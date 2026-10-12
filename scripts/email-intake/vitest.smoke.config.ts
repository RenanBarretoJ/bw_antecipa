import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Opt-in only: never read a real mailbox in the default/unit test suite.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src'),
    'server-only': path.resolve(__dirname, '../../src/test/server-only.ts') } },
  test: { include: ['scripts/email-intake/outlook.smoke.ts'], testTimeout: 40_000 },
})
