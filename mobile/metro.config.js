// Metro config for Expo SDK 57 web preview.
//
// expo-sqlite's web implementation (src/web/worker.ts) imports its SQLite engine as
// `./wa-sqlite/wa-sqlite.wasm`, expecting Metro to treat `.wasm` as a resolvable asset.
// The @expo/metro-config default resolver.assetExts list (as of this SDK version) does not
// include 'wasm' (it only adds 'heic'/'avif' for expo-image and 'db' for expo-sqlite's native
// file databases), so on web the worker bundle fails with "Unable to resolve module ...
// wa-sqlite.wasm" and the app hangs forever on "Menyiapkan database lokal...".
//
// This does not affect native (Android/iOS) builds, which use the native SQLite binding
// instead of the wa-sqlite/WASM worker and never hit this import path.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

// DEV-PREVIEW-ONLY: expo-secure-store has no web implementation (see web-shims/secureStoreShim.js
// for why). Redirect it to a localStorage-backed shim ONLY when bundling for the 'web' platform,
// so `expo start --web` can be used to visually check screens without a phone. Android/iOS builds
// are untouched (originModulePath check below only fires for platform === 'web').
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-secure-store') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'web-shims/secureStoreShim.js'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
