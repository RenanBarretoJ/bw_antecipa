import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { assertHomologEnvironment, connectDb, createAdminClient, loadHomologEnv, parseArgs } from '../homologacao/rlx-golden/helpers.mjs'
import { ingerirArquivoFinanceiro, publicarImportacaoFinanceira } from '../../src/lib/financeiro/ingestao/ingestao.server'
import { processarArquivoRlx } from '../../src/lib/financeiro/ingestao/parser'
import { datasEstoqueQa, gerarCsvEstoqueQa, type OperacaoEstoqueQa } from '../../src/lib/financeiro/qa/estoque-sintetico-operacao'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const PROVIDER = 'qa_synthetic_operacao'
const ORIGIN = 'GOLDEN_DATASET'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type OperationRow = {
  id: string; fundo_id: string; status: string; aquisicao: string; fundo_nome: string; fundo_cnpj: string
  valor_bruto_total: string; preco_aquisicao: string
}
type ParcelRow = {
  nota_fiscal_id: string; numero_nf: string; chave_acesso: string; cedente_nome: string; cedente_cnpj: string
  sacado_nome: string; sacado_cnpj: string; emissao: string; parcela_id: string; numero_parcela: number
  valor_nominal: string; valor_aquisicao: string; vencimento: string; status: string
}
type ExistingImport = { id: string; data_referencia: string; status: string; provedor: string; hash_conteudo: string }

function argument(args: Record<string, string | boolean | undefined>, name: string) {
  const value = args[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Informe --${name}.`)
  return value.trim()
}

async function main() {
  loadHomologEnv()
  const args = parseArgs() as Record<string, string | boolean | undefined>
  const env = assertHomologEnvironment({ ...args, 'expected-project-ref': HOMOLOG_REF })
  const operacaoId = argument(args, 'operacao-id')
  const fundoId = argument(args, 'fundo-id')
  const dataFinal = argument(args, 'data-final')
  if (!uuid.test(operacaoId) || !uuid.test(fundoId)) throw new Error('Operacao e fundo devem ser UUIDs completos.')
  const confirmacao = `PUBLICAR_ESTOQUE_QA_HOMOLOG_${HOMOLOG_REF}_${operacaoId.slice(0, 8)}`
  if (args.execute === true && args.confirm !== confirmacao) throw new Error(`Confirmacao invalida. Informe --confirm ${confirmacao}.`)

  const db = await connectDb(env, 'publicar_estoque_sintetico_preview')
  let operacao: OperationRow
  let parcelas: ParcelRow[]
  let existentes: ExistingImport[]
  try {
    await db.query('BEGIN READ ONLY')
    const operation = await db.query<OperationRow>(`
      select o.id,cf.fundo_id,o.status,
        to_char(o.cessao_efetivada_em at time zone 'America/Sao_Paulo','YYYY-MM-DD') as aquisicao,
        f.nome as fundo_nome,f.cnpj as fundo_cnpj,o.valor_bruto_total::text,o.preco_aquisicao::text
      from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id
      join public.fundos f on f.id=cf.fundo_id
      where o.id=$1 and cf.fundo_id=$2`, [operacaoId, fundoId])
    if (operation.rows.length !== 1) throw new Error('Operacao nao encontrada no fundo informado.')
    operacao = operation.rows[0]
    if (operacao.status !== 'em_andamento' || !operacao.aquisicao) throw new Error('Somente operacao cedida e em andamento pode originar o estoque QA.')

    const notes = await db.query<ParcelRow>(`
      select n.id as nota_fiscal_id,n.numero_nf,n.chave_acesso,
        n.razao_social_emitente as cedente_nome,n.cnpj_emitente as cedente_cnpj,
        n.razao_social_destinatario as sacado_nome,n.cnpj_destinatario as sacado_cnpj,
        n.data_emissao::text as emissao,p.id as parcela_id,p.numero_parcela,
        p.valor_nominal::text,oc.valor_presente::text as valor_aquisicao,
        p.data_vencimento::text as vencimento,p.status
      from public.operacoes_nf_parcelas onp
      join public.nota_fiscal_parcelas p on p.id=onp.parcela_id and p.nota_fiscal_id=onp.nota_fiscal_id
      join public.notas_fiscais n on n.id=onp.nota_fiscal_id and n.fundo_id=$2
      join public.operacao_calculo_nfs oc on oc.operacao_id=onp.operacao_id
        and oc.nota_fiscal_id=onp.nota_fiscal_id and oc.parcela_id=onp.parcela_id and oc.fundo_id=$2
      where onp.operacao_id=$1 order by n.id,p.numero_parcela`, [operacaoId, fundoId])
    parcelas = notes.rows
    if (!parcelas.length || new Set(parcelas.map((row) => row.nota_fiscal_id)).size !== 1) {
      throw new Error('Este gerador QA exige exatamente uma NF com parcelas calculadas na operacao.')
    }
    const totalSelecionadas = await db.query<{ total: number }>('select count(*)::int as total from public.operacoes_nf_parcelas where operacao_id=$1', [operacaoId])
    if (parcelas.length !== totalSelecionadas.rows[0].total) throw new Error('Nem toda parcela selecionada tem memoria financeira consistente.')

    const imports = await db.query<ExistingImport>(`
      select id,data_referencia::text,status,provedor,hash_conteudo from public.importacoes_financeiras
      where fundo_id=$1 and tipo_base='ESTOQUE' and data_referencia between $2::date and $3::date`, [fundoId, operacao.aquisicao, dataFinal])
    existentes = imports.rows
    await db.query('ROLLBACK')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    await db.end()
  }

  const nota = parcelas[0]
  const entrada: OperacaoEstoqueQa = {
    operacaoId, fundoId, fundoNome: operacao.fundo_nome, fundoCnpj: operacao.fundo_cnpj,
    numeroNf: nota.numero_nf, chaveNfe: nota.chave_acesso,
    cedenteNome: nota.cedente_nome, cedenteCnpj: nota.cedente_cnpj,
    sacadoNome: nota.sacado_nome, sacadoCnpj: nota.sacado_cnpj,
    emissao: nota.emissao, aquisicao: operacao.aquisicao,
    valorBrutoTotal: operacao.valor_bruto_total, precoAquisicao: operacao.preco_aquisicao,
    parcelas: parcelas.map((row) => ({
      parcelaId: row.parcela_id, numeroParcela: row.numero_parcela,
      valorNominal: row.valor_nominal, valorAquisicao: row.valor_aquisicao,
      vencimento: row.vencimento, status: row.status,
    })),
  }
  const datas = datasEstoqueQa(operacao.aquisicao, dataFinal)
  const plano = datas.map((data) => {
    const arquivo = gerarCsvEstoqueQa(entrada, data)
    const validacao = processarArquivoRlx({ arquivo, tipoBase: 'ESTOQUE', fundoId, dataReferencia: data, provedor: PROVIDER })
    if (validacao.completude !== 'COMPLETO_COM_DADOS' || validacao.errosArquivo.length
      || validacao.linhas.some((linha) => linha.status === 'INVALIDA')) {
      throw new Error(`CSV QA invalido para ${data}: ${validacao.errosArquivo.join(' ')}`)
    }
    const hash = createHash('sha256').update(arquivo).digest('hex')
    const conflitos = existentes.filter((item) => item.data_referencia === data)
    if (conflitos.length > 1 || conflitos.some((item) => item.provedor !== PROVIDER || item.hash_conteudo !== hash)) {
      throw new Error(`Ja existe Estoque de outra origem ou conteudo em ${data}; nenhuma base sera sobrescrita.`)
    }
    if (conflitos.some((item) => !['VALIDA', 'PUBLICADA'].includes(item.status))) {
      throw new Error(`Importacao QA de ${data} esta em estado ${conflitos[0].status}; revisar antes de continuar.`)
    }
    return { data, arquivo, hash, existente: conflitos[0] || null }
  })
  const nominal = entrada.parcelas.reduce((sum, parcela) => sum.plus(parcela.valorNominal), new Decimal(0))
  const aquisicao = entrada.parcelas.reduce((sum, parcela) => sum.plus(parcela.valorAquisicao), new Decimal(0))
  console.log(`\nEstoque QA (${args.execute === true ? 'EXECUCAO' : 'PREVIEW'})`)
  console.log(`Projeto: ${env.projectRef}; fundo: ${fundoId}; operacao: ${operacaoId}`)
  console.log(`NF: ${nota.numero_nf}; parcelas: ${entrada.parcelas.length}; nominal: ${nominal.toFixed(2)}; aquisicao: ${aquisicao.toFixed(2)}`)
  console.log(`Periodo ANBIMA: ${datas[0]} a ${datas.at(-1)}; ${datas.length} snapshots: ${datas.join(', ')}`)
  console.log(`Origem: ${ORIGIN}/${PROVIDER}; valor de aquisicao historico fixo; nenhuma liquidacao inferida.`)
  if (args.execute !== true) {
    console.log(`Para executar: --execute --confirm ${confirmacao}`)
    return
  }

  const admin = createAdminClient(env)
  for (const item of plano) {
    let importacaoId = item.existente?.id
    if (!importacaoId) {
      const atual = await admin.from('importacoes_financeiras').select('id').eq('fundo_id', fundoId)
        .eq('tipo_base', 'ESTOQUE').eq('data_referencia', item.data).limit(1)
      if (atual.error) throw new Error(`Nao foi possivel revalidar Estoque ${item.data}: ${atual.error.message}`)
      if (atual.data?.length) throw new Error(`Estoque ${item.data} criado concorrentemente; execucao interrompida.`)
      const result = await ingerirArquivoFinanceiro({
        fundoId, provedor: PROVIDER, tipoBase: 'ESTOQUE', dataReferencia: item.data,
        origem: ORIGIN, arquivo: item.arquivo, nomeArquivo: `QA_STOCK_${operacaoId.slice(0, 8)}_${item.data}.csv`, mimeType: 'text/csv',
      })
      if (result.status !== 'VALIDA' && result.status !== 'PUBLICADA') {
        throw new Error(`Estoque ${item.data} nao foi validado: ${result.resultado.errosArquivo.join(' ')}`)
      }
      importacaoId = result.importacaoId
    }
    if (item.existente?.status !== 'PUBLICADA') await publicarImportacaoFinanceira(importacaoId)
    const [importacao, posicoes] = await Promise.all([
      admin.from('importacoes_financeiras').select('status,linhas_publicadas,hash_conteudo').eq('id', importacaoId).single(),
      admin.from('estoque_posicoes').select('id_recebivel,valor_nominal,valor_aquisicao').eq('importacao_id', importacaoId),
    ])
    if (importacao.error || posicoes.error) throw new Error(`Falha ao verificar Estoque ${item.data}: ${importacao.error?.message || posicoes.error?.message}`)
    const ids = new Set((posicoes.data || []).map((row) => row.id_recebivel))
    const soma = (posicoes.data || []).reduce((sum, row) => sum.plus(String(row.valor_nominal)), new Decimal(0))
    if (importacao.data.status !== 'PUBLICADA' || importacao.data.hash_conteudo !== item.hash
      || importacao.data.linhas_publicadas !== entrada.parcelas.length || ids.size !== entrada.parcelas.length
      || !soma.eq(nominal)) throw new Error(`Verificacao pos-publicacao falhou em ${item.data}; revisar importacao ${importacaoId}.`)
    console.log(`${item.data}: PUBLICADA, ${ids.size} titulos, ${soma.toFixed(2)} nominal; importacao ${importacaoId}`)
  }
  console.log('\nEstoque QA publicado e verificado. Reexecute a esteira de conciliacao/risco pelo portal para testar o gate.')
}

main().catch((error) => {
  console.error(`\nFalha no estoque QA: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
