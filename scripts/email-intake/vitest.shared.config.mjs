import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Framework marker alias only. Auth/DB/Storage/parsers are real; the browser
// scenario controls Graph HTTP responses in its separate local Next process.
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src'), 'server-only': path.resolve('src/test/server-only.ts') } },
  test: {
    include: ['scripts/email-intake/shared-service-smoke.mjs'], environment: 'node',
    // One opt-in scenario includes real MFA HTTP calls, Chromium PDF generation,
    // parsing, concurrent imports, or a separate browser/Next compilation run.
    testTimeout: 120_000,
  },
})
