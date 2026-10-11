import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const directory = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  resolve: { alias: { '@': path.resolve(directory, '../../../../src'),
    'server-only': path.resolve(directory, '../../../../src/test/server-only.ts') } },
  test: { environment: 'node', include: ['scripts/qa/nfse-national/e27/*.test.mjs'],
    testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
})
