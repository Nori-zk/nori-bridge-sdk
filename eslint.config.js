import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import o1js from 'eslint-plugin-o1js';
import json from '@eslint/json';

const jsTsFiles = ['**/*.{js,mjs,cjs,ts,mts,cts}'];

export default [
  {
    files: jsTsFiles,
    ...eslint.configs.recommended,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: config.files ?? jsTsFiles,
  })),
  {
    files: jsTsFiles,
    plugins: {
      o1js,
    },
    rules: {
      // o1js recommended rules
      'o1js/no-greater-storage-limit-in-circuit': 'error',
      'o1js/no-if-in-circuit': 'warn',
      'o1js/no-ternary-in-circuit': 'warn',
      'o1js/no-throw-in-circuit': 'error',
      'o1js/no-json-functions-in-circuit': 'warn',
      'o1js/no-random-in-circuit': 'warn',
      'o1js/no-constructor-in-smart-contract': 'error',
      // Custom overrides
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      'no-constant-condition': 'off',
      'prefer-const': 'off',
      'no-global-assign': 'off',
    },
  },
  {
    files: ['**/*.json'],
    plugins: { json },
    language: 'json/jsonc',
    rules: {
      'json/no-duplicate-keys': 'error',
    },
  },
  {
    ignores: ['build/**', 'target/**', 'node_modules/**'],
  }
];
