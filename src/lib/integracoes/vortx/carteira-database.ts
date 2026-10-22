export type VortxCarteiraFunctions = {
  vortx_reservar_carteira: { Args: { p_fundo_id: string; p_versao_id: string; p_referencia: string; p_hash: string; p_tamanho: number }; Returns: Record<string, unknown> }
  vortx_concluir_carteira: { Args: { p_id: string; p_lease: string; p_resposta: object[] }; Returns: Record<string, unknown> }
  vortx_encerrar_carteira: { Args: { p_id: string; p_lease: string }; Returns: Record<string, unknown> }
}
