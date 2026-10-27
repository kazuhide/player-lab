import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class PrepareCompanionTests(unittest.TestCase):
    def test_build_command_resolves_the_installed_cli_from_an_external_directory(self):
        with tempfile.TemporaryDirectory(prefix="vega companion ") as directory:
            root = Path(directory).resolve()
            checkout = root / "source checkout"
            app = checkout / "apps/vega"
            runtime = app / "runtime"
            runtime.mkdir(parents=True)
            script = runtime / "prepare-companion.py"
            shutil.copyfile(Path(__file__).with_name("prepare-companion.py"), script)
            (app / "package.json").write_text(json.dumps({"name": "vega-fixture", "version": "0.1.0",
                "dependencies": {"react": "18.2.0", "react-native": "0.72.0"}, "kepler": {"appName": "VegaFixture"}}))
            (app / "babel.config.js").write_text("module.exports = {};\n")
            modules = app / "node_modules"
            bin_directory = modules / ".bin"
            bin_directory.mkdir(parents=True)
            installed = checkout / "node_modules/.pnpm/installed/node_modules"
            native = installed / "react-native"
            native.mkdir(parents=True)
            cli = native / "cli.js"
            cli.write_text('''const { createRequire } = require("node:module");
const project = createRequire(process.cwd() + "/package.json");
project("@amazon-devices/kepler-module-manifest-builder/package.json");
project("@amazon-devices/kepler-compatibility-metro-config/package.json");
console.log(JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}));
''')
            (modules / "react-native").symlink_to(native, target_is_directory=True)
            installed_cli = installed / "@react-native-community/cli"
            installed_cli.mkdir(parents=True)
            installed_cli.with_name("cli-plugin-metro").mkdir()
            (modules / "@react-native-community").mkdir()
            (modules / "@react-native-community/cli").symlink_to(installed_cli, target_is_directory=True)
            (modules / "@amazon-devices").mkdir()
            platform = installed / "@amazon-devices/kepler-cli-platform"
            platform.mkdir(parents=True)
            (modules / "@amazon-devices/kepler-cli-platform").symlink_to(platform, target_is_directory=True)
            for name in ["kepler-module-manifest-builder", "kepler-compatibility-metro-config"]:
                dependency = platform.with_name(name)
                dependency.mkdir()
                (dependency / "package.json").write_text(json.dumps({"name": "@amazon-devices/" + name, "version": "0.0.0"}))
            shim = bin_directory / "react-native"
            relative_cli = os.path.relpath(cli, bin_directory)
            shim.write_text('#!/bin/sh\nbasedir=$(dirname "$0")\nexec node "$basedir/' + relative_cli + '" "$@"\n')
            shim.chmod(0o755)
            output = root / "external companion"
            prepared = subprocess.run([sys.executable, str(script), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            command = json.loads((output / "package.json").read_text())["scripts"]["build"]
            environment = {**os.environ, "PATH": str(output / "node_modules/.bin") + os.pathsep + os.environ["PATH"]}
            built = subprocess.run(command, cwd=output, env=environment, shell=True, capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            self.assertEqual(json.loads(built.stdout), {"cwd": str(output), "args": ["build-vega", "--build-type", "Release", "--max-workers", "2"]})
            self.assertFalse((output / "runtime.local.json").exists())


if __name__ == "__main__": unittest.main()
