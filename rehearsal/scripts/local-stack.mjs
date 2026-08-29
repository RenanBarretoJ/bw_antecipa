import { LOCAL_PROJECT_ID, REHEARSAL_ROOT, assertLocalTarget, formatError, run, runSupabase } from './lib.mjs'

const action = process.argv[2]

try {
  assertLocalTarget()
  if (!['start', 'stop', 'destroy'].includes(action)) throw new Error('Use start, stop ou destroy.')

  if (action === 'start') {
    run('docker', ['info', '--format', '{{.ServerVersion}}'])
    runSupabase(['start', '--output', 'json'])
    console.log('Stack Supabase de rehearsal iniciado.')
    console.log('API local: http://127.0.0.1:55321')
    console.log('Studio local: http://127.0.0.1:55323')
    console.log('Postgres local: 127.0.0.1:55322')
  } else if (action === 'stop') {
    runSupabase(['stop', '--project-id', LOCAL_PROJECT_ID])
    console.log('Stack Supabase de rehearsal parado; volume preservado.')
  } else {
    if (REHEARSAL_ROOT.toLowerCase().includes('supabase/migrations')) throw new Error('Workdir invalido para destruicao.')
    runSupabase(['stop', '--project-id', LOCAL_PROJECT_ID, '--no-backup'])
    console.log('Stack e volumes locais de rehearsal removidos.')
  }
} catch (error) {
  console.error(`Falha no stack local: ${formatError(error)}`)
  process.exitCode = 1
}
