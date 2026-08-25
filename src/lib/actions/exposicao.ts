'use server'

import { z } from 'zod'
import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { obterPoliticaAplicavelAoCedenteFundo } from '@/lib/operacoes/politica'
import { simularExposicaoSelecaoCanonica } from '@/lib/financeiro/risco/proforma-selecao.server'
import type { ProformaExposicaoSelecao } from '@/lib/financeiro/risco/visao-operacional'

const selecaoSchema = z.object({
  notaFiscalIds: z.array(z.uuid()).max(500),
  parcelaIds: z.array(z.uuid()).max(2_000),
})

export type SimulacaoExposicaoSelecaoResult =
  | { success: true; data: ProformaExposicaoSelecao | null }
  | { success: false; message: string }

export async function simularExposicaoSelecao(input: {
  notaFiscalIds: string[]
  parcelaIds: string[]
}): Promise<SimulacaoExposicaoSelecaoResult> {
  const parsed = selecaoSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'A selecao informada e invalida.' }

  try {
    const auth = await requireAuthenticated()
    assertRole(auth.profile.role, ['cedente'])
    const { data: cedenteId, error: cedenteError } = await auth.supabase.rpc('get_user_cedente_id')
    if (cedenteError) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${cedenteError.message}`)
    if (!cedenteId) return { success: false, message: 'Cadastro de cedente nao encontrado.' }

    const contexto = await resolverCedenteFundoAtivo(String(cedenteId), auth.supabase)
    if (!contexto.cedenteFundo || !contexto.fundo) {
      return { success: false, message: 'O cedente nao possui fundo operacional ativo.' }
    }
    const politica = await obterPoliticaAplicavelAoCedenteFundo({
      cedenteId: String(cedenteId),
      cedenteFundoId: contexto.cedenteFundo.id,
      fundoId: contexto.fundo.id,
    }, auth.supabase)
    const data = await simularExposicaoSelecaoCanonica({
      client: auth.supabase,
      cedenteId: String(cedenteId),
      cedenteFundoId: contexto.cedenteFundo.id,
      fundoId: contexto.fundo.id,
      fundoNome: contexto.fundo.nome,
      politica,
      notaFiscalIds: parsed.data.notaFiscalIds,
      parcelaIds: parsed.data.parcelaIds,
    })
    return { success: true, data }
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : 'Falha nao identificada.'
    console.error('[simularExposicaoSelecao]', { etapa: 'simulacao_read_only', erro: detalhe })
    return {
      success: false,
      message: error instanceof Error && !error.message.includes(':')
        ? error.message
        : 'Nao foi possivel atualizar o impacto estimado da selecao.',
    }
  }
}
