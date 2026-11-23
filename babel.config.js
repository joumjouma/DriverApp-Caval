module.exports = function (api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Strip console.log/info/debug from release bundles (keeps error/warn),
      // so production builds don't leak user data into device logs.
      ...(process.env.NODE_ENV === "production"
        ? [["transform-remove-console", { exclude: ["error", "warn"] }]]
        : []),
      "react-native-reanimated/plugin",
      "@babel/plugin-transform-runtime",
      [
        "module-resolver",
        {
          alias: {
            "@components": "./components",
            "@screens": "./screens",
            "@navigation": "./navigation",
            "@utils": "./utils",
            "@assets": "./assets",
          },
        },
      ],
      ["module:react-native-dotenv", {
        "moduleName": "@env",
        "path": ".env",
        "blacklist": null,
        "whitelist": null,
        "safe": false,
        "allowUndefined": true
      }]
    ],
  };
};
