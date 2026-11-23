import js from '@eslint/js';

export default [
  {
    ignores: ['cindy-plugin/**', 'node_modules/**', 'dist/**', '.desloppify/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node built-ins used across src/, test/, scripts/ and bin/.
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        BroadcastChannel: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // The Cindy plugin entry runs inside the host and receives `cindy`.
    files: ['src/cindy-entry.mjs'],
    languageOptions: {
      globals: { cindy: 'readonly' },
    },
  },
  {
    // The settings page runs in a browser WebView.
    files: ['src/settings.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
