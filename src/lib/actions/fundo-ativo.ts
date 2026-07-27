'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  FUNDO_ATIVO_COOKIE,
  escolherFundoInicial,
  type FundoAtivoAutorizado,
  type FundoAutorizado,
} from '@/lib/fundos/fundo-ativo'

type ActionResult<T> = {
  success: boolean
  message?: string
  data?: T
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

async function getUserAndProfile() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Usuário não autenticado.')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw new Error(`Erro ao consultar perfil: ${profileError.message}`)
  if (!profile || (profile as { role?: string }).role !== 'gestor') throw new Error('Contexto de fundo ativo é exclusivo para gestores.')

  return {
    supabase,
    userId: user.id,
    tenantId: null,
  }
}

async function listarFundosDoUsuario(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('usuario_fundos')
    .select('fundo_id, perfil_no_fundo, status, principal, fundos(id, nome, cnpj, ativo)')
    .eq('usuario_id', userId)
    .eq('status', 'ativo')
    .order('principal', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Erro ao consultar fundos autorizados: ${error.message}`)

  return ((data || []) as unknown as UsuarioFundoRow[])
    .filter((row) => row.fundos && row.fundos.ativo !== false)
    .map((row): FundoAutorizado => ({
      id: row.fundo_id,
      nome: row.fundos?.nome || row.fundo_id,
      cnpj: row.fundos?.cnpj || null,
      status: row.status,
      perfilNoFundo: row.perfil_no_fundo,
      principal: row.principal,
    }))
}

async function registrarAuditoria({
  userId,
  tipoEvento,
  fundoAnteriorId,
  fundoNovoId,
  resultado,
}: {
  userId: string
  tipoEvento: string
  fundoAnteriorId?: string | null
  fundoNovoId?: string | null
  resultado: 'sucesso' | 'negado'
}) {
  const supabase = await createClient()
  await supabase.from('logs_auditoria').insert({
    usuario_id: userId,
    ator_tipo: 'usuario',
    origem: 'app',
    tipo_evento: tipoEvento,
    entidade_tipo: 'fundos',
    entidade_id: fundoNovoId || fundoAnteriorId || null,
    dados_antes: fundoAnteriorId ? { fundo_id: fundoAnteriorId } : null,
    dados_depois: { fundo_id: fundoNovoId, resultado },
  } as never)
}

export async function carregarContextoFundoAtivo(): Promise<ActionResult<{
  fundos: FundoAutorizado[]
  contexto: FundoAtivoAutorizado
  requerSelecao: boolean
  bloqueado: boolean
}>> {
  try {
    const { userId, tenantId } = await getUserAndProfile()
    const cookieStore = await cookies()
    const cookieFundoId = cookieStore.get(FUNDO_ATIVO_COOKIE)?.value || null
    const fundos = await listarFundosDoUsuario(userId)
    const selecionado = escolherFundoInicial({ fundos, cookieFundoId })

    if (!selecionado) {
      cookieStore.delete(FUNDO_ATIVO_COOKIE)
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

    if (selecionado.id !== cookieFundoId) {
      cookieStore.set(FUNDO_ATIVO_COOKIE, selecionado.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 90,
      })
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
    return { success: false, message: error instanceof Error ? error.message : 'Não foi possível carregar o fundo ativo.' }
  }
}

export async function selecionarFundoAtivo(fundoId: string): Promise<ActionResult<{ fundo: FundoAutorizado }>> {
  try {
    const { userId } = await getUserAndProfile()
    const cookieStore = await cookies()
    const fundoAnteriorId = cookieStore.get(FUNDO_ATIVO_COOKIE)?.value || null
    const fundos = await listarFundosDoUsuario(userId)
    const fundo = fundos.find((item) => item.id === fundoId)

    if (!fundo) {
      await registrarAuditoria({ userId, tipoEvento: 'fundo_ativo_tentativa_nao_autorizada', fundoAnteriorId, fundoNovoId: fundoId, resultado: 'negado' })
      return { success: false, message: 'Fundo não autorizado para este usuário.' }
    }

    cookieStore.set(FUNDO_ATIVO_COOKIE, fundo.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
    })

    await registrarAuditoria({
      userId,
      tipoEvento: fundoAnteriorId === fundo.id ? 'fundo_ativo_reselecionado' : 'fundo_ativo_alterado',
      fundoAnteriorId,
      fundoNovoId: fundo.id,
      resultado: 'sucesso',
    })

    revalidatePath('/gestor')
    return { success: true, message: `Fundo alterado para ${fundo.nome}.`, data: { fundo } }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Não foi possível alterar o fundo ativo.' }
  }
}

export async function obterFundoAtivoAutorizado(): Promise<FundoAtivoAutorizado> {
  const result = await carregarContextoFundoAtivo()
  if (!result.success || !result.data || result.data.bloqueado || !result.data.contexto.fundoId) {
    throw new Error(result.message || 'Nenhum fundo ativo autorizado encontrado.')
  }
  return result.data.contexto
}
