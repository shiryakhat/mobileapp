// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'pipeline/*',
      'content/*',
      'supabase/*',
      'node_modules/*',
      'src/coinflip/coinPage.generated.ts',
    ],
  },
]);
