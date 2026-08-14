import { writeFixtures } from './fixtures.mjs'

const check = process.argv.includes('--check')
const result = writeFixtures({ check })
if (check && result.differences.length) {
  console.error(`Golden V2 divergente: ${result.differences.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(check ? `Golden V2 deterministico: ${result.files.size} arquivos.` : `Golden V2 gerado: ${result.files.size} arquivos.`)
}
