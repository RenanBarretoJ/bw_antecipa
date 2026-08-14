import { createClient } from '@supabase/supabase-js'
import { executarPosicaoLogisticaFinanceira } from '../../../src/lib/rlx/logistica/processor.server'
import { DATASET_VERSION, buildGoldenV2 } from '../rlx-golden-v2/scenario-definitions.mjs'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase server-side ausentes.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const dataset = buildGoldenV2()
  const { data: actor, error } = await client.from('cedentes').select('user_id').eq('id', dataset.cedents[0].id).single()
  if (error || !actor?.user_id) throw new Error(`Ator QA V2 nao encontrado: ${error?.message || 'retorno vazio'}`)
  const main = await executarPosicaoLogisticaFinanceira({ fundoId: dataset.mainFund.id, dataReferencia: dataset.dates['D-1'], atorUsuarioId: actor.user_id })
  const adversarial = await executarPosicaoLogisticaFinanceira({ fundoId: dataset.adversarialFund.id, dataReferencia: dataset.dates['D-1'], atorUsuarioId: actor.user_id })
  console.log(JSON.stringify({ dataset: DATASET_VERSION, main, adversarial }, null, 2))
}

main().catch((error) => {
  console.error(`Execucao P2.4 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
