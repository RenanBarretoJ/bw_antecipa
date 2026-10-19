import { z } from 'zod'
import { CODIGO_CARTEIRA_PATTERN } from '@/lib/integracoes/configuracao-vortx-vrs'

export const VORTX_RELATORIO_SOLICITAR_PATH = '/v1/vrs/externo/solicitar'
export const TIPOS_RELATORIO_VORTX = ['Inclusao', 'Exclusao', 'PosicaoAtivo', 'PosicaoParcela'] as const
export type TipoRelatorioVortx = typeof TIPOS_RELATORIO_VORTX[number]

const solicitacaoSchema = z.object({
  codigoCarteira: z.string().trim().regex(CODIGO_CARTEIRA_PATTERN),
  dataInicio: z.iso.date(),
  dataFim: z.iso.date(),
  dataReferencia: z.iso.date().optional(),
  tipoRelatorio: z.enum(TIPOS_RELATORIO_VORTX),
  extensaoArquivo: z.union([z.literal(1), z.literal(2)]).default(2),
}).strict()

export type SolicitacaoRelatorioVortx = Omit<z.output<typeof solicitacaoSchema>, 'dataReferencia'> & {
  dataReferencia: string
}

const protocoloSchema = z.object({
  id: z.uuid(),
  status: z.literal(0),
  dataSolicitacao: z.iso.datetime({ offset: true }),
})
export type ProtocoloRelatorioVortx = z.output<typeof protocoloSchema>

export class ContratoRelatorioVortxError extends Error {
  constructor(message: string, readonly categoria: 'configuracao' | 'resposta_inesperada') {
    super(message)
    this.name = 'ContratoRelatorioVortxError'
  }
}

/**
 * Apenas valida o body documentado. Nao autoriza um Fundo nem executa HTTP.
 * O chamador deve obter hoje e a carteira do contexto validado no servidor.
 * Envia referencia nos quatro tipos para atender tambem ao required do OpenAPI.
 */
export function prepararSolicitacaoRelatorioVortx(entrada: unknown, hoje: string): SolicitacaoRelatorioVortx {
  const parse = solicitacaoSchema.safeParse(entrada)
  if (!parse.success || !z.iso.date().safeParse(hoje).success) {
    throw new ContratoRelatorioVortxError('Parametros da solicitacao de relatorio Vortx invalidos.', 'configuracao')
  }
  const body = parse.data
  // A descricao exige fim posterior ao inicio. Periodos de um unico dia
  // aguardam confirmacao contratual, em vez de presumir que a API os aceita.
  if (body.dataFim <= body.dataInicio) {
    throw new ContratoRelatorioVortxError('O fim do periodo deve ser posterior ao inicio.', 'configuracao')
  }
  const posicao = body.tipoRelatorio === 'PosicaoAtivo' || body.tipoRelatorio === 'PosicaoParcela'
  if (posicao && !body.dataReferencia) {
    throw new ContratoRelatorioVortxError('Relatorios de posicao exigem data de referencia explicita.', 'configuracao')
  }
  const dataReferencia = body.dataReferencia ?? body.dataFim
  if ([body.dataInicio, body.dataFim, dataReferencia].some((data) => data > hoje)) {
    throw new ContratoRelatorioVortxError('Relatorios Vortx nao permitem datas futuras.', 'configuracao')
  }
  return { ...body, dataReferencia }
}

/**
 * O schema descreve o protocolo direto; o exemplo o envolve em data.
 * Ambos sao aceitos explicitamente, mas envelopes contraditorios nao.
 * Status 0 confirma somente pedido pendente, nunca arquivo pronto/importado.
 */
export function interpretarProtocoloRelatorioVortx(resposta: unknown): ProtocoloRelatorioVortx {
  const record = resposta && typeof resposta === 'object' && !Array.isArray(resposta)
    ? resposta as Record<string, unknown>
    : null
  const envelopado = record !== null && Object.hasOwn(record, 'data')
  if (envelopado && ['id', 'status', 'dataSolicitacao'].some((campo) => Object.hasOwn(record, campo))) {
    throw new ContratoRelatorioVortxError('Resposta de protocolo Vortx ambigua.', 'resposta_inesperada')
  }
  const parse = protocoloSchema.safeParse(envelopado ? record.data : resposta)
  if (!parse.success) {
    throw new ContratoRelatorioVortxError('Resposta de protocolo Vortx incompleta ou inesperada.', 'resposta_inesperada')
  }
  return parse.data
}
