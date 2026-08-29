import { formatError } from './lib.mjs'
import { writeProductionManifest } from './production-manifest.mjs'

try {
  const manifest = writeProductionManifest()
  console.log(`Manifesto canonico criado: ${manifest.manifest_hash}`)
  console.log(`Migrations promoviveis: ${manifest.upgrade_order.length}`)
} catch (error) {
  console.error(`Falha ao criar manifesto canonico: ${formatError(error)}`)
  process.exitCode = 1
}
