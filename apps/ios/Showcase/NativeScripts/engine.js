/* Bounded callback evaluation. Acorn parses source; user code is never passed to eval or Function. */
(function (global) {
  'use strict';
  const LIMIT = Object.freeze({steps: 50000, depth: 64, calls: 32, bytes: 4194304,
    string: 1048576, array: 262144, storage: 262144, source: 65536, nodes: 4096, wall: 250, cpu: 25, wallWithCPU: 2000});
  // Installed by the trusted Swift bootstrap; it is absent from the interpreted environment.
  const threadCPUClock = typeof global.__playerLabThreadCPUTimeMilliseconds === 'function' ? global.__playerLabThreadCPUTimeMilliseconds : null;
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const callables = new WeakMap();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = () => Object.create(null);
  class Budget extends Error { constructor(message) { super(message); this.name = 'ScriptBudgetError'; } }
  class Thrown { constructor(value) { this.value = value; } }
  class Flow { constructor(kind, value) { this.kind = kind; this.value = value; } }
  function failure(message) { throw new Thrown({name: 'Error', message}); }
  function key(value) {
    if (!['string', 'number'].includes(typeof value)) failure('A property key must be a string or number.');
    const result = String(value);
    if (forbidden.has(result)) failure('This property is not available to callback scripts.');
    return result;
  }
  class Meter {
    constructor() {
      this.steps = LIMIT.steps; this.bytes = 0; this.calls = 0; this.started = Date.now();
      const cpu = threadCPUClock ? threadCPUClock() : NaN;
      this.cpuStarted = typeof cpu === 'number' && Number.isFinite(cpu) && cpu >= 0 ? cpu : null;
      this.deadline = this.started + (this.cpuStarted === null ? LIMIT.wall : LIMIT.wallWithCPU);
    }
    tick(count = 1) {
      this.steps -= count;
      if (this.steps < 0) throw new Budget('The instruction budget was exceeded.');
      if ((this.steps & 127) === 0) this.finish();
    }
    finish() {
      if (this.cpuStarted !== null) {
        const cpu = threadCPUClock();
        if (typeof cpu !== 'number' || !Number.isFinite(cpu) || cpu < this.cpuStarted) throw new Budget('The CPU clock became unavailable.');
        if (cpu - this.cpuStarted > LIMIT.cpu) throw new Budget('The CPU-time budget was exceeded.');
      }
      if (Date.now() > this.deadline) throw new Budget('The elapsed-time budget was exceeded.');
    }
    metrics() {
      const cpu = this.cpuStarted === null ? null : threadCPUClock();
      return {wallMs: Math.max(0, Date.now() - this.started), cpuMs: typeof cpu === 'number' && Number.isFinite(cpu) ? cpu - this.cpuStarted : null, instructions: LIMIT.steps - this.steps};
    }
    allocate(bytes) {
      this.tick();
      this.bytes += bytes;
      if (this.bytes > LIMIT.bytes) throw new Budget('The allocation budget was exceeded.');
    }
    string(value) {
      if (value.length > LIMIT.string) throw new Budget('The string length limit was exceeded.');
      this.allocate(value.length * 2 + 16);
      return value;
    }
    array(length) {
      if (!Number.isSafeInteger(length) || length < 0 || length > LIMIT.array) throw new Budget('The array length limit was exceeded.');
      this.allocate(length * 8 + 24);
    }
  }
  function plain(value, meter, depth = 0, seen = new Set()) {
    meter.tick();
    if (depth > LIMIT.depth) throw new Budget('The value depth limit was exceeded.');
    if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'undefined') return value;
    if (typeof value === 'string') return meter.string(value);
    if (typeof value !== 'object' || callables.has(value)) failure('Only plain callback values may cross this boundary.');
    if (seen.has(value)) failure('Cyclic callback values are not supported.');
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      meter.array(value.length); result = [];
      for (let i = 0; i < value.length; ++i) result.push(plain(value[i], meter, depth + 1, seen));
    } else {
      result = record();
      for (const name of Object.keys(value)) {
        key(name); meter.allocate(name.length * 2 + 24);
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || !own(descriptor, 'value')) failure('Accessor properties are not supported.');
        result[name] = plain(descriptor.value, meter, depth + 1, seen);
      }
    }
    seen.delete(value); return result;
  }
  const allowed = new Set(['Program', 'BlockStatement', 'EmptyStatement', 'ExpressionStatement',
    'ReturnStatement', 'ThrowStatement', 'VariableDeclaration', 'VariableDeclarator', 'Identifier',
    'Literal', 'ArrayExpression', 'ObjectExpression', 'Property', 'SpreadElement', 'IfStatement',
    'ConditionalExpression', 'LogicalExpression', 'BinaryExpression', 'UnaryExpression', 'UpdateExpression',
    'AssignmentExpression', 'MemberExpression', 'CallExpression', 'NewExpression', 'SequenceExpression',
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'WhileStatement', 'DoWhileStatement',
    'ForStatement', 'ForOfStatement', 'ForInStatement', 'BreakStatement', 'ContinueStatement', 'TryStatement',
    'CatchClause', 'SwitchStatement', 'SwitchCase', 'TemplateLiteral', 'TemplateElement']);
  function compile(source) {
    if (typeof source !== 'string' || source.length > LIMIT.source) throw new Error('The function body exceeds 64 KiB.');
    let tokens = 0, nesting = 0;
    const ast = global.acorn.parse(source, {ecmaVersion: 2022, allowReturnOutsideFunction: true,
      onToken(token) {
        if (++tokens > 16384) throw new Budget('The syntax token limit was exceeded.');
        const label = token.type.label;
        if (['(', '[', '{', '${'].includes(label) && ++nesting > LIMIT.depth) throw new Budget('The syntax depth limit was exceeded.');
        if ([')', ']', '}'].includes(label)) --nesting;
      }});
    let nodes = 0;
    function visit(node, depth) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) visit(child, depth); return; }
      if (typeof node.type !== 'string') return;
      if (++nodes > LIMIT.nodes || depth > LIMIT.depth) throw new Budget('The syntax tree limit was exceeded.');
      if (!allowed.has(node.type)) throw new Error('Unsupported callback syntax: ' + node.type + '.');
      if (node.regex || node.bigint || node.async || node.generator || node.optional || node.method || node.kind === 'get' || node.kind === 'set' || node.label || node.await) throw new Error('This callback syntax is not supported.');
      if (node.type === 'Identifier' && forbidden.has(node.name)) throw new Error('This callback identifier is not supported.');
      if (/Function/.test(node.type)) {
        for (const param of node.params) if (param.type !== 'Identifier') throw new Error('Use named callback parameters.');
      }
      if (node.type === 'VariableDeclarator' && node.id.type !== 'Identifier') throw new Error('Use a named variable.');
      if (node.type === 'VariableDeclaration' && node.kind === 'var') throw new Error('Use let or const; var declarations are not supported.');
      if (node.type === 'CatchClause' && node.param && node.param.type !== 'Identifier') throw new Error('Use a named catch parameter.');
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'JSON' && node.arguments.length > 1) throw new Error('JSON callbacks accept one argument; reviver, replacer and indentation options are not supported.');
      for (const name of Object.keys(node)) if (!['type', 'start', 'end', 'loc'].includes(name)) {
        const child = node[name]; if (child && typeof child === 'object') visit(child, depth + 1);
      }
    }
    visit(ast, 0); return ast;
  }
  class Env {
    constructor(parent) { this.parent = parent; this.values = record(); this.constants = new Set(); }
    define(name, value, constant = false) {
      if (own(this.values, name)) failure('Duplicate variable.');
      this.values[name] = value; if (constant) this.constants.add(name);
    }
    get(name) { if (own(this.values, name)) return this.values[name]; if (this.parent) return this.parent.get(name); failure('Unknown callback identifier.'); }
    set(name, value) {
      if (own(this.values, name)) { if (this.constants.has(name)) failure('A constant cannot be reassigned.'); this.values[name] = value; }
      else if (this.parent) this.parent.set(name, value); else failure('Assign to a declared variable.');
      return value;
    }
  }
  function callable(description) { const value = record(); callables.set(value, description); return value; }
  function text(value, meter) {
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return arrayJoin(value, ',', meter, 0);
    if (callables.has(value)) failure('A function cannot be converted to text.');
    return '[object Object]';
  }
  function numeric(value, meter) { meter.tick(); return Number(typeof value === 'object' && value !== null ? text(value, meter) : value); }
  function index(value, meter) { const number = numeric(value, meter); return Number.isNaN(number) ? 0 : Math.trunc(number); }
  function arrayJoin(array, separator, meter, depth) {
    if (depth > LIMIT.depth) throw new Budget('The value depth limit was exceeded.');
    let result = '';
    for (let i = 0; i < array.length; ++i) {
      meter.tick(); const item = array[i];
      const part = item == null ? '' : Array.isArray(item) ? arrayJoin(item, ',', meter, depth + 1) : text(item, meter);
      if (result.length + part.length + (i ? separator.length : 0) > LIMIT.string) throw new Budget('The string length limit was exceeded.');
      result += (i ? separator : '') + part;
    }
    return meter.string(result);
  }
  function binary(operator, left, right, meter) {
    meter.tick();
    if (operator === '===') return left === right;
    if (operator === '!==') return left !== right;
    if (operator === '==') {
      if (typeof left === typeof right) return left === right;
      if (left == null || right == null) return left == null && right == null;
      if (typeof left === 'boolean') return binary('==', Number(left), right, meter);
      if (typeof right === 'boolean') return binary('==', left, Number(right), meter);
      if (typeof left === 'object') return binary('==', text(left, meter), right, meter);
      if (typeof right === 'object') return binary('==', left, text(right, meter), meter);
      return numeric(left, meter) === numeric(right, meter);
    }
    if (operator === '!=') return !binary('==', left, right, meter);
    if (operator === '+') {
      if (typeof left === 'object' && left !== null) left = text(left, meter);
      if (typeof right === 'object' && right !== null) right = text(right, meter);
      if (typeof left === 'string' || typeof right === 'string') {
        const a = text(left, meter), b = text(right, meter);
        if (a.length + b.length > LIMIT.string) throw new Budget('The string length limit was exceeded.');
        return meter.string(a + b);
      }
      return numeric(left, meter) + numeric(right, meter);
    }
    if (['<', '<=', '>', '>='].includes(operator)) {
      const a = typeof left === 'string' && typeof right === 'string' ? left : numeric(left, meter);
      const b = typeof left === 'string' && typeof right === 'string' ? right : numeric(right, meter);
      return operator === '<' ? a < b : operator === '<=' ? a <= b : operator === '>' ? a > b : a >= b;
    }
    const a = numeric(left, meter), b = numeric(right, meter);
    switch (operator) {
      case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
      case '**': return a ** b; case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
      case '<<': return a << b; case '>>': return a >> b; case '>>>': return a >>> b;
      default: failure('Unsupported callback operator.');
    }
  }
  const stringMethods = new Set(['toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'slice',
    'substring', 'substr', 'charAt', 'charCodeAt', 'includes', 'startsWith', 'endsWith', 'indexOf',
    'lastIndexOf', 'split', 'replace', 'replaceAll', 'repeat', 'padStart', 'padEnd', 'concat', 'toString']);
  const arrayMethods = new Set(['map', 'filter', 'reduce', 'forEach', 'some', 'every', 'find', 'findIndex',
    'includes', 'indexOf', 'slice', 'join', 'push', 'pop', 'shift', 'unshift', 'concat', 'reverse', 'sort', 'fill']);
  function property(object, name, meter) {
    meter.tick(); name = key(name);
    if (object == null) failure('Cannot read a property of an empty value.');
    if (callables.has(object)) {
      const description = callables.get(object);
      if (description.kind === 'namespace') {
        if (description.name === 'Math' && own(Math, name) && typeof Math[name] === 'number') return Math[name];
        return callable({kind: 'builtin', name: description.name + '.' + name});
      }
      if (description.kind === 'builtin' && ['Array', 'Object', 'Number', 'String'].includes(description.name)) return callable({kind: 'builtin', name: description.name + '.' + name});
      failure('Function properties are not available.');
    }
    if (typeof object === 'string') {
      if (name === 'length') return object.length;
      if (/^(0|[1-9][0-9]*)$/.test(name)) return object[Number(name)];
      if (stringMethods.has(name)) return callable({kind: 'method', name, receiver: object});
      return undefined;
    }
    if (Array.isArray(object)) {
      if (name === 'length') return object.length;
      if (/^(0|[1-9][0-9]*)$/.test(name)) return object[Number(name)];
      if (arrayMethods.has(name)) return callable({kind: 'method', name, receiver: object});
      return own(object, name) ? object[name] : undefined;
    }
    if (typeof object === 'number' && ['toString', 'toFixed', 'toPrecision'].includes(name)) return callable({kind: 'method', name, receiver: object});
    return own(object, name) ? object[name] : undefined;
  }
  function write(object, name, value, meter) {
    meter.tick(); name = key(name);
    if (!object || typeof object !== 'object' || callables.has(object)) failure('Write only to plain callback objects.');
    if (Array.isArray(object)) {
      if (name === 'length') {
        const length = numeric(value, meter); meter.array(length); object.length = length; return value;
      }
      if (!/^(0|[1-9][0-9]*)$/.test(name)) failure('Only array indexes may be assigned.');
      const position = Number(name);
      if (position >= object.length) meter.array(position + 1);
      object[position] = value;
    } else { if (!own(object, name)) meter.allocate(name.length * 2 + 24); object[name] = value; }
    return value;
  }
  function keysFor(value, meter) {
    if (typeof value === 'string') meter.array(value.length);
    const keys = Object.keys(value); meter.array(keys.length); return keys;
  }
  function reference(node, env, meter, depth) {
    if (node.type === 'Identifier') return {get: () => env.get(node.name), set: value => env.set(node.name, value)};
    if (node.type !== 'MemberExpression') failure('Invalid assignment target.');
    const object = evaluate(node.object, env, meter, depth + 1);
    const name = node.computed ? evaluate(node.property, env, meter, depth + 1) : node.property.name;
    return {get: () => property(object, name, meter), set: value => write(object, name, value, meter), object, name};
  }
  function invoke(fn, args, meter, depth) {
    meter.tick();
    const description = fn && typeof fn === 'object' ? callables.get(fn) : null;
    if (!description) failure('The callback value is not callable.');
    if (++meter.calls > LIMIT.calls) throw new Budget('The callback call-depth limit was exceeded.');
    try {
      if (description.kind === 'function') {
        let parent = description.env;
        if (description.node.type === 'FunctionExpression' && description.node.id) {
          parent = new Env(parent); parent.define(description.node.id.name, fn, true);
        }
        const env = new Env(parent);
        description.node.params.forEach((parameter, i) => env.define(parameter.name, args[i]));
        if (description.node.type === 'ArrowFunctionExpression' && description.node.body.type !== 'BlockStatement') return evaluate(description.node.body, env, meter, depth + 1);
        try { statements(description.node.body.body, env, meter, depth + 1); } catch (error) {
          if (error instanceof Flow && error.kind === 'return') return error.value; throw error;
        }
        return undefined;
      }
      try {
        if (description.kind === 'method') return method(description.receiver, description.name, args, meter, depth + 1);
        if (description.kind === 'builtin') return builtin(description.name, args, meter, depth + 1);
      } catch (error) {
        if (error instanceof Budget || error instanceof Thrown || error instanceof Flow) throw error;
        throw new Thrown({name: error && typeof error.name === 'string' ? error.name : 'Error', message: 'The callback value could not be converted.'});
      }
      failure('The callback value is not callable.');
    } finally { --meter.calls; }
  }
  function method(receiver, name, args, meter, depth) {
    meter.tick();
    if (typeof receiver === 'string') {
      meter.tick(Math.ceil(receiver.length / 32));
      if (['toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'toString'].includes(name)) return meter.string(String.prototype[name].call(receiver));
      if (['slice', 'substring', 'substr', 'charAt', 'charCodeAt'].includes(name)) {
        const result = String.prototype[name].apply(receiver, args.map(value => value === undefined ? undefined : index(value, meter)));
        return typeof result === 'string' ? meter.string(result) : result;
      }
      if (['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf'].includes(name)) return String.prototype[name].call(receiver, text(args[0], meter), args[1] === undefined ? undefined : index(args[1], meter));
      if (name === 'repeat') {
        const count = index(args[0], meter);
        if (!Number.isFinite(count) || count < 0) failure('Invalid repeat count.');
        if (receiver.length * count > LIMIT.string) throw new Budget('The string length limit was exceeded.');
        return meter.string(receiver.repeat(count));
      }
      if (name === 'padStart' || name === 'padEnd') {
        const count = Math.max(0, index(args[0], meter));
        if (count > LIMIT.string) throw new Budget('The string length limit was exceeded.');
        return meter.string(String.prototype[name].call(receiver, count, args[1] === undefined ? ' ' : text(args[1], meter)));
      }
      if (name === 'concat') return args.reduce((value, item) => binary('+', value, text(item, meter), meter), receiver);
      if (name === 'split') {
        const separator = args[0] === undefined ? undefined : text(args[0], meter);
        const limit = args[1] === undefined ? LIMIT.array : Math.min(LIMIT.array, numeric(args[1], meter) >>> 0);
        const maximum = Math.min(receiver.length + 1, limit);
        meter.array(maximum);
        return receiver.split(separator, limit).map(value => meter.string(value));
      }
      if (name === 'replace' || name === 'replaceAll') {
        const search = text(args[0], meter), replacement = args[1];
        let output = '', position = 0, found, used = false;
        while (!used || name === 'replaceAll') {
          meter.tick(); found = receiver.indexOf(search, position);
          if (found < 0) break;
          const value = callables.has(replacement) ? text(invoke(replacement, [search, found, receiver], meter, depth + 1), meter) : text(replacement, meter);
          // A replacement string uses the standard dollar substitutions without native callbacks.
          let expanded = callables.has(replacement) ? value : '';
          for (let i = 0; !callables.has(replacement) && i < value.length; ++i) {
            meter.tick();
            if (value[i] === '$' && i + 1 < value.length && ["$", "&", "`", "'"].includes(value[i + 1])) {
              const token = value[++i];
              expanded = binary('+', expanded, token === '$' ? '$' : token === '&' ? search : token === '`' ? receiver.slice(0, found) : receiver.slice(found + search.length), meter);
            } else expanded = binary('+', expanded, value[i], meter);
          }
          output = binary('+', output, receiver.slice(position, found), meter);
          output = binary('+', output, expanded, meter);
          position = found + search.length; used = true;
          if (search === '') {
            if (position >= receiver.length) break;
            output = binary('+', output, receiver[position], meter); ++position;
          }
        }
        return binary('+', output, receiver.slice(position), meter);
      }
    }
    if (typeof receiver === 'number') {
      const digits = args[0] === undefined ? undefined : index(args[0], meter);
      if (name === 'toString' && digits !== undefined && (digits < 2 || digits > 36)) failure('Invalid number radix.');
      if (name !== 'toString' && digits !== undefined && (!Number.isFinite(digits) || digits < 0 || digits > 100)) failure('Invalid number precision.');
      return meter.string(Number.prototype[name].call(receiver, digits));
    }
    if (!Array.isArray(receiver)) failure('Unsupported callback method.');
    const length = receiver.length;
    if (name === 'join') return arrayJoin(receiver, args[0] === undefined ? ',' : text(args[0], meter), meter, 0);
    if (name === 'slice') { meter.array(length); return receiver.slice(...args.map(value => value === undefined ? undefined : index(value, meter))); }
    if (name === 'includes' || name === 'indexOf') { meter.tick(length); return Array.prototype[name].call(receiver, args[0], args[1] === undefined ? 0 : index(args[1], meter)); }
    if (name === 'push' || name === 'unshift') { meter.array(length + args.length); return Array.prototype[name].apply(receiver, args); }
    if (name === 'pop' || name === 'shift') { meter.tick(length); return Array.prototype[name].call(receiver); }
    if (name === 'reverse') { meter.tick(length); return receiver.reverse(); }
    if (name === 'fill') { meter.tick(length); return receiver.fill(args[0], args[1] === undefined ? 0 : index(args[1], meter), args[2] === undefined ? length : index(args[2], meter)); }
    if (name === 'concat') {
      const total = length + args.reduce((n, value) => n + (Array.isArray(value) ? value.length : 1), 0);
      meter.array(total); const result = receiver.slice();
      for (const value of args) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; ++i) { meter.tick(); if (own(value, String(i))) result.push(value[i]); else ++result.length; }
        else result.push(value);
      }
      return result;
    }
    if (name === 'sort') {
      meter.tick(length);
      return receiver.sort((a, b) => { meter.tick(); if (args[0] !== undefined) return numeric(invoke(args[0], [a, b], meter, depth + 1), meter); const x = text(a, meter), y = text(b, meter); return x < y ? -1 : x > y ? 1 : 0; });
    }
    if (name === 'map') meter.array(length);
    const result = name === 'map' ? new Array(length) : [];
    let accumulator = args[1], start = 0;
    if (name === 'reduce' && args.length < 2) {
      while (start < length && !own(receiver, String(start))) { meter.tick(); ++start; }
      if (start === length) failure('An empty reduce requires an initial value.');
      accumulator = receiver[start++];
    }
    for (let i = start; i < length; ++i) {
      meter.tick();
      if (!own(receiver, String(i)) && !['find', 'findIndex'].includes(name)) continue;
      const element = receiver[i];
      const value = invoke(args[0], name === 'reduce' ? [accumulator, element, i, receiver] : [element, i, receiver], meter, depth + 1);
      if (name === 'map') result[i] = value;
      else if (name === 'filter' && value) { meter.allocate(8); result.push(element); }
      else if (name === 'reduce') accumulator = value;
      else if (name === 'some' && value) return true;
      else if (name === 'every' && !value) return false;
      else if (name === 'find' && value) return element;
      else if (name === 'findIndex' && value) return i;
    }
    if (name === 'reduce') return accumulator;
    if (name === 'some') return false; if (name === 'every') return true; if (name === 'findIndex') return -1;
    return name === 'map' || name === 'filter' ? result : undefined;
  }
  const mathFunctions = new Set(['abs', 'ceil', 'floor', 'round', 'trunc', 'min', 'max', 'pow', 'sqrt', 'cbrt',
    'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'log', 'log2', 'log10', 'exp', 'hypot', 'imul', 'clz32', 'fround']);
  function builtin(name, args, meter, depth) {
    meter.tick();
    if (name.startsWith('Math.') && mathFunctions.has(name.slice(5))) return Math[name.slice(5)](...args.map(value => numeric(value, meter)));
    if (name === 'Number') return numeric(args.length ? args[0] : 0, meter);
    if (name === 'String') return meter.string(args.length ? text(args[0], meter) : '');
    if (name === 'Boolean') return Boolean(args[0]);
    if (name === 'Number.isFinite') return typeof args[0] === 'number' && Number.isFinite(args[0]);
    if (name === 'Number.isNaN') return typeof args[0] === 'number' && Number.isNaN(args[0]);
    if (name === 'Number.isInteger') return Number.isInteger(args[0]);
    if (name === 'Number.isSafeInteger') return Number.isSafeInteger(args[0]);
    if (name === 'Array.isArray') return Array.isArray(args[0]);
    if (name === 'Array' || name === 'Uint8Array') {
      const length = args.length === 1 && typeof args[0] === 'number' ? args[0] : args.length === 1 && Array.isArray(args[0]) && name === 'Uint8Array' ? args[0].length : args.length;
      meter.array(length); const output = new Array(length);
      for (let i = 0; i < length; ++i) {
        meter.tick();
        if (name === 'Uint8Array') output[i] = numeric(Array.isArray(args[0]) ? args[0][i] : args.length === 1 && typeof args[0] === 'number' ? 0 : args[i], meter) & 255;
        else if (!(args.length === 1 && typeof args[0] === 'number')) output[i] = args[i];
      }
      return output;
    }
    if (name === 'Array.from') {
      const input = args[0];
      if (!Array.isArray(input) && typeof input !== 'string') failure('Array.from requires an array or string.');
      meter.array(input.length); const output = [];
      let i = 0;
      for (const item of input) { meter.tick(); output.push(args[1] === undefined ? item : invoke(args[1], [item, i], meter, depth + 1)); ++i; }
      return output;
    }
    if (name === 'Object.create') { if (args[0] !== null || args.length !== 1) failure('Object.create only accepts null.'); meter.allocate(24); return record(); }
    if (['Object.keys', 'Object.values', 'Object.entries'].includes(name)) {
      if (args[0] == null || callables.has(args[0])) failure('A plain object is required.');
      const keys = keysFor(args[0], meter);
      return keys.map(item => { meter.tick(); key(item); return name === 'Object.keys' ? meter.string(item) : name === 'Object.values' ? args[0][item] : (meter.array(2), [meter.string(item), args[0][item]]); });
    }
    if (name === 'Object.assign') {
      const target = args[0];
      for (const source of args.slice(1)) if (source != null) for (const name of keysFor(source, meter)) write(target, name, property(source, name, meter), meter);
      return target;
    }
    if (name === 'Object.hasOwn') return args[0] != null && own(args[0], key(args[1]));
    if (name === 'Object.fromEntries') {
      if (!Array.isArray(args[0])) failure('Object.fromEntries requires an array.');
      const target = record(); for (const pair of args[0]) { meter.tick(); if (!Array.isArray(pair) || pair.length < 2) failure('Invalid object entry.'); write(target, pair[0], pair[1], meter); } return target;
    }
    if (name === 'JSON.parse') {
      if (args.length > 1) failure('JSON.parse accepts one argument in callback scripts.');
      const source = text(args[0], meter); meter.tick(Math.ceil(source.length / 16));
      let nesting = 0, quoted = false, escaped = false;
      for (const char of source) { if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; } else if (char === '"') quoted = true; else if (char === '[' || char === '{') { if (++nesting > LIMIT.depth) throw new Budget('The JSON depth limit was exceeded.'); } else if (char === ']' || char === '}') --nesting; }
      return plain(JSON.parse(source), meter);
    }
    if (name === 'JSON.stringify') {
      if (args.length > 1) failure('JSON.stringify accepts one argument in callback scripts.');
      const value = plain(args[0], meter), output = JSON.stringify(value); return output === undefined ? undefined : meter.string(output);
    }
    if (name === 'parseInt' || name === 'parseFloat') {
      const source = text(args[0], meter); meter.tick(Math.ceil(source.length / 16));
      return name === 'parseInt' ? parseInt(source, args[1] === undefined ? undefined : numeric(args[1], meter)) : parseFloat(source);
    }
    if (name === 'isFinite') return Number.isFinite(numeric(args[0], meter));
    if (name === 'isNaN') return Number.isNaN(numeric(args[0], meter));
    if (name === 'encodeURIComponent' || name === 'decodeURIComponent') {
      const source = text(args[0], meter); meter.tick(Math.ceil(source.length / 16));
      if (source.length * (name === 'encodeURIComponent' ? 9 : 1) > LIMIT.string) throw new Budget('The encoded string limit was exceeded.');
      return meter.string(name === 'encodeURIComponent' ? encodeURIComponent(source) : decodeURIComponent(source));
    }
    if (name === 'Error' || name === 'TypeError') { const value = record(); value.name = name; value.message = args.length ? meter.string(text(args[0], meter)) : ''; return value; }
    failure('This callback builtin is not available.');
  }
  function evaluate(node, env, meter, depth = 0) {
    meter.tick(); if (depth > LIMIT.depth) throw new Budget('The evaluation depth limit was exceeded.');
    switch (node.type) {
      case 'Literal': return typeof node.value === 'string' ? meter.string(node.value) : node.value;
      case 'Identifier': return env.get(node.name);
      case 'ArrayExpression': {
        const result = [];
        for (const child of node.elements) {
          if (child && child.type === 'SpreadElement') { const list = evaluate(child.argument, env, meter, depth + 1); if (!Array.isArray(list) && typeof list !== 'string') failure('Spread requires an array or string.'); meter.array(result.length + list.length); for (const item of list) { meter.tick(); result.push(item); } }
          else { meter.allocate(8); if (child) result.push(evaluate(child, env, meter, depth + 1)); else ++result.length; }
        }
        return result;
      }
      case 'ObjectExpression': {
        const result = record(); meter.allocate(24);
        for (const item of node.properties) {
          if (item.type === 'SpreadElement') { const source = evaluate(item.argument, env, meter, depth + 1); if (source != null) for (const name of keysFor(source, meter)) write(result, name, property(source, name, meter), meter); }
          else { const name = item.computed ? evaluate(item.key, env, meter, depth + 1) : item.key.type === 'Identifier' ? item.key.name : item.key.value; write(result, name, evaluate(item.value, env, meter, depth + 1), meter); }
        }
        return result;
      }
      case 'MemberExpression': return reference(node, env, meter, depth).get();
      case 'CallExpression': case 'NewExpression': {
        const fn = evaluate(node.callee, env, meter, depth + 1), args = [];
        for (const argument of node.arguments) {
          if (argument.type === 'SpreadElement') { const list = evaluate(argument.argument, env, meter, depth + 1); if (!Array.isArray(list)) failure('Call spread requires an array.'); meter.array(args.length + list.length); for (const item of list) { meter.tick(); args.push(item); } }
          else args.push(evaluate(argument, env, meter, depth + 1));
        }
        if (node.type === 'NewExpression' && !['Array', 'Uint8Array', 'Error', 'TypeError'].includes(callables.get(fn)?.name)) failure('This constructor is not available.');
        return invoke(fn, args, meter, depth + 1);
      }
      case 'FunctionExpression': case 'ArrowFunctionExpression': return callable({kind: 'function', node, env});
      case 'BinaryExpression': return binary(node.operator, evaluate(node.left, env, meter, depth + 1), evaluate(node.right, env, meter, depth + 1), meter);
      case 'LogicalExpression': { const left = evaluate(node.left, env, meter, depth + 1); return (node.operator === '&&' ? left : node.operator === '??' ? left == null : !left) ? evaluate(node.right, env, meter, depth + 1) : left; }
      case 'ConditionalExpression': return evaluate(evaluate(node.test, env, meter, depth + 1) ? node.consequent : node.alternate, env, meter, depth + 1);
      case 'AssignmentExpression': {
        const ref = reference(node.left, env, meter, depth);
        if (['&&=', '||=', '??='].includes(node.operator)) { const old = ref.get(); if (node.operator === '&&=' ? !old : node.operator === '||=' ? !!old : old != null) return old; return ref.set(evaluate(node.right, env, meter, depth + 1)); }
        const previous = node.operator === '=' ? undefined : ref.get();
        const value = evaluate(node.right, env, meter, depth + 1);
        return ref.set(node.operator === '=' ? value : binary(node.operator.slice(0, -1), previous, value, meter));
      }
      case 'UpdateExpression': { const ref = reference(node.argument, env, meter, depth), old = numeric(ref.get(), meter), value = old + (node.operator === '++' ? 1 : -1); ref.set(value); return node.prefix ? value : old; }
      case 'UnaryExpression': {
        if (node.operator === 'delete') { const ref = reference(node.argument, env, meter, depth); if (!ref.object || callables.has(ref.object)) failure('Delete only plain object properties.'); return delete ref.object[key(ref.name)]; }
        if (node.operator === 'typeof' && node.argument.type === 'Identifier') { try { const v = env.get(node.argument.name); return callables.has(v) ? 'function' : typeof v; } catch (error) { if (error instanceof Thrown) return 'undefined'; throw error; } }
        const value = evaluate(node.argument, env, meter, depth + 1);
        switch (node.operator) { case '!': return !value; case '~': return ~numeric(value, meter); case '+': return numeric(value, meter); case '-': return -numeric(value, meter); case 'void': return undefined; case 'typeof': return callables.has(value) ? 'function' : typeof value; default: failure('Unsupported unary operator.'); }
      }
      case 'SequenceExpression': { let result; for (const child of node.expressions) result = evaluate(child, env, meter, depth + 1); return result; }
      case 'TemplateLiteral': { let result = ''; for (let i = 0; i < node.quasis.length; ++i) { result = binary('+', result, node.quasis[i].value.cooked, meter); if (i < node.expressions.length) result = binary('+', result, text(evaluate(node.expressions[i], env, meter, depth + 1), meter), meter); } return result; }
      default: failure('Unsupported callback expression.');
    }
  }
  function statements(body, env, meter, depth) {
    for (const node of body) if (node.type === 'FunctionDeclaration') env.define(node.id.name, callable({kind: 'function', node, env}));
    for (const node of body) statement(node, env, meter, depth + 1);
  }
  function statement(node, env, meter, depth) {
    meter.tick(); if (depth > LIMIT.depth) throw new Budget('The statement depth limit was exceeded.');
    switch (node.type) {
      case 'EmptyStatement': case 'FunctionDeclaration': return;
      case 'BlockStatement': return statements(node.body, new Env(env), meter, depth + 1);
      case 'ExpressionStatement': evaluate(node.expression, env, meter, depth + 1); return;
      case 'ReturnStatement': throw new Flow('return', node.argument ? evaluate(node.argument, env, meter, depth + 1) : undefined);
      case 'ThrowStatement': throw new Thrown(evaluate(node.argument, env, meter, depth + 1));
      case 'VariableDeclaration': for (const item of node.declarations) { meter.allocate(item.id.name.length * 2 + 24); env.define(item.id.name, item.init ? evaluate(item.init, env, meter, depth + 1) : undefined, node.kind === 'const'); } return;
      case 'IfStatement': if (evaluate(node.test, env, meter, depth + 1)) statement(node.consequent, env, meter, depth + 1); else if (node.alternate) statement(node.alternate, env, meter, depth + 1); return;
      case 'BreakStatement': throw new Flow('break');
      case 'ContinueStatement': throw new Flow('continue');
      case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement': {
        let scope = new Env(env);
        if (node.init) { if (node.init.type === 'VariableDeclaration') statement(node.init, scope, meter, depth + 1); else evaluate(node.init, scope, meter, depth + 1); }
        let first = true;
        while (node.type === 'DoWhileStatement' && first || !node.test || evaluate(node.test, scope, meter, depth + 1)) {
          meter.tick(); first = false;
          try { statement(node.body, scope, meter, depth + 1); } catch (error) { if (!(error instanceof Flow)) throw error; if (error.kind === 'break') break; if (error.kind !== 'continue') throw error; }
          if (node.type === 'ForStatement' && node.init && node.init.type === 'VariableDeclaration') {
            const next = new Env(env);
            for (const name of Object.keys(scope.values)) { meter.tick(); next.define(name, scope.values[name], scope.constants.has(name)); }
            scope = next;
          }
          if (node.update) evaluate(node.update, scope, meter, depth + 1);
        }
        return;
      }
      case 'ForOfStatement': case 'ForInStatement': {
        const source = evaluate(node.right, env, meter, depth + 1);
        if (source == null || callables.has(source)) failure('Invalid loop input.');
        if (node.type === 'ForOfStatement' && !Array.isArray(source) && typeof source !== 'string') failure('For-of requires an array or string.');
        const items = node.type === 'ForInStatement' ? keysFor(source, meter) : source;
        meter.array(items.length);
        for (const item of items) {
          meter.tick(); const scope = new Env(env);
          if (node.left.type === 'VariableDeclaration') { const binding = node.left.declarations[0]; scope.define(binding.id.name, item, node.left.kind === 'const'); }
          else reference(node.left, scope, meter, depth + 1).set(item);
          try { statement(node.body, scope, meter, depth + 1); } catch (error) { if (!(error instanceof Flow)) throw error; if (error.kind === 'break') break; if (error.kind !== 'continue') throw error; }
        }
        return;
      }
      case 'TryStatement': {
        let pending;
        try { statement(node.block, env, meter, depth + 1); } catch (error) {
          // A quota failure must bypass both user catch and user finally.
          if (error instanceof Budget) throw error;
          if (error instanceof Thrown && node.handler) {
            const scope = new Env(env); if (node.handler.param) scope.define(node.handler.param.name, error.value);
            try { statement(node.handler.body, scope, meter, depth + 1); } catch (next) { if (next instanceof Budget) throw next; pending = next; }
          } else pending = error;
        }
        if (node.finalizer) statement(node.finalizer, env, meter, depth + 1);
        if (pending) throw pending; return;
      }
      case 'SwitchStatement': {
        const value = evaluate(node.discriminant, env, meter, depth + 1); let start = -1, fallback = -1;
        for (let i = 0; i < node.cases.length; ++i) { meter.tick(); if (!node.cases[i].test) fallback = i; else if (evaluate(node.cases[i].test, env, meter, depth + 1) === value) { start = i; break; } }
        if (start < 0) start = fallback; if (start < 0) return;
        const scope = new Env(env);
        try { for (let i = start; i < node.cases.length; ++i) statements(node.cases[i].consequent, scope, meter, depth + 1); } catch (error) { if (!(error instanceof Flow) || error.kind !== 'break') throw error; } return;
      }
      default: failure('Unsupported callback statement.');
    }
  }
  function globals(storage, input) {
    const env = new Env(); env.define('input', input); env.define('storage', storage, true);
    env.define('undefined', undefined, true); env.define('NaN', NaN, true); env.define('Infinity', Infinity, true);
    for (const name of ['Math', 'JSON']) env.define(name, callable({kind: 'namespace', name}), true);
    for (const name of ['Array', 'Uint8Array', 'Object', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'Error', 'TypeError']) env.define(name, callable({kind: 'builtin', name}), true);
    return env;
  }
  global.PlayerLabScriptEngine = Object.freeze({
    validate(source) { compile(source); return true; },
    create(sources) {
      const bodies = record(), parsed = record(); let storage = record(), total = 0, last = null;
      if (!sources || typeof sources !== 'object' || Object.keys(sources).length > 128) throw new Error('Invalid callback source map.');
      for (const id of Object.keys(sources)) {
        if (typeof sources[id] !== 'string' || sources[id].length > LIMIT.source) throw new Error('The function body exceeds 64 KiB.');
        if ((total += sources[id].length) > 1048576) throw new Error('The callback source limit was exceeded.');
        bodies[id] = sources[id];
      }
      return Object.freeze({
        call(id, input) {
          if (!own(bodies, id)) throw new Error('The callback is not configured.');
          if (!own(parsed, id)) parsed[id] = compile(bodies[id]);
          const meter = new Meter();
          try {
            const local = plain(storage, meter), snapshot = plain(input, meter), env = globals(local, snapshot);
            let result;
            try { statements(parsed[id].body, env, meter, 0); } catch (error) { if (error instanceof Flow && error.kind === 'return') result = error.value; else throw error; }
            const output = plain(result, meter), retainedMeter = new Meter(), retained = plain(local, retainedMeter);
            if (retainedMeter.bytes > LIMIT.storage) throw new Budget('The retained storage limit was exceeded.');
            meter.finish(); retainedMeter.finish();
            storage = retained; return output;
          } catch (error) {
            if (error instanceof Budget) throw error;
            // Do not expose user input, license bytes or response text in native diagnostics.
            throw new Error('The callback could not return a supported value.');
          } finally { last = meter.metrics(); }
        },
        lastMetrics() { return last && {...last}; },
        inspectStorage() { const meter = new Meter(), value = plain(storage, meter); meter.finish(); return value; }
      });
    }
  });
})(globalThis);
