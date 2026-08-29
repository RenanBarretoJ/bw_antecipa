import { createAdminClient, assertHomologEnvironment, loadHomologEnv, parseArgs } from '../homologacao/rlx-golden/helpers.mjs'
import { ingerirArquivoFinanceiro, publicarImportacaoFinanceira } from '../../src/lib/financeiro/ingestao/ingestao.server'
import {
  executarPublicacaoPlSintetico,
  HOMOLOG_PROJECT_REF,
  QA_PL_ORIGIN,
  QA_PL_PROVIDER,
  validarAlvoExclusivoHomolog,
  validarEntradaPlSintetico,
  type BaseFinanceira,
  type BootstrapFinanceiro,
  type ConfirmacaoPl,
  type FundoPlSintetico,
  type ImportacaoPlExistente,
  type RepositorioPlSintetico,
} from '../../src/lib/financeiro/qa/pl-sintetico'

type AdminClient = ReturnType<typeof createAdminClient>
type DatabaseRow = Record<string, unknown>

function asError(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`)
}

function mapBootstrap(data: unknown): BootstrapFinanceiro {
  const value = (data || {}) as { fundo_virgem?: boolean; carteira_oficial?: DatabaseRow | null }
  const carteira = value.carteira_oficial
  return {
    fundoVirgem: value.fundo_virgem === true,
    carteiraOficial: carteira ? {
      importacaoId: String(carteira.importacao_id),
      dataReferencia: String(carteira.data_referencia),
      patrimonioLiquido: String(carteira.patrimonio_liquido),
    } : null,
  }
}

function criarRepositorio(client: AdminClient): RepositorioPlSintetico {
  return {
    async obterFundo(fundoId): Promise<FundoPlSintetico | null> {
      const { data, error } = await client.from('fundos').select('id,nome,cnpj,ativo').eq('id', fundoId).maybeSingle()
      asError('Nao foi possivel consultar o fundo', error)
      if (!data) return null
      return { id: String(data.id), nome: String(data.nome), cnpj: data.cnpj ? String(data.cnpj) : null, ativo: data.ativo === true }
    },

    async listarImportacoesNaData(fundoId, dataBase): Promise<ImportacaoPlExistente[]> {
      const { data, error } = await client.from('importacoes_financeiras')
        .select('id,provedor,origem,status')
        .eq('fundo_id', fundoId).eq('tipo_base', 'CARTEIRA').eq('data_referencia', dataBase)
        .order('created_at', { ascending: false })
      asError('Nao foi possivel verificar Carteiras existentes', error)
      const rows = (data || []) as DatabaseRow[]
      const ids = rows.map((row) => String(row.id))
      const snapshotByImport = new Map<string, string>()
      if (ids.length) {
        const snapshots = await client.from('carteira_snapshots').select('importacao_id,patrimonio_liquido,vigente').in('importacao_id', ids)
        asError('Nao foi possivel verificar snapshots existentes', snapshots.error)
        for (const snapshot of (snapshots.data || []) as DatabaseRow[]) {
          if (snapshot.vigente === true) snapshotByImport.set(String(snapshot.importacao_id), String(snapshot.patrimonio_liquido))
        }
      }
      return rows.map((row) => ({
        id: String(row.id),
        provedor: String(row.provedor),
        origem: String(row.origem),
        status: String(row.status),
        patrimonioLiquido: snapshotByImport.get(String(row.id)) ?? null,
      }))
    },

    async listarBasesFinanceiras(fundoId): Promise<BaseFinanceira[]> {
      const { data, error } = await client.from('importacoes_financeiras')
        .select('tipo_base,data_referencia,completude,linhas_publicadas,publicada_em')
        .eq('fundo_id', fundoId).in('tipo_base', ['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'])
        .eq('status', 'PUBLICADA').order('publicada_em', { ascending: false })
      asError('Nao foi possivel diagnosticar as bases financeiras', error)
      const latest = new Map<BaseFinanceira['tipoBase'], BaseFinanceira>()
      for (const row of (data || []) as DatabaseRow[]) {
        const tipoBase = String(row.tipo_base) as BaseFinanceira['tipoBase']
        if (!latest.has(tipoBase)) latest.set(tipoBase, {
          tipoBase,
          dataReferencia: String(row.data_referencia),
          completude: String(row.completude),
          linhasPublicadas: Number(row.linhas_publicadas || 0),
        })
      }
      return [...latest.values()]
    },

    async confirmarPl(importacaoId): Promise<ConfirmacaoPl | null> {
      const importResult = await client.from('importacoes_financeiras')
        .select('id,fundo_id,data_referencia,provedor,origem,status').eq('id', importacaoId).maybeSingle()
      asError('Nao foi possivel confirmar a importacao publicada', importResult.error)
      if (!importResult.data) return null
      const snapshotResult = await client.from('carteira_snapshots')
        .select('patrimonio_liquido,vigente').eq('importacao_id', importacaoId).eq('vigente', true).maybeSingle()
      asError('Nao foi possivel confirmar o snapshot publicado', snapshotResult.error)
      if (!snapshotResult.data) return null
      return {
        importacaoId: String(importResult.data.id),
        fundoId: String(importResult.data.fundo_id),
        dataReferencia: String(importResult.data.data_referencia),
        patrimonioLiquido: String(snapshotResult.data.patrimonio_liquido),
        provedor: String(importResult.data.provedor),
        origem: String(importResult.data.origem),
        status: String(importResult.data.status),
        vigente: snapshotResult.data.vigente === true,
      }
    },

    async resolverBootstrap(fundoId): Promise<BootstrapFinanceiro> {
      const { data, error } = await client.rpc('resolver_bootstrap_financeiro', { p_fundo_id: fundoId })
      asError('Nao foi possivel confirmar o PL no resolvedor financeiro', error)
      return mapBootstrap(data)
    },
  }
}

function formatarMoeda(value: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

function formatarData(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00.000Z`))
}

function descreverBase(tipo: BaseFinanceira['tipoBase'], bases: BaseFinanceira[], fundoVirgem: boolean) {
  const base = bases.find((item) => item.tipoBase === tipo)
  if (!base) return fundoVirgem ? 'zero (bootstrap de fundo virgem; nenhum dado economico fabricado)' : 'ausente'
  if (base.completude === 'COMPLETO_VAZIO' || base.linhasPublicadas === 0) return `zero declarado em ${formatarData(base.dataReferencia)}`
  return `ultima valida em ${formatarData(base.dataReferencia)} (${base.linhasPublicadas} linhas)`
}

async function main() {
  loadHomologEnv()
  validarAlvoExclusivoHomolog(process.env)
  const args = parseArgs() as Record<string, string | boolean | undefined>
  const env = assertHomologEnvironment({ ...args, 'expected-project-ref': HOMOLOG_PROJECT_REF })
  if (env.projectRef !== HOMOLOG_PROJECT_REF) throw new Error('ERRO: este script so pode executar em homologacao.')

  const input = validarEntradaPlSintetico({
    fundoId: typeof args['fundo-id'] === 'string' ? args['fundo-id'] : undefined,
    pl: typeof args.pl === 'string' ? args.pl : undefined,
    dataBase: typeof args['data-base'] === 'string' ? args['data-base'] : undefined,
    replaceQa: args['replace-qa'] === true,
  })
  const client = createAdminClient(env)
  const resultado = await executarPublicacaoPlSintetico(input, {
    repositorio: criarRepositorio(client),
    pipeline: {
      async ingerir(payload) {
        return ingerirArquivoFinanceiro({
          fundoId: payload.fundoId,
          provedor: QA_PL_PROVIDER,
          tipoBase: 'CARTEIRA',
          dataReferencia: payload.dataBase,
          origem: QA_PL_ORIGIN,
          arquivo: payload.arquivo,
          nomeArquivo: payload.nomeArquivo,
          mimeType: 'text/csv',
        })
      },
      publicar: publicarImportacaoFinanceira,
    },
  })

  console.log('\nPL sintetico publicado com sucesso.\n')
  console.log(`Fundo: ${resultado.fundo.nome}`)
  console.log(`Fundo ID: ${resultado.fundo.id}`)
  console.log(`Data-base: ${formatarData(resultado.confirmacao.dataReferencia)}`)
  console.log(`PL QA: ${formatarMoeda(resultado.confirmacao.patrimonioLiquido)}`)
  console.log(`Origem: QA_SYNTHETIC (${resultado.confirmacao.origem}/${resultado.confirmacao.provedor})`)
  console.log(`Importacao: ${resultado.confirmacao.importacaoId}${resultado.idempotente ? ' (ja publicada; nenhuma escrita adicional)' : ''}`)
  if (resultado.substituiuQa) console.log('Retificacao: a versao QA anterior foi preservada como RETIFICADA.')
  console.log('\nBase financeira:')
  console.log(`- Estoque: ${descreverBase('ESTOQUE', resultado.bases, resultado.bootstrap.fundoVirgem)}`)
  console.log(`- Aquisicoes: ${descreverBase('AQUISICOES', resultado.bases, resultado.bootstrap.fundoVirgem)}`)
  console.log(`- Liquidacoes: ${descreverBase('LIQUIDACOES', resultado.bases, resultado.bootstrap.fundoVirgem)}`)
  if (resultado.bootstrap.fundoVirgem && resultado.bootstrap.carteiraOficial) {
    console.log(`\nResolvedor bootstrap: ${formatarMoeda(resultado.bootstrap.carteiraOficial.patrimonioLiquido)} em ${formatarData(resultado.bootstrap.carteiraOficial.dataReferencia)}.`)
  } else {
    console.log(`\nResolvedor temporal: snapshot vigente confirmado para ${formatarData(resultado.confirmacao.dataReferencia)}; use esta data como D-2 do teste.`)
  }
  console.log('\nPronto para testar P2.5/P2.6.')
}

main().catch((error) => {
  console.error(`\nFalha ao publicar PL sintetico: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
