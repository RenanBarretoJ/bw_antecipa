import type { AuditoriaAtorTipo } from '@/lib/types/domain'

export type AuditoriaAtor = {
  tipo: AuditoriaAtorTipo
  origem: string
  identificador?: string | null
  usuarioId?: string | null
}
export interface AuditoriaAtorNormalizado {
  usuario_id: string | null
  ator_tipo: AuditoriaAtor['tipo']
  origem: string
  ator_identificador: string | null
}

export function normalizarAtorAuditoria(
  ator: AuditoriaAtor | undefined,
  usuarioAutenticadoId: string | null,
): AuditoriaAtorNormalizado {
  const tipo = ator?.tipo ?? 'usuario'

  return {
    // O usuário humano sempre vem da sessão atual; não aceitamos um ID
    // fornecido pelo chamador para evitar falsificação de autoria.
    usuario_id: tipo === 'usuario' ? usuarioAutenticadoId : (ator?.usuarioId ?? null),
    ator_tipo: tipo,
    origem: ator?.origem ?? 'server_action',
    ator_identificador: ator?.identificador ?? null,
  }
}
