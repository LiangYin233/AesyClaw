import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import localImportRules from './eslint/local-rules/import-boundaries.mjs';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'plugins/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        require: 'readonly',
        fetch: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        RequestInit: 'readonly',
        Buffer: 'readonly',
        Response: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      local: localImportRules,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'local/no-invalid-import-boundaries': 'error',
      'local/no-invalid-barrel-exports': 'error',
    },
    ignores: ['dist/**', 'node_modules/**', '**/*.js'],
  },
];
