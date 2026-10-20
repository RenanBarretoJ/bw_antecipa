export type VortxCallbackFunctions = {
  vortx_registrar_callback_rejeitado: { Args: { p_id: string; p_segredo_hash: string; p_revisao: number; p_motivo: string; p_bytes: number; p_hash: string; p_ciphertext: string; p_chave_versao: string; p_capturar_ate: string }; Returns: Record<string, unknown> }
  vortx_limpar_callback_diagnosticos_expirados: { Args: Record<string, never>; Returns: number }
  admin_vortx_callback_status: { Args: { p_fundo_id: string; p_versao_id: string }; Returns: Record<string, unknown> }
  admin_vortx_callback_mutar: { Args: { p_fundo_id: string; p_versao_id: string; p_acao: string; p_revisao_esperada: number; p_segredo_hash: string | null; p_nonce_hash: string }; Returns: Record<string, unknown> }
  vortx_configurar_callback: { Args: { p_fundo_id: string; p_versao_id: string; p_segredo_hash: string }; Returns: Record<string, unknown> }
  vortx_revogar_callback: { Args: { p_id: string }; Returns: undefined }
  vortx_autorizar_callback: { Args: { p_id: string; p_segredo_hash: string }; Returns: Record<string, unknown> }
  vortx_receber_callback: { Args: { p_id: string; p_segredo_hash: string; p_revisao: number; p_metadados: object; p_hash_evento: string; p_ciphertext: string; p_chave_versao: string }; Returns: Record<string, unknown> }
}
