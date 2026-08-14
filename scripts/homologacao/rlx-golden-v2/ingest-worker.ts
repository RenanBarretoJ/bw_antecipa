import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ingerirArquivoFinanceiro,
  publicarImportacaoFinanceira,
} from '../../../src/lib/financeiro/ingestao/ingestao.server'
import type { TipoBaseFinanceiro } from '../../../src/lib/financeiro/ingestao/types'
import { FIXTURES_ROOT } from './fixtures.mjs'
import { DATASET_VERSION, PROVIDER, buildGoldenV2 } from './scenario-definitions.mjs'

type Result = {
  scenario: string
  fundId: string
  type: TipoBaseFinanceiro
  date: string
  importId: string
  status: string
  completeness: string
  duplicate: boolean
}

const dataset = buildGoldenV2()
const phase = process.argv.find((item) => item.startsWith('--phase='))?.split('=')[1] || 'initial'

async function ingest(input: {
  scenario: string
  fundId: string
  type: TipoBaseFinanceiro
  date: string
  fixture: string
}) : Promise<Result> {
  const fixturePath = resolve(FIXTURES_ROOT, input.fixture)
  const result = await ingerirArquivoFinanceiro({
    fundoId: input.fundId,
    provedor: PROVIDER,
    tipoBase: input.type,
    dataReferencia: input.date,
    origem: 'GOLDEN_DATASET',
    arquivo: readFileSync(fixturePath),
    nomeArquivo: input.fixture.replaceAll('\\', '/').split('/').at(-1) || 'fixture.csv',
    mimeType: 'text/csv',
  })
  if (result.status === 'FALHA') throw new Error(`${input.scenario}: validacao P2.2 falhou.`)
  if (!result.duplicada && result.status === 'VALIDA') await publicarImportacaoFinanceira(result.importacaoId)
  return {
    scenario: input.scenario, fundId: input.fundId, type: input.type, date: input.date,
    importId: result.importacaoId, status: result.status, completeness: result.resultado.completude,
    duplicate: result.duplicada,
  }
}

async function initial() {
  const results: Result[] = []
  for (const day of ['D-4', 'D-3', 'D-2', 'D-1'] as const) {
    for (const [type, name] of [
      ['CARTEIRA', 'carteira.csv'], ['ESTOQUE', 'estoque.csv'],
      ['AQUISICOES', 'aquisicoes.csv'], ['LIQUIDACOES', 'liquidacoes.csv'],
    ] as const) {
      results.push(await ingest({ scenario: `${day}/${type}`, fundId: dataset.mainFund.id, type, date: dataset.dates[day], fixture: `${day}/${name}` }))
    }
  }
  for (const [type, name] of [
    ['ESTOQUE', 'estoque-D-1.csv'], ['AQUISICOES', 'aquisicoes-D-1.csv'], ['LIQUIDACOES', 'liquidacoes-D-1.csv'],
  ] as const) {
    results.push(await ingest({ scenario: `ADVERSARIAL/${type}`, fundId: dataset.adversarialFund.id, type, date: dataset.dates['D-1'], fixture: `adversarial/${name}` }))
  }
  const duplicate = await ingest({
    scenario: 'DUPLICATE/ESTOQUE_D1', fundId: dataset.mainFund.id, type: 'ESTOQUE',
    date: dataset.dates['D-1'], fixture: 'duplicados/estoque-D-1-copia.csv',
  })
  if (!duplicate.duplicate) throw new Error('Segunda ingestao do mesmo hash nao foi idempotente.')
  results.push(duplicate)
  return results
}

async function rectify() {
  return Promise.all([
    ingest({ scenario: 'RETIFICACAO/ESTOQUE_D1_V2', fundId: dataset.mainFund.id, type: 'ESTOQUE', date: dataset.dates['D-1'], fixture: 'retificacoes/estoque-D-1-v2.csv' }),
    ingest({ scenario: 'RETIFICACAO/AQUISICOES_D1_V2', fundId: dataset.mainFund.id, type: 'AQUISICOES', date: dataset.dates['D-1'], fixture: 'retificacoes/aquisicoes-D-1-v2.csv' }),
  ])
}

async function main() {
  const results = phase === 'initial' ? await initial() : phase === 'rectify' ? await rectify() : (() => { throw new Error(`Fase invalida: ${phase}`) })()
  console.log(JSON.stringify({ dataset: DATASET_VERSION, phase, results }, null, 2))
}

main().catch((error) => {
  console.error(`Ingestao Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
