'use server'

import { createHash } from 'node:crypto'
import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { createClient } from '@/lib/supabase/server'
import {
  normalizarRequisitoDocumental,
  normalizarRequisitoLegadoParaEdicao,
  type PoliticaRequisitoInput,
} from '@/lib/politicas/requisitos-documentais'
import { stableStringify, validarConfiguracaoPublica } from '@/lib/operacoes/politica'
import { registrarLog } from './auditoria'
import { obterFundoAtivoAutorizado } from './fundo-ativo'
import type { MetodoCalculoNovaPolitica } from '@/lib/operacoes/calculo'
import { validarUnicidadeFamiliasLogisticas } from '@/lib/logistica/evidencias-logisticas'

type PolicyActionState = { success?: boolean; message?: string }
type SupabaseFrom = Awaited<ReturnType<typeof requireGestor>>['supabase']

export type { PoliticaRequisitoInput } from '@/lib/politicas/requisitos-documentais'

export interface CriarVersaoPoliticaInput {
  vigente_desde?: string
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  exigir_status_logistico_pre_cessao: boolean
  permite_postergacao_upload_canhoto: boolean
  limite_postergacao_upload_canhoto_dias: number | null
  metodo_calculo_financeiro: MetodoCalculoNovaPolitica | null
  configuracao?: Record<string, unknown>
  requisitos: PoliticaRequisitoInput[]
}

function result(message: string, success = false): PolicyActionState {
  return { success, message }
}

function hashVersao(input: CriarVersaoPoliticaInput, requisitos: ReturnType<typeof normalizarRequisitoDocumental>[]): string {
  return createHash('sha256').update(stableStringify({
    aceite_sacado_obrigatorio: input.aceite_sacado_obrigatorio,
    cessao_no_desembolso: input.cessao_no_desembolso,
    cria_acompanhamento_entrega: input.cria_acompanhamento_entrega,
    exigir_status_logistico_pre_cessao: input.exigir_status_logistico_pre_cessao,
    permite_postergacao_upload_canhoto: input.permite_postergacao_upload_canhoto,
    limite_postergacao_upload_canhoto_dias: input.limite_postergacao_upload_canhoto_dias,
    metodo_calculo_financeiro: input.metodo_calculo_financeiro,
    configuracao: input.configuracao || {},
    requisitos,
  })).digest('hex')
}

async function validarCedenteFundoDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, cedenteFundoId: string) {
  const { data, error } = await supabase
    .from('cedente_fundos')
    .select('id, fundo_id, status')
    .eq('id', cedenteFundoId)
    .eq('fundo_id', fundoId)
    .maybeSingle()
  if (error || !data) throw new Error('Vinculo cedente-fundo nao pertence ao fundo informado.')
  return data as { id: string; fundo_id: string; status: string }
}

async function validarFundoAtivoAutorizado(fundoId: string) {
  const contexto = await obterFundoAtivoAutorizado()
  if (contexto.fundoId !== fundoId) throw new Error('Fundo informado nao corresponde ao fundo ativo autorizado.')
  return contexto
}

async function validarPoliticaDoFundo(supabase: SupabaseFrom, fundoId: string, politicaId: string) {
  const { data, error } = await supabase
    .from('politicas_operacionais')
    .select('id, fundo_id, status')
    .eq('id', politicaId)
    .maybeSingle()
  const policy = data as unknown as { id: string; fundo_id: string | null; status: string } | null
  if (error) throw new Error(`Erro ao validar politica: ${error.message}`)
  if (!policy) throw new Error('Politica nao encontrada.')
  if (!policy.fundo_id) throw new Error('Politica sem contexto de fundo.')
  if (policy.fundo_id !== fundoId) throw new Error('Politica nao pertence ao fundo informado.')
  return policy
}

async function validarVersaoPoliticaDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, versaoId: string) {
  const { data: version, error: versionError } = await supabase
    .from('politica_operacional_versoes')
    .select('id, politica_operacional_id, fundo_id')
    .eq('id', versaoId)
    .maybeSingle()
  if (versionError) throw new Error(`Erro ao validar versao da politica: ${versionError.message}`)
  const versionData = version as { id: string; politica_operacional_id: string; fundo_id: string | null } | null
  if (!versionData) throw new Error('Versao de politica nao encontrada.')
  if (!versionData.fundo_id) throw new Error('Versao de politica sem contexto de fundo.')
  if (versionData.fundo_id !== fundoId) throw new Error('Versao de politica nao pertence ao fundo informado.')
  return versionData
}

async function loadPolicyContext(supabase: SupabaseFrom, politicaId: string) {
  const { data: policy, error } = await supabase
    .from('politicas_operacionais')
    .select('id, fundo_id, status')
    .eq('id', politicaId)
    .maybeSingle()
  if (error) throw new Error(`Erro ao consultar politica: ${error.message}`)
  if (!policy) throw new Error('Politica nao encontrada.')
  const policyData = policy as { id: string; fundo_id: string | null; status: string }
  if (!policyData.fundo_id) throw new Error('Politica sem contexto de fundo.')
  return { ...policyData, fundo_id: policyData.fundo_id }
}

export async function criarPoliticaOperacional(
  cedenteFundoId: string,
  codigo: string,
  nome: string,
  descricao?: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  const context = await requireGestor()
  if (!cedenteFundoId || !codigo.trim() || !nome.trim()) return result('Vinculo, codigo e nome sao obrigatorios.')

  const supabase = context.supabase
  const { data: link } = await supabase
    .from('cedente_fundos')
    .select('id, fundo_id, status')
    .eq('id', cedenteFundoId)
    .maybeSingle()
  if (!link) return result('Vinculo cedente-fundo nao encontrado.')
  const linkData = link as { id: string; fundo_id: string; status: string }
  if (linkData.status !== 'ativo') return result('A politica so pode ser criada para um vinculo ativo.')

  const { data, error } = await supabase.from('politicas_operacionais').insert({
    fundo_id: linkData.fundo_id,
    codigo: codigo.trim(),
    nome: nome.trim(),
    descricao: descricao?.trim() || null,
    status: 'rascunho',
    padrao: false,
    created_by: context.user.id,
  } as never).select('id').single()

  if (error || !data) return result(`Erro ao criar politica: ${error?.message || 'registro nao retornado'}`)
  await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_CRIADA', entidade_tipo: 'politicas_operacionais', entidade_id: (data as { id: string }).id, dados_depois: { vinculo_origem_id: cedenteFundoId, fundo_id: linkData.fundo_id, codigo: codigo.trim() } })
  return { success: true, message: 'Politica criada como rascunho.', data: { id: (data as { id: string }).id } }
}

export async function criarPoliticaDoFundo(
  fundoId: string,
  codigo: string,
  nome: string,
  descricao?: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  try {
    const context = await requireGestor()
    await validarFundoAtivoAutorizado(fundoId)
    if (!codigo.trim() || !nome.trim()) return result('Codigo e nome sao obrigatorios.')

    const { data, error } = await context.supabase.from('politicas_operacionais').insert({
      fundo_id: fundoId,
      codigo: codigo.trim(),
      nome: nome.trim(),
      descricao: descricao?.trim() || null,
      status: 'rascunho',
      padrao: false,
      created_by: context.user.id,
    } as never).select('id').single()

    if (error || !data) return result(`Erro ao criar politica: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({ tipo_evento: 'POLITICA_CATALOGO_CRIADA', entidade_tipo: 'politicas_operacionais', entidade_id: (data as { id: string }).id, dados_depois: { fundo_id: fundoId, codigo: codigo.trim() } })
    return { success: true, message: 'Politica criada no catalogo do fundo.', data: { id: (data as { id: string }).id } }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar politica do fundo.')
  }
}

export async function criarPoliticaOperacionalNoFundo(
  fundoId: string,
  cedenteFundoId: string,
  codigo: string,
  nome: string,
  descricao?: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  try {
    await validarFundoAtivoAutorizado(fundoId)
    if (cedenteFundoId) await validarCedenteFundoDoFundo((await requireGestor()).supabase, fundoId, cedenteFundoId)
    return criarPoliticaDoFundo(fundoId, codigo, nome, descricao)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar politica.')
  }
}

export async function criarVersaoPolitica(
  politicaId: string,
  input: CriarVersaoPoliticaInput,
): Promise<PolicyActionState & { data?: { id: string; politica_operacional_id: string; fundo_id: string; versao: number; publicada_em: string | null; vigente_desde: string } }> {
  const context = await requireGestor()
  try {
    const supabase = context.supabase
    const policyData = await loadPolicyContext(supabase, politicaId)
    if (policyData.status === 'arquivada' || policyData.status === 'desativada') return result('Nao e possivel criar versao para politica arquivada.')

    const normalized = input.requisitos.map(normalizarRequisitoDocumental)
    validarUnicidadeFamiliasLogisticas(normalized)
    const codes = new Set<string>()
    for (const requirement of normalized) {
      if (codes.has(requirement.codigo)) return result(`Requisito duplicado: ${requirement.codigo}.`)
      codes.add(requirement.codigo)
    }
    if (input.exigir_status_logistico_pre_cessao
      && !normalized.some((requirement) => requirement.ativo
        && ['pos_cessao', 'entrega'].includes(requirement.momento_obrigatorio)
        && ['cte', 'cte_xml', 'cte_pdf_dacte', 'cte_dacte_pdf', 'dacte', 'canhoto', 'comprovante_entrega', 'comprovante_de_entrega'].includes(requirement.tipo_documento_codigo))) {
      return result('O gate logistico exige ao menos um requisito oficial de CT-e/DACTE ou Comprovante de Entrega no pos-cessao.')
    }

    const { data: last, error: lastError } = await supabase
      .from('politica_operacional_versoes')
      .select('versao')
      .eq('politica_operacional_id', politicaId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastError) return result(`Erro ao consultar ultima versao: ${lastError.message}`)
    const version = ((last as { versao: number } | null)?.versao || 0) + 1
    const config = input.configuracao || {}
    if (input.limite_postergacao_upload_canhoto_dias !== null
      && (!Number.isInteger(input.limite_postergacao_upload_canhoto_dias) || input.limite_postergacao_upload_canhoto_dias <= 0)) {
      return result('O limite de postergação do canhoto deve ser um número inteiro positivo.')
    }
    const exigeCanhoto = normalized.some((requirement) => requirement.ativo
      && requirement.obrigatorio
      && ['pos_cessao', 'entrega'].includes(requirement.momento_obrigatorio)
      && ['canhoto', 'comprovante_entrega'].includes(requirement.tipo_documento_codigo))
    if (input.permite_postergacao_upload_canhoto && !exigeCanhoto) {
      return result('A postergação só pode ser habilitada quando houver canhoto obrigatório no pós-cessão.')
    }
    validarConfiguracaoPublica(config)
    const payload = { ...input, configuracao: config, requisitos: normalized }
    const hash = hashVersao(payload, normalized)
    const { data: created, error } = await supabase.from('politica_operacional_versoes').insert({
      politica_operacional_id: politicaId,
      fundo_id: policyData.fundo_id,
      versao: version,
      status: 'rascunho',
      vigente_desde: input.vigente_desde || new Date().toISOString(),
      aceite_sacado_obrigatorio: input.aceite_sacado_obrigatorio,
      cessao_no_desembolso: input.cessao_no_desembolso,
      cria_acompanhamento_entrega: input.cria_acompanhamento_entrega,
      exigir_status_logistico_pre_cessao: input.exigir_status_logistico_pre_cessao,
      permite_postergacao_upload_canhoto: input.permite_postergacao_upload_canhoto,
      limite_postergacao_upload_canhoto_dias: input.permite_postergacao_upload_canhoto
        ? input.limite_postergacao_upload_canhoto_dias
        : null,
      metodo_calculo_financeiro: input.metodo_calculo_financeiro,
      configuracao: config,
      regras: config.fluxo_operacional ? { fluxo_operacional: config.fluxo_operacional } : {},
      parametros: config,
      conteudo_hash: hash,
    } as never).select('id, politica_operacional_id, fundo_id, versao, publicada_em, vigente_desde').single()
    if (error) return result(`Erro ao criar versao: ${error.message}`)
    if (!created) return result('Erro ao criar versao: registro nao retornado pelo banco.')

    const createdVersion = created as { id: string; politica_operacional_id: string; fundo_id: string; versao: number; publicada_em: string | null; vigente_desde: string }
    const versionId = createdVersion.id
    if (normalized.length > 0) {
      const { error: requirementsError } = await supabase.from('politica_requisitos_documentais').insert(normalized.map((requirement) => ({
        ...requirement,
        politica_operacional_versao_id: versionId,
        politica_operacional_id: politicaId,
        fundo_id: policyData.fundo_id,
        momento_obrigatorio: requirement.momento_obrigatorio,
        categoria: requirement.categoria,
        bloqueia_fluxo: requirement.bloqueia_fluxo,
        observacoes: requirement.observacoes,
      })) as never[])
      if (requirementsError) {
        await supabase.from('politica_operacional_versoes').delete().eq('id', versionId)
        return result(`Erro ao criar requisitos: ${requirementsError.message}`)
      }
    }

    await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_VERSAO_CRIADA', entidade_tipo: 'politica_operacional_versoes', entidade_id: versionId, dados_depois: { politica_operacional_id: politicaId, fundo_id: policyData.fundo_id, versao: version, conteudo_hash: hash } })
    return { success: true, message: `Versao ${version} criada como rascunho.`, data: createdVersion }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Dados invalidos para a versao.')
  }
}

export async function criarVersaoPoliticaNoFundo(
  fundoId: string,
  politicaId: string,
  input: CriarVersaoPoliticaInput,
): Promise<PolicyActionState & { data?: { id: string; politica_operacional_id: string; fundo_id: string; versao: number; publicada_em: string | null; vigente_desde: string } }> {
  try {
    const context = await requireGestor()
    await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    return await criarVersaoPolitica(politicaId, input)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar versao.')
  }
}

export async function publicarVersaoPolitica(versaoId: string): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const supabase = context.supabase
    const { data: version, error: versionError } = await supabase.from('politica_operacional_versoes').select('*').eq('id', versaoId).maybeSingle()
    if (versionError) return result(`Erro ao consultar versao: ${versionError.message}`)
    if (!version) return result('Versao nao encontrada.')
    const versionData = version as { id: string; politica_operacional_id: string; fundo_id?: string | null; vigente_desde: string; publicada_em: string | null; versao: number; metodo_calculo_financeiro?: MetodoCalculoNovaPolitica | null }
    if (versionData.publicada_em) return result('Esta versao ja foi publicada.')
    if (!versionData.metodo_calculo_financeiro) return result('Selecione o metodo de calculo financeiro antes de publicar.')
    const policyContext = await loadPolicyContext(supabase, versionData.politica_operacional_id)
    if (versionData.fundo_id && policyContext.fundo_id !== versionData.fundo_id) return result('Versao de politica nao pertence ao fundo da politica.')
    const now = new Date().toISOString()

    const { error: closeError } = await supabase.from('politica_operacional_versoes')
      .update({ vigente_ate: now, status: 'substituida', substituida_em: now } as never)
      .eq('politica_operacional_id', versionData.politica_operacional_id)
      .not('publicada_em', 'is', null)
      .is('vigente_ate', null)
    if (closeError) return result(`Erro ao fechar versao anterior: ${closeError.message}`)

    const { data: published, error: publishError } = await supabase.from('politica_operacional_versoes').update({
      vigente_desde: now,
      publicada_por: context.user.id,
      publicada_em: now,
      status: 'publicada',
    } as never).eq('id', versaoId).select('id, versao, publicada_em').single()
    if (publishError) return result(`Erro ao publicar versao: ${publishError.message}`)
    if (!published) return result('Erro ao publicar versao: registro nao retornado pelo banco.')

    const { data: activated, error: activateError } = await supabase
      .from('politicas_operacionais')
      .update({ status: 'ativa' } as never)
      .eq('id', versionData.politica_operacional_id)
      .select('id, status')
      .single()
    if (activateError) return result(`Versao publicada, mas nao foi possivel ativar a politica: ${activateError.message}`)
    if (!activated) return result('Versao publicada, mas a politica ativada nao foi retornada pelo banco.')

    await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_VERSAO_PUBLICADA', entidade_tipo: 'politica_operacional_versoes', entidade_id: versaoId, dados_depois: { fundo_id: policyContext.fundo_id, versao: versionData.versao, publicada_em: now } })
    return { success: true, message: `Versao ${versionData.versao} publicada e politica ativada.` }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao.')
  }
}

export async function publicarVersaoPoliticaNoFundo(fundoId: string, versaoId: string): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await validarVersaoPoliticaDoFundo(context.supabase, fundoId, versaoId)
    return await publicarVersaoPolitica(versaoId)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao.')
  }
}

export async function desativarPolitica(politicaId: string): Promise<PolicyActionState> {
  const context = await requireGestor()
  await exigirSessaoElevada(context)
  const supabase = await createClient()
  const { error } = await supabase.from('politicas_operacionais').update({ status: 'desativada' } as never).eq('id', politicaId)
  if (error) return result(`Erro ao desativar politica: ${error.message}`)
  await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_DESATIVADA', entidade_tipo: 'politicas_operacionais', entidade_id: politicaId, dados_depois: { status: 'desativada' } })
  return { success: true, message: 'Politica desativada.' }
}

export async function desativarPoliticaNoFundo(fundoId: string, politicaId: string): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    return desativarPolitica(politicaId)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao desativar politica.')
  }
}

export async function definirPoliticaPadrao(fundoId: string, politicaId: string): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    const policy = await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    if (policy.status !== 'ativa') return result('Somente politicas ativas podem ser definidas como padrao.')

    const { error: clearError } = await context.supabase.from('politicas_operacionais').update({ padrao: false } as never).eq('fundo_id', fundoId).eq('padrao', true)
    if (clearError) return result(`Erro ao limpar politica padrao anterior: ${clearError.message}`)

    const { error } = await context.supabase.from('politicas_operacionais').update({ padrao: true } as never).eq('id', politicaId).eq('fundo_id', fundoId)
    if (error) return result(`Erro ao definir politica padrao: ${error.message}`)

    await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_PADRAO_DEFINIDA', entidade_tipo: 'politicas_operacionais', entidade_id: politicaId, dados_depois: { fundo_id: fundoId } })
    return { success: true, message: 'Politica definida como padrao do fundo.' }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao definir politica padrao.')
  }
}

export async function duplicarPoliticaDoFundo(
  fundoId: string,
  politicaId: string,
  novoCodigo: string,
  novoNome: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    if (!novoCodigo.trim() || !novoNome.trim()) return result('Codigo e nome da nova politica sao obrigatorios.')

    const { data: basePolicy, error: policyError } = await context.supabase
      .from('politicas_operacionais')
      .select('id, descricao')
      .eq('id', politicaId)
      .single()
    if (policyError || !basePolicy) return result(`Erro ao consultar politica base: ${policyError?.message || 'registro nao retornado'}`)

    const { data: createdPolicy, error: createError } = await context.supabase
      .from('politicas_operacionais')
      .insert({
        fundo_id: fundoId,
        codigo: novoCodigo.trim(),
        nome: novoNome.trim(),
        descricao: (basePolicy as { descricao?: string | null }).descricao ?? null,
        status: 'rascunho',
        padrao: false,
        created_by: context.user.id,
      } as never)
      .select('id')
      .single()
    if (createError || !createdPolicy) return result(`Erro ao duplicar politica: ${createError?.message || 'registro nao retornado'}`)

    const newPolicyId = (createdPolicy as { id: string }).id
    const { data: baseVersion, error: versionError } = await context.supabase
      .from('politica_operacional_versoes')
      .select('*')
      .eq('politica_operacional_id', politicaId)
      .not('publicada_em', 'is', null)
      .is('vigente_ate', null)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (versionError) return result(`Politica duplicada, mas nao foi possivel consultar versao base: ${versionError.message}`)
    if (baseVersion) {
      const base = baseVersion as {
        id: string
        aceite_sacado_obrigatorio: boolean
        cessao_no_desembolso: boolean
        cria_acompanhamento_entrega: boolean
        exigir_status_logistico_pre_cessao: boolean
        permite_postergacao_upload_canhoto: boolean
        limite_postergacao_upload_canhoto_dias: number | null
        metodo_calculo_financeiro: MetodoCalculoNovaPolitica | null
        configuracao: Record<string, unknown>
      }
      const { data: baseRequirements, error: requirementsError } = await context.supabase
        .from('politica_requisitos_documentais')
        .select('*')
        .eq('politica_operacional_versao_id', base.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true })
      if (requirementsError) return result(`Politica duplicada, mas nao foi possivel consultar requisitos base: ${requirementsError.message}`)

      const requisitos = ((baseRequirements || []) as Array<Record<string, unknown>>)
        .map(normalizarRequisitoLegadoParaEdicao)

      const versionResult = await criarVersaoPolitica(newPolicyId, {
        aceite_sacado_obrigatorio: base.aceite_sacado_obrigatorio,
        cessao_no_desembolso: base.cessao_no_desembolso,
        cria_acompanhamento_entrega: base.cria_acompanhamento_entrega,
        exigir_status_logistico_pre_cessao: base.exigir_status_logistico_pre_cessao,
        permite_postergacao_upload_canhoto: base.permite_postergacao_upload_canhoto,
        limite_postergacao_upload_canhoto_dias: base.limite_postergacao_upload_canhoto_dias,
        metodo_calculo_financeiro: base.metodo_calculo_financeiro,
        configuracao: base.configuracao || {},
        requisitos,
      })
      if (!versionResult.success) return result(`Politica duplicada, mas a versao inicial falhou: ${versionResult.message}`)
    }

    await registrarLog({
      tipo_evento: 'POLITICA_OPERACIONAL_DUPLICADA',
      entidade_tipo: 'politicas_operacionais',
      entidade_id: newPolicyId,
      dados_depois: { fundo_id: fundoId, politica_origem_id: politicaId, codigo: novoCodigo.trim() },
    })
    return { success: true, message: 'Politica duplicada como rascunho no catalogo do fundo.', data: { id: newPolicyId } }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao duplicar politica.')
  }
}

export async function arquivarPoliticaDoFundo(
  fundoId: string,
  politicaId: string,
  motivo?: string,
): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)

    const { count, error: countError } = await context.supabase
      .from('cedente_fundo_politicas')
      .select('id', { count: 'exact', head: true })
      .eq('politica_operacional_id', politicaId)
      .eq('status', 'ativa')
      .is('vigente_ate', null)
    if (countError) return result(`Erro ao validar vinculos ativos: ${countError.message}`)
    if ((count || 0) > 0) return result('Nao e possivel arquivar politica com cedentes vinculados ativamente.')

    const { error } = await context.supabase
      .from('politicas_operacionais')
      .update({ status: 'arquivada', padrao: false } as never)
      .eq('id', politicaId)
      .eq('fundo_id', fundoId)
    if (error) return result(`Erro ao arquivar politica: ${error.message}`)

    await registrarLog({
      tipo_evento: 'POLITICA_OPERACIONAL_ARQUIVADA',
      entidade_tipo: 'politicas_operacionais',
      entidade_id: politicaId,
      dados_depois: { fundo_id: fundoId, motivo: motivo || null },
    })
    return { success: true, message: 'Politica arquivada.' }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao arquivar politica.')
  }
}

export async function vincularPoliticaAoCedenteFundo(
  fundoId: string,
  cedenteFundoId: string,
  politicaId: string,
  vigenteDesde?: string,
  motivo?: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    await validarCedenteFundoDoFundo(context.supabase, fundoId, cedenteFundoId)
    const policy = await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    if (policy.status !== 'ativa') return result('Somente politicas ativas e publicadas podem ser vinculadas.')

    const { data: publishedVersion, error: versionError } = await context.supabase
      .from('politica_operacional_versoes')
      .select('id')
      .eq('politica_operacional_id', politicaId)
      .not('publicada_em', 'is', null)
      .is('vigente_ate', null)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (versionError) return result(`Erro ao validar versao publicada: ${versionError.message}`)
    if (!publishedVersion) return result('A politica selecionada nao possui versao publicada vigente.')

    const now = new Date().toISOString()
    const effectiveSince = vigenteDesde || now
    const { error: closeError } = await context.supabase
      .from('cedente_fundo_politicas')
      .update({ status: 'encerrada', vigente_ate: effectiveSince } as never)
      .eq('cedente_fundo_id', cedenteFundoId)
      .eq('status', 'ativa')
      .is('vigente_ate', null)
    if (closeError) return result(`Erro ao encerrar politica anterior: ${closeError.message}`)

    const { data, error } = await context.supabase.from('cedente_fundo_politicas').insert({
      cedente_fundo_id: cedenteFundoId,
      politica_operacional_id: politicaId,
      status: 'ativa',
      vigente_desde: effectiveSince,
      atribuido_por: context.user.id,
      motivo: motivo?.trim() || null,
    } as never).select('id').single()

    if (error || !data) return result(`Erro ao vincular politica: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({
      tipo_evento: 'POLITICA_OPERACIONAL_VINCULADA_CEDENTE',
      entidade_tipo: 'cedente_fundo_politicas',
      entidade_id: (data as { id: string }).id,
      dados_depois: { fundo_id: fundoId, cedente_fundo_id: cedenteFundoId, politica_operacional_id: politicaId, vigente_desde: effectiveSince, motivo: motivo || null },
    })
    return { success: true, message: 'Politica vinculada ao cedente. Novas operacoes ja usarao esta configuracao.', data: { id: (data as { id: string }).id } }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao vincular politica ao cedente.')
  }
}

export async function vincularPoliticaEmLote(
  fundoId: string,
  cedenteFundoIds: string[],
  politicaId: string,
  vigenteDesde?: string,
  motivo?: string,
): Promise<PolicyActionState & { vinculados?: number; erros?: Array<{ cedente_fundo_id: string; erro: string }> }> {
  try {
    const ids = [...new Set(cedenteFundoIds.filter(Boolean))]
    if (ids.length === 0) return result('Selecione ao menos um cedente para aplicar a politica.')

    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    const policy = await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    if (policy.status !== 'ativa') return result('Somente politicas ativas e publicadas podem ser vinculadas em lote.')

    const erros: Array<{ cedente_fundo_id: string; erro: string }> = []
    let vinculados = 0
    for (const cedenteFundoId of ids) {
      const item = await vincularPoliticaAoCedenteFundo(fundoId, cedenteFundoId, politicaId, vigenteDesde, motivo)
      if (item.success) vinculados += 1
      else erros.push({ cedente_fundo_id: cedenteFundoId, erro: item.message || 'Falha ao vincular politica.' })
    }

    await registrarLog({
      tipo_evento: 'POLITICA_OPERACIONAL_APLICACAO_LOTE',
      entidade_tipo: 'politicas_operacionais',
      entidade_id: politicaId,
      dados_depois: { fundo_id: fundoId, cedente_fundo_ids: ids, vinculados, erros: erros.length },
    })

    if (erros.length > 0) return { success: vinculados > 0, message: `${vinculados} vinculo(s) atualizado(s), ${erros.length} erro(s).`, vinculados, erros }
    return { success: true, message: `${vinculados} vinculo(s) atualizado(s).`, vinculados, erros: [] }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Erro ao aplicar politica em lote.', vinculados: 0, erros: [] }
  }
}

export async function encerrarVinculoPolitica(
  fundoId: string,
  cedenteFundoPoliticaId: string,
  motivo?: string,
): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await validarFundoAtivoAutorizado(fundoId)
    const now = new Date().toISOString()
    const { data, error } = await context.supabase
      .from('cedente_fundo_politicas')
      .update({ status: 'encerrada', vigente_ate: now, motivo: motivo?.trim() || null } as never)
      .eq('id', cedenteFundoPoliticaId)
      .select('id, cedente_fundo_id, politica_operacional_id')
      .single()
    if (error || !data) return result(`Erro ao encerrar vinculo de politica: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_VINCULO_ENCERRADO', entidade_tipo: 'cedente_fundo_politicas', entidade_id: cedenteFundoPoliticaId, dados_depois: { fundo_id: fundoId, motivo: motivo || null } })
    return { success: true, message: 'Vinculo de politica encerrado. O cedente fica pendente para novas operacoes.' }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao encerrar vinculo de politica.')
  }
}
