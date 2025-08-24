const { getDefaultConfig } = require("@expo/metro-config");
const path = require("path");

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  ...defaultConfig,
  resolver: {
    ...defaultConfig.resolver,
    sourceExts: ["jsx", "js", "ts", "tsx", "cjs", "mjs", "json"],
    assetExts: [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "ttf",
      "otf",
      "woff",
      "woff2",
      "db",
    ],
    extraNodeModules: {
      idb: require.resolve("idb"),
    },
    resolveRequest: (context, moduleName, platform) => {
      // Exclude caval-driver subdirectory from main app bundling
      if (moduleName.includes("caval-driver")) {
        return null;
      }
      
      if (moduleName.includes("idb") && !moduleName.endsWith(".js")) {
        try {
          return {
            filePath: require.resolve("idb"),
            type: "sourceFile",
          };
        } catch (e) {
          // Fall back to default resolver
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    // Exclude caval-driver directory from watchman
    watchFolders: [
      path.resolve(__dirname, "node_modules"),
      // Only watch the main app directory, not caval-driver
    ],
  },
  transformer: {
    ...defaultConfig.transformer,
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  // Exclude caval-driver from the main bundle
  resolver: {
    ...defaultConfig.resolver,
    blacklistRE: /caval-driver/,
  },
};

module.exports = config;
