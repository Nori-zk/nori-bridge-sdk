module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    jest: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
  },
  plugins: ['@typescript-eslint', 'o1js'],
  rules: {
    'no-constant-condition': 'off',
    'prefer-const': 'off',
    'no-unused-vars': 'on',
    '@typescript-eslint/no-unused-vars': 'error',
  },
};
