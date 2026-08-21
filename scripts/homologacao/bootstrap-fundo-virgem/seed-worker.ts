import { ingerirArquivoFinanceiro, publicarImportacaoFinanceira } from '../../../src/lib/financeiro/ingestao/ingestao.server'

// Publica a PRIMEIRA Carteira oficial (ponto zero financeiro) de um fundo
// virgem usando o MESMO caminho canonico de uma Carteira real: parser +
// validacao P2.2 (ingerirArquivoFinanceiro) seguido da publicacao P2.2
// (publicarImportacaoFinanceira). Nunca faz INSERT manual em
// importacoes_financeiras/importacao_linhas/carteira_snapshots.

async function main() {
  const fundoId = process.argv[2]
  const pl = process.argv[3]
  const dataBase = process.argv[4]
  if (!fundoId || !pl || !dataBase) throw new Error('Uso: seed-worker <fundoId> <pl> <dataBase YYYY-MM-DD>')
  if (!/^\d+(\.\d{1,2})?$/.test(pl)) throw new Error('PL invalido: use um numero decimal (ex.: 1000000 ou 1000000.00).')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataBase)) throw new Error('Data base invalida: use YYYY-MM-DD.')

  const plFormatado = Number(pl).toFixed(2).replace('.', ',')
  const linha = ['FUNDO_EXTERNO', 'DOC_FUNDO', 'FUNDO_ID', 'DATA_REFERENCIA', 'VERSAO', 'PATRIMONIO_LIQUIDO', 'PUBLICADA_EM', 'STATUS_SNAPSHOT'].join(';')
  const dados = ['QA BOOTSTRAP FUNDO VIRGEM FIDC', '84810000000201', fundoId, dataBase, 'QA_BOOTSTRAP_V1', plFormatado, `${dataBase}T20:00:00-03:00`, 'COMPLETO_COM_DADOS'].join(';')
  const csv = `${linha}\n${dados}\n`

  const resultado = await ingerirArquivoFinanceiro({
    fundoId, provedor: 'qa_bootstrap_fundo_virgem', tipoBase: 'CARTEIRA', dataReferencia: dataBase,
    origem: 'MANUAL', arquivo: new TextEncoder().encode(csv),
    nomeArquivo: `QA_BOOTSTRAP_CARTEIRA_${dataBase}.csv`, mimeType: 'text/csv',
  })
  if (resultado.status === 'FALHA') throw new Error('Validacao P2.2 da Carteira QA de bootstrap falhou.')
  if (resultado.duplicada) {
    console.log(JSON.stringify({ importacaoId: resultado.importacaoId, status: resultado.status, duplicada: true }))
    return
  }
  const publicacao = await publicarImportacaoFinanceira(resultado.importacaoId)
  console.log(JSON.stringify({ importacaoId: resultado.importacaoId, status: 'PUBLICADA', duplicada: false, publicacao }))
}

main().catch((error) => {
  console.error(`Seed da Carteira QA de bootstrap falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
