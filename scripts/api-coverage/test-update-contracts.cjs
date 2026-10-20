const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createExtractor } = require('./extract-sdk-surface.cjs');

function withFixture(body) {
  const folder = mkdtempSync(path.join(tmpdir(), 'player-lab-contract-'));
  try {
    function extract(version, declaration) {
      writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'public-contract-fixture', version }));
      writeFileSync(path.join(folder, 'index.d.ts'), declaration);
      const x = createExtractor({ packageRoot: folder, entryFile: 'index.d.ts', referenceFor: id => `https://example.com/${id}` });
      assert.deepEqual(x.diagnostics(), []);
      return [{ id: 'web', version, diagnostics: [], rows: x.configuration(['Config']).rows }];
    }
    body(extract);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function changed(a, b) {
  const source = "import json,sys;sys.path.insert(0,'scripts');from sdk_updates import api_delta;a,b=json.load(sys.stdin);print(json.dumps(api_delta(a,b)[0]['changed']))";
  return JSON.parse(execFileSync('python3', ['-c', source], {
    cwd: path.resolve(__dirname, '../..'), input: JSON.stringify([a, b]), encoding: 'utf8',
  }));
}

test('update deltas retain optional, nullable, readonly and parent configuration contracts', () => {
  withFixture(extract => {
    const before = extract('1.0.0', `export interface Config {
      optional?: boolean; nullable: string | null; group?: { count: number };
      readonly locked?: boolean; stable: number;
    }`);
    const after = extract('1.0.1', `export interface Config {
      optional: boolean; nullable: string; group: { count: number };
      locked?: boolean; stable: number;
    }`);
    assert.deepEqual(changed(before, after), ['Config.group.count', 'Config.locked', 'Config.nullable', 'Config.optional']);
    const formattingOnly = extract('1.0.2', `// Documentation and provenance only.
      export interface Config { optional: boolean;
        nullable: string; group: { count: number }; locked?: boolean; stable: number; }`);
    assert.deepEqual(changed(after, formattingOnly), []);
  });
});

test('update deltas retain nullable and mapped readonly root contracts', () => {
  withFixture(extract => {
    const nullable = extract('1.0.0', 'export type Config = { value: number } | null;');
    const required = extract('1.0.1', 'export type Config = { value: number };');
    assert.deepEqual(changed(nullable, required), ['Config.value']);
    const readonly = extract('1.0.2', 'export type Config = Readonly<{ value: number }>;');
    assert.deepEqual(changed(required, readonly), ['Config.value']);
  });
});

test('a union branch cannot overwrite another branch property contract', () => {
  withFixture(extract => {
    const before = extract('1.0.0', `interface A { kind: 'a'; readonly value: boolean }
      interface B { kind: 'b'; value: boolean }
      export interface Config { choice: A | B }`);
    const after = extract('1.0.1', `interface A { kind: 'a'; value: boolean }
      interface B { kind: 'b'; value: boolean }
      export interface Config { choice: A | B }`);
    assert.deepEqual(changed(before, after), ['Config.choice.value']);
    const reordered = extract('1.0.2', `interface A { kind: 'a'; value: boolean }
      interface B { kind: 'b'; value: boolean }
      export interface Config { choice: B | A }`);
    // Reordering branches does not change their individual contracts.
    assert.deepEqual(changed(after, reordered), []);
  });
});

test('moving a property contract between named union branches is a change', () => {
  withFixture(extract => {
    const before = extract('1.0.0', `interface A { kind: 'a'; readonly value: boolean }
      interface B { kind: 'b'; value: boolean }
      export interface Config { choice: A | B }`);
    const after = extract('1.0.1', `interface A { kind: 'a'; value: boolean }
      interface B { kind: 'b'; readonly value: boolean }
      export interface Config { choice: A | B }`);
    assert.deepEqual(changed(before, after), ['Config.choice.value']);
  });
});
