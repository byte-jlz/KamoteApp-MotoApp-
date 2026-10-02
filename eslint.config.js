// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions run on Deno, the admin page is a separate static site, and supabase/tests runs in Node;
    // none of them is part of the app.
    ignores: ["dist/*", "supabase/functions/*", "supabase/tests/*", "admin/*"],
  }
]);
