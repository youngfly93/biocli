import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
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
    ],
  },
});
