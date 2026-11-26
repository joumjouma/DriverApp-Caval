// Standard Expo bundler config. (The old one had a workaround for a Firebase
// dependency, idb, that the app no longer uses.)
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Server code, scripts and tests are not part of the app
config.resolver.blockList = [/\/functions\/.*/, /\/scripts\/.*/, /\/firestore-tests\/.*/, /\/supabase\/.*/];

module.exports = config;
