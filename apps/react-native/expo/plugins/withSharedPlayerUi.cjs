const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const files = ["bitmovinplayer-ui.js", "bitmovinplayer-ui.css"];

function copyAssets(projectRoot, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of files) {
    const source = path.join(projectRoot, "assets/webui", name);
    if (!fs.lstatSync(source).isFile()) throw new Error("The built shared Player UI assets are required.");
    fs.copyFileSync(source, path.join(target, name));
  }
}

// Use the SDK's local URLs; native builds include the same JS/CSS bytes as the shared UI.
// https://docs.expo.dev/config-plugins/development-and-debugging/#best-practices-for-mods
module.exports = function withSharedPlayerUi(config) {
  config = withDangerousMod(config, ["android", async (config) => {
    copyAssets(config.modRequest.projectRoot, path.join(config.modRequest.platformProjectRoot, "app/src/main/assets/webui"));
    return config;
  }]);
  config = withDangerousMod(config, ["ios", async (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    copyAssets(config.modRequest.projectRoot, path.join(config.modRequest.platformProjectRoot, projectName));
    return config;
  }]);
  return withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    // Expo's asset/font plugins use this resource group and helper, which avoids duplicate entries.
    IOSConfig.XcodeUtils.ensureGroupRecursively(config.modResults, "Resources");
    for (const name of files) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: `${projectName}/${name}`,
        groupName: "Resources",
        project: config.modResults,
        isBuildFile: true,
      });
    }
    return config;
  });
};
