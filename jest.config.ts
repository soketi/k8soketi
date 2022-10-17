import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
    moduleFileExtensions: ['ts', 'js', 'json'],
    coveragePathIgnorePatterns: [
        '<rootDir>/dist/',
        '<rootDir>/node_modules/',
    ],
    testPathIgnorePatterns: [
        '<rootDir>/dist',
        '<rootDir>/node_modules',
    ],
    preset: 'ts-jest/presets/default-esm',
    moduleNameMapper: {
        '^~/(.*)$': '<rootDir>/src/$1',
    },
    testRegex: "(/tests/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
    transform: {
        '^.+\\.(ts|tsx)$': [
            'ts-jest',
            {
                useESM: true,
                isolatedModules: true,
            },
        ],
    },
    testRunner: 'jest-circus/runner',
    maxWorkers: 1,
    testTimeout: 20 * 1000,
    collectCoverage: true,
    testEnvironment: 'node',
    globals: {
        Uint8Array: Uint8Array,
    },
};

export default config;
