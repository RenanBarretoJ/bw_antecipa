'use server'

import { z } from 'zod'
import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { LIMITE_CEDENTES_SELETOR } from '@/lib/operacoes/consultor-seletor'

const buscaSchema = z.string().trim().max(80)

export type CedenteElegivelConsultor = {
  id: string
  razaoSocial: string
  nomeFantasia: string | null
  cnpj: string
}

export type BuscaCedentesConsultorResult =
  | { success: true; data: CedenteElegivelConsultor[] }
  | { success: false; message: string }

export async function buscarCedentesElegiveisConsultor(
  termo: string,
): Promise<BuscaCedentesConsultorResult> {
  const parsed = buscaSchema.safeParse(termo)
  if (!parsed.success) return { success: false, message: 'Termo de busca invalido.' }

  const q = parsed.data

  try {
    const auth = await requireAuthenticated()
    assertRole(auth.profile.role, ['consultor'])
    if (q.length > 0 && q.length < 4) return { success: true, data: [] }
    const { data, error } = await auth.supabase.rpc('buscar_cedentes_elegiveis_consultor', {
      p_termo: q || null,
      p_limite: LIMITE_CEDENTES_SELETOR,
    })
    if (error) throw error

    return {
      success: true,
      data: ((data || []) as Array<{
        id: string
        razao_social: string
        nome_fantasia: string | null
        cnpj: string
      }>).map((item) => ({
        id: item.id,
        razaoSocial: item.razao_social,
        nomeFantasia: item.nome_fantasia,
        cnpj: item.cnpj,
      })),
    }
  } catch (error) {
    console.error('[buscarCedentesElegiveisConsultor]', {
      etapa: 'busca_cedentes_elegiveis',
      erro: error instanceof Error ? error.message : 'Falha nao identificada.',
    })
    return { success: false, message: 'Nao foi possivel buscar os Cedentes da sua carteira.' }
  }
}
