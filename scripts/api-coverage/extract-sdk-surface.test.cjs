const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { createExtractor } = require('./extract-sdk-surface.cjs');
const { checkReport, checkSdkEvidence, reactNativeReference } = require('./extract-installed.cjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-public-sdk-'));
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), "{\"name\":\"public-sdk-fixture\",\"version\":\"1.0.0\",\"types\":\"index.d.ts\"}\n");
fs.writeFileSync(path.join(fixtureRoot, 'index.d.ts'), "export interface Shared { enabled?: boolean; }\nexport interface Recursive { next?: Recursive; value?: number; }\nexport declare class Handle { run(): void; }\nexport interface Config {\n    flag?: boolean;\n    nested?: Shared;\n    other?: Shared;\n    entries?: { name: string }[];\n    labels?: string[];\n    choice?: string | { value: number };\n    callback?: (input: string) => boolean;\n    map?: { [key: string]: number };\n    mixed?: { [key: string]: unknown; documented?: boolean };\n    finite?: Partial<Record<'plain' | 'a-b', number>>;\n    recursive?: Recursive;\n    handle?: Handle;\n    element?: HTMLElement;\n    /** @hidden */\n    hidden?: boolean;\n    /** @deprecated */\n    old?: number;\n}\nexport interface Namespace { set(value: number): void; get(): number; }\nexport interface API {\n    readonly values: string[];\n    readonly namespace: Namespace;\n    readonly exports: Namespace;\n    act(value: string): void;\n    act(value: number): void;\n    getState(): string;\n}\nexport declare enum Events {\n    Open = 'open',\n    Close = 'close',\n    /** @hidden */\n    Internal = 'internal'\n}\n\nexport declare const PublicManager: { connect(endpoint: string): void; isConnected(): boolean; };\n");
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
function fixture(){return createExtractor({packageRoot:fixtureRoot,entryFile:'index.d.ts'});}
test('config denominator preserves callbacks, named members beside dynamic maps, finite mapped keys and structured array leaves',()=>{
 const x=fixture();const {rows}=x.configuration(['Config']);const byId=new Map(rows.map(row=>[row.id,row]));
 for(const id of ['Config.flag','Config.nested.enabled','Config.other.enabled','Config.entries[].name','Config.labels','Config.choice','Config.choice.value','Config.callback','Config.map','Config.mixed{*}','Config.mixed.documented','Config.finite.plain','Config.finite["a-b"]'])assert.ok(byId.has(id),id);
 assert.deepEqual(byId.get('Config.callback').kinds,['callback']);
 assert.deepEqual(byId.get('Config.labels').kinds,['scalar-array']);
 assert.equal(byId.get('Config.map').indices[0].key,'string');
 assert.ok(rows.every(row=>row.declarations.length && row.declarations.every(d=>Number.isInteger(d.line)&&d.sha256.length===64)));
});
test('config stops at recursive, instance and DOM boundaries and excludes hidden declarations without dropping deprecated fields',()=>{
 const {rows,excluded}=fixture().configuration(['Config']);const byId=new Map(rows.map(row=>[row.id,row]));
 assert.deepEqual(byId.get('Config.recursive.next').kinds,['recursive-boundary']);
 assert.deepEqual(byId.get('Config.handle').kinds,['instance-boundary']);
 assert.deepEqual(byId.get('Config.element').kinds,['external-boundary']);
 assert.equal(byId.get('Config.old').deprecated,true);assert.equal(byId.has('Config.hidden'),false);assert.ok(excluded.some(row=>row.id==='Config.hidden'));
 assert.equal(rows.some(row=>row.id.startsWith('Config.handle.run')),false);
});
test('methods dedupe overloads, traverse declared namespaces, and never include array prototype APIs',()=>{
 const {rows,values}=fixture().methods(['API'],{omitPaths:['API.exports']});
 assert.deepEqual(rows.map(row=>row.id),['API.act','API.getState','API.namespace.get','API.namespace.set']);
 assert.equal(rows.find(row=>row.id==='API.act').signatures.length,2);
 assert.equal(rows.find(row=>row.id==='API.getState').category,'observation');
 assert.ok(values.some(row=>row.id==='API.values'));assert.equal(rows.some(row=>row.id.includes('.map')),false);
});
test('events come from the enum, and missing exports fail instead of silently reducing the denominator',()=>{
 const x=fixture();assert.deepEqual(x.enumeration('Events').map(row=>row.value),['open','close']);
 assert.throws(()=>x.configuration(['Unknown']),/Missing public export/);
 assert.throws(()=>x.enumeration('Config'),/not an enum/);
 assert.equal(x.diagnostics().filter(d=>!d.commentOnly).length,0);
});

test('caller can select platform libraries without weakening strict no-emit declaration checking',()=>{
 const x=createExtractor({packageRoot:fixtureRoot,entryFile:'index.d.ts',compilerOptions:{lib:['lib.esnext.d.ts'],strict:false,skipLibCheck:true,noEmit:false}});
 assert.equal(x.compilerOptions.strict,true);assert.equal(x.compilerOptions.skipLibCheck,false);assert.equal(x.compilerOptions.noEmit,true);
 assert.deepEqual(x.compilerOptions.lib,['lib.esnext.d.ts']);
 assert.ok(x.diagnostics().some(d=>d.code===2304 && d.message.includes('HTMLElement')));
});

test('value-exported managers retain public callable members and allow official package-specific references',()=>{
 const x=createExtractor({packageRoot:fixtureRoot,entryFile:'index.d.ts',referenceFor:(id,declarations)=>`https://example.invalid/v1/${declarations[0]?.file || 'index.d.ts'}#${id}`});
 const result=x.methods(['PublicManager']);assert.deepEqual(result.rows.map(row=>row.id),['PublicManager.connect','PublicManager.isConnected']);
 assert.equal(result.rows[0].officialReference,'https://example.invalid/v1/index.d.ts#PublicManager.connect');
 assert.ok(x.configuration(['Config']).rows.every(row=>row.officialReference.startsWith('https://example.invalid/v1/')));
 assert.ok(x.enumeration('Events').every(row=>row.officialReference.startsWith('https://example.invalid/v1/')));
});

function documentationFixture(packageName, annotated, run, extra = []) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-sdk-reference-'));
 try {
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:packageName,version:'1.0.0'}));
  fs.writeFileSync(path.join(root,'index.d.ts'),"export * from './Export';\n");
  fs.writeFileSync(path.join(root,'Export.d.ts'),(annotated?'/** @module Core */\n':'')+"export * from './API';\n");
  fs.writeFileSync(path.join(root,'API.d.ts'),[
   'export interface Nested { enabled?: boolean; }',
   'export interface Config { nested?: Nested; }',
   'export declare class Base { release(): void; }',
   'export declare class Manager extends Base { activate(): void; getState(): string; }',
   "export declare enum Events { Open = 'open' }",
   ...extra,
  ].join('\n'));
  run(createExtractor({packageRoot:root,entryFile:'index.d.ts'}));
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
}

test('Web references use public module exports and the actual declaring owner and kind',()=>{
 documentationFixture('bitmovin-player',true,x=>{
  assert.equal(x.configuration(['Config']).rows[0].officialReference,'https://cdn.bitmovin.com/player/web/8/docs/interfaces/Core.Nested.html#enabled');
  const methods=new Map(x.methods(['Manager']).rows.map(row=>[row.id,row]));
  assert.equal(methods.get('Manager.release').officialReference,'https://cdn.bitmovin.com/player/web/8/docs/classes/Core.Base.html#release');
  assert.equal(methods.get('Manager.activate').officialReference,'https://cdn.bitmovin.com/player/web/8/docs/classes/Core.Manager.html#activate');
  assert.equal(x.enumeration('Events')[0].officialReference,'https://cdn.bitmovin.com/player/web/8/docs/enums/Core.Events.html#Open');
  assert.ok(x.documentationArtifacts.some(a=>a.file==='Export.d.ts' && a.module==='Core' && a.sha256.length===64));
 });
});

test('UI references retain unprefixed interface, class and enum owners',()=>{
 documentationFixture('bitmovin-player-ui',false,x=>{
  assert.equal(x.configuration(['Config']).rows[0].officialReference,'https://cdn.bitmovin.com/player/ui/4/docs/interfaces/Nested.html#enabled');
  assert.equal(x.methods(['Manager']).rows.find(r=>r.id==='Manager.release').officialReference,'https://cdn.bitmovin.com/player/ui/4/docs/classes/Base.html#release');
  assert.equal(x.methods(['Manager']).rows.find(r=>r.id==='Manager.getState').officialReference,'https://cdn.bitmovin.com/player/ui/4/docs/classes/Manager.html#getstate');
  assert.equal(x.enumeration('Events')[0].officialReference,'https://cdn.bitmovin.com/player/ui/4/docs/enums/Events.html#open');
 });
});

test('SDK interfaces extending Array and ReadonlyArray expose element fields without library prototypes',()=>{
 documentationFixture('bitmovin-player',true,x=>{
  const rows=x.configuration(['ArrayConfig']).rows;
  assert.deepEqual(rows.map(r=>r.id),[
   'ArrayConfig.clearkey[].id','ArrayConfig.clearkey[].key','ArrayConfig.names',
   'ArrayConfig.nested[][].id','ArrayConfig.nested[][].key',
   'ArrayConfig.readonlyKeys[].id','ArrayConfig.readonlyKeys[].key','ArrayConfig.recursive[]',
  ]);
  assert.deepEqual(rows.find(r=>r.id==='ArrayConfig.names').kinds,['scalar-array']);
  assert.deepEqual(rows.find(r=>r.id==='ArrayConfig.recursive[]').kinds,['recursive-boundary']);
  assert.ok(rows.every(r=>r.declarations.every(d=>!d.file.startsWith('..'))));
  const runtime=x.methods(['ArrayAPI']);assert.deepEqual(runtime.rows,[]);
  assert.deepEqual(runtime.values.map(r=>r.id),['ArrayAPI.keys','ArrayAPI.nested']);
 },[
  'export interface Entry { id: string; key: string; }',
  'export interface Keys extends Array<Entry> {}',
  'export interface ReadonlyKeys extends ReadonlyArray<Entry> {}',
  'export interface RecursiveArray extends ReadonlyArray<RecursiveArray> {}',
  'export interface ArrayConfig { clearkey?: Keys; readonlyKeys?: ReadonlyKeys; nested?: ReadonlyArray<ReadonlyKeys>; names?: ReadonlyArray<string>; recursive?: RecursiveArray; }',
  'export interface ArrayAPI { readonly keys: Keys; readonly nested: ReadonlyArray<ReadonlyKeys>; }',
 ]);
});

function reportFixture() {
 const member={id:'PlayerAPI.play',category:'command',scope:'PlayerAPI',deprecated:false,
  officialReference:'https://cdn.bitmovin.com/player/web/8/docs/interfaces/Core.PlayerAPI.html#play',
  declarations:[{file:'types/core/PlayerAPI.d.ts',line:32,sha256:'a'.repeat(64)}]};
 const inventory={id:'web',sdkId:'web',package:'bitmovin-player',version:'8.280.0',declaredVersion:'8.280.0',diagnostics:[],rows:[member]};
 const proof={kind:'sdk',package:inventory.package,version:inventory.version,...member.declarations[0]};
 const report={sdks:[{id:'web',version:inventory.version}],applications:[{id:'web',sdkId:'web',rows:[{
  id:member.id,category:member.category,scope:member.scope,deprecated:member.deprecated,officialReference:member.officialReference,
  evidence:[proof,{kind:'sdk',package:'bitmovin-player-ui',version:'4.23.0',file:'dist/js/framework/components/Component.js',sha256:'b'.repeat(64),line:1}],
 }]}]};
 return {report,inventories:[inventory]};
}

function sdkByteFixture(run) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'public-sdk-bytes-'));
 try {
  const {report,inventories}=reportFixture();
  const roots=new Map();
  const makePackage=(folder,name,version)=>{
   const root=path.join(directory,folder);fs.mkdirSync(root);
   fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name,version}));
   roots.set(`${name}@${version}`,root);return root;
  };
  const core=makePackage('core','bitmovin-player','8.280.0');
  const ui=makePackage('ui','bitmovin-player-ui','4.23.0');
  const proofs=report.applications[0].rows[0].evidence;
  proofs[1].file='dist/js/framework/components/seekbar/SeekBar.js';proofs[1].line=2;
  const sources=[Buffer.from('// public declaration fixture\n'.repeat(32)),Buffer.from('player.seek(1);\r\nplayer.seek(2);\r\n')];
  for(let i=0;i<proofs.length;i++){
   const target=path.join(i===0?core:ui,proofs[i].file);fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,sources[i]);proofs[i].sha256=crypto.createHash('sha256').update(sources[i]).digest('hex');
  }
  inventories[0].rows[0].declarations[0].sha256=proofs[0].sha256;
  run({report,inventories,roots,directory,core,ui,proofs,sources,makePackage});
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
}

test('installed byte check verifies additional runtime files across pinned packages and caches files without dropping proofs',()=>{
 sdkByteFixture(({report,inventories,roots,proofs})=>{
  assert.doesNotThrow(()=>checkReport(report,inventories));
  assert.deepEqual(checkSdkEvidence(report,roots),{packages:2,files:2,proofs:2});
  proofs.push({...proofs[1],line:1});delete proofs[1].line;
  assert.deepEqual(checkSdkEvidence(report,roots),{packages:2,files:2,proofs:3});
 });
});

test('runtime SDK tampering, forged hashes and invalid lines fail even after a file was already proven',()=>{
 sdkByteFixture(({report,roots,ui,proofs,sources})=>{
  const target=path.join(ui,proofs[1].file);
  fs.writeFileSync(target,Buffer.concat([sources[1],Buffer.from('changed();\n')]));
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence bytes differ/);
  fs.writeFileSync(target,sources[1]);
  const original=proofs[1].sha256;proofs[1].sha256='f'.repeat(64);
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence bytes differ/);proofs[1].sha256=original;
  for(const line of [0,-1,1.5,true]){
   proofs[1].line=line;assert.throws(()=>checkSdkEvidence(report,roots),/Invalid SDK evidence line/);
  }
  proofs[1].line=2;proofs.push({...proofs[1],line:3});
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence line is outside the file/);
  proofs.pop();proofs[0].line=33;
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence line is outside the file/);
 });
});

test('SDK byte paths reject traversal, secret files, symlink escapes and nonregular files before reading',()=>{
 sdkByteFixture(({report,roots,ui,directory,proofs})=>{
  const original=proofs[1].file;
  for(const file of ['../outside.js','/tmp/outside.js','C:\\outside.js','dist\\outside.js','dist/../../outside.js',
    './inside.js','.env','dist/.env.local','local.properties','dist/local.xcconfig',{},null]){
   proofs[1].file=file;assert.throws(()=>checkSdkEvidence(report,roots),/Unsafe SDK package-relative evidence path/);
  }
  const outside=path.join(directory,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'proof.js'),'public fixture\n');
  fs.symlinkSync(outside,path.join(ui,'escape'),'dir');fs.symlinkSync(path.join(outside,'proof.js'),path.join(ui,'alias.js'),'file');
  for(const file of ['escape/proof.js','alias.js']){
   proofs[1].file=file;assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence symlink is forbidden/);
  }
  proofs[1].file='dist';assert.throws(()=>checkSdkEvidence(report,roots),/regular package file/);
  proofs[1].file='dist/missing.js';assert.throws(()=>checkSdkEvidence(report,roots),/Cannot read public SDK package file/);
  proofs[1].file=original;
  const manifest=path.join(ui,'package.json');fs.unlinkSync(manifest);fs.symlinkSync(path.join(outside,'proof.js'),manifest,'file');
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence symlink is forbidden/);
 });
});

test('SDK byte check refuses unknown packages, wrong versions and installed metadata that disagrees with the trusted pin',()=>{
 sdkByteFixture(({report,roots,ui,proofs,makePackage,core})=>{
  for(const [name,version] of [['not-installed','1.0.0'],['bitmovin-player-ui','4.22.0']]){
   const original={...proofs[1]};proofs[1].package=name;proofs[1].version=version;
   assert.throws(()=>checkSdkEvidence(report,roots),/Unknown installed SDK evidence package\/version/);Object.assign(proofs[1],original);
  }
  for(const metadata of [{name:'other-package',version:'4.23.0'},{name:'bitmovin-player-ui',version:'4.22.0'}]){
   fs.writeFileSync(path.join(ui,'package.json'),JSON.stringify(metadata));
   assert.throws(()=>checkSdkEvidence(report,roots),/Installed SDK evidence package\/version mismatch/);
  }
  fs.writeFileSync(path.join(ui,'package.json'),JSON.stringify({name:'bitmovin-player-ui',version:'4.23.0'}));
  const vega=makePackage('vega','bitmovin-player','8.138.0-beta.28');
  fs.mkdirSync(path.dirname(path.join(vega,proofs[0].file)),{recursive:true});
  fs.copyFileSync(path.join(core,proofs[0].file),path.join(vega,proofs[0].file));
  proofs[0].version='8.138.0-beta.28';
  assert.throws(()=>checkSdkEvidence(report,roots),/SDK evidence version differs from the application pin/);
 });
});

test('installed check accepts independent declaration proof plus additional SDK UI route evidence',()=>{
 const {report,inventories}=reportFixture();
 assert.deepEqual(checkReport(report,inventories),[{id:'web',version:'8.280.0',members:1,categories:{configuration:0,command:1,observation:0,event:0}}]);
});

test('installed check rejects missing APIs and synthetic prototype IDs',()=>{
 const missing=reportFixture();missing.report.applications[0].rows=[];
 assert.throws(()=>checkReport(missing.report,missing.inventories),/1 missing, 0 extra/);
 const extra=reportFixture();extra.report.applications[0].rows.push({...extra.report.applications[0].rows[0],id:'SourceConfig.drm.clearkey.splice'});
 assert.throws(()=>checkReport(extra.report,extra.inventories),/0 missing, 1 extra/);
});

test('installed check independently verifies category, scope, deprecation and official references',()=>{
 for(const [fact,value] of [['category','observation'],['scope','WrongScope'],['deprecated',true],['officialReference','https://cdn.bitmovin.com/player/web/8/docs/interfaces/PlayerAPI.html#play']]){
  const {report,inventories}=reportFixture();report.applications[0].rows[0][fact]=value;
  assert.throws(()=>checkReport(report,inventories),new RegExp('SDK member '+fact+' differs'));
 }
});

test('SDK evidence must match the exact declaration package, version, file, hash and line',()=>{
 for(const [fact,value] of [['package','bitmovin-player-ui'],['version','8.279.0'],['file','types/core/Config.d.ts'],['sha256','c'.repeat(64)],['line',33]]){
  const {report,inventories}=reportFixture();report.applications[0].rows[0].evidence[0][fact]=value;
  assert.throws(()=>checkReport(report,inventories),/SDK declaration evidence differs/);
 }
 const unrelated=reportFixture();unrelated.report.applications[0].rows[0].evidence.shift();
 assert.throws(()=>checkReport(unrelated.report,unrelated.inventories),/SDK declaration evidence differs/);
});

test('all overload declaration locations must remain proven',()=>{
 const {report,inventories}=reportFixture();
 inventories[0].rows[0].declarations.push({...inventories[0].rows[0].declarations[0],line:33});
 assert.throws(()=>checkReport(report,inventories),/SDK declaration evidence differs/);
 report.applications[0].rows[0].evidence.push({...report.applications[0].rows[0].evidence[0],line:33});
 assert.doesNotThrow(()=>checkReport(report,inventories));
});

test('installed check rejects SDK pin drift, declaration diagnostics and non-public provenance',()=>{
 const manifest=reportFixture();manifest.inventories[0].declaredVersion='8.279.0';
 assert.throws(()=>checkReport(manifest.report,manifest.inventories),/exact manifest pin/);
 const version=reportFixture();version.report.sdks[0].version='8.279.0';
 assert.throws(()=>checkReport(version.report,version.inventories),/Reported SDK version differs/);
 const diagnostic=reportFixture();diagnostic.inventories[0].diagnostics.push({code:2304,message:'Cannot find name MissingPublicType'});
 assert.throws(()=>checkReport(diagnostic.report,diagnostic.inventories),/declaration diagnostics/);
 const external=reportFixture();external.inventories[0].rows[0].declarations[0].file='../typescript/lib/lib.es5.d.ts';
 assert.throws(()=>checkReport(external.report,external.inventories),/Non-public declaration provenance/);
});

test('installed check rejects duplicate report or extracted IDs and incorrect SDK bindings',()=>{
 const duplicate=reportFixture();duplicate.report.applications[0].rows.push(duplicate.report.applications[0].rows[0]);
 assert.throws(()=>checkReport(duplicate.report,duplicate.inventories),/Duplicate/);
 const extracted=reportFixture();extracted.inventories[0].rows.push(extracted.inventories[0].rows[0]);
 assert.throws(()=>checkReport(extracted.report,extracted.inventories),/Duplicate/);
 const binding=reportFixture();binding.report.applications[0].sdkId='vega';
 assert.throws(()=>checkReport(binding.report,binding.inventories),/application SDK binding/);
});

test('React Native references preserve the pinned release and actual TS/TSX source extensions',()=>{
 assert.equal(reactNativeReference('1.28.0','Player.load',[{file:'build/player.d.ts'}]),'https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/src/player.ts');
 assert.equal(reactNativeReference('1.28.0','PlayerView',[{file:'build/components/PlayerView/index.d.ts'}]),'https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/src/components/PlayerView/index.tsx');
 assert.throws(()=>reactNativeReference('1.28.0','Player.load',[{file:'../native/Private.d.ts'}]),/published build declarations/);
});


test('reading tag names does not turn documentation links into declaration type errors',()=>{
 documentationFixture('bitmovin-player',true,x=>{
  const rows=x.configuration(['DocumentationHolder']).rows;
  assert.equal(rows.find(r=>r.id==='DocumentationHolder.old').deprecated,true);
  assert.equal(x.diagnostics().length,0);
 },[
  'export interface DocumentationFields { value: boolean; }',
  'export interface DocumentationHolder {',
  '  /** @deprecated Use {@link DocumentationFields.value} instead. */',
  '  old?: boolean;',
  '}',
 ]);
});

test('strict unresolved declaration types still fail after API enumeration',()=>{
 documentationFixture('bitmovin-player',true,x=>{
  x.configuration(['UnresolvedHolder']);
  assert.ok(x.diagnostics().some(d=>d.code===2304 && d.message.includes('MissingPublicType')));
 },['export interface UnresolvedHolder { value?: MissingPublicType; }']);
});
