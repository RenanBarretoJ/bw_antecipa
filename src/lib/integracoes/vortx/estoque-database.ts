export type VortxStockFunctions = {
  vortx_marcar_download_estoque: { Args: { p_id: string; p_lease: string }; Returns: undefined }
  vortx_retomar_download_estoque: { Args: { p_fundo_id: string; p_correlation_id: string }; Returns: boolean }
  financeiro_possui_historico_fonte_vortx: { Args: { p_fundo_id: string; p_ambiente: string }; Returns: boolean }
  persistir_estoque_vortx: { Args: { p_payload: Record<string, unknown> }; Returns: Record<string, unknown> }
  publicar_estoque_vortx: { Args: { p_importacao_id: string }; Returns: Record<string, unknown> }
  vortx_reservar_processamento_estoque: { Args: { p_fundo_id: string }; Returns: Record<string, unknown> | null }
  vortx_concluir_processamento_estoque: { Args: { p_id: string; p_lease: string; p_payload: Record<string, unknown> }; Returns: Record<string, unknown> }
  vortx_falhar_processamento_estoque: { Args: { p_id: string; p_lease: string; p_erro: string }; Returns: boolean }
  vortx_estagiar_linhas_estoque: { Args: { p_id: string; p_lease: string; p_tipo: string; p_ordem: number; p_linhas: object[] }; Returns: number }
  vortx_reservar_manifesto_estoque: { Args: { p_id: string; p_lease: string; p_manifesto: Record<string, unknown> }; Returns: boolean }
}
