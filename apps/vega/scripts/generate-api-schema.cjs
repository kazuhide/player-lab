#!/usr/bin/env node
// Generate native editor metadata from the pinned Vega SDK declarations.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '../../..');
const { createExtractor } = require(path.join(repo, 'scripts/api-coverage/extract-sdk-surface.cjs'));
const appRequire = createRequire(path.join(repo, 'apps/vega/package.json'));
const sdkRoot = path.dirname(appRequire.resolve('bitmovin-player/package.json'));
const sdkPackage = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
const x = createExtractor({ packageRoot: sdkRoot, entryFile: sdkPackage.types || 'bitmovinplayer.d.ts' });
const nodes = {};
const constructors = {};
const instanceNodes = [];
let sequence = 0;

function graph(x, prefix) {
  const { ts, checker } = x;
  const known = new Map();
  const clean = type => type.isUnion() ? type.types.filter(part => !(part.flags & ts.TypeFlags.Undefined)) : [type];
  const hidden = symbol => (symbol.declarations || []).some(d =>
    ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
    || symbol.getJsDocTags().some(tag => ['hidden', 'internal'].includes(tag.name));
  const scope = x.type('PlayerConfig').symbol.declarations[0];
  const symbolType = symbol => checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration || symbol.declarations?.[0] || scope);
  const label = type => checker.typeToString(type);
  const signature = sig => ({
    parameters: sig.parameters.map(parameter => ({
      name: parameter.name,
      schema: convert(symbolType(parameter)),
      optional: Boolean(parameter.flags & ts.SymbolFlags.Optional)
        || (parameter.declarations || []).some(d => Boolean(d.questionToken || d.initializer)),
      rest: (parameter.declarations || []).some(d => Boolean(d.dotDotDotToken)),
    })),
    returns: convert(checker.getReturnTypeOfSignature(sig)),
  });
  function convert(type) {
    if (known.has(type)) return known.get(type);
    const id = prefix + (++sequence);
    known.set(type, id);
    const node = { kind: 'unknown', label: label(type) };
    nodes[id] = node;
    if (sequence > 20000) throw Error('Unexpectedly large SDK input graph: ' + label(type));
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) node.kind = 'unknown';
    else if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint && constraint !== type) Object.assign(node, { kind: 'union', options: [convert(constraint)] });
    }
    else if (type.flags & ts.TypeFlags.Undefined) node.kind = 'undefined';
    else if (type.flags & ts.TypeFlags.Void) node.kind = 'void';
    else if (type.flags & ts.TypeFlags.Null) node.kind = 'null';
    else if (type.flags & ts.TypeFlags.Never) node.kind = 'never';
    else if (type.isStringLiteral() || type.isNumberLiteral()) Object.assign(node, { kind: 'literal', value: type.value });
    else if (type.flags & ts.TypeFlags.BooleanLiteral) Object.assign(node, { kind: 'literal', value: type.intrinsicName === 'true' });
    else if (type.flags & ts.TypeFlags.StringLike) node.kind = 'string';
    else if (type.flags & ts.TypeFlags.NumberLike) node.kind = 'number';
    else if (type.flags & ts.TypeFlags.Boolean) node.kind = 'boolean';
    else if (type.isUnion()) Object.assign(node, { kind: 'union', options: type.types.map(convert) });
    else if (type.getCallSignatures().length) Object.assign(node, { kind: 'function', signatures: type.getCallSignatures().map(signature) });
    else if (checker.isTupleType(type)) {
      Object.assign(node, { kind: 'tuple', items: checker.getTypeArguments(type).map(convert),
        flags: type.target.elementFlags });
    } else if (checker.isArrayType(type) || checker.isArrayLikeType(type)) {
      const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (!item) throw Error('Array input has no element type: ' + label(type));
      Object.assign(node, { kind: 'array', item: convert(item) });
    } else {
      const name = type.symbol?.name || type.aliasSymbol?.name || '';
      const value = type.symbol?.valueDeclaration;
      const externalConstructor = value && !value.getSourceFile().fileName.startsWith(sdkRoot + path.sep)
        && checker.getTypeOfSymbolAtLocation(type.symbol, value).getConstructSignatures().length;
      if (['Boolean', 'String', 'Number'].includes(name)) node.kind = name.toLowerCase();
      else if (name === 'Object') node.kind = 'unknown';
      else if (['ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'DataView'].includes(name)) {
        Object.assign(node, { kind: 'binary', name });
      } else if (name === 'Promise') {
        Object.assign(node, { kind: 'promise', value: convert(checker.getTypeArguments(type)[0]) });
      } else if (name === 'PlayerAPI' || externalConstructor || name === 'Date' || name === 'RegExp' || /^(HTML.+Element|Element|Document|Window|Node|MediaKeys|MediaKeySession|TextTrack|VTTCue|AudioTrack|CSSStyleDeclaration|AbortSignal)$/.test(name)) {
        Object.assign(node, { kind: 'instance', name, factories: [] });
        instanceNodes.push({ node, type, x });
      } else if (type.symbol?.declarations?.some(ts.isClassDeclaration)) {
        Object.assign(node, { kind: 'instance', name, factories: [] });
        instanceNodes.push({ node, type, x });
      } else {
        const properties = type.getProperties().filter(property => !hidden(property));
        Object.assign(node, {
          kind: 'object',
          properties: properties.map(property => ({ name: property.name,
            schema: convert(symbolType(property)), optional: Boolean(property.flags & ts.SymbolFlags.Optional) })),
        });
        const index = checker.getIndexInfosOfType(type).find(index => index.keyType.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike));
        if (index) node.additional = convert(index.type);
        if (!properties.length && !index) node.kind = 'unknown';
      }
    }
    return id;
  }
  function resolve(id) {
    const source = id.replace(/\{\*\}/g, '');
    const matches = [...source.matchAll(/(?:^|\.)([A-Za-z_$][\w$]*)|\[("(?:[^"\\]|\\.)*")\]|(\[\])/g)];
    if (matches.map(match => match[0]).join('') !== source) throw Error('Invalid public API path: ' + id);
    const tokens = matches.map(match => match[1] || (match[2] ? JSON.parse(match[2]) : '[]'));
    let type = x.type(tokens.shift());
    for (const token of tokens) {
      const branches = clean(type);
      const results = branches.flatMap(branch => {
        if (token === '[]') {
          const item = checker.getIndexTypeOfType(branch, ts.IndexKind.Number);
          return item ? [item] : [];
        }
        const property = checker.getPropertyOfType(branch, token);
        return property ? [symbolType(property)] : [];
      });
      if (!results.length) throw Error('Cannot resolve public API input: ' + id);
      type = results.length === 1 ? results[0] : checker.getUnionType(results, ts.UnionReduction.Literal);
    }
    return type;
  }
  return { convert, resolve, signature, symbolType };
}

const sdk = graph(x, 'v');
const rows = [];
for (const row of x.configuration(['PlayerConfig', 'SourceConfig'], { boundaries: { 'PlayerConfig.events': 'event-map' } }).rows) {
  rows.push({ id: row.id, category: 'configuration', root: row.scope, schema: sdk.convert(sdk.resolve(row.id)), reference: row.officialReference });
}
for (const row of x.methods(['PlayerAPI'], { omitPaths: ['PlayerAPI.exports'] }).rows) {
  rows.push({ id: row.id, category: row.category, root: 'PlayerAPI', schema: sdk.convert(sdk.resolve(row.id)), reference: row.officialReference });
}
for (const row of x.enumeration('PlayerEvent')) rows.push({ id: row.id, category: 'event', root: 'PlayerAPI', name: row.name, value: row.value, reference: row.officialReference });
const roots = { PlayerConfig: sdk.convert(x.type('PlayerConfig')), SourceConfig: sdk.convert(x.type('SourceConfig')) };
for (const target of instanceNodes) {
  target.node.compatible = instanceNodes.filter(source => x.checker.isTypeAssignableTo(source.type, target.type)).map(source => source.node.name);
}
const output = { schemaVersion: 1, playerVersion: sdkPackage.version, nodes, constructors, roots, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) };
const target = path.join(repo, 'apps/vega/src/api/schema.json');
const encoded = JSON.stringify(output) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== encoded) {
    console.error('Vega API editor metadata differs from its pinned declarations. Run pnpm --filter @showcase/vega api:generate.'); process.exitCode = 1;
  } else console.log('Vega API editor metadata matches the pinned SDK declarations.');
} else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, encoded); console.log('Generated ' + rows.length + ' Vega API entries and ' + Object.keys(nodes).length + ' input types.'); }
