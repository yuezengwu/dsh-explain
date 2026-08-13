import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const testingLibraryRequire = createRequire(require.resolve('@testing-library/react/package.json'))

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
    alias: [
      {
        find: /^@deepseek-ai\/dsh-client-ui-primitives$/,
        replacement: fileURLToPath(new URL('./tests/button-stub.ts', import.meta.url)),
      },
      {
        find: /^@deepseek-ai\/dsh-client-runtime\/client$/,
        replacement: fileURLToPath(new URL('./tests/client-runtime-stub.ts', import.meta.url)),
      },
      { find: /^react$/, replacement: testingLibraryRequire.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: testingLibraryRequire.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: testingLibraryRequire.resolve('react/jsx-dev-runtime') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
})
