import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dependency = (path: string): string => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url))
const localReact = (path: string): string => dependency(`.pnpm/react@18.3.1/node_modules/react/${path}`)
const localReactDom = (path: string): string => dependency(`.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/${path}`)

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
      { find: /^react$/, replacement: localReact('index.js') },
      { find: /^react\/jsx-runtime$/, replacement: localReact('jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: localReact('jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: localReactDom('index.js') },
      {
        find: /^react-dom\/(.*)$/,
        replacement: `${dependency('.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom')}/$1`,
      },
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
