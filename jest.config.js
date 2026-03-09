/** @type {import('jest').Config} */
const config = {
  // The test environment that will be used for testing
  testEnvironment: 'node',

  // The glob patterns Jest uses to detect test files.
  // We look for .js files in __tests__ folders or with .spec/.test suffixes.
  testMatch: [
    '**/?(*.)+(spec|test).jest.js?(x)'
  ],
  
  // To add TypeScript support in the future:
  // 1. Run `npm install --save-dev ts-jest @types/jest`
  // 2. Uncomment the following lines:
  // preset: 'ts-jest',
  // testMatch: [
  //   '**/__tests__/**/*.ts?(x)',
  //   '**/?(*.)+(spec|test).ts?(x)'
  // ],
};

module.exports = config;
