import type { PoliticaRequisitoInput } from '@/lib/actions/politica'
import type { PoliticaTipoDocumentoCodigo } from '@/lib/types/domain'

export type AceiteSacadoOption = 'nao_exigido' | 'antes_cessao' | 'antes_desembolso'
export type MomentoCessaoOption = 'aprovacao' | 'assinatura' | 'desembolso'
export type AcompanhamentoEntregaOption = 'nao_aplicavel' | 'apos_desembolso' | 'antes_liberacao_definitiva'

export interface PoliticaOperationalSelections {
  aceiteSacado: AceiteSacadoOption
  momentoCessao: MomentoCessaoOption
  acompanhamentoEntrega: AcompanhamentoEntregaOption
}

export interface PoliticaLegacyFlags {
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
}

export interface PoliticaVersionStateInput {
  id: string
  versao: number
  publicada_em: string | null
  vigente_ate?: string | null
}

export type PoliticaDisplayState = 'sem_versao' | 'preparacao' | 'vigente' | 'historico'

export const policyDocumentOptions: Array<{ value: PoliticaTipoDocumentoCodigo; label: string; formatos: string[] }> = [
  { value: 'nf_xml', label: 'XML da nota fiscal', formatos: ['xml'] },
  { value: 'nf_danfe_pdf', label: 'DANFE', formatos: ['pdf'] },
  { value: 'nf_pedido_compra', label: 'Pedido de compra', formatos: ['pdf'] },
  { value: 'contrato', label: 'Contrato', formatos: ['pdf'] },
  { value: 'comprovante_entrega', label: 'Comprovante de entrega', formatos: ['pdf', 'jpg', 'png'] },
  { value: 'canhoto', label: 'Canhoto', formatos: ['pdf', 'jpg', 'png'] },
  { value: 'cte', label: 'CT-e', formatos: ['xml', 'pdf'] },
  { value: 'boleto', label: 'Boleto', formatos: ['pdf'] },
  { value: 'duplicata', label: 'Duplicata', formatos: ['pdf'] },
  { value: 'comprovante_aceite', label: 'Comprovante de aceite', formatos: ['pdf'] },
  { value: 'outro', label: 'Outro', formatos: ['pdf'] },
]

export const policyScopeLabels: Record<PoliticaRequisitoInput['escopo'], string> = {
  nf_pre_cessao: 'NF pré-cessão',
  operacao: 'Operação',
  pos_cessao: 'Pós-cessão',
  entrega: 'Entrega',
}

export const policyResponsibleLabels: Record<PoliticaRequisitoInput['responsavel_upload'], string> = {
  cedente: 'Cedente',
  gestor: 'Gestor',
  sacado: 'Sacado',
  sistema: 'Sistema',
}

export const policyValidationLabels: Record<NonNullable<PoliticaRequisitoInput['nivel_validacao']>, string> = {
  estrutural: 'Validação estrutural',
  manual: 'Validação manual',
  hibrido: 'Validação híbrida',
}

export function createPolicyInternalCode(cedenteFundoId: string) {
  const suffix = cedenteFundoId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase() || 'vinculo'
  return `politica_${suffix}`
}

export function mapOperationalSelectionsToLegacyFlags(selections: PoliticaOperationalSelections): PoliticaLegacyFlags {
  return {
    aceite_sacado_obrigatorio: selections.aceiteSacado !== 'nao_exigido',
    cessao_no_desembolso: selections.momentoCessao === 'desembolso',
    cria_acompanhamento_entrega: selections.acompanhamentoEntrega !== 'nao_aplicavel',
  }
}

export function mapLegacyFlagsToOperationalSelections(flags: PoliticaLegacyFlags): PoliticaOperationalSelections {
  return {
    aceiteSacado: flags.aceite_sacado_obrigatorio ? 'antes_cessao' : 'nao_exigido',
    momentoCessao: flags.cessao_no_desembolso ? 'desembolso' : 'aprovacao',
    acompanhamentoEntrega: flags.cria_acompanhamento_entrega ? 'apos_desembolso' : 'nao_aplicavel',
  }
}

export function describeAceiteSacado(value: AceiteSacadoOption) {
  if (value === 'nao_exigido') return 'Não exigido'
  if (value === 'antes_desembolso') return 'Exigido antes do desembolso'
  return 'Exigido antes da cessão'
}

export function describeMomentoCessao(value: MomentoCessaoOption) {
  if (value === 'assinatura') return 'Na assinatura'
  if (value === 'desembolso') return 'No desembolso'
  return 'Na aprovação'
}

export function describeAcompanhamentoEntrega(value: AcompanhamentoEntregaOption) {
  if (value === 'apos_desembolso') return 'Obrigatório após desembolso'
  if (value === 'antes_liberacao_definitiva') return 'Obrigatório antes da liberação definitiva'
  return 'Não aplicável'
}

export function documentLabel(code: string) {
  return policyDocumentOptions.find((option) => option.value === code)?.label || code
}

export function derivePoliticaVersionState<T extends PoliticaVersionStateInput>(versions: T[]) {
  const historico = [...versions].sort((a, b) => b.versao - a.versao)
  const versaoPublicada = historico.find((version) => version.publicada_em && !version.vigente_ate) || null
  const versaoRascunho = historico.find((version) => !version.publicada_em) || null

  return {
    historico,
    versaoPublicada,
    versaoRascunho,
    possuiVersoes: historico.length > 0,
  }
}

export function getPoliticaDisplayState(state: { possuiVersoes: boolean; versaoPublicada: unknown | null; versaoRascunho: unknown | null }): PoliticaDisplayState {
  if (!state.possuiVersoes) return 'sem_versao'
  if (state.versaoPublicada) return 'vigente'
  if (state.versaoRascunho) return 'preparacao'
  return 'historico'
}

export function shouldCloseVersionModalAfterCreate(result: { success?: boolean; data?: unknown; message?: string } | undefined | null) {
  return Boolean(result?.success && result.data)
}

export function shouldClosePublishModal(result: { success?: boolean; message?: string } | undefined | null) {
  return Boolean(result?.success)
}
