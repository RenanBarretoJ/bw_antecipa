import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildMigrationInventory } from './lib.mjs'

const inventory = buildMigrationInventory()
const target = resolve('docs/financeiro/migration-inventory-p2-6-1.json')
writeFileSync(target, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
console.log(`Inventario P2.6.1: ${inventory.total} migrations; manifest ${inventory.manifest_sha256}; arquivo ${target}`)
