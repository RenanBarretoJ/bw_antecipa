import 'server-only'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticated } from '@/lib/auth/authorization'
import {
  FUNDO_ATIVO_COOKIE,
  escolherFundoInicial,
  type FundoAtivoAutorizado,
  type FundoAutorizado,
} from '@/lib/fundos/fundo-ativo'

export type FundoAtivoContextoData = {
  fundos: FundoAutorizado[]
  contexto: FundoAtivoAutorizado
  requerSelecao: boolean
  bloqueado: boolean
}

export type FundoAtivoReadResult = {
  success: boolean
  message?: string
  data?: FundoAtivoContextoData
}

type UsuarioFundoRow = {
  fundo_id: string
  perfil_no_fundo: string
  status: string
  principal: boolean
  fundos: {
    id: string
    nome: string
    cnpj: string | null
    ativo: boolean | null
  } | null
}

export async function carregarFundosAutorizadosGestor() {
  const supabase = await createClient()
  const { user, profile } = await requireAuthenticated(supabase)
  if (profile.role !== 'gestor') throw new Error('Contexto de fundo ativo e exclusivo para gestores.')

  const { data, error } = await supabase
    .from('usuario_fundos')
    .select('fundo_id, perfil_no_fundo, status, principal, fundos(id, nome, cnpj, ativo)')
    .eq('usuario_id', user.id)
    .eq('status', 'ativo')
    .order('principal', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Erro ao consultar fundos autorizados: ${error.message}`)

  const fundos = ((data || []) as unknown as UsuarioFundoRow[])
    .filter((row) => row.fundos && row.fundos.ativo !== false)
    .map((row): FundoAutorizado => ({
      id: row.fundo_id,
      nome: row.fundos?.nome || row.fundo_id,
      cnpj: row.fundos?.cnpj || null,
      status: row.status,
      perfilNoFundo: row.perfil_no_fundo,
      principal: row.principal,
    }))

  return { userId: user.id, tenantId: null, fundos }
}

/**
 * Resolve o fundo ativo durante renderizacao sem efeitos colaterais. Quando o
 * cookie estiver ausente ou invalido, o fallback existe somente em memoria.
 */
export async function carregarContextoFundoAtivoReadOnly(): Promise<FundoAtivoReadResult> {
  try {
    const { userId, tenantId, fundos } = await carregarFundosAutorizadosGestor()
    const cookieFundoId = (await cookies()).get(FUNDO_ATIVO_COOKIE)?.value || null
    const selecionado = escolherFundoInicial({ fundos, cookieFundoId })

    if (!selecionado) {
      return {
        success: true,
        data: {
          fundos,
          contexto: { userId, tenantId, fundoId: null, perfilNoFundo: null, consolidado: false },
          requerSelecao: false,
          bloqueado: true,
        },
      }
    }

    return {
      success: true,
      data: {
        fundos,
        contexto: {
          userId,
          tenantId,
          fundoId: selecionado.id,
          perfilNoFundo: selecionado.perfilNoFundo,
          consolidado: false,
        },
        requerSelecao: fundos.length > 1 && !cookieFundoId,
        bloqueado: false,
      },
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Nao foi possivel carregar o fundo ativo.',
    }
  }
}

export async function obterFundoAtivoAutorizado(): Promise<FundoAtivoAutorizado> {
  const result = await carregarContextoFundoAtivoReadOnly()
  if (!result.success || !result.data || result.data.bloqueado || !result.data.contexto.fundoId) {
    throw new Error(result.message || 'Nenhum fundo ativo autorizado encontrado.')
  }
  return result.data.contexto
}
