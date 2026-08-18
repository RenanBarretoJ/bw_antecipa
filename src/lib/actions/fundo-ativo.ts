'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { FUNDO_ATIVO_COOKIE, type FundoAutorizado } from '@/lib/fundos/fundo-ativo'
import {
  carregarContextoFundoAtivoReadOnly,
  carregarFundosAutorizadosGestor,
  type FundoAtivoContextoData,
} from '@/lib/fundos/fundo-ativo.server'

type ActionResult<T> = {
  success: boolean
  message?: string
  data?: T
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

/**
 * Server Action de leitura consumida pelo provider cliente. A resolucao e
 * intencionalmente side-effect-free; ela nunca persiste fallback no cookie.
 */
export async function carregarContextoFundoAtivo(): Promise<ActionResult<FundoAtivoContextoData>> {
  return carregarContextoFundoAtivoReadOnly()
}

export async function selecionarFundoAtivo(fundoId: string): Promise<ActionResult<{ fundo: FundoAutorizado }>> {
  try {
    const { userId, fundos } = await carregarFundosAutorizadosGestor()
    const cookieStore = await cookies()
    const fundoAnteriorId = cookieStore.get(FUNDO_ATIVO_COOKIE)?.value || null
    const fundo = fundos.find((item) => item.id === fundoId)

    if (!fundo) {
      await registrarAuditoria({
        userId,
        tipoEvento: 'fundo_ativo_tentativa_nao_autorizada',
        fundoAnteriorId,
        fundoNovoId: fundoId,
        resultado: 'negado',
      })
      return { success: false, message: 'Fundo nao autorizado para este usuario.' }
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
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel alterar o fundo ativo.' }
  }
}
