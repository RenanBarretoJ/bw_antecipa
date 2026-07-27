'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { requirePermissao } from '@/lib/auth/permissoes'
import { registrarLog } from '@/lib/actions/auditoria'
import { createAdminClient } from '@/lib/supabase/server'
import { vincularCedenteFundo, type StatusOnboardingCedente } from '@/lib/fundos/cedente-fundo'

export type OnboardingCedenteActionState = {
  success: boolean
  message: string
  data?: { cedenteFundoId?: string; status?: StatusOnboardingCedente }
}

export async function vincularCedenteAoFundo(input: {
  cedenteId: string
  fundoId: string
  motivo?: string
}): Promise<OnboardingCedenteActionState> {
  const context = await requireGestor()
  await exigirSessaoElevada(context)

  const cedenteId = input.cedenteId?.trim()
  const fundoId = input.fundoId?.trim()
  const correlationId = randomUUID()

  if (!cedenteId) return { success: false, message: 'Informe o cedente.' }
  if (!fundoId) return { success: false, message: 'Informe o fundo.' }

  try {
    await requirePermissao(context, 'cedentes.vincular_fundo', { fundoId })

    const { data: cedente, error: cedenteError } = await context.supabase
      .from('cedentes')
      .select('id, razao_social, status')
      .eq('id', cedenteId)
      .maybeSingle()
    if (cedenteError) throw new Error(`Erro ao consultar cedente: ${cedenteError.message}`)
    if (!cedente) return { success: false, message: 'Cedente nao encontrado.' }

    const { data: fundo, error: fundoError } = await context.supabase
      .from('fundos')
      .select('id, nome, ativo')
      .eq('id', fundoId)
      .maybeSingle()
    if (fundoError) throw new Error(`Erro ao consultar fundo: ${fundoError.message}`)
    if (!fundo) return { success: false, message: 'Fundo nao encontrado.' }
    if ((fundo as { ativo?: boolean | null }).ativo !== true) return { success: false, message: 'O fundo selecionado esta inativo.' }

    const { data: duplicated, error: duplicatedError } = await context.supabase
      .from('cedente_fundos')
      .select('id')
      .eq('cedente_id', cedenteId)
      .eq('fundo_id', fundoId)
      .eq('status', 'ativo')
      .maybeSingle()
    if (duplicatedError) throw new Error(`Erro ao validar vinculo existente: ${duplicatedError.message}`)
    if (duplicated) return { success: false, message: 'Este cedente ja possui vinculo ativo com o fundo selecionado.' }

    const link = await vincularCedenteFundo(cedenteId, fundoId, context.supabase)
    const admin = createAdminClient()
    const auditPayload = {
      usuario_id: context.user.id,
      ator_tipo: 'usuario',
      origem: 'onboarding_cedentes',
      ator_identificador: context.user.email ?? null,
      tipo_evento: 'cedente_fundo_vinculado',
      entidade_tipo: 'cedente_fundos',
      entidade_id: link.id,
      dados_antes: {
        cedente_id: cedenteId,
        fundo_id: fundoId,
        tenant_id: fundoId,
        valor_anterior: 'sem_vinculo',
      },
      dados_depois: {
        cedente_id: cedenteId,
        cedente_fundo_id: link.id,
        fundo_id: fundoId,
        tenant_id: fundoId,
        permissao: 'cedentes.vincular_fundo',
        origem_acao: 'onboarding_cedentes',
        status: 'ativo',
        valor_novo: 'vinculo_ativo',
        correlation_id: correlationId,
        registrado_em: new Date().toISOString(),
      },
    }

    const { error: auditError } = await admin.from('logs_auditoria').insert(auditPayload as never)
    if (auditError) {
      const { error: rollbackError } = await admin.from('cedente_fundos').delete().eq('id', link.id)
      if (rollbackError) {
        throw new Error(`Vinculo criado, mas a auditoria falhou (${auditError.message}) e a compensacao tambem falhou (${rollbackError.message}).`)
      }
      throw new Error(`Auditoria obrigatoria da vinculacao falhou: ${auditError.message}`)
    }

    revalidatePath('/gestor/onboarding-cedentes')
    revalidatePath('/gestor/cedentes')
    revalidatePath(`/gestor/cedentes/${cedenteId}`)
    revalidatePath(`/gestor/fundos/${fundoId}`)

    return {
      success: true,
      message: 'Cedente vinculado ao fundo. Configure a politica operacional para liberar operacoes.',
      data: { cedenteFundoId: link.id, status: 'aguardando_politica' },
    }
  } catch (error) {
    await registrarLog({
      tipo_evento: 'CEDENTE_ONBOARDING_VINCULO_NEGADO',
      entidade_tipo: 'cedente_fundos',
      dados_depois: {
        cedente_id: cedenteId || null,
        fundo_id: fundoId || null,
        erro: error instanceof Error ? error.message : 'erro_desconhecido',
        origem_acao: 'onboarding_cedentes',
        correlation_id: correlationId,
      },
    })
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel vincular o cedente ao fundo.' }
  }
}
