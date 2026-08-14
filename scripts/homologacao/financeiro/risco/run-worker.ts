import { createClient } from '@supabase/supabase-js'
import { executarGateRisco } from '../../../../src/lib/financeiro/risco/processor.server'
import { buildGoldenV2, DATASET_VERSION } from '../../rlx-golden-v2/scenario-definitions.mjs'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase server-side ausentes.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const dataset = buildGoldenV2()
  const { data: actor, error } = await client.from('cedentes').select('user_id').eq('id', dataset.cedents[0].id).single()
  if (error || !actor?.user_id) throw new Error(`Ator QA V2 nao encontrado: ${error?.message || 'retorno vazio'}`)
  const results = []
  for (const fund of dataset.funds) {
    results.push(await executarGateRisco({
      fundoId: fund.id,
      dataOperacional: dataset.baseDate,
      atorUsuarioId: actor.user_id,
      origem: 'CENTRAL_RISCO',
    }))
  }
  console.log(JSON.stringify({ dataset: DATASET_VERSION, results }, null, 2))
}

main().catch((error) => {
  console.error(`Execucao P2.6 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
