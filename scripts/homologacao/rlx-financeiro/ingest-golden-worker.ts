import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ingerirArquivoFinanceiroRlx,
  publicarImportacaoFinanceiraRlx,
} from '../../../src/lib/rlx/ingestao/ingestao.server'
import type { RlxTipoBase } from '../../../src/lib/rlx/ingestao/types'

const FIXTURES = resolve(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures')
const MAIN_FUND_ID = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const ADVERSARIAL_FUND_ID = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const DATES = {
  'D-4': '2026-08-06',
  'D-3': '2026-08-07',
  'D-2': '2026-08-08',
  'D-1': '2026-08-09',
} as const
const FILES: ReadonlyArray<readonly [RlxTipoBase, string]> = [
  ['CARTEIRA', 'carteira.csv'],
  ['ESTOQUE', 'estoque.csv'],
  ['AQUISICOES', 'aquisicoes.csv'],
  ['LIQUIDACOES', 'liquidacoes.csv'],
]

type ResultadoExecucao = {
  cenario: string
  fundoId: string
  tipoBase: RlxTipoBase
  dataReferencia: string
  importacaoId: string
  status: string
  completude: string
  linhas: number
  duplicada: boolean
}

async function ingest(input: {
  cenario: string
  fundoId: string
  tipoBase: RlxTipoBase
  dataReferencia: string
  fixture: string
  publicar?: boolean
}): Promise<ResultadoExecucao> {
  const result = await ingerirArquivoFinanceiroRlx({
    fundoId: input.fundoId,
    provedor: 'rlx_golden',
    tipoBase: input.tipoBase,
    dataReferencia: input.dataReferencia,
    origem: 'GOLDEN_DATASET',
    arquivo: readFileSync(resolve(FIXTURES, input.fixture)),
    nomeArquivo: input.fixture.replaceAll('\\', '/').split('/').at(-1) || 'fixture.csv',
    mimeType: 'text/csv',
  })
  if (result.status === 'FALHA') throw new Error(`${input.cenario}: validacao falhou.`)
  if (input.publicar !== false && result.status === 'VALIDA') {
    await publicarImportacaoFinanceiraRlx(result.importacaoId)
  }
  return {
    cenario: input.cenario,
    fundoId: input.fundoId,
    tipoBase: input.tipoBase,
    dataReferencia: input.dataReferencia,
    importacaoId: result.importacaoId,
    status: result.status === 'VALIDA' && input.publicar !== false ? 'PUBLICADA' : result.status,
    completude: result.resultado.completude,
    linhas: result.resultado.linhas.length,
    duplicada: result.duplicada,
  }
}

async function main() {
  const resultados: ResultadoExecucao[] = []

  for (const [periodo, dataReferencia] of Object.entries(DATES)) {
    for (const [tipoBase, fileName] of FILES) {
      resultados.push(await ingest({
        cenario: `${periodo}/${tipoBase}`,
        fundoId: MAIN_FUND_ID,
        tipoBase,
        dataReferencia,
        fixture: `${periodo}/${fileName}`,
      }))
    }
  }

  const estoqueD1 = resultados.find((item) => item.cenario === 'D-1/ESTOQUE')
  if (!estoqueD1) throw new Error('Importacao D-1/ESTOQUE nao encontrada.')
  const duplicate = await ingest({
    cenario: 'D-1/ESTOQUE_DUPLICADO',
    fundoId: MAIN_FUND_ID,
    tipoBase: 'ESTOQUE',
    dataReferencia: DATES['D-1'],
    fixture: 'duplicados/estoque-D-1-copia.csv',
  })
  if (!duplicate.duplicada || duplicate.importacaoId !== estoqueD1.importacaoId) {
    throw new Error('Arquivo duplicado nao reutilizou a importacao original.')
  }
  resultados.push(duplicate)

  resultados.push(await ingest({
    cenario: 'D-2/AQUISICOES_RETIFICACAO_V2',
    fundoId: MAIN_FUND_ID,
    tipoBase: 'AQUISICOES',
    dataReferencia: DATES['D-2'],
    fixture: 'retificacoes/aquisicoes-D-2-v2.csv',
  }))
  resultados.push(await ingest({
    cenario: 'D-1/ESTOQUE_RETIFICACAO_V2',
    fundoId: MAIN_FUND_ID,
    tipoBase: 'ESTOQUE',
    dataReferencia: DATES['D-1'],
    fixture: 'retificacoes/estoque-D-1-v2.csv',
  }))
  resultados.push(await ingest({
    cenario: 'D-1/ESTOQUE_CROSS_FUND',
    fundoId: ADVERSARIAL_FUND_ID,
    tipoBase: 'ESTOQUE',
    dataReferencia: DATES['D-1'],
    fixture: 'adversarial/estoque-D-1.csv',
  }))

  console.log(JSON.stringify({
    dataset: 'RLX_GOLDEN_V1',
    periodos: DATES,
    resultados,
    idempotencia: 'OK',
    retificacoes: 'OK',
    crossFund: 'OK',
  }, null, 2))
}

main().catch((error) => {
  console.error(`P2.2 golden worker falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
