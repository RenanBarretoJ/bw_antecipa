export type VortxReportFunctions = {
  vortx_solicitar_relatorio: {
    Args: { p_fundo_id: string; p_versao_id: string; p_tipo: string; p_inicio: string; p_fim: string; p_referencia: string; p_extensao: number; p_lease_hash: string; p_anterior?: string | null }
    Returns: Record<string, unknown>
  }
  vortx_contexto_relatorios: { Args: { p_fundo_id: string }; Returns: Record<string, unknown> }
  vortx_contexto_rotina: { Args: { p_fundo_id: string }; Returns: Record<string, unknown> }
  vortx_rotina_reservar: {
    Args: { p_fundo_id: string; p_versao_id: string; p_tipo: string; p_inicio: string; p_fim: string; p_referencia: string; p_lease_hash: string }
    Returns: Record<string, unknown>
  }
  vortx_rotina_transicionar: {
    Args: { p_id: string; p_lease: string; p_estado: string; p_protocolo?: string | null; p_http?: number | null }
    Returns: Record<string, unknown>
  }
  admin_ressolicitar_relatorio_vortx: {
    Args: { p_fundo_id: string; p_versao_id: string; p_tipo: string; p_inicio: string; p_fim: string; p_referencia: string; p_extensao: number; p_nonce_hash: string; p_lease_hash: string; p_anterior: string }
    Returns: Record<string, unknown>
  }
  admin_reservar_relatorio_vortx: {
    Args: { p_fundo_id: string; p_versao_id: string; p_tipo: string; p_inicio: string; p_fim: string; p_referencia: string; p_extensao: number; p_nonce_hash: string; p_lease_hash: string }
    Returns: Record<string, unknown>
  }
  admin_transicionar_relatorio_vortx: {
    Args: { p_id: string; p_lease: string; p_estado: string; p_protocolo?: string | null; p_http?: number | null }
    Returns: Record<string, unknown>
  }
  admin_listar_relatorios_vortx: { Args: { p_fundo_id: string; p_pagina?: number }; Returns: Record<string, unknown> }
}
