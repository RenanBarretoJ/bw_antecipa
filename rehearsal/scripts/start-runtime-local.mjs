import { formatError } from './lib.mjs'
import { spawnRuntime } from './runtime-lib.mjs'

try {
  const child = spawnRuntime()
  child.once('exit', (code) => { process.exitCode = code ?? 1 })
  child.once('error', (error) => { throw error })
  console.log('Runtime iniciado em http://localhost:3001 com saidas externas removidas do ambiente.')
} catch (error) {
  console.error(`Runtime local falhou: ${formatError(error)}`)
  process.exitCode = 1
}
