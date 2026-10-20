import { z } from 'zod'
import { TIPOS_RELATORIO_VORTX } from './relatorios-contrato'
export { relatorioDePosicao } from './relatorios-tipos'

export const RELATORIOS_OPERADOR = [
  { tipo: 'PosicaoParcela', titulo: 'Estoque em aberto', subtitulo: 'Posição por parcela', descricao: 'Parcelas em aberto na data escolhida. É a base principal para conferir o estoque.', capability: 'ESTOQUE' },
  { tipo: 'PosicaoAtivo', titulo: 'Estoque consolidado', subtitulo: 'Posição por ativo', descricao: 'Visão consolidada dos ativos para confrontar com as parcelas. Não deve ser somada ao estoque em aberto.', capability: 'ESTOQUE' },
  { tipo: 'Inclusao', titulo: 'Cessões realizadas', subtitulo: 'Relatório de inclusão', descricao: 'Movimentos de inclusão no período. Solicitar este relatório não envia novas cessões.', capability: 'AQUISICOES' },
  { tipo: 'Exclusao', titulo: 'Liquidações e exclusões', subtitulo: 'Relatório de exclusão', descricao: 'Movimentos de exclusão no período. A interpretação do layout ainda está pendente; nenhum título será baixado automaticamente.', capability: 'LIQUIDACOES' },
] as const

export const solicitarRelatorioSchema = z.object({
  fundoId: z.uuid(), versaoId: z.uuid(), tipo: z.enum(TIPOS_RELATORIO_VORTX),
  inicio: z.iso.date(), fim: z.iso.date(), referencia: z.iso.date(),
  extensao: z.union([z.literal(1), z.literal(2)]), mfaCode: z.string().regex(/^\d{6}$/),
}).strict()
export type RelatorioFormulario = Omit<z.infer<typeof solicitarRelatorioSchema>, 'mfaCode'>

export const solicitacaoRelatorioSchema = z.object({
  id: z.uuid(), fundo_id: z.uuid(), integracao_versao_id: z.uuid(), ambiente: z.enum(['producao','homologacao']),
  pedido: z.object({ codigoCarteira: z.string(), tipoRelatorio: z.enum(TIPOS_RELATORIO_VORTX),
    dataInicio: z.iso.date(), dataFim: z.iso.date(), dataReferencia: z.iso.date(), extensaoArquivo: z.union([z.literal(1),z.literal(2)]) }),
  estado: z.enum(['registrada','enviando','aceita','recusada','indeterminada','falha_autenticacao']),
  protocolo_externo: z.uuid().nullable(), codigo_http: z.number().int().nullable(), criada_em: z.string(),
  envio_iniciado_em: z.string().nullable(), concluida_em: z.string().nullable(),
})
export type SolicitacaoRelatorio = z.infer<typeof solicitacaoRelatorioSchema>
export const historicoRelatorioSchema = z.object({ total: z.number().int().nonnegative(), solicitacoes: z.array(solicitacaoRelatorioSchema) })
export type HistoricoRelatorio = z.infer<typeof historicoRelatorioSchema>
export type SolicitacaoRelatorioResult = { success: true; criada: boolean; solicitacao: SolicitacaoRelatorio } | { success: false; message: string }

export type ContextoRelatorios = {
  fundo: { id: string; nome: string; cnpj: string }
  versoes: Array<{ id: string; versao: number; ambiente: 'producao'|'homologacao'; carteira: string; capabilities: string[] }>
}

export function relatoriosPreviewPermitidos(fundoId: string, env: Readonly<Record<string,string|undefined>> = process.env): boolean {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'feature/vortx-real-data-preview'
    && env.NEXT_PUBLIC_SUPABASE_URL === 'https://phdckowbexkkvuwnzeaf.supabase.co'
    && env.VORTX_REPORTS_PREVIEW_ENABLED === 'true'
    && Boolean(env.VORTX_REPORTS_PREVIEW_FUNDO_ID) && fundoId === env.VORTX_REPORTS_PREVIEW_FUNDO_ID
}

export function situacaoRelatorio(row: SolicitacaoRelatorio, agora = Date.now()): { titulo: string; descricao: string; tom: 'neutro'|'atencao'|'erro' } {
  if (['registrada','enviando'].includes(row.estado) && agora - Date.parse(row.criada_em) > 120_000) {
    return { titulo: 'Requer conferência', descricao: 'A execução não registrou uma conclusão. Não solicite novamente: confirme com o suporte se a Vórtx recebeu o pedido.', tom: 'atencao' }
  }
  switch (row.estado) {
    case 'registrada': return { titulo: 'Preparando pedido', descricao: 'Solicitação registrada no BW; o envio à Vórtx ainda não foi iniciado.', tom: 'neutro' }
    case 'enviando': return { titulo: 'Consultando a Vórtx', descricao: 'Envio iniciado. Aguardando a resposta com o protocolo.', tom: 'neutro' }
    case 'aceita': return { titulo: 'Aguardando arquivo', descricao: 'A Vórtx aceitou a solicitação. Ainda não há arquivo recebido nem dados importados nesta tela.', tom: 'neutro' }
    case 'recusada': return { titulo: 'Pedido recusado', descricao: row.codigo_http === 401 || row.codigo_http === 403 ? 'A API negou a solicitação. Confira a permissão das credenciais para este relatório.' : 'A API recusou a solicitação. Confira o período e a configuração da integração com o suporte.', tom: 'erro' }
    case 'indeterminada': return { titulo: 'Retorno não confirmado', descricao: 'O pedido pode ter chegado à Vórtx, mas não recebemos um protocolo válido. Não reenviamos automaticamente para evitar duplicidade.', tom: 'atencao' }
    case 'falha_autenticacao': return { titulo: 'Não enviado', descricao: 'Não foi possível preparar ou autenticar a solicitação. O relatório não foi solicitado; confira o teste de conexão da integração.', tom: 'erro' }
  }
}
