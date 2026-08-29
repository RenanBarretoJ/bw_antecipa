import path from 'node:path'
import { REHEARSAL_ROOT, formatError, run } from './lib.mjs'

try {
  const scripts = ['local-stack.mjs', 'restore-local.mjs', 'baseline-local.mjs']
  const script = (name) => path.join(REHEARSAL_ROOT, 'scripts', name)
  run(process.execPath, [script(scripts[0]), 'destroy'])
  run(process.execPath, [script(scripts[0]), 'start'])
  run(process.execPath, [script(scripts[1])])
  run(process.execPath, [script(scripts[2])])
  console.log('Rebuild local concluido a partir do snapshot de producao.')
} catch (error) {
  console.error(`Rebuild abortado: ${formatError(error)}`)
  process.exitCode = 1
}
