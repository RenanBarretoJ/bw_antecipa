export type PosicaoCarteiraVortx = {
  dataReferencia: string
  patrimonioLiquidoTotal: string
  cotas: Array<{ codigoCarteira: string; rotulo: string; patrimonioLiquido: string }>
}
export type ProcessamentoCarteiraResult =
  | { success: false; message: string }
  | { success: true; estado: 'PUBLICADA' | 'JA_REGISTRADA' | 'CONTEUDO_HISTORICO'; posicao: PosicaoCarteiraVortx }
  | { success: true; estado: 'AGUARDANDO_COTAS'; dataReferencia: string; cotasPendentes: Array<{ codigoCarteira: string; rotulo: string }> }
  | { success: true; estado: 'CONFIGURACAO_PENDENTE' | 'REVISAO_NECESSARIA' }
