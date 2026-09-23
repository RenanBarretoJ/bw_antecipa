'use server'

import { revalidatePath } from 'next/cache'
import { assertRole, AuthorizationError, requireAuthenticated } from '@/lib/auth/authorization'
import { criarCedenteConsultorSchema, type CriarCedenteConsultorResult } from '@/lib/consultor/cedentes'

type RpcResult = { cedente_id?: string }

export async function criarCedenteConsultor(input: unknown): Promise<CriarCedenteConsultorResult> {
  const parsed = criarCedenteConsultorSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, message: 'Revise os dados informados.', fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const context = await requireAuthenticated()
    assertRole(context.profile.role, ['consultor'])
    const { data, error } = await context.supabase.rpc('criar_cedente_consultor', {
      p_fundo_id: parsed.data.fundoId,
      p_cnpj: parsed.data.cnpj,
      p_razao_social: parsed.data.razaoSocial,
      p_nome_fantasia: parsed.data.nomeFantasia || null,
    })
    if (error) {
      const message = ['23505', '22023', '42501'].includes(error.code)
        ? error.message
        : 'Não foi possível criar o Cedente.'
      return { success: false, message }
    }
    const result = data as RpcResult
    if (!result?.cedente_id) return { success: false, message: 'A criação não retornou o Cedente.' }
    revalidatePath('/consultor/cedentes')
    return { success: true, message: 'Cedente criado. Continue o cadastro.', cedenteId: result.cedente_id }
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    return { success: false, message: 'Não foi possível criar o Cedente.' }
  }
}
