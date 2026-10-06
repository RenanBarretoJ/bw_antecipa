import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'

type EventoCadastro = 'cadastro_cedente' | 'documento_enviado' | 'alteracao_cadastral'
  | 'documento_vencido' | 'documento_a_vencer'

type AvisoCadastro = {
  cedenteId: string
  titulo: string
  mensagem: string
  tipo: EventoCadastro
  eventoKey: string
}

/** Internal producer, never a Server Action. Call only after domain authorization
 * and persistence; SQL resolves every active fund and its authorized recipients. */
export async function notificarGestoresCadastro(input: AvisoCadastro): Promise<
  { success: true; criadas: number } | { success: false }
> {
  try {
    const { data, error } = await createAdminClient().rpc('notificar_gestores_cadastro_cedente', {
      p_cedente_id: input.cedenteId,
      p_titulo: input.titulo,
      p_mensagem: input.mensagem,
      p_tipo: input.tipo,
      p_evento_key: input.eventoKey,
    })
    if (error || typeof data !== 'number') {
      console.error('[notificacoes/cadastro] Falha no aviso por Fundo.', {
        code: error?.code ?? 'INVALID_RESPONSE', tipo: input.tipo,
      })
      return { success: false }
    }
    return { success: true, criadas: data }
  } catch {
    // The domain event is already committed. Report the notification failure
    // without returning a false failure for the user's completed upload/action.
    console.error('[notificacoes/cadastro] Falha de infraestrutura no aviso por Fundo.', { tipo: input.tipo })
    return { success: false }
  }
}
