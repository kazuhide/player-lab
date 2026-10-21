#!/usr/bin/env python3
"""Generate public binary provenance; no application configuration or credentials are read."""
import argparse,hashlib,json,re,subprocess,zipfile,urllib.request
from pathlib import Path
parser=argparse.ArgumentParser(description="Compare published Android SDK release and IMA-compatible variant without changing inventory IDs.")
parser.add_argument("--coverage-report",type=Path,required=True)
parser.add_argument("--output-dir",type=Path,required=True)
parser.add_argument("--gradle-cache",type=Path,default=Path.home()/".gradle/caches/modules-2/files-2.1/com.bitmovin.player")
parser.add_argument("--standard-source-jar",type=Path,required=True)
parser.add_argument("--javap",default="javap")
parser.add_argument("--command-wrapper",action="append",default=[])
parser.add_argument("--download-missing",action="store_true")
args=parser.parse_args()
ROOT=args.gradle_cache
OUT=args.output_dir;OUT.mkdir(parents=True,exist_ok=True)
report=json.loads(args.coverage_report.read_text())
release=next(s['version'] for s in report['sdks'] if s['id']=='android')
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', release): raise SystemExit('Expected an exact Android release version.')
jason=release+'+jason'
modules=['player','player-base','player-core','player-ui-web','player-analytics','player-media-session']
variants={}; artifacts=[]
for version in [release,jason]:
 jars=[];classes={}
 for module in modules:
  cached=list((ROOT/module/version).glob('*/*.aar'))
  if cached: aar=cached[0];data=aar.read_bytes()
  else:
   if not args.download_missing: raise SystemExit("Missing published artifact: "+module+":"+version+". Resolve it in Gradle or use --download-missing.")
   name=module+"-"+version+".aar"
   url="https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/"+module+"/"+version+"/"+name
   with urllib.request.urlopen(url,timeout=60) as response: data=response.read()
   aar=OUT/name;aar.write_bytes(data)
  with zipfile.ZipFile(aar) as z: raw=z.read('classes.jar')
  target=OUT/(module+'-'+version+'.jar');target.write_bytes(raw);jars.append(target)
  with zipfile.ZipFile(target) as z:
   for name in z.namelist():
    if name.endswith('.class'):
     binary=name[:-6].replace('/','.'); classes[binary.replace('$','.')]=binary
  artifacts.append({'group':'com.bitmovin.player','module':module,'version':version,'aarSha256':hashlib.sha256(data).hexdigest(),'classesJarSha256':hashlib.sha256(raw).hexdigest(),'officialArtifact':'https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/'+module+'/'+version+'/'+aar.name})
 variants[version]={'jars':jars,'classes':classes}
rows=next(a['rows'] for a in report['applications'] if a['id']=='android')
ownerFor={}
for row in rows:
 value=row['id'].removeprefix('android:'); matches=[x for x in variants[release]['classes'] if value==x or value.startswith(x+'.')]
 ownerFor[row['id']]=max(matches,key=len) if matches else None
owners=sorted({x for x in ownerFor.values() if x})
for version,v in variants.items():
 names=[v['classes'][owner] for owner in owners if owner in v['classes']]
 cmd=args.command_wrapper+[args.javap,'-public','-s','-classpath',':'.join(map(str,v['jars'])),*names]
 r=subprocess.run(cmd,capture_output=True,text=True,check=True); (OUT/('public-'+version+'.txt')).write_text(r.stdout)
 signatures={};current=None
 for line in r.stdout.splitlines():
  match=re.match(r'public (?:.*?)\b(?:class|interface|enum) ([^ <]+)',line)
  if match:
   current=match.group(1).replace('$','.');signatures[current]=[]
  if current and line.strip() and not line.startswith('Compiled from'):signatures[current].append(line.strip())
 v['signatures']=signatures
normalize=lambda text:text.replace('com.bitmovin.media3.','MEDIA3.').replace('androidx.media3.','MEDIA3.').replace('com/bitmovin/media3/','MEDIA3/').replace('androidx/media3/','MEDIA3/')
result=[]
for row in rows:
 owner=ownerFor[row['id']];a='\n'.join(variants[release]['signatures'].get(owner,[]));b='\n'.join(variants[jason]['signatures'].get(owner,[]))
 member=row['id'].removeprefix('android:').removeprefix((owner or '')+'.').removesuffix('()')
 getter='get'+member[:1].upper()+member[1:]; setter='set'+member[:1].upper()+member[1:]
 names=[member,getter,setter]
 if member.startswith('is'): names+=[member,'set'+member[2:]]
 has=lambda sig: bool(owner and (row['category']=='event' and member==owner or any(re.search(r'\b'+re.escape(x)+r'\(',sig) for x in names)))
 result.append({'id':row['id'],'category':row['category'],'owner':owner,'member':member,'standardOwnerPresent':bool(a),'jasonOwnerPresent':bool(b),'standardMemberPresent':has(a),'jasonMemberPresent':has(b),'byteIdenticalPublicOwnerShape':a==b and bool(a),'relocatedMedia3EquivalentOwnerShape':normalize(a)==normalize(b) and bool(a),'shapeDifferenceOwner': None if a==b else owner})
packet={'schemaVersion':1,'sdk':'Android Player','checkedAt':report['checkedAt'],'baseInventoryRows':len(rows),'inventoryUnchanged':True,'variantsCompared':[release,jason],'normalization':'Only the explicit Media3 package relocation androidx.media3. <-> com.bitmovin.media3. is normalized for the equivalence field; raw public JVM signatures are retained. No API IDs are changed or removed.','artifacts':artifacts,'sourceArtifact':{'version':release,'sha256':hashlib.sha256(args.standard_source_jar.read_bytes()).hexdigest(),'appliesTo':'Original standard source inventory; not asserted byte-identical to the +jason binaries.'},'publicOwners':{owner:{'standard':variants[release]['signatures'].get(owner,[]),'jason':variants[jason]['signatures'].get(owner,[])} for owner in owners},'rows':result}
path=OUT/'android-sdk-variant-contract.json';path.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'packet':str(path),'rows':len(result),'missingOwner':len([r for r in result if not r['standardOwnerPresent'] or not r['jasonOwnerPresent']]),'unmatchedMember':len([r for r in result if not r['standardMemberPresent'] or not r['jasonMemberPresent']]),'rawOwnerShapeDifference':len([r for r in result if not r['byteIdenticalPublicOwnerShape']]),'relocationOnlyEquivalent':len([r for r in result if r['relocatedMedia3EquivalentOwnerShape']]),'otherShapeDifferences':len([r for r in result if not r['relocatedMedia3EquivalentOwnerShape']])}))
