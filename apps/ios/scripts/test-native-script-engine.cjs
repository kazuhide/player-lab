const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.join(__dirname, '../Showcase/NativeScripts');
function context(initial = {}) {
  const sandbox = vm.createContext(initial);
  for (const file of ['acorn.js', 'engine.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), sandbox, {timeout: 2000});
  return sandbox;
}
function run(source, input = {}) {
  const sandbox = context();
  sandbox.source = source; sandbox.input = input;
  return vm.runInContext('PlayerLabScriptEngine.create({example: source}).call("example", input)', sandbox, {timeout: 2000});
}
const equal = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

test('edited DRM bytes, labels, network objects and arrow callbacks use plain snapshots', () => {
  equal(run('return input.bytes.map((byte, index) => (byte + index + input.assetId.length) % 256);', {bytes: [1, 254], assetId: 'id'}), [3, 1]);
  assert.equal(run("return 'asset:' + input.contentId.toUpperCase();", {contentId: 'abc'}), 'asset:ABC');
  assert.equal(run("return input.url.replace('/old', '/new');", {url: 'https://example.com/old'}), 'https://example.com/new');
  const input = {request: {method: 'GET', headers: {}}};
  equal(run("input.request.headers['X-Example'] = 'manifest'; input.request.method = 'POST'; input.request.body = {utf8: 'hello'}; return input.request;", input), {method: 'POST', headers: {'X-Example': 'manifest'}, body: {utf8: 'hello'}});
  equal(input, {request: {method: 'GET', headers: {}}});
});

test('finite loops, branching, functions, lexical variables and array reductions work', () => {
  assert.equal(run('let total = 0; for (let i = 0; i < input.count; i++) { if (i === 2) continue; total += i; } return total;', {count: 5}), 8);
  assert.equal(run('function twice(x) { return x * 2; } return input.bytes.filter(x => x > 1).map(twice).reduce((sum, x) => sum + x, 0);', {bytes: [1, 2, 3]}), 10);
  assert.equal(run('let i = 0; do { i++; } while (i < 3); while (i < 5) i++; return i;'), 5);
  assert.equal(run('let sum = 0; for (const item of input.items) { sum += item; } return sum;', {items: [2, 3]}), 5);
  assert.equal(run('let value = ""; for (const name in input.headers) value += name; return value;', {headers: {a: 1, b: 2}}), 'ab');
  assert.equal(run('switch (input.code) {case 1: return "one"; default: return "other";}', {code: 2}), 'other');
});

test('storage is shared within an owner and failed callbacks do not publish partial mutations', () => {
  const sandbox = context();
  vm.runInContext("engine = PlayerLabScriptEngine.create({write: 'storage.lastSeek = input.time;', read: 'return storage.lastSeek;', bad: 'storage.lastSeek = 999; while(true) {}'});", sandbox);
  vm.runInContext('engine.call("write", {time: 42})', sandbox, {timeout: 2000});
  assert.equal(vm.runInContext('engine.call("read", {})', sandbox, {timeout: 2000}), 42);
  assert.throws(() => vm.runInContext('engine.call("bad", {})', sandbox, {timeout: 2000}), /budget/);
  assert.equal(vm.runInContext('engine.call("read", {})', sandbox, {timeout: 2000}), 42);
  equal(vm.runInContext('engine.inspectStorage()', sandbox), {lastSeek: 42});
});

for (const source of [
  'while (true) {}',
  'for (;;) {}',
  'do {} while (true);',
  'try { while(true) {} } catch (error) { return true; }',
  'try { while(true) {} } finally { return true; }',
  'try { try { while(true) {} } catch(e) {} } finally { return true; }',
  'function recurse() { return recurse(); } return recurse();',
  'const f = x => f(x); return f(1);',
]) test('runaway code terminates with an uncaught engine quota: ' + source, () => {
  assert.throws(() => run(source), /budget|depth/i);
});

for (const source of [
  'return input.constructor.constructor("return globalThis")();',
  'return ({}).constructor;',
  'return input["__" + "proto__"];',
  'return Object["con" + "structor"]("return this")();',
  'return (()=>0).call(null);',
  'return Function("return 1")();',
  'return eval("1");',
  'return globalThis;',
  'return this;',
  'return /(?:a+)+$/.test(input.text);',
  'return new RegExp(input.text);',
  'return Object.create(input);',
  'return import("node:fs");',
  'return async () => 1;',
]) test('host access or unsupported dynamic execution fails closed: ' + source, () => {
  assert.throws(() => run(source, {text: 'a'.repeat(100)}));
});

for (const source of [
  'return "x".repeat(1000000000);',
  'return new Array(1000000000);',
  'return new Uint8Array(1000000000);',
  'return "x".padEnd(1000000000);',
  'let value = "x"; for(let i = 0; i < 30; i++) value += value; return value;',
  'const value = []; value[1000000000] = 1; return value;',
  'const value = []; value.length = 1000000000; return value;',
  'let value = {}; for(let i = 0; i < 30; i++) value = {a:value,b:value}; return value;',
  'const value = []; value.push(value); return value;',
  'storage.value = "x".repeat(200000); return true;',
  'return "x".repeat(100000).replaceAll("", "$\'".repeat(1000));',
  'return Object.keys("x".repeat(300000));',
  'return {..."x".repeat(300000)};',
]) test('value growth is bounded before large native allocation: ' + source, () => {
  assert.throws(() => run(source), /budget|limit|supported/);
});

test('large SDK strings are distinct from the editor source limit', () => {
  assert.equal(run('return input.body.length;', {body: 'x'.repeat(80000)}), 80000);
  equal(run('return input.bytes.slice(0, 3);', {bytes: [1, 2, 3, 4]}), [1, 2, 3]);
});

test('JSON, headers, numeric helpers and string substitutions stay within value operations', () => {
  equal(run('return Object.fromEntries(Object.entries(input.headers).map(pair => [pair[0].toUpperCase(), pair[1]]));', {headers: {test: 'yes'}}), {TEST: 'yes'});
  assert.equal(run('return JSON.stringify(JSON.parse(input.body));', {body: '{"a":[1,2]}'}), '{"a":[1,2]}');
  assert.equal(run('return Math.round(input.height / 3) + "px";', {height: 100}), '33px');
  assert.equal(run('return "abc".replace("b", "[$&]");'), 'a[b]c');
  assert.equal(run('return "aba".replaceAll("a", (value, index) => String(index));'), '0b2');
  assert.equal(run('return "abc".replace("b", () => "$&");'), 'a$&c');
  assert.equal(run('return "abc".replaceAll("", "-");'), '-a-b-c-');
  equal(run('return Array.from("😀");'), ['😀']);
  assert.equal(run('return `${input.height}p`;', {height: 720}), '720p');
});

test('ordinary user throw can be caught while diagnostics omit user content', () => {
  assert.equal(run('try { throw new Error("example"); } catch(error) { return error.message; }'), 'example');
  assert.throws(() => run('throw new Error(input.secret);', {secret: 'must-not-be-logged'}), error => !error.message.includes('must-not-be-logged'));
});

test('missing-value equality follows JavaScript without treating zero or false as null', () => {
  equal(run('return [null == 0, null == false, null == "0", null == undefined, null != 0, "foo" == ["foo"], false == []];'), [false, false, false, true, true, true, true]);
});

test('Number distinguishes an omitted argument from an explicit undefined value', () => {
  equal(run('return [Number(), Number.isNaN(Number(undefined)), Number.isNaN(Number(input.missing)), Number(null)];'), [0, true, true, 0]);
});

test('for-loop closures retain each iteration binding', () => {
  equal(run('const functions = []; for(let i=0;i<3;i++){functions.push(()=>i);} return functions.map(fn=>fn());'), [0, 1, 2]);
});

test('named function expressions bind their own name only within the function', () => {
  assert.equal(run('const f=function again(n){return n ? again(n-1) : 0;}; return f(2);'), 0);
  assert.equal(run('const f=function again(n){return n;}; return typeof again;'), 'undefined');
  assert.equal(run('const f=function again(again){return again;}; return f(7);'), 7);
});

test('var is rejected before application with an actionable syntax message', () => {
  const sandbox = context();
  for (const source of ['if(true){var x=7;} return x;', 'var x=1; var x=2; return x;']) {
    sandbox.source = source;
    assert.throws(() => vm.runInContext('PlayerLabScriptEngine.validate(source)', sandbox), /Use let or const/);
  }
});

test('ordinary builtin errors can be caught without allowing quota failures to be caught', () => {
  assert.equal(run('try { return JSON.parse(input.body); } catch(error) { return error.name; }', {body: '{'}), 'SyntaxError');
  assert.equal(run('try { return decodeURIComponent(input.url); } catch(error) { return error.name; }', {url: '%'}), 'URIError');
});

test('explicit undefined leaves optional slice arguments at their normal defaults', () => {
  assert.equal(run('return "abc".slice(1, input.end);'), 'bc');
  assert.equal(run('return "abc".substring(1, input.end);'), 'bc');
  assert.equal(run('return "abc".substr(1, input.end);'), 'bc');
  equal(run('return [1,2,3].slice(1, input.end);'), [2, 3]);
  assert.equal(run('return JSON.stringify(input.missing);'), undefined);
});

test('sparse arrays retain normal iteration behavior inside callback scripts', () => {
  assert.equal(run('let calls=0; new Array(3).map(()=>calls++); return calls;'), 0);
  assert.equal(run('let calls=0; [,2,].forEach(()=>calls++); return calls;'), 1);
  assert.equal(run('return [,2,3].reduce((sum,n)=>sum+n);'), 5);
  assert.equal(run('return [,,].reduce((sum,n)=>sum+n, 7);'), 7);
  assert.equal(run('try { return [,,].reduce((sum,n)=>sum+n); } catch(e) { return "empty"; }'), 'empty');
  assert.equal(run('let n=0; [7].concat(new Array(2)).forEach(()=>n++); return n;'), 1);
  assert.equal(run('let n=0; new Array(2).concat([7]).forEach(()=>n++); return n;'), 1);
});

test('predicates retain the visited element when editing their input array', () => {
  equal(run('const a=[1]; return a.filter((v,i)=>{a[i]=2;return true;});'), [1]);
  assert.equal(run('const a=[1]; return a.find((v,i)=>{a[i]=2;return true;});'), 1);
});

test('unsupported JSON options fail explicitly instead of being silently ignored', () => {
  const sandbox = context();
  for (const source of ['return JSON.parse(input.body, (key,value)=>value);', 'return JSON.stringify(input, null, 2);']) {
    sandbox.source = source;
    assert.throws(() => vm.runInContext('PlayerLabScriptEngine.validate(source)', sandbox), /one argument/);
  }
  assert.throws(() => run('const parse=JSON.parse; return parse(input.body, (key,value)=>value);', {body: '{}'}));
});

test('elapsed quota is checked before even a short result and storage change are published', () => {
  const sandbox = context();
  vm.runInContext('let reads=0; Date={now:()=>++reads<=2?0:300}; engine=PlayerLabScriptEngine.create({test:"storage.value=2; return true;"});', sandbox);
  assert.throws(() => vm.runInContext('engine.call("test", {})', sandbox, {timeout: 2000}), /elapsed-time budget/);
  equal(vm.runInContext('Date={now:()=>0}; engine.inspectStorage()', sandbox), {});
});

test('the trusted thread CPU clock is checked and is unavailable to interpreted scripts', () => {
  let cpu = 0;
  const sandbox = context({__playerLabThreadCPUTimeMilliseconds: () => cpu});
  sandbox.advance = () => { cpu = 30; };
  vm.runInContext('engine=PlayerLabScriptEngine.create({test:"return true;", private:"return typeof __playerLabThreadCPUTimeMilliseconds;"}); engine.call("test", {});', sandbox);
  assert.equal(vm.runInContext('engine.call("private", {})', sandbox), 'undefined');
  vm.runInContext('let reads=0; Date={now:()=>{if(++reads===2)advance();return 0;}};', sandbox);
  assert.throws(() => vm.runInContext('engine.call("test", {})', sandbox), /CPU-time budget/);
  assert.equal(vm.runInContext('engine.lastMetrics().cpuMs', sandbox), 30);
});

test('a short callback delayed by scheduling retains CPU protection and a separate wall guard', () => {
  let reads = 0;
  const sandbox = context({__playerLabThreadCPUTimeMilliseconds: () => ++reads === 1 ? 0 : 0.38});
  vm.runInContext('let reads=0; Date={now:()=>++reads===1?0:297}; engine=PlayerLabScriptEngine.create({test:"return true;"});', sandbox);
  assert.equal(vm.runInContext('engine.call("test", {})', sandbox), true);
  const metrics = vm.runInContext('engine.lastMetrics()', sandbox);
  assert.equal(metrics.wallMs, 297); assert.equal(metrics.cpuMs, 0.38);
  assert.ok(metrics.instructions > 0 && metrics.instructions <= 50000);
  const stalled = context({__playerLabThreadCPUTimeMilliseconds: () => 0.38});
  vm.runInContext('let reads=0; Date={now:()=>++reads===1?0:2001}; engine=PlayerLabScriptEngine.create({test:"storage.value=2; return true;"});', stalled);
  assert.throws(() => vm.runInContext('engine.call("test", {})', stalled), /elapsed-time budget/);
});

test('input accessors, cycles, forbidden names, source size and nesting are rejected', () => {
  const accessor = {}; Object.defineProperty(accessor, 'value', {enumerable: true, get() { throw new Error('host getter invoked'); }});
  assert.throws(() => run('return input;', accessor), /supported/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => run('return input;', cyclic), /supported/);
  assert.throws(() => run(' '.repeat(65537)), /64 KiB/);
  assert.throws(() => run('return ' + '('.repeat(1000) + '1' + ')'.repeat(1000)), /depth/);
  assert.throws(() => run('Object.assign(storage, JSON.parse(input.body));', {body: '{"__proto__":{"polluted":true}}'}), /supported/);
  assert.equal({}.polluted, undefined);
});
