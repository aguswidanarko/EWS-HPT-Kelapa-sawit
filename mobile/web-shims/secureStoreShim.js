// DEV-PREVIEW-ONLY SHIM — not used on Android/iOS, and not part of the app's real source.
//
// expo-secure-store has no web implementation by design (there is no OS keychain in a browser) —
// its web build literally exports `{}`, so any call to setItemAsync/getItemAsync/deleteItemAsync
// throws "not a function" when this app is run with `expo start --web`. On a real device the app
// uses the real native SecureStore (Android Keystore-backed) exactly as intended by BRD 01 §9.
//
// This shim exists only so the web preview (used here to visually check screens without a phone)
// can get past login. It backs the same three-method API with localStorage, which is NOT
// equivalently secure — this file is aliased in for web bundling only, see metro.config.js.
const store = {
  async setItemAsync(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore in headless contexts */ }
  },
  async getItemAsync(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  },
  async deleteItemAsync(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
};

module.exports = store;
