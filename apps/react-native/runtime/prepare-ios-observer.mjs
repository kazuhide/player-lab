#!/usr/bin/env node
/** Add read-only WK observation only to an explicit external runtime-checks host. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { embeddedUiSnapshot } from './embedded-ui.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '../../..');
const host = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || host === checkout || host.startsWith(checkout + path.sep) ||
    !fs.readFileSync(path.join(host, 'index.tsx'), 'utf8').includes('RuntimeCheckApp')) {
  throw new Error('Select an external opt-in runtime-checks host');
}
const require = createRequire(path.join(host, 'package.json'));
const { IOSConfig } = require('expo/config-plugins');
const name = IOSConfig.XcodeUtils.getProjectName(host);
const target = path.join(host, 'ios', name);
const files = ['PlayerLabRuntimeUiObserver.swift', 'PlayerLabRuntimeUiBootstrap.m', 'PlayerLabRuntimeUiScript.swift'];
for (const file of files.slice(0, 2)) fs.copyFileSync(path.join(here, 'ios-observer', file), path.join(target, file));
const program = `(${embeddedUiSnapshot.toString()})()`;
fs.writeFileSync(path.join(target, files[2]), '#if DEBUG\nimport Foundation\nenum PlayerLabRuntimeUiScript {\n  static let program = ' + JSON.stringify(program) + '\n}\n#endif\n');
const project = IOSConfig.XcodeUtils.getPbxproj(host);
for (const file of files) {
  const filepath = `${name}/${file}`;
  if (!project.hasFile(filepath)) IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project });
}
fs.writeFileSync(project.filepath, project.writeSync());
console.log('Prepared debug-only read-only WK observer in the external runtime host');
