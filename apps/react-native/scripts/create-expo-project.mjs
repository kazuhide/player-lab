#!/usr/bin/env node
/** Create a new external Expo 54 host using the existing showcase screen. */
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const names = ["bitmovinplayer-ui.js", "bitmovinplayer-ui.css"];

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function createExpoProject({ target, assets = join(repoRoot, "packages/ui-shared/dist"), envFrom }) {
  target = resolve(target);
  if (inside(repoRoot, target)) throw new Error("Create the project outside the sample checkout.");
  if (existsSync(target)) throw new Error("The external project must be a new directory.");
  for (const name of names) {
    const path = join(assets, name);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size === 0) {
      throw new Error("Build the shared UI first: pnpm --filter @showcase/ui-shared build");
    }
  }
  if (envFrom && (!lstatSync(envFrom).isFile() || lstatSync(envFrom).size > 64 * 1024)) {
    throw new Error("The selected environment input must be a small regular file.");
  }
  mkdirSync(target, { recursive:true });
  for (const name of ["app.json", "package.json", "pnpm-lock.yaml", "index.tsx", "tsconfig.json", ".gitignore", ".nvmrc"]) {
    copyFileSync(join(appRoot, "expo", name), join(target, name));
  }
  copyFileSync(join(appRoot, "App.tsx"), join(target, "App.tsx"));
  cpSync(join(appRoot, "src"), join(target, "src"), {
    recursive:true,
    filter:(path) => lstatSync(path).isDirectory() || (lstatSync(path).isFile() && /\.tsx?$/.test(path)),
  });
  cpSync(join(appRoot, "expo/plugins"), join(target, "plugins"), { recursive:true });
  cpSync(join(appRoot, "expo/native-locks"), join(target, "native-locks"), { recursive:true });
  mkdirSync(join(target, "assets/webui"), { recursive:true });
  for (const name of names) copyFileSync(join(assets, name), join(target, "assets/webui", name));
  // Copy only when explicitly selected. Never parse, display or add keys to app.json.
  if (envFrom) {
    copyFileSync(envFrom, join(target, ".env"));
    chmodSync(join(target, ".env"), 0o600);
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals:true,
    options:{ "env-from":{ type:"string" }, help:{ type:"boolean" } },
  });
  if (values.help) {
    console.log("node create-expo-project.mjs NEW_EXTERNAL_DIRECTORY [--env-from GENERATED_ENV_FILE]");
  } else {
    try {
      if (positionals.length !== 1) throw new Error("Supply one new external project directory.");
      const target = createExpoProject({ target:positionals[0], envFrom:values["env-from"] });
      console.log(`Created Player Lab React Native in ${target}. Install the pinned dependencies, then run Expo prebuild.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Project generation failed.");
      process.exitCode = 1;
    }
  }
}
