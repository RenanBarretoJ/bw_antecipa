'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { requirePermissao } from '@/lib/auth/permissoes'
import { registrarLog } from '@/lib/actions/auditoria'
import { createAdminClient } from '@/lib/supabase/server'
import { vincularCedenteFundo, type StatusOnboardingCedente } from '@/lib/fundos/cedente-fundo'
import { resolverFundoAtivoOnboarding } from '@/lib/onboarding-cedentes/contexto.server'
import type { ContextoOnboardingCedente, PoliticaOnboardingOpcao } from '@/lib/onboarding-cedentes/listagem'

export type OnboardingCedenteActionState = {
  success: boolean
  message: string
  data?: { cedenteFundoId?: string; status?: StatusOnboardingCedente }
}

export type ContextoOnboardingActionState = {
  success: boolean
  message: string
  data?: ContextoOnboardingCedente
}

export async function carregarContextoOnboardingCedente(
  cedenteIdInput: string,
): Promise<ContextoOnboardingActionState> {
  try {
    const context = await requireGestor()
    const fundo = await resolverFundoAtivoOnboarding(context)
    const cedenteId = cedenteIdInput?.trim()
    if (!cedenteId) return { success: false, message: 'Informe o cedente.' }
    if (!fundo) return { success: false, message: 'Nenhum fundo ativo autorizado foi encontrado.' }

    const [cedenteResult, vinculoResult] = await Promise.all([
      context.supabase
        .from('cedentes')
        .select('id, razao_social, nome_fantasia, cnpj, status, created_at')
        .eq('id', cedenteId)
        .maybeSingle(),
      context.supabase
        .from('cedente_fundos')
        .select('id, status, vigente_desde, vigente_ate')
        .eq('cedente_id', cedenteId)
        .eq('fundo_id', fundo.id)
        .in('status', ['ativo', 'suspenso'])
        .or(`vigente_ate.is.null,vigente_ate.gt.${new Date().toISOString()}`)
        .order('vigente_desde', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (cedenteResult.error) throw new Error(`Erro ao consultar cedente: ${cedenteResult.error.message}`)
    if (vinculoResult.error) throw new Error(`Erro ao consultar vinculo: ${vinculoResult.error.message}`)
    if (!cedenteResult.data) return { success: false, message: 'Cedente nao encontrado.' }

    const vinculo = vinculoResult.data
    if (!vinculo) {
      const { count, error } = await context.supabase
        .from('cedente_fundos')
        .select('id', { count: 'exact', head: true })
        .eq('cedente_id', cedenteId)
        .in('status', ['ativo', 'suspenso'])
      if (error) throw new Error(`Erro ao validar escopo do cedente: ${error.message}`)
      if ((count || 0) > 0) return { success: false, message: 'Cedente fora do contexto do fundo ativo.' }
    }

    const { data: politicas, error: politicasError } = await context.supabase
      .from('politicas_operacionais')
      .select('id, nome, codigo')
      .eq('fundo_id', fundo.id)
      .eq('status', 'ativa')
      .order('nome', { ascending: true })
    if (politicasError) throw new Error(`Erro ao consultar politicas: ${politicasError.message}`)

    const politicaIds = (politicas || []).map((politica) => politica.id)
    const { data: versoes, error: versoesError } = politicaIds.length
      ? await context.supabase
        .from('politica_operacional_versoes')
        .select('id, politica_operacional_id, versao, publicada_em')
        .in('politica_operacional_id', politicaIds)
        .eq('fundo_id', fundo.id)
        .eq('status', 'publicada')
        .not('publicada_em', 'is', null)
        .lte('vigente_desde', new Date().toISOString())
        .is('vigente_ate', null)
        .order('versao', { ascending: false })
      : { data: [], error: null }
    if (versoesError) throw new Error(`Erro ao consultar versoes publicadas: ${versoesError.message}`)

    const versaoAtualPorPolitica = new Map<string, (typeof versoes)[number]>()
    for (const versao of versoes || []) {
      if (!versaoAtualPorPolitica.has(versao.politica_operacional_id)) {
        versaoAtualPorPolitica.set(versao.politica_operacional_id, versao)
      }
    }
    const versaoIds = [...versaoAtualPorPolitica.values()].map((versao) => versao.id)
    const { data: requisitos, error: requisitosError } = versaoIds.length
      ? await context.supabase
        .from('politica_requisitos_documentais')
        .select('politica_operacional_versao_id')
        .in('politica_operacional_versao_id', versaoIds)
        .eq('ativo', true)
      : { data: [], error: null }
    if (requisitosError) throw new Error(`Erro ao contar requisitos: ${requisitosError.message}`)

    const requisitoCount = new Map<string, number>()
    for (const requisito of requisitos || []) {
      requisitoCount.set(
        requisito.politica_operacional_versao_id,
        (requisitoCount.get(requisito.politica_operacional_versao_id) || 0) + 1,
      )
    }

    const politicasDisponiveis = (politicas || []).flatMap((politica): PoliticaOnboardingOpcao[] => {
      const versao = versaoAtualPorPolitica.get(politica.id)
      if (!versao?.publicada_em) return []
      return [{
        id: politica.id,
        nome: politica.nome,
        codigo: politica.codigo,
        versaoId: versao.id,
        numeroVersao: versao.versao,
        publicadaEm: versao.publicada_em,
        requisitoCount: requisitoCount.get(versao.id) || 0,
      }]
    })

    let politicaAtual: PoliticaOnboardingOpcao | null = null
    if (vinculo?.status === 'ativo') {
      const { data: atribuicao, error: atribuicaoError } = await context.supabase
        .from('cedente_fundo_politicas')
        .select('politica_operacional_id')
        .eq('cedente_fundo_id', vinculo.id)
        .eq('status', 'ativa')
        .is('vigente_ate', null)
        .order('vigente_desde', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (atribuicaoError) throw new Error(`Erro ao consultar politica atribuida: ${atribuicaoError.message}`)
      politicaAtual = politicasDisponiveis.find((politica) => politica.id === atribuicao?.politica_operacional_id) || null
    }

    return {
      success: true,
      message: 'Contexto carregado.',
      data: {
        cedente: {
          id: cedenteResult.data.id,
          razaoSocial: cedenteResult.data.razao_social,
          nomeFantasia: cedenteResult.data.nome_fantasia,
          cnpj: cedenteResult.data.cnpj,
          statusCadastral: cedenteResult.data.status,
          createdAt: cedenteResult.data.created_at,
        },
        fundo,
        vinculo: vinculo ? {
          id: vinculo.id,
          status: vinculo.status,
          vigenteDesde: vinculo.vigente_desde,
          vigenteAte: vinculo.vigente_ate,
        } : null,
        politicaAtual,
        politicasDisponiveis,
      },
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Nao foi possivel carregar o contexto do cedente.',
    }
  }
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
    const fundoAtivo = await resolverFundoAtivoOnboarding(context)
    if (!fundoAtivo || fundoAtivo.id !== fundoId) {
      return { success: false, message: 'O fundo informado nao corresponde ao fundo ativo autorizado.' }
    }
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
