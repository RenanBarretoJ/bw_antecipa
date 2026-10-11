import { execFileSync } from 'node:child_process'

// Use the repository's existing server-only alias, exactly as the regression suite does.
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/nfse/xml-nacional/benchmark.test.ts'], {
  stdio: 'inherit', env: { ...process.env, BW_NFSE_WRITE_BENCHMARK: 'true' },
})
