import { createClient } from '@supabase/supabase-js'
import { executarConciliacaoFinanceira, executarMatchingFinanceiro } from '../../../src/lib/financeiro/conciliacao/processor.server'
import { DATASET_VERSION, buildGoldenV2 } from './scenario-definitions.mjs'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase server-side ausentes.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function main() {
  const dataset = buildGoldenV2()
  const client = admin()
  const { data: actor, error } = await client.from('cedentes').select('user_id').eq('id', dataset.cedents[0].id).single()
  if (error || !actor?.user_id) throw new Error(`Ator QA V2 nao encontrado: ${error?.message || 'retorno vazio'}`)
  const matching = await executarMatchingFinanceiro({ fundoId: dataset.mainFund.id, dataReferencia: dataset.dates['D-1'], atorUsuarioId: actor.user_id })
  const adversarialMatching = await executarMatchingFinanceiro({
    fundoId: dataset.adversarialFund.id,
    dataReferencia: dataset.dates['D-1'],
    atorUsuarioId: actor.user_id,
  })
  const reconciliation = await executarConciliacaoFinanceira({ fundoId: dataset.mainFund.id, dataReferencia: dataset.dates['D-1'], atorUsuarioId: actor.user_id })
  const phase = process.argv.find((item) => item.startsWith('--phase='))?.split('=')[1] || 'A'
  console.log(JSON.stringify({ dataset: DATASET_VERSION, phase, matching, adversarialMatching, reconciliation }, null, 2))
}

main().catch((error) => {
  console.error(`Execucao P2.3 Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
