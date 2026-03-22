'use server'

import { createClient } from '@/lib/supabase/server'
import { enviarEmail, emailTemplates } from '@/lib/email'

interface NotificacaoInput {
  usuario_id: string
  titulo: string
  mensagem: string
  tipo: string
}

export async function criarNotificacao({ usuario_id, titulo, mensagem, tipo }: NotificacaoInput) {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('notificacoes')
      .insert({ usuario_id, titulo, mensagem, tipo } as never)

    if (error) {
      console.error('[criarNotificacao] Falha ao inserir:', error.message, { usuario_id, tipo })
    }

    // Tentar enviar email (nao bloqueia se falhar)
    tentarEnviarEmail(usuario_id, tipo, titulo, mensagem).catch(() => {})
  } catch (err) {
    console.error('[criarNotificacao] Erro inesperado:', err)
  }
}

export async function notificarGestores(titulo: string, mensagem: string, tipo: string) {
  try {
    const supabase = await createClient()
    const { data: gestores, error: queryError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'gestor')

    if (queryError) {
      console.error('[notificarGestores] Erro ao buscar gestores:', queryError.message)
      return
    }

    if (!gestores || gestores.length === 0) {
      console.warn('[notificarGestores] Nenhum gestor encontrado para notificar')
      return
    }

    const notificacoes = gestores.map((g) => ({
      usuario_id: (g as { id: string }).id,
      titulo,
      mensagem,
      tipo,
    }))

    const { error: insertError } = await supabase
      .from('notificacoes')
      .insert(notificacoes as never[])

    if (insertError) {
      console.error('[notificarGestores] Falha ao inserir notificacoes:', insertError.message, { tipo, count: notificacoes.length })
    }
  } catch (err) {
    console.error('[notificarGestores] Erro inesperado:', err)
  }
}

// Envia email transacional baseado no tipo de notificacao.
// Non-blocking: erros sao logados mas nao propagados.
async function tentarEnviarEmail(usuarioId: string, tipo: string, titulo: string, mensagem: string) {
  try {
    const supabase = await createClient()

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
  } catch (err) {
    console.error('[tentarEnviarEmail] Erro:', err)
  }
}
