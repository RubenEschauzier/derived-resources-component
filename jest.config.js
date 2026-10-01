// ESM libraries the Community Solid Server depends on, which need to be transformed so Jest can load them,
// as the server does in its own tests
const esModules = [
  'oidc-provider',
  'nanoid',
  'quick-lru',
  'jose',
  'marked',
];

module.exports = {
  transform: {
    '^.+\\.ts$': [ 'ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
    // Converts the ESM packages to CJS
    '^.+node_modules.+\\.js$': '@swc/jest',
  },
  // By default, node_modules are not transformed, but the ESM packages need to be
  transformIgnorePatterns: [ `/node_modules/(?!(${esModules.join('|')})/)` ],
  // Only run tests in the unit and integration folders.
  // All test files need to have the suffix `.test.ts`.
  testRegex: '/test/(unit|integration)/.*\\.test\\.ts$',
  moduleFileExtensions: [
    'ts',
    'js',
    // The native module of HDT
    'node',
  ],
  testEnvironment: 'node',
  setupFilesAfterEnv: [ '<rootDir>/test/util/SetupTests.ts' ],
  collectCoverage: true,
  coverageReporters: [ 'text', 'lcov' ],
  coveragePathIgnorePatterns: [
    '/dist/',
    '/node_modules/',
    '/test/',
  ],
  // Make sure our tests have enough time to start a server
  testTimeout: 60000,
};
