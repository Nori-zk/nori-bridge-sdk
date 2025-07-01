/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  verbose: true,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 1_000_000,
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  resolver: '<rootDir>/jest-resolver.cjs',
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!(mina-attestations|tslib|o1js/node_modules/tslib))',
  ],
  modulePathIgnorePatterns: ['<rootDir>/build/', '<rootDir>/target/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.+)\\.js$': '$1',
    '^mina-attestations/imported$':
      '<rootDir>/node_modules/mina-attestations/dist/imported.js',
  },
};
