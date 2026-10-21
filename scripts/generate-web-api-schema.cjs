#!/usr/bin/env node
// Generate editor metadata from the pinned public SDK declarations.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createExtractor } = require('./api-coverage/extract-sdk-surface.cjs');
const repo = path.resolve(__dirname, '..');
const webRequire = createRequire(path.join(repo, 'apps/web/package.json'));
const uiRequire = createRequire(path.join(repo, 'packages/ui-shared/package.json'));
const webRoot = path.dirname(webRequire.resolve('bitmovin-player/package.json'));
const uiRoot = path.dirname(uiRequire.resolve('bitmovin-player-ui/package.json'));
const metadata = root => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const webPackage = metadata(webRoot);
const uiPackage = metadata(uiRoot);
const xWeb = createExtractor({ packageRoot: webRoot, entryFile: webPackage.types || 'bitmovinplayer.d.ts' });
const xUi = createExtractor({
  packageRoot: uiRoot, entryFile: uiPackage.types,
  dependencies: { 'bitmovin-player': { packageRoot: webRoot, entryFile: path.join(webRoot, webPackage.types || 'bitmovinplayer.d.ts') } },
});
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
  const scope = x.type(prefix === 'u' ? 'UIConfig' : 'PlayerConfig').symbol.declarations[0];
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
      const externalConstructor = value && !value.getSourceFile().fileName.startsWith(x === xUi ? uiRoot : webRoot)
        && checker.getTypeOfSymbolAtLocation(type.symbol, value).getConstructSignatures().length;
      if (['Boolean', 'String', 'Number'].includes(name)) node.kind = name.toLowerCase();
      else if (name === 'Object') node.kind = 'unknown';
      else if (['ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'DataView'].includes(name)) {
        Object.assign(node, { kind: 'binary', name });
      } else if (name === 'Promise') {
        Object.assign(node, { kind: 'promise', value: convert(checker.getTypeArguments(type)[0]) });
      } else if (name === 'PlayerAPI' || externalConstructor || name === 'Date' || name === 'RegExp' || /^(HTML.+Element|Element|Document|Window|Node|MediaKeys|MediaKeySession|TextTrack|VTTCue|AudioTrack|CSSStyleDeclaration|AbortSignal)$/.test(name)) {
        Object.assign(node, { kind: 'instance', name, factories: [] });
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

const web = graph(xWeb, 'w');
const ui = graph(xUi, 'u');
const rows = [];
function configurations(x, g, roots, options = {}) {
  for (const row of x.configuration(roots, options).rows) {
    const blocked = row.id.startsWith('UIComponentConfigMap.ToggleSettingsPanelItem.');
    rows.push({ id: row.id, category: 'configuration', root: row.scope,
      ...(!blocked ? { schema: g.convert(g.resolve(row.id)) } : {}), reference: row.officialReference,
      ...(blocked ? { blocked: 'component-class-is-not-constructor-config' } : {}) });
  }
}
configurations(xWeb, web, ['PlayerConfig', 'SourceConfig'], { boundaries: { 'PlayerConfig.events': 'event-map' } });
configurations(xUi, ui, ['UIConfig'], { omitPaths: ['UIConfig.componentConfigOverrides', 'UIConfig.componentLayoutOverrides'] });
configurations(xUi, ui, ['UIComponentConfigMap']);
configurations(xUi, ui, ['UIComponentLayoutOverrideMap']);
// Required siblings, such as a technology's player and streaming fields, must
// be submitted together. These containing forms supplement the leaf inventory.
const configurationIds = new Set(rows.map(row => row.id));
for (const row of [...rows]) {
  if (row.blocked) continue;
  const g = row.root === 'PlayerConfig' || row.root === 'SourceConfig' ? web : ui;
  const tokens = [...row.id.replace(/\{\*\}/g, '').matchAll(/(?:^|\.)([A-Za-z_$][\w$]*)|\[("(?:[^"\\]|\\.)*")\]|(\[\])/g)];
  for (let length = 2; length < tokens.length; length++) {
    const id = tokens.slice(0, length).map(token => token[0]).join('');
    if (configurationIds.has(id)) continue;
    const schema = g.convert(g.resolve(id));
    const node = nodes[schema];
    const branches = node.kind === 'union' ? node.options.map(id => nodes[id]) : [node];
    if (!branches.some(node => ['object', 'array', 'tuple'].includes(node.kind))) continue;
    configurationIds.add(id);
    rows.push({ id, category: 'configuration', root: row.root, schema, container: true, reference: row.reference });
  }
}
for (const [x, g, root, options] of [[xWeb, web, 'PlayerAPI', { omitPaths: ['PlayerAPI.exports'] }],
  [xUi, ui, 'UIManager', { namespacePaths: ['UIManager.recommendations', 'UIManager.timelineMarkers'] }]]) {
  for (const row of x.methods([root], options).rows) rows.push({ id: row.id, category: row.category,
    root, schema: g.convert(g.resolve(row.id)), reference: row.officialReference });
}
for (const row of xWeb.enumeration('PlayerEvent')) rows.push({ id: row.id, category: 'event', root: 'PlayerAPI', name: row.name, value: row.value, reference: row.officialReference });
for (const name of ['onUiVariantResolve', 'onActiveUiChanged']) rows.push({ id: 'UIManager.' + name,
  category: 'event', root: 'UIManager', name, schema: ui.convert(ui.resolve('UIManager.' + name)) });

// Concrete UI objects are created through their published constructors, not JSON casts.
for (const name of xUi.exportNames) {
  const type = xUi.type(name);
  const symbol = type.symbol;
  if (!symbol?.valueDeclaration || !symbol.declarations.some(xUi.ts.isClassDeclaration)
      || symbol.declarations.some(d => xUi.ts.getCombinedModifierFlags(d) & xUi.ts.ModifierFlags.Abstract)) continue;
  const valueType = xUi.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
  const signatures = valueType.getConstructSignatures();
  if (signatures.length) constructors[name] = { signatures: signatures.map(ui.signature) };
}
for (const { node, type, x } of instanceNodes) {
  if (x !== xUi) continue;
  node.factories = Object.keys(constructors).filter(name => xUi.checker.isTypeAssignableTo(xUi.type(name), type));
}
const eventDispatcherType = Object.entries(nodes).find(([, node]) => node.kind === 'instance' && node.name === 'EventDispatcher');
if (!eventDispatcherType) throw Error('The published EventDispatcher type is missing.');
constructors.EventDispatcher = { signatures: [{ parameters: [], returns: eventDispatcherType[0] }] };
for (const node of Object.values(nodes)) {
  if (node.kind === 'instance' && node.name === 'EventDispatcher') node.factories = ['EventDispatcher'];
}
// DOM is published as a public subpath rather than re-exported by the main barrel.
const domType = instanceNodes.find(entry => entry.x === xUi && entry.node.name === 'DOM');
if (domType) {
  const symbol = domType.type.symbol;
  const signatures = xUi.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration).getConstructSignatures();
  constructors.DOM = { signatures: signatures.map(ui.signature) };
  domType.node.factories = ['DOM'];
}

// The SDK map has one component class where a constructor configuration was intended.
// Retain its original paths as blocked and also expose the actual constructor input.
const toggle = constructors.ToggleSettingsPanelItem;
if (!toggle) throw Error('The published ToggleSettingsPanelItem constructor is missing.');
rows.push({ id: 'UIConstructorConfig.ToggleSettingsPanelItem', root: 'UIConstructorConfig',
  category: 'configuration', schema: toggle.signatures[0].parameters[0].schema,
  reference: 'https://cdn.bitmovin.com/player/ui/4/docs/interfaces/ToggleSettingsPanelItemConfig.html' });
const output = { schemaVersion: 1, playerVersion: webPackage.version, uiVersion: uiPackage.version,
  nodes, constructors, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) };
const target = path.join(repo, 'apps/web/src/api/schema.json');
const encoded = JSON.stringify(output) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== encoded) {
    console.error('SDK editor metadata differs from the pinned SDK declarations. Run node scripts/generate-web-api-schema.cjs.');
    process.exitCode = 1;
  } else console.log('SDK editor metadata matches the pinned SDK declarations.');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encoded);
  console.log('Generated ' + rows.length + ' API editor entries and ' + Object.keys(nodes).length + ' input types.');
}
