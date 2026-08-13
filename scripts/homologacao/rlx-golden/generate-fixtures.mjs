import { writeFixtures } from './manifest.mjs'

const check = process.argv.includes('--check')
const { files, differences } = writeFixtures({ check })
if (check && differences.length) {
  console.error(`Fixtures divergentes: ${differences.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(check ? `Fixtures deterministicas: ${files.size} arquivos conferidos.` : `Fixtures geradas: ${files.size} arquivos.`)
}
