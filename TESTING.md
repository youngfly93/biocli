# Testing Guide

biocli uses a three-tier test strategy powered by [Vitest](https://vitest.dev/).

## Test Tiers

### Unit Tests (`npm test`)

Pure function tests with no network calls or mocks of the command registry.

- **Location**: `src/**/*.test.ts` (excluding `src/clis/**`)
- **Examples**: URL builders, parsers, argument coercion, utility functions
- **Run**: `npm test` or `vitest run --project unit`

### Adapter Tests (`npm run test:adapter`)

Test individual commands by mocking the `HttpContext` interface. No real HTTP calls.

- **Location**: `src/clis/**/*.test.ts`
- **Pattern**: Import command module → mock HttpContext → get from registry → call `cmd.func!()` → assert output shape
- **Run**: `npm run test:adapter` or `vitest run --project adapter`

### E2E Tests (`npm run test:e2e`)

Spawn the real CLI as a subprocess with injected global `fetch` mocks.

- **Location**: `tests/e2e/**/*.test.ts`
- **Pattern**: `spawnSync` with isolated temp home directories
- **Run**: `npm run test:e2e` or `vitest run --project e2e`

### All Tests

```bash
npm run test:all    # Runs unit → adapter → e2e in sequence
```

### Coverage

```bash
npm run test:coverage
```

Runs the full Vitest suite with V8 coverage enabled and writes reports under `coverage/`.

## Writing a New Adapter Test

1. Create `src/clis/<database>/<command>.test.ts`
2. Import the command module (side-effect registration):
   ```ts
   import './<command>.js';
   ```
3. Create a mock `HttpContext`:
   ```ts
   function makeCtx(): HttpContext {
     return {
       databaseId: '<database>',
       fetchJson: async (url) => { /* return mock data */ },
       fetch: async () => { throw new Error('unexpected'); },
       fetchXml: async () => { throw new Error('unexpected'); },
       fetchText: async () => { throw new Error('unexpected'); },
     };
   }
   ```
4. Get the command and call it:
   ```ts
   const cmd = getRegistry().get('<database>/<command>');
   const rows = await cmd!.func!(makeCtx(), { arg: 'value' }) as Record<string, unknown>[];
   ```
5. Assert output shape:
   ```ts
   expect(rows).toEqual([expect.objectContaining({ field: 'expected' })]);
   ```

## Mock Data Conventions

- Use minimal but structurally accurate mock data
- Use real field names from actual API responses
- For aggregation tests, use `vi.mock()` to replace `createHttpContextForDatabase`

## Smoke Tests

### Core Smoke (no network)

```bash
npm run smoke:core
```

Validates CLI startup, built-in commands, and output parsing.

### Live Smoke (requires network)

```bash
npm run smoke:live
```

Makes real API calls to verify backend connectivity. Intended for manual testing or nightly CI.

## CI Integration

| CI Stage | Tests |
|----------|-------|
| PR       | `npm run typecheck` + `npm run test:all` |
| Nightly  | `npm run smoke:live` |
| Release  | `npm run test:all` + `npm run smoke:core` |
