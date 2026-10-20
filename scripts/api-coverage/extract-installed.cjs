#!/usr/bin/env node
// Compare declarations and every SDK proof with the pinned installed packages.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const TARGETS = [
  { id: 'web', owner: 'apps/web', package: 'bitmovin-player' },
  { id: 'web-ui', owner: 'packages/ui-shared', package: 'bitmovin-player-ui' },
  { id: 'react-native', owner: 'apps/react-native', package: 'bitmovin-player-react-native' },
  { id: 'vega', owner: 'apps/vega', package: 'bitmovin-player' },
];
const RN_CONFIG_ROOTS = ['PlayerConfig', 'SourceConfig', 'PlayerViewConfig', 'PlayerViewProps', 'WebUiConfig', 'BitmovinCastManagerOptions', 'OfflineContentConfig', 'OfflineDownloadRequest', 'OfflineSourceOptions'];
const RN_NAMESPACES = ['Player.analytics', 'Player.buffer', 'Player.mediaControls', 'Source.drm', 'Source.drm.fairplay'];
const RN_QUERIES = new Set(['Player.canPlayAtPlaybackSpeed', 'Source.duration', 'Source.loadingState', 'Source.metadata', 'OfflineContentManager.state', 'OfflineContentManager.usedStorage']);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requirePackagePath(file) {
  requireCondition(typeof file === 'string' && file.length > 0 && !path.isAbsolute(file)
    && !path.win32.isAbsolute(file) && !/[\\:\x00-\x1f\x7f]/.test(file)
    && file.split('/').every(part => part && !part.startsWith('.')
      && !['local.properties', 'local.xcconfig', 'key.properties'].includes(part.toLowerCase())),
  'Unsafe SDK package-relative evidence path.');
}

function readPackageFile(root, file) {
  requirePackagePath(file);
  let descriptor;
  try {
    root = fs.realpathSync(root);
    const parts = file.split('/');
    let target = root;
    let metadata;
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      metadata = fs.lstatSync(target);
      requireCondition(!metadata.isSymbolicLink(), `SDK evidence symlink is forbidden: ${file}`);
      requireCondition(index === parts.length - 1 ? metadata.isFile() : metadata.isDirectory(),
        `SDK evidence must be a regular package file: ${file}`);
    }
    requireCondition(fs.realpathSync(target) === target, `SDK evidence escapes its package: ${file}`);
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(descriptor);
    requireCondition(opened.isFile() && opened.dev === metadata.dev && opened.ino === metadata.ino
      && fs.realpathSync(target) === target, `SDK evidence changed during resolution: ${file}`);
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error.code) throw new Error(`Cannot read public SDK package file: ${file}`);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function packageAt(repo, target) {
  const manifest = JSON.parse(readPackageFile(repo, `${target.owner}/package.json`).toString('utf8'));
  const declaredVersion = manifest.dependencies?.[target.package];
  const root = fs.realpathSync(path.join(repo, target.owner, 'node_modules', target.package));
  const metadata = JSON.parse(readPackageFile(root, 'package.json').toString('utf8'));
  requireCondition(metadata.name === target.package, `Installed package name mismatch: ${target.id}`);
  requireCondition(typeof declaredVersion === 'string' && typeof metadata.version === 'string'
    && declaredVersion === metadata.version, `Installed SDK differs from the exact manifest pin: ${target.id}`);
  return { ...target, root, metadata, declaredVersion };
}

function reactNativeReference(version, _id, declarations) {
  const declaration = declarations[0]?.file || 'build/index.d.ts';
  requireCondition(declaration && declaration.startsWith('build/') && declaration.endsWith('.d.ts'), 'React Native reference must come from its published build declarations.');
  // PlayerView is the wrapper's JSX component; the other measured roots are TS.
  const source = declaration.replace(/^build\//, 'src/').replace(/\.d\.ts$/, '.ts');
  const actualSource = source === 'src/components/PlayerView/index.ts' ? source + 'x' : source;
  return `https://github.com/bitmovin/bitmovin-player-react-native/blob/v${version}/${actualSource}`;
}

function publicRows(x, target) {
  if (target.id === 'web-ui') {
    const core = x.configuration(['UIConfig'], { omitPaths: ['UIConfig.componentConfigOverrides', 'UIConfig.componentLayoutOverrides'] });
    const components = x.configuration(['UIComponentConfigMap']);
    const layout = x.configuration(['UIComponentLayoutOverrideMap']);
    const runtime = x.methods(['UIManager'], { namespacePaths: ['UIManager.recommendations', 'UIManager.timelineMarkers'] });
    const events = x.exportedMembers('UIManager')
      .filter(row => ['onUiVariantResolve', 'onActiveUiChanged'].includes(row.name))
      .map(row => ({ ...row, id: `UIManager.${row.name}`, category: 'event', scope: 'UIManager' }));
    return [...core.rows, ...components.rows, ...layout.rows, ...runtime.rows, ...events];
  }
  if (target.id === 'react-native') {
    const props = x.exportedMembers('PlayerViewProps');
    const excludedProps = ['viewRef', 'player', 'ref', 'style', 'config'];
    const config = x.configuration(RN_CONFIG_ROOTS, {
      omitPaths: ['PlayerViewConfig.uiConfig', ...excludedProps.map(name => `PlayerViewProps.${name}`), ...props.filter(row => /^on[A-Z]/.test(row.name)).map(row => `PlayerViewProps.${row.name}`)],
      boundaries: { 'PlayerViewProps.fullscreenHandler': 'callback-contract', 'PlayerViewProps.customMessageHandler': 'callback-contract' },
    });
    const runtime = x.methods(['Player', 'Source', 'OfflineContentManager', 'BitmovinCastManager'], { namespacePaths: RN_NAMESPACES });
    for (const row of runtime.rows) if (RN_QUERIES.has(row.id)) row.category = 'observation';
    const values = runtime.values.filter(row => !RN_NAMESPACES.includes(row.id));
    const events = ['PlayerViewProps', 'OfflineContentManagerListener'].flatMap(name => x.exportedMembers(name)
      .filter(row => /^on[A-Z]/.test(row.name) && `${name}.${row.name}` !== 'PlayerViewProps.onEvent')
      .map(row => ({ ...row, id: `${name}.${row.name}`, category: 'event', scope: name })));
    return [...config.rows, ...runtime.rows, ...values, ...events];
  }
  const config = x.configuration(['PlayerConfig', 'SourceConfig'], { boundaries: { 'PlayerConfig.events': 'event-map' } });
  const runtime = x.methods(['PlayerAPI'], { omitPaths: ['PlayerAPI.exports'] });
  return [...config.rows, ...runtime.rows, ...x.enumeration('PlayerEvent')];
}

function extractInstalled(repo) {
  repo = path.resolve(repo);
  // Resolve the compiler through the requested checkout, even if this script is
  // being used to inspect another worktree before its dependencies are installed.
  createRequire(path.join(repo, 'apps/web/package.json')).resolve('typescript');
  const previousRepo = process.env.SDK_COVERAGE_REPO;
  process.env.SDK_COVERAGE_REPO = repo;
  let createExtractor;
  try { ({ createExtractor } = require('./extract-sdk-surface.cjs')); }
  finally {
    if (previousRepo === undefined) delete process.env.SDK_COVERAGE_REPO;
    else process.env.SDK_COVERAGE_REPO = previousRepo;
  }
  const packages = TARGETS.map(target => packageAt(repo, target));
  const web = packages.find(target => target.id === 'web');
  const ui = packages.find(target => target.id === 'web-ui');
  const uiPlayer = JSON.parse(fs.readFileSync(createRequire(path.join(ui.root, 'package.json')).resolve('bitmovin-player/package.json'), 'utf8'));
  requireCondition(uiPlayer.version === web.metadata.version, 'Player UI resolves a different Web Player declaration version.');
  return packages.map(target => {
    const options = {
      packageRoot: target.root,
      entryFile: target.metadata.types || 'bitmovinplayer.d.ts',
      supportedPlatforms: [target.id],
    };
    if (target.id === 'web-ui') options.dependencies = {
      'bitmovin-player': { packageRoot: web.root, entryFile: path.join(web.root, web.metadata.types || 'bitmovinplayer.d.ts') },
    };
    if (target.id === 'react-native') {
      options.compilerOptions = { lib: ['lib.esnext.d.ts'] };
      options.referenceFor = (id, declarations) => reactNativeReference(target.metadata.version, id, declarations);
    }
    const x = createExtractor(options);
    const rows = publicRows(x, target);
    return {
      id: target.id, sdkId: target.id, package: target.package,
      version: target.metadata.version, declaredVersion: target.declaredVersion,
      compilerVersion: x.compilerVersion, diagnostics: x.diagnostics(),
      rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    };
  });
}

function indexUnique(rows, label) {
  requireCondition(Array.isArray(rows), `${label} must be an array.`);
  const map = new Map();
  for (const row of rows) {
    requireCondition(row && typeof row.id === 'string' && !map.has(row.id), `Duplicate or invalid ${label} ID.`);
    map.set(row.id, row);
  }
  return map;
}

function declarationEvidence(inventory, declaration) {
  const file = declaration.file;
  requireCondition(typeof file === 'string' && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(part => !part || part === '.' || part === '..'), `Non-public declaration provenance: ${inventory.id}`);
  requireCondition(Number.isInteger(declaration.line) && declaration.line > 0 && /^[a-f0-9]{64}$/.test(declaration.sha256), `Invalid declaration provenance: ${inventory.id}`);
  return { kind: 'sdk', package: inventory.package, version: inventory.version, file, line: declaration.line, sha256: declaration.sha256 };
}

function checkReport(report, inventories) {
  const sdks = indexUnique(report.sdks, 'SDK');
  const applications = indexUnique(report.applications, 'application');
  const independent = indexUnique(inventories, 'installed inventory');
  const result = [];
  for (const inventory of independent.values()) {
    requireCondition(inventory.version === inventory.declaredVersion, `Installed SDK differs from the exact manifest pin: ${inventory.id}`);
    requireCondition(Array.isArray(inventory.diagnostics) && inventory.diagnostics.length === 0, `Public SDK declaration diagnostics: ${inventory.id}`);
    requireCondition(sdks.get(inventory.sdkId)?.version === inventory.version, `Reported SDK version differs from the installed SDK: ${inventory.id}`);
    const application = applications.get(inventory.id);
    requireCondition(application?.sdkId === inventory.sdkId, `Missing or incorrect application SDK binding: ${inventory.id}`);
    const expected = indexUnique(inventory.rows, `${inventory.id} extracted member`);
    const actual = indexUnique(application.rows, `${inventory.id} reported member`);
    const missing = [...expected.keys()].filter(id => !actual.has(id));
    const extra = [...actual.keys()].filter(id => !expected.has(id));
    requireCondition(!missing.length && !extra.length, `Public API inventory differs for ${inventory.id}: ${missing.length} missing, ${extra.length} extra${missing[0] ? `; missing ${missing[0]}` : ''}${extra[0] ? `; extra ${extra[0]}` : ''}`);
    for (const [id, member] of expected) {
      const row = actual.get(id);
      for (const fact of ['category', 'scope', 'deprecated', 'officialReference']) {
        requireCondition(row[fact] === member[fact], `SDK member ${fact} differs: ${inventory.id}:${id}`);
      }
      requireCondition(Array.isArray(member.declarations) && member.declarations.length > 0, `Missing extracted SDK declaration: ${inventory.id}:${id}`);
      requireCondition(Array.isArray(row.evidence), `Missing reported SDK evidence: ${inventory.id}:${id}`);
      for (const declaration of member.declarations) {
        const proof = declarationEvidence(inventory, declaration);
        requireCondition(row.evidence.some(evidence => Object.entries(proof).every(([key, value]) => evidence[key] === value)), `SDK declaration evidence differs: ${inventory.id}:${id}`);
      }
    }
    result.push({ id: inventory.id, version: inventory.version, members: expected.size,
      categories: Object.fromEntries(['configuration', 'command', 'observation', 'event'].map(category => [category, inventory.rows.filter(row => row.category === category).length])) });
  }
  return result;
}

function installedPackageRoots(repo) {
  const roots = new Map();
  for (const target of TARGETS) {
    const installed = packageAt(repo, target);
    const key = `${installed.package}@${installed.metadata.version}`;
    requireCondition(!roots.has(key) || roots.get(key) === installed.root, `Conflicting installed SDK roots: ${key}`);
    roots.set(key, installed.root);
  }
  return roots;
}

function checkSdkEvidence(report, packageRoots) {
  requireCondition(packageRoots instanceof Map, 'Installed SDK package roots are required.');
  const sdks = indexUnique(report.sdks, 'SDK');
  const applications = indexUnique(report.applications, 'application');
  const metadata = new Map();
  const files = new Map();
  let proofs = 0;
  // Native SDK evidence belongs to the separate native snapshot checker.
  for (const target of TARGETS) {
    const app = applications.get(target.id);
    if (!app) continue;
    for (const row of app.rows) {
      requireCondition(Array.isArray(row.evidence), `Missing SDK evidence array: ${target.id}`);
      for (const evidence of row.evidence) {
        requireCondition(evidence && ['app', 'sdk'].includes(evidence.kind), 'Unknown SDK evidence kind.');
        if (evidence.kind !== 'sdk') continue;
        requireCondition(typeof evidence.package === 'string' && typeof evidence.version === 'string', 'Invalid SDK evidence package/version.');
        const key = `${evidence.package}@${evidence.version}`;
        requireCondition(packageRoots.has(key), `Unknown installed SDK evidence package/version: ${key}`);
        if (evidence.package === target.package) {
          requireCondition(evidence.version === sdks.get(app.sdkId)?.version,
            `SDK evidence version differs from the application pin: ${target.id}`);
        }
        const root = packageRoots.get(key);
        if (!metadata.has(key)) {
          const installed = JSON.parse(readPackageFile(root, 'package.json').toString('utf8'));
          requireCondition(installed.name === evidence.package && installed.version === evidence.version,
            `Installed SDK evidence package/version mismatch: ${key}`);
          metadata.set(key, installed);
        }
        requireCondition(typeof evidence.sha256 === 'string' && /^[a-f0-9]{64}$/.test(evidence.sha256), 'Invalid SDK evidence SHA256.');
        requireCondition(!Object.hasOwn(evidence, 'line') || (Number.isInteger(evidence.line) && evidence.line > 0), 'Invalid SDK evidence line.');
        requirePackagePath(evidence.file);
        const fileKey = `${key}\0${evidence.file}`;
        if (!files.has(fileKey)) {
          const bytes = readPackageFile(root, evidence.file);
          const text = bytes.toString('utf8');
          const lines = bytes.length ? text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0) : 0;
          files.set(fileKey, { sha256:crypto.createHash('sha256').update(bytes).digest('hex'), lines });
        }
        const actual = files.get(fileKey);
        requireCondition(actual.sha256 === evidence.sha256, `SDK evidence bytes differ: ${key}/${evidence.file}`);
        requireCondition(!Object.hasOwn(evidence, 'line') || evidence.line <= actual.lines,
          `SDK evidence line is outside the file: ${key}/${evidence.file}`);
        proofs++;
      }
    }
  }
  return { packages:metadata.size, files:files.size, proofs };
}

function main(args) {
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/api-coverage/extract-installed.cjs --repo ROOT --check REPORT.json\n');
    return;
  }
  let repo = path.resolve(__dirname, '../..');
  let file;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    requireCondition(['--repo', '--check'].includes(flag) && args[index + 1], `Unknown or incomplete argument: ${flag}`);
    if (flag === '--repo') repo = path.resolve(args[++index]);
    else file = path.resolve(args[++index]);
  }
  requireCondition(file, 'A report is required; use --check REPORT.json.');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = checkReport(report, extractInstalled(repo));
  const bytes = checkSdkEvidence(report, installedPackageRoots(repo));
  process.stdout.write(`PASS: installed public SDK declarations and all SDK evidence bytes match (${bytes.files} files, ${bytes.proofs} proofs).\n` + JSON.stringify(result, null, 2) + '\n');
}

module.exports = { extractInstalled, checkReport, checkSdkEvidence, reactNativeReference };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`FAIL: ${error.message}\n`); process.exitCode = 1; }
}
