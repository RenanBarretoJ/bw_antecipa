export const FAMILIAS_DOCUMENTAIS_LOGISTICAS = ['cte', 'comprovante_entrega'] as const

export type FamiliaDocumentalLogistica = (typeof FAMILIAS_DOCUMENTAIS_LOGISTICAS)[number]
export type StatusLogisticoPreCessao = 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA'

const CODIGOS_POR_FAMILIA: Record<FamiliaDocumentalLogistica, readonly string[]> = {
  cte: ['cte', 'cte_xml', 'cte_pdf_dacte', 'cte_dacte_pdf', 'dacte'],
  comprovante_entrega: ['canhoto', 'comprovante_entrega', 'comprovante_de_entrega'],
}

const FAMILIA_POR_CODIGO = new Map<string, FamiliaDocumentalLogistica>(
  Object.entries(CODIGOS_POR_FAMILIA).flatMap(([familia, codigos]) =>
    codigos.map((codigo) => [codigo, familia as FamiliaDocumentalLogistica] as const),
  ),
)

export interface EvidenciaLogisticaParaClassificacao {
  familia: FamiliaDocumentalLogistica
  documentoId: string
  versaoId: string
  versaoStatus: string
  analiseId?: string | null
  analiseResultado?: string | null
  analisadoEm?: string | null
  analisadoPor?: string | null
  /** Data de criacao da versao/evidencia -- usado para achar a mais recente por upload, nao por analise. */
  criadoEm?: string | null
}

export interface ClassificacaoLogisticaPreCessao {
  status: StatusLogisticoPreCessao
  familiaVencedora: FamiliaDocumentalLogistica | null
  documentoId: string | null
  versaoId: string | null
  analiseId: string | null
  analisadoEm: string | null
  analisadoPor: string | null
  fundamento: 'comprovante_entrega_aprovado' | 'cte_aprovado' | 'sem_evidencia_aprovada'
  versaoResolvedor: 1
}

export interface RequisitoComFamilia {
  codigo?: string
  tipo_documento_codigo: string
  ativo?: boolean
}

export function resolverFamiliaDocumentalLogistica(codigo: string | null | undefined): FamiliaDocumentalLogistica | null {
  return FAMILIA_POR_CODIGO.get(String(codigo || '').trim().toLowerCase()) ?? null
}

export function codigosDaFamiliaLogistica(familia: FamiliaDocumentalLogistica): readonly string[] {
  return CODIGOS_POR_FAMILIA[familia]
}

export function requisitoEhLogistico(requisito: Pick<RequisitoComFamilia, 'tipo_documento_codigo'>): boolean {
  return resolverFamiliaDocumentalLogistica(requisito.tipo_documento_codigo) !== null
}

export function validarUnicidadeFamiliasLogisticas(requisitos: RequisitoComFamilia[]): void {
  const vistos = new Map<FamiliaDocumentalLogistica, string>()

  for (const requisito of requisitos) {
    if (requisito.ativo === false) continue
    const familia = resolverFamiliaDocumentalLogistica(requisito.tipo_documento_codigo)
    if (!familia) continue
    const anterior = vistos.get(familia)
    if (anterior) {
      throw new Error(
        `A familia documental ${familia === 'cte' ? 'CT-e/DACTE' : 'Comprovante de Entrega'} foi configurada mais de uma vez (${anterior} e ${requisito.codigo || requisito.tipo_documento_codigo}).`,
      )
    }
    vistos.set(familia, requisito.codigo || requisito.tipo_documento_codigo)
  }
}

function evidenciaAprovada(evidencia: EvidenciaLogisticaParaClassificacao): boolean {
  return evidencia.versaoStatus === 'aprovado' || evidencia.analiseResultado === 'aprovado'
}

function maisRecente(evidencias: EvidenciaLogisticaParaClassificacao[]): EvidenciaLogisticaParaClassificacao | null {
  return [...evidencias].sort((a, b) =>
    String(b.analisadoEm || '').localeCompare(String(a.analisadoEm || ''))
    || b.versaoId.localeCompare(a.versaoId),
  )[0] ?? null
}

export function classificarStatusLogisticoPreCessao(
  evidencias: EvidenciaLogisticaParaClassificacao[],
): ClassificacaoLogisticaPreCessao {
  const aprovadas = evidencias.filter(evidenciaAprovada)
  const comprovante = maisRecente(aprovadas.filter((item) => item.familia === 'comprovante_entrega'))
  const vencedora = comprovante ?? maisRecente(aprovadas.filter((item) => item.familia === 'cte'))

  if (!vencedora) {
    return {
      status: 'INDETERMINADA',
      familiaVencedora: null,
      documentoId: null,
      versaoId: null,
      analiseId: null,
      analisadoEm: null,
      analisadoPor: null,
      fundamento: 'sem_evidencia_aprovada',
      versaoResolvedor: 1,
    }
  }

  return {
    status: vencedora.familia === 'comprovante_entrega' ? 'ENTREGUE' : 'EM_TRANSITO',
    familiaVencedora: vencedora.familia,
    documentoId: vencedora.documentoId,
    versaoId: vencedora.versaoId,
    analiseId: vencedora.analiseId ?? null,
    analisadoEm: vencedora.analisadoEm ?? null,
    analisadoPor: vencedora.analisadoPor ?? null,
    fundamento: vencedora.familia === 'comprovante_entrega' ? 'comprovante_entrega_aprovado' : 'cte_aprovado',
    versaoResolvedor: 1,
  }
}

export function avaliarGateLogisticoPreCessao(input: {
  exigirStatusLogistico: boolean
  classificacao: Pick<ClassificacaoLogisticaPreCessao, 'status'>
}) {
  const permitido = !input.exigirStatusLogistico || input.classificacao.status !== 'INDETERMINADA'
  return {
    permitido,
    motivo: permitido
      ? null
      : 'A politica exige CT-e/DACTE ou Comprovante de Entrega aprovado antes da cessao.',
  }
}

function evidenciaVigente(evidencia: EvidenciaLogisticaParaClassificacao): boolean {
  if (evidencia.analiseResultado === 'rejeitado' || evidencia.analiseResultado === 'requer_ajuste') return false
  return ['enviado', 'em_analise', 'aprovado'].includes(evidencia.versaoStatus)
}

function maisRecentePorUpload(evidencias: EvidenciaLogisticaParaClassificacao[]): EvidenciaLogisticaParaClassificacao | null {
  return [...evidencias].sort((a, b) =>
    String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''))
    || b.versaoId.localeCompare(a.versaoId),
  )[0] ?? null
}

/**
 * Gate de SUBMISSAO pelo cedente: diferente da aprovacao pela gestora
 * (que exige evidencia aprovada, ver classificarStatusLogisticoPreCessao),
 * a submissao so exige que exista uma evidencia VIGENTE (enviada, em
 * analise ou aprovada) para uma das familias alternativas (CT-e/DACTE OU
 * Comprovante de Entrega). Considera a versao mais recente por upload
 * (nao por analise) de cada familia -- uma rejeicao antiga com reenvio
 * pendente nao deve bloquear a submissao.
 */
export function avaliarSubmissaoLogisticaPreCessao(input: {
  exigido: boolean
  evidencias: EvidenciaLogisticaParaClassificacao[]
}): { permitido: boolean; motivo: string | null } {
  if (!input.exigido) return { permitido: true, motivo: null }

  const porFamilia = new Map<FamiliaDocumentalLogistica, EvidenciaLogisticaParaClassificacao[]>()
  for (const evidencia of input.evidencias) {
    const atuais = porFamilia.get(evidencia.familia) || []
    atuais.push(evidencia)
    porFamilia.set(evidencia.familia, atuais)
  }

  const permitido = [...porFamilia.values()].some((evidenciasDaFamilia) => {
    const recente = maisRecentePorUpload(evidenciasDaFamilia)
    return Boolean(recente && evidenciaVigente(recente))
  })

  return {
    permitido,
    motivo: permitido
      ? null
      : 'A politica exige o envio de CT-e/DACTE ou Comprovante de Entrega antes da submissao.',
  }
}
