import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createExpoProject } from "../scripts/create-expo-project.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "player-lab-expo-"));
  try {
    const assets = join(root, "built-ui");
    mkdirSync(assets);
    writeFileSync(join(assets, "bitmovinplayer-ui.js"), "// public bundle fixture\n");
    writeFileSync(join(assets, "bitmovinplayer-ui.css"), ".fixture {}\n");
    run({ root, assets, target:join(root, "external-app") });
  } finally { rmSync(root, { recursive:true, force:true }); }
}

test("generates the existing App and pinned native project inputs without a license", () => fixture(({ assets, target }) => {
  createExpoProject({ target, assets });
  assert.equal(readFileSync(join(target, "App.tsx"), "utf8"), readFileSync(join(appRoot, "App.tsx"), "utf8"));
  assert.doesNotMatch(readFileSync(join(target, "index.tsx"), "utf8"), /RuntimeCheckApp/);
  assert.equal(readFileSync(join(target, "src/configuration.ts"), "utf8"), readFileSync(join(appRoot, "src/configuration.ts"), "utf8"));
  const config = JSON.parse(readFileSync(join(target, "app.json"), "utf8")).expo;
  assert.equal(config.ios.bundleIdentifier, "com.playerlab.reactnative");
  assert.equal(config.android.package, "com.playerlab.reactnative");
  assert.deepEqual(config.plugins[0], ["bitmovin-player-react-native", { features: {
    airPlay:true, backgroundPlayback:true, offline:true, pictureInPicture:true,
    googleCastSDK:{ appId:"FFE417E5", android:"21.3.0", ios:"4.8.4" },
  } }]);
  assert.equal(config.plugins.at(-1), "./plugins/withCastHost.cjs");
  assert.match(readFileSync(join(target, "plugins/native/PlayerLabCastHost.kt"), "utf8"), /BitmovinCastManager.initialize/);
  assert.match(readFileSync(join(target, "plugins/native/PlayerLabCastHost.swift"), "utf8"), /initializeCasting\(options:/);
  const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.equal(manifest.engines.node, "24.19.0");
  assert.equal(readFileSync(join(target, ".nvmrc"), "utf8").trim(), "24.19.0");
  assert.deepEqual(readFileSync(join(target, "pnpm-lock.yaml")), readFileSync(join(appRoot, "expo/pnpm-lock.yaml")));
  for (const name of ["Podfile.lock", "Package.resolved"]) {
    assert.deepEqual(readFileSync(join(target, "native-locks", name)), readFileSync(join(appRoot, "expo/native-locks", name)));
  }
  assert.equal(manifest.dependencies.expo, "57.0.30");
  assert.equal(manifest.dependencies["expo-crypto"], "57.0.4");
  assert.equal(manifest.dependencies["bitmovin-player-react-native"], "1.29.0");
  assert.match(readFileSync(join(target, ".gitignore"), "utf8"), /^\.env$/m);
  assert.throws(() => statSync(join(target, ".env")), { code:"ENOENT" });
}));

test("the explicit runtime-check entry retains the exact production App and pinned dependencies", () => fixture(({ assets, target }) => {
  createExpoProject({ target, assets, runtimeChecks:true });
  assert.match(readFileSync(join(target, "index.tsx"), "utf8"), /RuntimeCheckApp/);
  assert.equal(readFileSync(join(target, "App.tsx"), "utf8"), readFileSync(join(appRoot, "App.tsx"), "utf8"));
  assert.deepEqual(readFileSync(join(target, "package.json")), readFileSync(join(appRoot, "expo/package.json")));
}));

for (const runtimeChecks of [false, true]) {
  test(`the generated ${runtimeChecks ? "runtime-check" : "normal"} entry delegates safe-area ownership to its screen`, () => fixture(({ assets, target }) => {
    createExpoProject({ target, assets, runtimeChecks });
    const entry = readFileSync(join(target, "index.tsx"), "utf8");
    assert.doesNotMatch(entry, /SafeAreaProvider|SafeAreaView/);
    assert.match(entry, new RegExp(`registerRootComponent\\(${runtimeChecks ? "RuntimeCheckApp" : "App"}\\)`));
  }));
}

test("copies both built assets byte-for-byte", () => fixture(({ assets, target }) => {
  createExpoProject({ target, assets });
  for (const name of ["bitmovinplayer-ui.js", "bitmovinplayer-ui.css"]) {
    assert.deepEqual(readFileSync(join(target, "assets/webui", name)), readFileSync(join(assets, name)));
  }
}));

test("refuses an existing target without changing user files", () => fixture(({ assets, target }) => {
  mkdirSync(target);
  writeFileSync(join(target, "keep.txt"), "keep");
  assert.throws(() => createExpoProject({ target, assets }), /new directory/);
  assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "keep");
}));

test("missing built assets fail before creating the target", () => fixture(({ assets, target }) => {
  rmSync(join(assets, "bitmovinplayer-ui.css"));
  assert.throws(() => createExpoProject({ target, assets }), /Build the shared UI/);
  assert.throws(() => statSync(target), { code:"ENOENT" });
}));

test("an explicitly selected environment file is copied privately without entering public manifests", () => fixture(({ root, assets, target }) => {
  const envFrom = join(root, "fixture-input");
  const contents = "EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY=placeholder-for-test-only\n";
  writeFileSync(envFrom, contents);
  createExpoProject({ target, assets, envFrom });
  assert.equal(readFileSync(join(target, ".env"), "utf8"), contents);
  assert.equal(statSync(join(target, ".env")).mode & 0o777, 0o600);
  for (const name of ["app.json", "package.json"]) assert.doesNotMatch(readFileSync(join(target, name), "utf8"), /placeholder-for-test-only/);
}));

test("rejects targets inside the sample source", () => fixture(({ assets }) => {
  assert.throws(() => createExpoProject({ target:resolve(appRoot, "generated"), assets }), /outside the sample/);
}));


test("the Cast startup plugin is idempotent and refuses a changed native template", () => {
  const require = createRequire(import.meta.url);
  const { insertOnce } = require("../expo/plugins/withCastHost.cjs");
  const source = "before\n    super.onCreate(null)\nafter";
  const marker = "PlayerLabCastHost.initializeSavedOptions(this)";
  const edited = insertOnce(source, marker, "super.onCreate(null)", marker + "\n    super.onCreate(null)");
  assert.equal(insertOnce(edited, marker, "super.onCreate(null)", "must not duplicate"), edited);
  assert.ok(edited.indexOf(marker) < edited.indexOf("super.onCreate(null)"));
  assert.throws(() => insertOnce("changed template", marker, "super.onCreate(null)", "replacement"), /cannot find/);
});
