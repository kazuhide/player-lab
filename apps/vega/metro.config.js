const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  // pnpm stores dependencies at the workspace root and links app dependencies.
  watchFolders: [path.resolve(__dirname, "../..")],
  resolver: {
    unstable_enableSymlinks: true,
    nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
  },
});
