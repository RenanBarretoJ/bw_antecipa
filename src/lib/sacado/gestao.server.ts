import 'server-only'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'

export const usuarioSacadoSchema = z.object({
  id: z.string().uuid(), nome_completo: z.string(), email: z.string(), status: z.string(), cnpjs_ativos: z.number(),
})
export const acessoGestaoSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), cnpj: z.string(), razao_social: z.string(), status: z.enum(['ativo', 'inativo', 'revogado']), created_at: z.string(), updated_at: z.string(),
})
const resultSchema = z.object({ total: z.number(), usuarios: z.array(usuarioSacadoSchema), acessos: z.array(acessoGestaoSchema), pode_editar: z.boolean() })
export type AcessoGestaoSacado = z.infer<typeof acessoGestaoSchema>

export async function carregarGestaoSacados(params: Record<string, string | string[] | undefined>) {
  const auth = await requireRole(['gestor', 'super_admin'])
  const { data, error } = await auth.supabase.from('fundos').select('id, nome').eq('ativo', true).order('nome')
  if (error) throw new Error('Nao foi possivel consultar os Fundos autorizados.')
  const fundos = data ?? []
  const fundoInicial = !params.fundo && auth.profile.role === 'gestor'
    ? (await resolverContextoFundoGestor(auth)).fundoId
    : null
  const fundo = fundos.find(f => f.id === (params.fundo || fundoInicial)) ?? (params.fundo || fundoInicial ? null : fundos[0])
  if (!fundo) throw new Error('Selecione um Fundo autorizado.')
  const busca = typeof params.busca === 'string' ? params.busca.trim().slice(0, 150) : ''
  const pagina = Math.max(1, Math.min(10000, Number(params.pagina) || 1))
  const userId = typeof params.usuario === 'string' ? z.string().uuid().parse(params.usuario) : null
  const result = await auth.supabase.rpc('listar_gestao_sacados', { p_fundo_id: fundo.id, p_busca: busca, p_pagina: pagina, p_user_id: userId })
  if (result.error) throw new Error('Nao foi possivel consultar os Sacados deste Fundo.')
  return { fundo, fundos, busca, pagina, userId, ...resultSchema.parse(result.data) }
}
