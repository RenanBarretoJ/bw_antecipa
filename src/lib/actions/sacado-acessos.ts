'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireRole, type AuthContext } from '@/lib/auth/authorization'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { normalizarCnpjSacado } from '@/lib/sacado/acessos'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'

export type SacadoGestaoState = { success: boolean; message: string }
const payloadSchema = z.object({
  usuario: z.string().uuid(), fundo: z.string().uuid(),
  cnpj: z.string().transform(normalizarCnpjSacado).pipe(z.string().regex(/^\d{14}$/)),
  razao: z.string().trim().max(200),
  acao: z.enum(['adicionar', 'ativar', 'desativar', 'revogar', 'atualizar_empresa']),
  mfa: z.string().regex(/^\d{6}$/), confirmacao: z.literal('on'),
  contexto: z.enum(['gestor', 'admin']).default('gestor'),
})

async function validarFundoDoFormulario(auth: AuthContext, fundo: string, contexto: 'gestor' | 'admin'): Promise<string | null> {
  // O modo administrativo só chega aqui após requireSuperAdmin, nunca pelo payload sozinho.
  if (contexto === 'admin') return null
  try {
    const contexto = await resolverContextoFundoGestor(auth)
    return contexto.fundoId === fundo ? null : 'O fundo ativo mudou. Atualize a página e confira o fundo no cabeçalho antes de continuar.'
  } catch {
    return 'Não foi possível validar o fundo ativo. Atualize a página antes de continuar.'
  }
}

export async function consultarEmpresaSacado(fundo: string, cnpj: string, contexto: 'gestor' | 'admin' = 'gestor') {
  const parsed = z.object({ fundo: z.string().uuid(), cnpj: z.string().regex(/^\d{14}$/), contexto: z.enum(['gestor', 'admin']) }).safeParse({ fundo, cnpj: normalizarCnpjSacado(cnpj), contexto })
  if (!parsed.success) return { success: false as const, message: 'Informe os 14 digitos do CNPJ.' }
  const auth = parsed.data.contexto === 'admin' ? await requireSuperAdmin() : await requireRole(['gestor', 'super_admin'])
  const erroFundo = await validarFundoDoFormulario(auth, parsed.data.fundo, parsed.data.contexto)
  if (erroFundo) return { success: false as const, message: erroFundo }
  const { data, error } = await auth.supabase.rpc('consultar_empresa_sacado', { p_fundo_id: parsed.data.fundo, p_cnpj: parsed.data.cnpj })
  if (error) return { success: false as const, message: 'Nao foi possivel consultar a empresa neste Fundo.' }
  return { success: true as const, empresa: data }
}

export async function gerenciarAcessoSacado(_state: SacadoGestaoState, form: FormData): Promise<SacadoGestaoState> {
  const parsed = payloadSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { success: false, message: 'Confira os campos, o CNPJ completo, a confirmacao e o codigo de 6 digitos.' }
  try {
    const p = parsed.data
    const auth = p.contexto === 'admin' ? await requireSuperAdmin() : await requireRole(['gestor', 'super_admin'])
    const erroFundo = await validarFundoDoFormulario(auth, p.fundo, p.contexto)
    if (erroFundo) return { success: false, message: erroFundo }
    const authorization = await autorizarEConsumirAcaoSensivel(auth, 'gerenciar_acesso_sacado', p.mfa, { consumoTransacional: true })
    if (!authorization.nonceHash) throw new Error('Autorizacao nao confirmada.')
    const { error } = await auth.supabase.rpc('gerenciar_sacado_acesso', {
      p_user_id: p.usuario, p_fundo_id: p.fundo, p_cnpj: p.cnpj,
      p_razao_social: p.razao, p_acao: p.acao, p_nonce_hash: authorization.nonceHash,
    })
    if (error) return { success: false, message: error.code === '42501'
      ? 'Acesso negado ou confirmacao MFA expirada. Confira o Fundo e confirme novamente.'
      : error.code === '22023' ? 'Confira os dados. Se o vinculo ja existe, utilize Ativar.'
        : 'Nao foi possivel salvar o acesso. Nenhuma alteracao foi confirmada.' }
    revalidatePath('/gestor/sacados')
    revalidatePath('/gestor/configuracoes/sacados')
    revalidatePath('/admin/usuarios/sacados')
    revalidatePath('/sacado', 'layout')
    return { success: true, message: 'Acesso atualizado. Os demais usuarios e Fundos foram preservados.' }
  } catch {
    return { success: false, message: 'Nao foi possivel confirmar esta acao. Confira sua sessao e o codigo MFA.' }
  }
}
