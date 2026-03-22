'use server'

import { createClient } from '@/lib/supabase/server'

interface NotificacaoInput {
  usuario_id: string
  titulo: string
  mensagem: string
  tipo: string
}

export async function criarNotificacao({ usuario_id, titulo, mensagem, tipo }: NotificacaoInput) {
  const supabase = await createClient()
  await supabase.from('notificacoes').insert({ usuario_id, titulo, mensagem, tipo } as never)
}

export async function notificarGestores(titulo: string, mensagem: string, tipo: string) {
  const supabase = await createClient()
  const { data: gestores } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'gestor')

  if (!gestores) return

  const notificacoes = gestores.map((g) => ({
    usuario_id: (g as { id: string }).id,
    titulo,
    mensagem,
    tipo,
  }))

  if (notificacoes.length > 0) {
    await supabase.from('notificacoes').insert(notificacoes as never[])
  }
}
