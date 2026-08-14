import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/m6-combination.snapshot.ts'],
    hookTimeout: 180_000,
    testTimeout: 90_000,
    sequence: { concurrent: false },
  },
})
