'use server'

import { createClient } from '@/lib/supabase/server'

interface TestemunhaActionState {
  success: boolean
  message: string
}

export async function listarTestemunhas() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('testemunhas')
    .select('id, nome, cpf, email, ativo, created_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function adicionarTestemunha(
  nome: string,
  cpf: string,
  email: string | null
): Promise<TestemunhaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('testemunhas')
    .insert({ nome: nome.trim().toUpperCase(), cpf: cpf.trim(), email: email?.trim() || null } as never)

  if (error) return { success: false, message: `Erro ao adicionar: ${error.message}` }
  return { success: true, message: 'Testemunha adicionada.' }
}

export async function toggleTestemunhaAtivo(
  id: string,
  ativo: boolean
): Promise<TestemunhaActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('testemunhas')
    .update({ ativo } as never)
    .eq('id', id)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: ativo ? 'Testemunha ativada.' : 'Testemunha desativada.' }
}
