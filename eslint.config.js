// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions run on Deno and the admin page is a separate static site; neither is part of the app.
    ignores: ["dist/*", "supabase/functions/*", "admin/*"],
  }
]);
