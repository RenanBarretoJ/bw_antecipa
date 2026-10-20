import { createHash, randomUUID } from 'node:crypto'
import { comporEstoqueVortx } from './estoque-composicao'
import { processarCsvRelatorioVortx, type ContextoRelatorioVortx, type LinhaRelatorioVortx } from './relatorios-parser'

export type ArquivoPosicaoVortx = { nome: string; conteudo: Uint8Array }

/** Pure preparation. Scope must be resolved server-side and is revalidated by the database. */
export function prepararSnapshotEstoqueVortx(input: {
  contexto: ContextoRelatorioVortx
  integracaoFundoVersaoId: string
  ativo: ArquivoPosicaoVortx
  parcela: ArquivoPosicaoVortx
}) {
  const ativo = processarCsvRelatorioVortx({ tipoRelatorio: 'PosicaoAtivo', contexto: input.contexto, arquivo: input.ativo.conteudo })
  const parcela = processarCsvRelatorioVortx({ tipoRelatorio: 'PosicaoParcela', contexto: input.contexto, arquivo: input.parcela.conteudo })
  const composicao = comporEstoqueVortx(ativo, parcela)
  const id = randomUUID()
  const hash = createHash('sha256').update(JSON.stringify([
    'VORTX_ESTOQUE_V1', input.contexto.fundoId, input.contexto.ambiente,
    input.contexto.codigoCarteira, input.contexto.dataReferencia, ativo.hashArquivo, parcela.hashArquivo,
  ])).digest('hex')
  const arquivos = [input.ativo, input.parcela].map((arquivo, index) => ({
    id: randomUUID(), ordem: index + 1,
    nome_arquivo: arquivo.nome.normalize('NFD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'posicao.csv',
    tamanho_bytes: arquivo.conteudo.byteLength,
    hash_conteudo: index === 0 ? ativo.hashArquivo : parcela.hashArquivo,
    storage_bucket: 'financeiro-importacoes',
    storage_path: `${input.contexto.fundoId}/vortx/${id}/${index + 1}.csv`,
  }))
  const row = (linha: LinhaRelatorioVortx) => ({
    numero_linha: linha.numeroLinha, dados_brutos: linha.dadosBrutos, dados_normalizados: linha.dadosNormalizados,
  })
  return {
    composicao,
    arquivos,
    payload: {
      id, correlation_id: randomUUID(), fundo_id: input.contexto.fundoId,
      integracao_fundo_versao_id: input.integracaoFundoVersaoId,
      ambiente: input.contexto.ambiente, codigo_carteira: input.contexto.codigoCarteira,
      data_referencia: input.contexto.dataReferencia, hash_conteudo: hash,
      arquivos, ativos: ativo.linhas.map(row), parcelas: parcela.linhas.map(row),
    },
  }
}
