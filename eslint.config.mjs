import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.aesyclaw/**',
      '.trellis/**',
      '.opencode/**',
      '.yarn/**',
      'web/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableBoolean: true,
          allowNullableString: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['web/**/*.ts', 'web/**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parser: vueParser,
      parserOptions: {
        project: './web/tsconfig.eslint.json',
        parser: {
          ts: '@typescript-eslint/parser',
          js: '@typescript-eslint/parser',
        },
      },
    },
    rules: {
      ...vuePlugin.configs['flat/recommended'].rules,
    },
  },
);
