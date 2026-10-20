#!/usr/bin/env node
// Preserve the existing extractor's full public declaration evidence for an SDK update.
const fs = require('node:fs');
const path = require('node:path');
const { extractInstalled } = require('./extract-installed.cjs');
if (process.argv.length !== 3) throw new Error('Supply one output JSON file.');
const output = path.resolve(process.argv[2]);
const data = extractInstalled(path.resolve(__dirname, '../..'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
process.stdout.write(`Captured public declarations for ${data.length} SDK integrations.\n`);
