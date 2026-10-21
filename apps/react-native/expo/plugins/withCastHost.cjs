const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withAppBuildGradle, withAppDelegate, withDangerousMod, withMainActivity, withMainApplication, withXcodeProject } = require("expo/config-plugins");

function insertOnce(source, marker, anchor, replacement) {
  if (source.includes(marker)) return source;
  if (!source.includes(anchor)) throw new Error(`Cast startup adapter cannot find its native template anchor: ${anchor}`);
  return source.replace(anchor, replacement);
}

function withCastHost(config) {
  config = withAppBuildGradle(config, config => {
    if (config.modResults.language !== "groovy") throw new Error("The Cast startup adapter requires the Groovy Expo host.");
    // Match the exact native SDK resolved by the pinned React Native wrapper.
    config.modResults.contents = insertOnce(config.modResults.contents, "player-lab-cast-native-sdk",
      "dependencies {", 'dependencies {\n    // player-lab-cast-native-sdk\n    implementation("com.bitmovin.player:player-core:3.170.0+jason")');
    return config;
  });
  config = withMainActivity(config, config => {
    if (config.modResults.language !== "kt") throw new Error("The Cast startup adapter requires the Kotlin Expo host.");
    config.modResults.contents = insertOnce(config.modResults.contents, "PlayerLabCastHost.initializeSavedOptions(this)",
      "super.onCreate(null)", "PlayerLabCastHost.initializeSavedOptions(this)\n    super.onCreate(null)");
    return config;
  });
  config = withMainApplication(config, config => {
    if (config.modResults.language !== "kt") throw new Error("The Cast startup adapter requires the Kotlin Expo host.");
    config.modResults.contents = insertOnce(config.modResults.contents, "add(PlayerLabCastHostPackage())",
      "PackageList(this).packages.apply {", "PackageList(this).packages.apply {\n          add(PlayerLabCastHostPackage())");
    return config;
  });
  config = withDangerousMod(config, ["android", async config => {
    const packageName = config.android?.package;
    if (!packageName || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName)) throw new Error("Set a valid Android package before adding the Cast startup adapter.");
    const target = path.join(config.modRequest.platformProjectRoot, "app/src/main/java", ...packageName.split("."));
    fs.mkdirSync(target, { recursive: true });
    const source = fs.readFileSync(path.join(__dirname, "native/PlayerLabCastHost.kt"), "utf8");
    fs.writeFileSync(path.join(target, "PlayerLabCastHost.kt"), source.replace("__PLAYER_LAB_PACKAGE__", packageName));
    return config;
  }]);
  config = withAppDelegate(config, config => {
    if (config.modResults.language !== "swift") throw new Error("The Cast startup adapter requires the Swift Expo host.");
    config.modResults.contents = insertOnce(config.modResults.contents, "PlayerLabCastHost.initializeSavedOptions()",
      "let delegate = ReactNativeDelegate()", "PlayerLabCastHost.initializeSavedOptions()\n    let delegate = ReactNativeDelegate()");
    return config;
  });
  config = withDangerousMod(config, ["ios", async config => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const target = path.join(config.modRequest.platformProjectRoot, projectName);
    for (const name of ["PlayerLabCastHost.swift", "PlayerLabCastHost.m"]) fs.copyFileSync(path.join(__dirname, "native", name), path.join(target, name));
    return config;
  }]);
  return withXcodeProject(config, config => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    for (const name of ["PlayerLabCastHost.swift", "PlayerLabCastHost.m"]) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${projectName}/${name}`, groupName: projectName, project: config.modResults });
    }
    return config;
  });
}
module.exports = withCastHost;
module.exports.insertOnce = insertOnce;
