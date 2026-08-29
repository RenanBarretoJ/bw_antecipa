import { formatError } from './lib.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

try {
  const result = validateProductionManifest()
  console.log(`MIGRATIONS_PRODUCAO_CANONICAS = CONFIRMADO (${result.manifest_hash})`)
  console.log(`Baseline: ${result.baseline_count}; bridges: ${result.bridge_count}; upgrade: ${result.upgrade_count}; bloqueadas: ${result.blocked_count}.`)
} catch (error) {
  console.error(`MIGRATIONS_PRODUCAO_CANONICAS = RISCO: ${formatError(error)}`)
  process.exitCode = 1
}
