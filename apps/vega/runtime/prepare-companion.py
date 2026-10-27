#!/usr/bin/env python3
"""Prepare a license-free app used only for a real Vega app-to-app transfer."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    app = Path(__file__).resolve().parents[1]
    checkout = app.parents[1]
    output = args.output.resolve()
    if output.exists() or output == checkout or checkout in output.parents:
        parser.error("Use a new directory outside the checkout")
    if not (app / "node_modules").is_dir():
        parser.error("Install the repository's frozen dependencies first")
    os.umask(0o077)
    output.mkdir(parents=True)
    package = json.loads((app / "package.json").read_text())
    package.update(name="player-lab-runtime-companion", description="License-free Vega lifecycle test companion")
    package["dependencies"] = {key: value for key, value in package["dependencies"].items()
                               if key in {"react", "react-native", "@amazon-devices/react-native-kepler"}}
    native_cli = (app / "node_modules/react-native/cli.js").resolve()
    if not native_cli.is_file():
        parser.error("The pinned React Native CLI is not installed")
    # PNPM's .bin shell shim contains paths relative to its original location.
    # Execute the installed CLI directly when this project lives elsewhere.
    package["scripts"] = {"build": "node " + shlex.quote(str(native_cli)) + " build-vega --build-type Release --max-workers 2"}
    package["kepler"]["appName"] = "PlayerLabRuntimeCompanion"
    (output / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    modules = output / "node_modules"
    modules.mkdir()
    for entry in (app / "node_modules").iterdir():
        if entry.name.startswith("@") and entry.is_dir():
            (modules / entry.name).mkdir()
            for child in entry.iterdir():
                (modules / entry.name / child.name).symlink_to(child.resolve(), target_is_directory=child.is_dir())
        else:
            (modules / entry.name).symlink_to(entry.resolve(), target_is_directory=entry.is_dir())
    # Amazon's external-project lookup requires the CLI's existing transitive
    # Metro plugin at the project root. Reuse that exact installed dependency.
    plugin = (app / "node_modules/@react-native-community/cli").resolve().parent / "cli-plugin-metro"
    if not plugin.is_dir():
        parser.error("The pinned React Native CLI Metro plugin is not installed")
    (modules / "@react-native-community/cli-plugin-metro").symlink_to(plugin.resolve(), target_is_directory=True)
    platform = (app / "node_modules/@amazon-devices/kepler-cli-platform").resolve()
    # These build tools are transitive dependencies in the frozen PNPM graph.
    # Kepler looks them up from the external project instead of its own package.
    for name in ["kepler-module-manifest-builder", "kepler-compatibility-metro-config"]:
        dependency = platform.parent / name
        if not dependency.is_dir():
            parser.error("A pinned Kepler build dependency is not installed: " + name)
        (modules / "@amazon-devices" / name).symlink_to(dependency.resolve(), target_is_directory=True)
    shutil.copyfile(app / "babel.config.js", output / "babel.config.js")
    (output / "app.json").write_text(json.dumps({"name": "com.playerlab.runtimecompanion.main", "displayName": "Player Lab Runtime Companion"}) + "\n")
    (output / "index.js").write_text('''import React from "react";
import { AppRegistry, Text, View } from "react-native";
function RuntimeCompanion() {
  return <View style={{ flex: 1, backgroundColor: "#222", justifyContent: "center", alignItems: "center" }}>
    <Text style={{ color: "white", fontSize: 32 }}>Player Lab runtime companion</Text>
  </View>;
}
AppRegistry.registerComponent("com.playerlab.runtimecompanion.main", () => RuntimeCompanion);
''')
    (output / "manifest.toml").write_text('''schema-version = 1
[package]
title = "Player Lab Runtime Companion"
version = "0.1.0"
id = "com.playerlab.runtimecompanion"
[os.version]
min = "1.2"
target = "1.2"
[needs]
[[needs.module]]
id = "/com.amazon.vega.os@IVega_1_2"
[[needs.module]]
id = "/com.amazon.kepler.keplerscript_2@IKeplerScript_1"
[components]
[[components.interactive]]
id = "com.playerlab.runtimecompanion.main"
runtime-module = "/com.amazon.kepler.keplerscript.runtime.loader_2@IKeplerScript_2_0"
launch-type = "singleton"
categories = ["com.amazon.category.main"]
''')
    # Resolve the already installed public graph; no second install or license
    # configuration is needed. Exclude the licensed application's source tree.
    (output / "metro.config.js").write_text('''const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const checkout = CHECKOUT;
const block = new RegExp(BLOCK);
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [checkout],
  resolver: { unstable_enableSymlinks: true, blockList: [block] },
});
'''.replace("CHECKOUT", json.dumps(str(checkout))).replace("BLOCK", json.dumps(re.escape(str(app)) + "/(?!node_modules/)")))
    print(json.dumps({"prepared": True, "licenseConfigurationRequired": False}))


if __name__ == "__main__":
    main()
