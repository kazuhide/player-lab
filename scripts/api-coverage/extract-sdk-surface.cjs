// Read public TypeScript declaration distributions; no package installation or SDK runtime execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const compilerRepo = process.env.SDK_COVERAGE_REPO || path.resolve(__dirname, '../..');
const ts = createRequire(path.join(compilerRepo, 'apps/web/package.json'))('typescript');
const TYPE_FLAGS = ts.TypeFlags;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const append = (parent, key) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;

function createExtractor({ packageRoot, entryFile, dependencies = {}, checkedAt = '2026-10-20', supportedPlatforms = ['web'], compilerOptions = {}, referenceFor }) {
  packageRoot = path.resolve(packageRoot);
  entryFile = path.resolve(packageRoot, entryFile);
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const paths = {};
  for (const [name, dependency] of Object.entries(dependencies)) {
    paths[name] = [path.resolve(dependency.entryFile)];
    paths[`${name}/*`] = [path.join(path.resolve(dependency.packageRoot), '*')];
  }
  const program = ts.createProgram([entryFile], {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    baseUrl: packageRoot, paths, ...compilerOptions,
    strict: true, skipLibCheck: false, noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryFile);
  if (!source) throw new Error(`Missing declaration entry: ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`Entry is not a module: ${entryFile}`);
  const exports = new Map(checker.getExportsOfModule(moduleSymbol).map(s => [s.name, s]));
  const text = t => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation);
  const aliased = symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  // Only tag names determine inclusion/deprecation. Resolving @link text through
  // the checker can create documentation diagnostics unrelated to declaration types.
  const tags = symbol => symbol ? symbol.getJsDocTags().map(t => t.name) : [];
  const hidden = symbol => tags(symbol).some(t => ['hidden', 'internal'].includes(t)) || (symbol?.declarations || []).some(d => ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
  const declarationNodes = new WeakMap();
  const locate = node => {
    const file = node.getSourceFile();
    const location = { file: path.relative(packageRoot, file.fileName), line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, owner: node.parent?.name?.getText?.(), sha256: sha256(fs.readFileSync(file.fileName)) };
    declarationNodes.set(location, node);
    return location;
  };
  const locations = symbol => (symbol?.declarations || []).map(locate);
  const type = name => {
    const symbol = exports.get(name);
    if (!symbol) throw new Error(`Missing public export ${metadata.name}.${name}`);
    const target = aliased(symbol);
    return target.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.ValueModule)
      ? checker.getTypeOfSymbolAtLocation(target, target.valueDeclaration || target.declarations?.[0] || source)
      : checker.getDeclaredTypeOfSymbol(target);
  };
  const symbolType = symbol => checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration || symbol.declarations?.[0] || source);
  const arrayLike = t => checker.isArrayType(t) || checker.isTupleType(t) || checker.isArrayLikeType(t);
  // The public export barrels carry the namespaces used by the hosted TypeDoc site.
  const declarationModules = new WeakMap();
  const fileModules = new Map();
  const documentationArtifacts = [];
  for (const file of program.getSourceFiles().filter(f => f.fileName.startsWith(packageRoot))) {
    const module = file.text.match(/@module\s+([\w.]+)/)?.[1];
    const symbol = checker.getSymbolAtLocation(file);
    if (!module || !symbol) continue;
    documentationArtifacts.push({ file: path.relative(packageRoot, file.fileName), module, sha256: sha256(fs.readFileSync(file.fileName)) });
    for (const exported of checker.getExportsOfModule(symbol)) {
      for (const declaration of aliased(exported).declarations || []) {
        declarationModules.set(declaration, module);
        const source = declaration.getSourceFile();
        if (!fileModules.has(source)) fileModules.set(source, new Set());
        fileModules.get(source).add(module);
      }
    }
  }
  documentationArtifacts.sort((a, b) => a.file.localeCompare(b.file));
  const documentationOwner = node => {
    const anchors = [];
    for (let current = node; current; current = current.parent) {
      const category = ts.isInterfaceDeclaration(current) ? 'interfaces' : ts.isClassDeclaration(current) ? 'classes'
        : ts.isEnumDeclaration(current) ? 'enums' : ts.isTypeAliasDeclaration(current) ? 'types' : null;
      if (category && current.name) {
        const modules = fileModules.get(current.getSourceFile());
        const module = declarationModules.get(current) || (modules?.size === 1 ? [...modules][0] : '');
        return { category, name: (module ? module + '.' : '') + current.name.text, anchor: anchors.join('.') };
      }
      if ((ts.isPropertySignature(current) || ts.isPropertyDeclaration(current) || ts.isMethodSignature(current)
          || ts.isMethodDeclaration(current) || ts.isGetAccessor(current) || ts.isSetAccessor(current)
          || ts.isEnumMember(current)) && current.name) anchors.unshift(current.name.text || current.name.getText());
    }
    return null;
  };
  const memberRef = (id, declarations = []) => {
    if (referenceFor) return referenceFor(id, declarations);
    const root = id.split('.')[0];
    const node = declarations.map(d => declarationNodes.get(d)).find(Boolean)
      || aliased(exports.get(root))?.declarations?.[0];
    const owner = node && documentationOwner(node);
    if (!owner) throw new Error(`Missing public documentation owner for ${metadata.name}.${id}`);
    const isUi = metadata.name === 'bitmovin-player-ui';
    const base = isUi ? 'https://cdn.bitmovin.com/player/ui/4/docs'
      : 'https://cdn.bitmovin.com/player/web/8/docs';
    // The UI 4 TypeDoc site lowercases anchors; the Web 8 site preserves their case.
    const anchor = isUi ? owner.anchor.toLowerCase() : owner.anchor;
    return `${base}/${owner.category}/${owner.name}.html${anchor ? '#' + anchor : ''}`;
  };
  const row = (id, category, extra = {}) => ({ id, category, package: metadata.name, version: metadata.version, scope: id.split('.')[0], supportedPlatforms, sourceArtifactSha256: declarationArtifactSha256, deprecated: false, officialReference: memberRef(id, extra.declarations), ...extra });
  const excluded = [];
  const members = new Map();
  function addConfig(id, t, kind, symbol, origin = [], extra = {}) {
    const old = members.get(id) || row(id, 'configuration', { kinds: [], types: [], declarations: [], deprecated: false });
    if (!old.kinds.includes(kind)) old.kinds.push(kind);
    if (!old.types.includes(text(t))) old.types.push(text(t));
    const refs = locations(symbol); if (!refs.length) refs.push(...origin);
    for (const ref of refs) if (!old.declarations.some(x => x.file === ref.file && x.line === ref.line)) old.declarations.push(ref);
    old.deprecated ||= tags(symbol).includes('deprecated');
    Object.assign(old, extra); old.officialReference = memberRef(id, old.declarations); members.set(id, old);
  }
  function configWalk(t, id, ancestors, symbol, origin, options, parents = []) {
    const ownOrigin = locations(symbol); if (ownOrigin.length) origin = ownOrigin;
    // Scalar rows omit null/undefined. Retain the full property and enclosing
    // property contracts so release comparisons still detect breaking changes.
    const contracts = parents.at(-1)?.path === id ? parents : [...parents, {
      path: id, type: text(symbol ? symbolType(symbol) : t),
      optional: Boolean(symbol?.flags & ts.SymbolFlags.Optional),
      readonly: (symbol?.declarations || []).some(d => ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly),
    }];
    const add = (kind, extra = {}) => addConfig(id, t, kind, symbol, origin, { ...extra, contracts });
    if (options.omitPaths?.includes(id)) { excluded.push({ id, reason: 'reported in a separate configuration scope', declarations: origin }); return; }
    const boundary = options.boundaries?.[id];
    if (boundary) { add(boundary); return; }
    if (t.flags & (TYPE_FLAGS.Undefined | TYPE_FLAGS.Null | TYPE_FLAGS.Never)) return;
    if (t.flags & TYPE_FLAGS.EnumLike) { add('scalar'); return; }
    if (t.isUnion()) { for (const part of t.types) configWalk(part, id, ancestors, symbol, origin, options, contracts); return; }
    if (t.flags & (TYPE_FLAGS.Any | TYPE_FLAGS.Unknown)) { add('opaque'); return; }
    if (t.getCallSignatures().length) { add('callback'); return; }
    if (!(t.flags & TYPE_FLAGS.Object)) { add('scalar'); return; }
    if (ancestors.includes(t)) { add('recursive-boundary'); return; }
    if (arrayLike(t)) {
      const element = checker.getIndexTypeOfType(t, ts.IndexKind.Number);
      const parts = element?.isUnion() ? element.types : [element];
      if (parts.every(x => x && !(x.flags & TYPE_FLAGS.Object))) add('scalar-array');
      else if (element) configWalk(element, `${id}[]`, [...ancestors, t], symbol, origin, options, contracts);
      else add('opaque-array');
      return;
    }
    const properties = t.getProperties(); const indices = checker.getIndexInfosOfType(t);
    if (indices.length) { addConfig(id + (properties.length ? '{*}' : ''), t, 'dynamic-map', symbol, origin, { contracts, indices: indices.map(i => ({ key: text(i.keyType), value: text(i.type) })) }); if (!properties.length) return; }
    const owner = t.aliasSymbol || t.symbol; const declarations = owner?.declarations || [];
    if (declarations.some(ts.isClassDeclaration)) { add('instance-boundary'); return; }
    if (declarations.length && declarations.every(d => !d.getSourceFile().fileName.startsWith(packageRoot)) && !['Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit'].includes(owner?.name)) { add('external-boundary'); return; }
    if (!properties.length) { add('opaque-object'); return; }
    for (const property of properties) {
      const next = append(id, property.name);
      if (hidden(property)) { excluded.push({ id: next, reason: 'hidden/internal/private/protected', declarations: locations(property) }); continue; }
      configWalk(symbolType(property), next, [...ancestors, t], property, origin, options, contracts);
    }
  }
  function configuration(roots, options = {}) {
    members.clear(); excluded.length = 0;
    for (const root of roots) configWalk(type(root), root, [], exports.get(root), [], options);
    return { rows: [...members.values()].sort((a, b) => a.id.localeCompare(b.id)), excluded: [...excluded] };
  }
  function methodCategory(id) {
    const name = id.split('.').at(-1);
    return /^(get|is|has|list)/.test(name) || name === 'deviceOrientationPermissionRequired' ? 'observation' : 'command';
  }
  function methods(roots, options = {}) {
    const rows = new Map(); const values = []; const exclusions = [];
    function walk(t, id, ancestors) {
      if (t.flags & (TYPE_FLAGS.Undefined | TYPE_FLAGS.Null | TYPE_FLAGS.Never)) return;
      if (t.isUnion()) { for (const part of t.types) walk(part, id, ancestors); return; }
      if (!(t.flags & TYPE_FLAGS.Object) || ancestors.includes(t) || arrayLike(t)) return;
      const owner = t.aliasSymbol || t.symbol; const declarations = owner?.declarations || [];
      if (declarations.length && declarations.every(d => !d.getSourceFile().fileName.startsWith(packageRoot))) return;
      for (const symbol of t.getProperties()) {
        const next = append(id, symbol.name);
        if (hidden(symbol) || options.omitPaths?.includes(next)) { exclusions.push({ id: next, reason: hidden(symbol) ? 'hidden/internal/private/protected' : 'excluded convenience/data namespace', declarations: locations(symbol) }); continue; }
        const memberType = symbolType(symbol); const signatures = memberType.getCallSignatures();
        if (signatures.length) {
          rows.set(next, row(next, methodCategory(next), { signatures: signatures.map(s => checker.signatureToString(s, undefined, ts.TypeFormatFlags.NoTruncation)), declarations: locations(symbol), deprecated: tags(symbol).includes('deprecated') }));
          continue;
        }
        values.push(row(next, 'observation', { types: [text(memberType)], declarations: locations(symbol), deprecated: tags(symbol).includes('deprecated') }));
        const parts = memberType.isUnion() ? memberType.types : [memberType];
        const allowed = options.namespacePaths ? options.namespacePaths.includes(next) : true;
        if (allowed && parts.some(p => p.flags & TYPE_FLAGS.Object) && !arrayLike(memberType)) walk(memberType, next, [...ancestors, t]);
      }
    }
    for (const root of roots) walk(type(root), root, []);
    return { rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)), values, excluded: exclusions };
  }
  function enumeration(name) {
    const symbol = aliased(exports.get(name));
    const declaration = symbol?.declarations?.find(ts.isEnumDeclaration);
    if (!declaration) throw new Error(`Public export is not an enum: ${name}`);
    return declaration.members.filter(member => !hidden(checker.getSymbolAtLocation(member.name))).map(member => row(`${name}.${member.name.text}`, 'event', { name: member.name.text, value: checker.getConstantValue(member), declarations: [locate(member)], deprecated: tags(checker.getSymbolAtLocation(member.name)).includes('deprecated') }));
  }
  function exportedMembers(name) { return type(name).getProperties().filter(s => !hidden(s)).map(s => {
    const declarations = locations(s);
    return { name: s.name, type: text(symbolType(s)), declarations, deprecated: tags(s).includes('deprecated'), officialReference: memberRef(`${name}.${s.name}`, declarations) };
  }); }
  const artifacts = program.getSourceFiles().filter(f => f.fileName.startsWith(packageRoot)).map(f => ({ file: path.relative(packageRoot, f.fileName), sha256: sha256(fs.readFileSync(f.fileName)) })).sort((a, b) => a.file.localeCompare(b.file));
  const declarationArtifactSha256 = sha256(JSON.stringify(artifacts));
  const comments = new Map();
  function isInsideComment(diagnostic) {
    if (!diagnostic.file || diagnostic.start === undefined) return false;
    const file = diagnostic.file;
    if (!comments.has(file.fileName)) { const ranges = []; const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, file.text); let token; while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if ([ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia].includes(token)) ranges.push([scanner.getTokenPos(), scanner.getTextPos()]); comments.set(file.fileName, ranges); }
    return comments.get(file.fileName).some(([start, end]) => diagnostic.start >= start && diagnostic.start < end);
  }
  function diagnostics() { return ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, file: d.file ? path.relative(packageRoot, d.file.fileName) : null, line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null, commentOnly: isInsideComment(d), message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })); }
  return { package: metadata.name, version: metadata.version, checkedAt, compilerVersion: ts.version, compilerOptions: program.getCompilerOptions(), declarationArtifactSha256, artifacts, documentationArtifacts, configuration, methods, enumeration, exportedMembers, diagnostics, exportNames: [...exports.keys()].sort(), type, checker, ts };
}
module.exports = { createExtractor };
