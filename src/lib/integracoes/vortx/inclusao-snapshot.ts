import { createHash, randomUUID } from 'node:crypto'
import { processarCsvRelatorioVortx, RelatorioVortxError, type ContextoRelatorioVortx } from './relatorios-parser'

/** Pure preparation. Receipt date is preserved, never relabelled as disbursement/acquisition date. */
export function prepararInclusaoVortx(input: { contexto: ContextoRelatorioVortx; versaoId: string; arquivo: Uint8Array }) {
  const csv = processarCsvRelatorioVortx({ contexto: input.contexto, arquivo: input.arquivo, tipoRelatorio: 'Inclusao' })
  if (!csv.completo || csv.linhas.some(l => [l.dadosNormalizados.valor_nominal, l.dadosNormalizados.valor_aquisicao].some(v => v.startsWith('-')))) {
    throw new RelatorioVortxError('INCLUSAO_INVALIDA', 'O relatório de inclusão contém linhas inválidas; nenhum movimento foi salvo.')
  }
  const id = randomUUID(), ctx = input.contexto
  const hash = createHash('sha256').update(JSON.stringify(['VORTX_INCLUSAO_V1', ctx.fundoId, ctx.ambiente,
    ctx.codigoCarteira, ctx.dataReferencia, ctx.dataInicio, ctx.dataFim, csv.hashArquivo])).digest('hex')
  return {
    manifesto: { id, fundo_id: ctx.fundoId, ambiente: ctx.ambiente, codigo_carteira: ctx.codigoCarteira,
      versao_id: input.versaoId, data_referencia: ctx.dataReferencia, data_inicio: ctx.dataInicio, data_fim: ctx.dataFim,
      hash_conteudo: hash, linhas_total: csv.linhas.length,
      arquivo: { id: randomUUID(), tamanho_bytes: input.arquivo.byteLength, hash_conteudo: csv.hashArquivo,
        storage_bucket: 'financeiro-importacoes', storage_path: `${ctx.fundoId}/vortx/${id}/inclusao.csv` } },
    linhas: csv.linhas.map(l => ({ numero_linha: l.numeroLinha, dados_brutos: l.dadosBrutos, dados_normalizados: l.dadosNormalizados })),
  }
}
