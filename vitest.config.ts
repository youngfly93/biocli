import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'benchmarks/**/*.test.ts'],
          exclude: ['src/clis/**/*.test.ts', '**/._*'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'adapter',
          include: ['src/clis/**/*.test.ts'],
          exclude: ['**/._*'],
          sequence: { groupOrder: 1 },
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          exclude: ['**/._*'],
          sequence: { groupOrder: 2 },
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          exclude: ['**/._*'],
          sequence: { groupOrder: 3 },
          passWithNoTests: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'benchmarks/pipeline/lib.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/._*',
        'src/**/*.test.ts',
        'tests/**/*.test.ts',
        'benchmarks/**/*.test.ts',
        'benchmarks/pipeline/fixtures/**',
        'benchmarks/pipeline/results/**',
      ],
    },
  },
});
