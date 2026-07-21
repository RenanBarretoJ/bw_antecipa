'use server'

import { createHash } from 'node:crypto'
import { requireGestor } from '@/lib/auth/authorization'
import { createClient } from '@/lib/supabase/server'
import {
  POLICY_DOCUMENT_CODES,
  POLICY_REQUIREMENT_SCOPES,
  POLICY_RESPONSIBLES,
  POLICY_VALIDATION_LEVELS,
  type PoliticaNivelValidacao,
  type PoliticaRequisitoEscopo,
  type PoliticaResponsavel,
  type PoliticaTipoDocumentoCodigo,
} from '@/lib/types/domain'
import { stableStringify, validarConfiguracaoPublica } from '@/lib/operacoes/politica'
import { registrarLog } from './auditoria'

type PolicyActionState = { success?: boolean; message?: string }

export interface PoliticaRequisitoInput {
  codigo: string
  escopo: PoliticaRequisitoEscopo
  tipo_documento_codigo: PoliticaTipoDocumentoCodigo
  obrigatorio?: boolean
  quantidade_minima?: number
  formatos_aceitos?: string[]
  nivel_validacao?: PoliticaNivelValidacao
  prazo_dias_corridos?: number | null
  responsavel_upload: PoliticaResponsavel
  responsavel_aprovacao: PoliticaResponsavel
  ordem?: number
  ativo?: boolean
}

export interface CriarVersaoPoliticaInput {
  vigente_desde?: string
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  configuracao?: Record<string, unknown>
  requisitos: PoliticaRequisitoInput[]
}

function result(message: string, success = false): PolicyActionState {
  return { success, message }
}

function validEnum<T extends string>(value: string, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`${label} invalido.`)
  return value as T
}

function normalizeRequirement(input: PoliticaRequisitoInput, index: number) {
  const codigo = input.codigo.trim()
  if (!codigo) throw new Error(`O codigo do requisito ${index + 1} e obrigatorio.`)
  if (codigo.length > 80) throw new Error(`O codigo do requisito ${index + 1} excede 80 caracteres.`)

  const quantidade = input.quantidade_minima ?? 1
  if (!Number.isInteger(quantidade) || quantidade < 1) throw new Error(`Quantidade invalida no requisito ${codigo}.`)

  const prazo = input.prazo_dias_corridos ?? null
  if (prazo !== null && (!Number.isInteger(prazo) || prazo < 0)) throw new Error(`Prazo invalido no requisito ${codigo}.`)

  return {
    codigo,
    escopo: validEnum(input.escopo, POLICY_REQUIREMENT_SCOPES, `Escopo do requisito ${codigo}`),
    tipo_documento_codigo: validEnum(input.tipo_documento_codigo, POLICY_DOCUMENT_CODES, `Tipo documental do requisito ${codigo}`),
    obrigatorio: input.obrigatorio ?? true,
    quantidade_minima: quantidade,
    formatos_aceitos: [...new Set((input.formatos_aceitos || []).map((format) => format.trim().toLowerCase()).filter(Boolean))],
    nivel_validacao: validEnum(input.nivel_validacao || 'manual', POLICY_VALIDATION_LEVELS, `Nivel de validacao do requisito ${codigo}`),
    prazo_dias_corridos: prazo,
    responsavel_upload: validEnum(input.responsavel_upload, POLICY_RESPONSIBLES, `Responsavel pelo upload do requisito ${codigo}`),
    responsavel_aprovacao: validEnum(input.responsavel_aprovacao, POLICY_RESPONSIBLES, `Responsavel pela aprovacao do requisito ${codigo}`),
    ordem: input.ordem ?? index,
    ativo: input.ativo ?? true,
  }
}

function hashVersao(input: CriarVersaoPoliticaInput, requisitos: ReturnType<typeof normalizeRequirement>[]): string {
  return createHash('sha256').update(stableStringify({
    aceite_sacado_obrigatorio: input.aceite_sacado_obrigatorio,
    cessao_no_desembolso: input.cessao_no_desembolso,
    cria_acompanhamento_entrega: input.cria_acompanhamento_entrega,
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

async function validarPoliticaDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, politicaId: string) {
  const { data, error } = await supabase
    .from('politicas_operacionais')
    .select('id, cedente_fundo_id, link:cedente_fundos(fundo_id)')
    .eq('id', politicaId)
    .maybeSingle()
  const policy = data as unknown as { cedente_fundo_id: string; link: { fundo_id: string } | null } | null
  if (error || policy?.link?.fundo_id !== fundoId) throw new Error('Politica nao pertence ao fundo informado.')
  return policy
}

async function validarVersaoPoliticaDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, versaoId: string) {
  const { data, error } = await supabase
    .from('politica_operacional_versoes')
    .select('id, politica_operacional_id, cedente_fundo_id, link:cedente_fundos(fundo_id)')
    .eq('id', versaoId)
    .maybeSingle()
  const version = data as unknown as { link: { fundo_id: string } | null } | null
  if (error || version?.link?.fundo_id !== fundoId) throw new Error('Versao de politica nao pertence ao fundo informado.')
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
    .select('id, status')
    .eq('id', cedenteFundoId)
    .maybeSingle()
  if (!link) return result('Vinculo cedente-fundo nao encontrado.')
  if ((link as { status: string }).status !== 'ativo') return result('A politica so pode ser criada para um vinculo ativo.')

  const { data, error } = await supabase.from('politicas_operacionais').insert({
    cedente_fundo_id: cedenteFundoId,
    codigo: codigo.trim(),
    nome: nome.trim(),
    descricao: descricao?.trim() || null,
    status: 'rascunho',
    created_by: context.user.id,
  } as never).select('id').single()

  if (error || !data) return result(`Erro ao criar politica: ${error?.message || 'registro nao retornado'}`)
  await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_CRIADA', entidade_tipo: 'politicas_operacionais', entidade_id: (data as { id: string }).id, dados_depois: { cedente_fundo_id: cedenteFundoId, codigo: codigo.trim() } })
  return { success: true, message: 'Politica criada como rascunho.', data: { id: (data as { id: string }).id } }
}

export async function criarPoliticaOperacionalNoFundo(
  fundoId: string,
  cedenteFundoId: string,
  codigo: string,
  nome: string,
  descricao?: string,
): Promise<PolicyActionState & { data?: { id: string } }> {
  try {
    const context = await requireGestor()
    await validarCedenteFundoDoFundo(context.supabase, fundoId, cedenteFundoId)
    return criarPoliticaOperacional(cedenteFundoId, codigo, nome, descricao)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar politica.')
  }
}

export async function criarVersaoPolitica(
  politicaId: string,
  input: CriarVersaoPoliticaInput,
): Promise<PolicyActionState & { data?: { id: string; versao: number } }> {
  const context = await requireGestor()
  try {
    const supabase = context.supabase
    const { data: policy } = await supabase.from('politicas_operacionais').select('id, cedente_fundo_id, status').eq('id', politicaId).maybeSingle()
    if (!policy) return result('Politica nao encontrada.')

    const policyData = policy as { id: string; cedente_fundo_id: string; status: string }
    if (policyData.status === 'desativada') return result('Nao e possivel criar versao para politica desativada.')
    const { data: link } = await supabase.from('cedente_fundos').select('id, status').eq('id', policyData.cedente_fundo_id).maybeSingle()
    if (!link || (link as { status: string }).status !== 'ativo') return result('O vinculo cedente-fundo precisa estar ativo.')

    const normalized = input.requisitos.map(normalizeRequirement)
    const codes = new Set<string>()
    for (const requirement of normalized) {
      if (codes.has(requirement.codigo)) return result(`Requisito duplicado: ${requirement.codigo}.`)
      codes.add(requirement.codigo)
    }

    const { data: last } = await supabase.from('politica_operacional_versoes').select('versao').eq('politica_operacional_id', politicaId).order('versao', { ascending: false }).limit(1).maybeSingle()
    const version = ((last as { versao: number } | null)?.versao || 0) + 1
    const config = input.configuracao || {}
    validarConfiguracaoPublica(config)
    const payload = { ...input, configuracao: config, requisitos: normalized }
    const hash = hashVersao(payload, normalized)
    const { data: created, error } = await supabase.from('politica_operacional_versoes').insert({
      politica_operacional_id: politicaId,
      cedente_fundo_id: policyData.cedente_fundo_id,
      versao: version,
      vigente_desde: input.vigente_desde || new Date().toISOString(),
      aceite_sacado_obrigatorio: input.aceite_sacado_obrigatorio,
      cessao_no_desembolso: input.cessao_no_desembolso,
      cria_acompanhamento_entrega: input.cria_acompanhamento_entrega,
      configuracao: config,
      conteudo_hash: hash,
    } as never).select('id').single()
    if (error || !created) return result(`Erro ao criar versao: ${error?.message || 'registro nao retornado'}`)

    const versionId = (created as { id: string }).id
    if (normalized.length > 0) {
      const { error: requirementsError } = await supabase.from('politica_requisitos_documentais').insert(normalized.map((requirement) => ({
        ...requirement,
        politica_operacional_versao_id: versionId,
        politica_operacional_id: politicaId,
        cedente_fundo_id: policyData.cedente_fundo_id,
      })) as never[])
      if (requirementsError) {
        await supabase.from('politica_operacional_versoes').delete().eq('id', versionId)
        return result(`Erro ao criar requisitos: ${requirementsError.message}`)
      }
    }

    await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_VERSAO_CRIADA', entidade_tipo: 'politica_operacional_versoes', entidade_id: versionId, dados_depois: { politica_operacional_id: politicaId, versao: version, conteudo_hash: hash } })
    return { success: true, message: `Versao ${version} criada como rascunho.`, data: { id: versionId, versao: version } }
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Dados invalidos para a versao.')
  }
}

export async function criarVersaoPoliticaNoFundo(
  fundoId: string,
  politicaId: string,
  input: CriarVersaoPoliticaInput,
): Promise<PolicyActionState & { data?: { id: string; versao: number } }> {
  try {
    const context = await requireGestor()
    await validarPoliticaDoFundo(context.supabase, fundoId, politicaId)
    return criarVersaoPolitica(politicaId, input)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar versao.')
  }
}

export async function publicarVersaoPolitica(versaoId: string): Promise<PolicyActionState> {
  const context = await requireGestor()
  const supabase = context.supabase
  const { data: version } = await supabase.from('politica_operacional_versoes').select('*').eq('id', versaoId).maybeSingle()
  if (!version) return result('Versao nao encontrada.')
  const versionData = version as { id: string; politica_operacional_id: string; cedente_fundo_id: string; vigente_desde: string; publicada_em: string | null; versao: number }
  if (versionData.publicada_em) return result('Esta versao ja foi publicada.')

  const { data: link } = await supabase.from('cedente_fundos').select('status').eq('id', versionData.cedente_fundo_id).maybeSingle()
  if (!link || (link as { status: string }).status !== 'ativo') return result('O vinculo cedente-fundo precisa estar ativo.')
  const now = new Date().toISOString()

  const { error: closeError } = await supabase.from('politica_operacional_versoes')
    .update({ vigente_ate: now } as never)
    .eq('politica_operacional_id', versionData.politica_operacional_id)
    .not('publicada_em', 'is', null)
    .is('vigente_ate', null)
  if (closeError) return result(`Erro ao fechar versao anterior: ${closeError.message}`)

  const { error: publishError } = await supabase.from('politica_operacional_versoes').update({
    vigente_desde: now,
    publicada_por: context.user.id,
    publicada_em: now,
  } as never).eq('id', versaoId)
  if (publishError) return result(`Erro ao publicar versao: ${publishError.message}`)

  const { error: deactivateError } = await supabase.from('politicas_operacionais').update({ status: 'desativada' } as never)
    .eq('cedente_fundo_id', versionData.cedente_fundo_id)
    .neq('id', versionData.politica_operacional_id)
    .eq('status', 'ativa')
  if (deactivateError) return result(`Versao publicada, mas nao foi possivel desativar politica anterior: ${deactivateError.message}`)
  const { error: activateError } = await supabase.from('politicas_operacionais').update({ status: 'ativa' } as never).eq('id', versionData.politica_operacional_id)
  if (activateError) return result(`Versao publicada, mas nao foi possivel ativar a politica: ${activateError.message}`)

  await registrarLog({ tipo_evento: 'POLITICA_OPERACIONAL_VERSAO_PUBLICADA', entidade_tipo: 'politica_operacional_versoes', entidade_id: versaoId, dados_depois: { versao: versionData.versao, publicada_em: now } })
  return { success: true, message: `Versao ${versionData.versao} publicada e politica ativada.` }
}

export async function publicarVersaoPoliticaNoFundo(fundoId: string, versaoId: string): Promise<PolicyActionState> {
  try {
    const context = await requireGestor()
    await validarVersaoPoliticaDoFundo(context.supabase, fundoId, versaoId)
    return publicarVersaoPolitica(versaoId)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao.')
  }
}

export async function desativarPolitica(politicaId: string): Promise<PolicyActionState> {
  await requireGestor()
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
