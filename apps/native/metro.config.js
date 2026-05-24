// Learn more https://docs.expo.dev/guides/monorepos
// SDK 52+ automatically configures Metro for monorepos

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { FileStore } = require("metro-cache");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Use turborepo to restore the cache when possible
config.cacheStores = [
  new FileStore({
    root: path.join(projectRoot, "node_modules", ".cache", "metro"),
  }),
];

// Force all react imports to resolve from the native app's node_modules,
// preventing duplicate React instances from nested copies in the monorepo.
const reactModules = ["react", "react/jsx-runtime", "react/jsx-dev-runtime"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (reactModules.includes(moduleName)) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./src/app/global.css",
  inlineRem: 16,
});
