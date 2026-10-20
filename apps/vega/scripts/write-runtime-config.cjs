const fs = require("node:fs");
const path = require("node:path");

function writeRuntimeConfig(destination, environment, withoutCredentials = false, runtimeChecks = false) {
  const config = {
    playerKey: withoutCredentials ? "" : environment.BITMOVIN_PLAYER_LICENSE_KEY ?? "",
    analyticsKey: withoutCredentials ? "" : environment.BITMOVIN_ANALYTICS_LICENSE_KEY ?? "",
    ...(runtimeChecks ? { runtimeChecks: true } : {}),
  };
  const temporary = destination + "." + process.pid + ".tmp";
  let created = false;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    created = true;
    try {
      fs.writeFileSync(descriptor, JSON.stringify(config) + "\n");
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, destination);
    created = false;
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (new Set(args).size !== args.length || args.some((value) => !["--without-credentials", "--runtime-checks"].includes(value))) {
    process.stderr.write("Usage: node scripts/write-runtime-config.cjs [--without-credentials] [--runtime-checks]\n");
    process.exitCode = 1;
  } else {
    try {
      writeRuntimeConfig(path.resolve(__dirname, "../runtime.local.json"), process.env, args.includes("--without-credentials"), args.includes("--runtime-checks"));
      process.stdout.write("Generated ignored Vega runtime configuration.\n");
    } catch {
      process.stderr.write("Could not generate Vega runtime configuration.\n");
      process.exitCode = 1;
    }
  }
}

module.exports = { writeRuntimeConfig };
