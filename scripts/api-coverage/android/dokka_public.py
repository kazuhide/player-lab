#!/usr/bin/env python3
"""Inventory public, version-pinned Bitmovin Android Dokka API declarations.

Reads only official public distribution/docs and writes private artifacts.
Config, runtime API, events and optional modules are separate count domains.
"""
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

VERSION = ''
BASE = ''
CACHE = None
READ_CACHE = None
OFFLINE = False

class Node:
    def __init__(self, tag='', attrs=None, parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs or []), parent
        self.children = []

    @property
    def text(self):
        return ''.join(x if isinstance(x, str) else x.text for x in self.children)

    def all(self, pred):
        out = []
        for x in self.children:
            if isinstance(x, Node):
                if pred(x):
                    out.append(x)
                out.extend(x.all(pred))
        return out

    def cls(self, name):
        return name in self.attrs.get('class', '').split()


class Tree(HTMLParser):
    VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.current = self.root
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.current)
        self.current.children.append(n)
        if tag not in self.VOID:
            self.current = n

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        n = self.current
        while n.parent is not None:
            if n.tag == tag:
                self.current = n.parent
                return
            n = n.parent

    def handle_data(self, data):
        self.current.children.append(data)


def clean(s):
    return re.sub(r'\s+', ' ', s).strip()


def fetch(rel):
    path = Path(rel)
    if path.is_absolute() or '..' in path.parts:
        raise RuntimeError('Invalid Dokka relative path')
    if READ_CACHE is not None and (READ_CACHE / path).is_file():
        return (READ_CACHE / path).read_text()
    target = CACHE / path
    if target.exists():
        return target.read_text()
    if OFFLINE:
        raise RuntimeError('Offline cache is missing ' + rel)
    req = urllib.request.Request(BASE + rel, headers={'User-Agent':'Mozilla/5.0 public SDK inventory'})
    error = None
    for attempt in range(3):
        try:
            body = urllib.request.urlopen(req, timeout=45).read()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            return body.decode()
        except Exception as e:
            error = e
            time.sleep(0.4 * (attempt+1))
    raise RuntimeError(f'{rel}: {error}')


def parse_page(rel):
    t = Tree(fetch(rel))
    version_node = next(iter(t.root.all(lambda n:n.attrs.get('id')=='library-version')), None)
    if version_node is None or clean(version_node.text) != VERSION:
        raise RuntimeError('Dokka version does not match requested version: ' + rel)
    content = next(iter(t.root.all(lambda n:n.attrs.get('id')=='content')), None)
    if content is None:
        return {'page':rel,'error':'No content node'}
    title = next(iter(content.all(lambda n:n.tag=='h1')), None)
    owner = clean(title.text) if title else ''
    pathparts = rel.split('/')
    package = pathparts[1] if len(pathparts)>2 else ''
    members=[]
    for row in content.all(lambda n:n.cls('table-row')):
        kind = row.attrs.get('data-togglable','')
        ancestor=row.parent
        while kind not in ('PROPERTY','FUNCTION','CONSTRUCTOR','TYPE','ENTRY','TYPEALIAS','EXTENSION_FUNCTION','EXTENSION_PROPERTY') and ancestor is not None:
            kind=ancestor.attrs.get('data-togglable','')
            ancestor=ancestor.parent
        if kind not in ('PROPERTY','FUNCTION','CONSTRUCTOR','TYPE','ENTRY','TYPEALIAS','EXTENSION_FUNCTION','EXTENSION_PROPERTY'):
            continue
        subs=row.all(lambda n:n.cls('main-subrow'))
        if not subs:
            continue
        links=subs[0].all(lambda n:n.tag=='a' and bool(n.attrs.get('href')))
        if not links:
            continue
        link=links[0]
        url=urllib.parse.urljoin(BASE+rel,link.attrs['href'])
        signatures=row.all(lambda n:n.cls('symbol'))
        signature=clean(signatures[0].text) if signatures else ''
        paragraphs=row.all(lambda n:n.cls('paragraph'))
        annotation_text=' '.join(clean(n.text) for n in row.all(lambda n:n.cls('annotations')))
        text=clean(row.text)
        for sig in (signatures or [None]):
            signature=clean(sig.text) if sig else ''
            members.append({'kind':kind.lower(),'name':clean(link.text),'signature':signature,'url':url,
                        'type_urls':sorted(set(urllib.parse.urljoin(BASE+rel,n.attrs['href'])
                           for n in (sig.all(lambda n:n.tag=='a' and bool(n.attrs.get('href'))) if sig else [])
                           if n.attrs['href'].endswith('/index.html') and clean(n.text)!=clean(link.text))),
                        'deprecated':bool(sig and sig.all(lambda n:n.tag=='strike')),
                        'experimental':bool(sig and 'ExperimentalBitmovinApi' in signature),
                        'declaring_page':urllib.parse.urljoin(url,'index.html')})
    covers=content.all(lambda n:n.cls('cover'))
    cover_signatures=covers[0].all(lambda n:n.cls('symbol')) if covers else []
    signature=clean(cover_signatures[0].text) if cover_signatures else ''
    class_type_urls=sorted(set(urllib.parse.urljoin(BASE+rel,n.attrs['href'])
        for n in (cover_signatures[0].all(lambda n:n.tag=='a' and bool(n.attrs.get('href'))) if cover_signatures else [])
        if n.attrs['href'].endswith('/index.html')))
    inheritor_urls=sorted(set(urllib.parse.urljoin(BASE+rel,n.attrs['href'])
        for row in (covers[0].all(lambda n:n.cls('table-row')) if covers else [])
        for n in row.all(lambda n:n.tag=='a' and bool(n.attrs.get('href')))))
    return {'page':rel,'url':BASE+rel,'module':pathparts[0],'package':package,'owner':owner,
            'class_signature':signature,'class_type_urls':class_type_urls,'inheritor_urls':inheritor_urls,
            'members':members,
            'sha256':hashlib.sha256(json.dumps({'signature':signature,'members':[(m['kind'],m['name'],m['signature'],m['deprecated']) for m in members]},sort_keys=True,separators=(',',':')).encode()).hexdigest()}


def collect(version, scratch, read_cache=None, offline=False):
    global VERSION, BASE, CACHE, READ_CACHE, OFFLINE
    VERSION = version
    BASE = f'https://cdn.bitmovin.com/player/android/{version}/docs/'
    CACHE = Path(scratch)
    CACHE.mkdir(parents=True, exist_ok=True)
    READ_CACHE = Path(read_cache) if read_cache else None
    OFFLINE = offline
    nav = Tree(fetch('navigation.html'))
    urls = sorted(set(n.attrs['href'] for n in nav.root.all(lambda n:n.tag=='a' and n.attrs.get('href','').endswith('/index.html'))))
    type_pages = [url for url in urls if '/-' in url]
    package_pages = [url for url in urls if '/com.bitmovin.' in url and '/-' not in url]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        types = list(pool.map(parse_page, type_pages))
        packages = list(pool.map(parse_page, package_pages))
    errors = [r for r in types + packages if 'error' in r]
    if errors:
        raise RuntimeError(str(errors))
    return {'sdk':'Bitmovin Android','version':version,'base_url':BASE,
            'pages':types,'package_declarations':packages}
