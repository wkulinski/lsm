import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        clearMocks: true,
        environment: 'node',
        globals: false,
        include: ['tests/**/*.test.ts'],
        restoreMocks: true,
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/core/types/**'],
            thresholds: {
                lines: 80,
                statements: 80,
                functions: 85,
                branches: 70,
            },
        },
    },
});
