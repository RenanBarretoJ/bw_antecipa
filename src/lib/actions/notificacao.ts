import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmail, emailTemplates } from '@/lib/email'

export type ContextoNotificacao = {
  entidadeTipo: 'nota_fiscal' | 'operacao' | 'cedente_fundo' | 'entrega' | 'evento_dominio'
  entidadeId: string
}
type DestinoNotificacao = 'gestor' | 'cedente' | 'sacado' | 'consultor'
export type NotificacaoCedenteEscopo = 'operacional' | 'administrativo'
export type ResultadoNotificacao = { success: true; criadas: number } | { success: false }
type Criada = { usuario_id: string; notificacao_id: string }

/** Internal backend boundary, never a callable Server Action. SQL derives fund,
 * canonical link and recipients from the persisted entity, not the UI cookie. */
export async function notificarEntidade(
  contexto: ContextoNotificacao,
  destino: DestinoNotificacao,
  titulo: string,
  mensagem: string,
  tipo: string,
  dedupeKey: string,
  options: { usuarioId?: string; somenteAdmin?: boolean; enviarEmail?: boolean } = {},
): Promise<ResultadoNotificacao> {
  try {
    const { data, error } = await createAdminClient().rpc('notificar_entidade', {
      p_entidade_tipo: contexto.entidadeTipo, p_entidade_id: contexto.entidadeId,
      p_destino: destino, p_titulo: titulo, p_mensagem: mensagem, p_tipo: tipo,
      p_dedupe_key: dedupeKey, p_usuario_id: options.usuarioId ?? null,
      p_somente_admin: options.somenteAdmin ?? false,
    })
    if (error || !Array.isArray(data)) {
      console.error('[notificacoes/entidade] Falha no aviso.', { code: error?.code ?? 'INVALID_RESPONSE', tipo })
      return { success: false }
    }
    if (options.enviarEmail) await enviarEmailsNovos(data, tipo, titulo, mensagem)
    return { success: true, criadas: data.length }
  } catch {
    console.error('[notificacoes/entidade] Falha de infraestrutura.', { tipo })
    return { success: false }
  }
}

export async function criarNotificacao(input: {
  usuario_id: string; contexto: ContextoNotificacao; destino: DestinoNotificacao
  titulo: string; mensagem: string; tipo: string; dedupe_key: string
}) {
  return notificarEntidade(input.contexto, input.destino, input.titulo, input.mensagem, input.tipo,
    input.dedupe_key, { usuarioId: input.usuario_id, enviarEmail: true })
}

export async function notificarCedente(
  contexto: ContextoNotificacao, titulo: string, mensagem: string, tipo: string,
  dedupeKey: string, escopo: NotificacaoCedenteEscopo = 'operacional',
) {
  return notificarEntidade(contexto, 'cedente', titulo, mensagem, tipo, dedupeKey,
    { somenteAdmin: escopo === 'administrativo', enviarEmail: true })
}

export async function notificarGestores(
  contexto: ContextoNotificacao, titulo: string, mensagem: string, tipo: string, dedupeKey: string,
) {
  return notificarEntidade(contexto, 'gestor', titulo, mensagem, tipo, dedupeKey)
}

export async function notificarCedenteCadastro(
  cedenteId: string, titulo: string, mensagem: string, tipo: string, dedupeKey: string,
  escopo: NotificacaoCedenteEscopo = 'operacional',
): Promise<ResultadoNotificacao> {
  try {
    const { data, error } = await createAdminClient().rpc('notificar_cedente_cadastro', {
      p_cedente_id: cedenteId, p_titulo: titulo, p_mensagem: mensagem, p_tipo: tipo,
      p_dedupe_key: dedupeKey, p_somente_admin: escopo === 'administrativo',
    })
    if (error || !Array.isArray(data)) {
      console.error('[notificacoes/cadastro-cedente] Falha no aviso.', { code: error?.code ?? 'INVALID_RESPONSE', tipo })
      return { success: false }
    }
    await enviarEmailsNovos(data, tipo, titulo, mensagem)
    return { success: true, criadas: data.length }
  } catch {
    console.error('[notificacoes/cadastro-cedente] Falha de infraestrutura.', { tipo })
    return { success: false }
  }
}

async function enviarEmailsNovos(criadas: Criada[], tipo: string, titulo: string, mensagem: string) {
  // One email per newly notified user, even when a shared event affects two funds.
  const users = [...new Set(criadas.map(row => row.usuario_id))]
  await Promise.allSettled(users.map(user => tentarEnviarEmail(user, tipo, titulo, mensagem)))
}

// Envia email transacional baseado no tipo de notificacao.
// Non-blocking: erros sao logados mas nao propagados.
async function tentarEnviarEmail(usuarioId: string, tipo: string, titulo: string, mensagem: string) {
  try {
    const supabase = createAdminClient()

    // Buscar email do usuario
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, nome_completo')
      .eq('id', usuarioId)
      .single()

    if (!profile) return

    const { email, nome_completo } = profile as { email: string; nome_completo: string }
    if (!email) return

    // Mapear tipo de notificacao para template de email
    let emailData: { subject: string; html: string } | null = null

    switch (tipo) {
      case 'cadastro_aprovado':
        emailData = emailTemplates.cadastroAprovado(nome_completo, mensagem.match(/ESC-[\w-]+/)?.[0] || '')
        break
      case 'cadastro_reprovado':
        emailData = emailTemplates.documentoReprovado(nome_completo, 'Cadastro', mensagem.replace(/.*Motivo: /, ''))
        break
      case 'documento_aprovado':
        emailData = emailTemplates.documentoAprovado(nome_completo, mensagem.match(/"([^"]+)"/)?.[1] || '')
        break
      case 'documento_reprovado':
        emailData = emailTemplates.documentoReprovado(nome_completo, mensagem.match(/"([^"]+)"/)?.[1] || '', mensagem.replace(/.*Motivo: /, ''))
        break
      case 'operacao_aprovada':
        emailData = emailTemplates.operacaoAprovada(
          nome_completo,
          mensagem.match(/desembolsado: ([^\s(]+)/)?.[1] || '',
          mensagem.match(/taxa: ([\d,.]+)%/)?.[1] || ''
        )
        break
      case 'operacao_reprovada':
        emailData = emailTemplates.operacaoReprovada(nome_completo, mensagem.replace(/.*Motivo: /, ''))
        break
      case 'cessao_credito':
        emailData = emailTemplates.cessaoCredito(nome_completo, mensagem.match(/cedente (.+?)\./)?.[1] || '', mensagem.match(/NFs (.+?) emitidas/)?.[1] || '')
        break
      case 'operacao_liquidada':
        emailData = emailTemplates.operacaoLiquidada(nome_completo, mensagem.match(/#(\w+)/)?.[1] || '')
        break
      case 'operacao_inadimplente':
        emailData = emailTemplates.alertaInadimplencia(nome_completo, mensagem.match(/#(\w+)/)?.[1] || '')
        break
      default:
        // Para tipos sem template especifico, nao envia email
        return
    }

    if (emailData) {
      await enviarEmail({ to: email, ...emailData })
    }
  } catch {
    console.error('[notificacoes/email] Falha no envio transacional.', { tipo })
  }
}
