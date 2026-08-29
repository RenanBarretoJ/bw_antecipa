export type EtapaOperacaoStatus = 'concluida' | 'atual' | 'pendente' | 'bloqueada' | 'rejeitada'

export interface CapabilitiesOperacao {
  exigeAceiteSacado: boolean
  usaAcompanhamentoLogistico: boolean
  exigeCteXml: boolean
  exigeDacte: boolean
  exigeCanhoto: boolean
  exigeComprovanteEntrega: boolean
  usaEscrow: boolean
  exigeNotificacaoSacado: boolean
  exigeQuitacao: boolean
  exigeDocumentosJuridicos: boolean
  usaCnab: boolean
  usaPortalFidc: boolean
  avisos: string[]
}

export interface SnapshotPoliticaOperacaoNormalizado {
  schema: string | null
  aceiteSacadoObrigatorio: boolean
  criaAcompanhamentoEntrega: boolean
  requisitos: SnapshotRequisitoOperacao[]
  configuracao: Record<string, unknown>
  avisos: string[]
}

export interface SnapshotRequisitoOperacao {
  id: string | null
  codigo: string
  tipoDocumentoCodigo: string
  escopo: string
  momentoObrigatorio: string
  obrigatorio: boolean
  ativo: boolean
  responsavelUpload: string | null
}

export interface EtapaOperacao {
  id: string
  ordem: number
  titulo: string
  descricao: string
  aplicavel: boolean
  status: EtapaOperacaoStatus
  concluidaEm: string | null
  ator: string | null
  origem: string
}

export interface DocumentoOperacaoParaPolitica {
  id?: string
  nota_fiscal_id?: string | null
  nota_fiscal_entrega_id?: string | null
  codigo?: string | null
  tipo_documento_codigo_snapshot?: string | null
  escopo_snapshot?: string | null
  status?: string | null
  versao_aprovada_id?: string | null
  obrigatorio?: boolean | null
  responsavel_upload_snapshot?: string | null
  prazo_limite?: string | null
  enviado_em?: string | null
  analisado_em?: string | null
}

export interface LogisticaOperacaoParaPolitica {
  status_entrega?: string | null
  data_entrega?: string | null
  entrega_confirmada_em?: string | null
  data_limite_cte?: string | null
  data_limite_canhoto?: string | null
}

export interface OperacaoParaPolitica {
  status?: string | null
  created_at?: string | null
  aprovado_em?: string | null
  aceite_sacado_em?: string | null
  cessao_efetivada_em?: string | null
  liquidada_em?: string | null
  aceite_sacado_exigido?: boolean | null
  aceite_sacado_status?: string | null
  termo_assinado_url?: string | null
  testemunha_1_id?: string | null
  testemunha_2_id?: string | null
  conta_escrow_id?: string | null
  remessa_gerado_em?: string | null
  remessa_enviado_em?: string | null
  politica_snapshot?: unknown | null
}

type MomentoRequisito = 'nf_pre_cessao' | 'operacao' | 'pos_cessao' | 'entrega' | 'outro'

const LOGISTICS_CODES = new Set([
  'cte',
  'cte_xml',
  'cte_pdf_dacte',
  'cte_dacte_pdf',
  'dacte',
  'canhoto',
  'comprovante_entrega',
])
const LEGAL_CODES = new Set([
  'contrato',
  'contrato_mae',
  'contrato_cessao',
  'termo_cessao',
  'termo_de_cessao',
  'procuracao',
])
const PRE_CESSION_MOMENTS = new Set(['nf_pre_cessao', 'pre_cessao', 'antes_cessao'])
const OPERATION_MOMENTS = new Set(['operacao', 'analise_operacao'])
const POST_CESSION_MOMENTS = new Set(['pos_cessao', 'apos_cessao', 'apos_desembolso'])
const DELIVERY_MOMENTS = new Set(['entrega', 'logistica'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function flagFromConfiguration(config: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = config[key]
    if (value === true) return true
    if (
      asRecord(value).ativo === true
      || asRecord(value).habilitado === true
      || asRecord(value).enabled === true
    ) return true
  }
  return false
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replaceAll(' ', '_')
}

function normalizarMomento(value: unknown): MomentoRequisito {
  const normalized = normalizeCode(value)
  if (PRE_CESSION_MOMENTS.has(normalized)) return 'nf_pre_cessao'
  if (OPERATION_MOMENTS.has(normalized)) return 'operacao'
  if (POST_CESSION_MOMENTS.has(normalized)) return 'pos_cessao'
  if (DELIVERY_MOMENTS.has(normalized)) return 'entrega'
  return 'outro'
}

/**
 * Normaliza snapshots v1 e formatos anteriores sem alterar o JSON persistido.
 * Nos snapshots v1, escopo é a fonte do momento obrigatório. Formatos futuros
 * podem expor momento_obrigatorio sem mudar o consumidor.
 */
export function normalizarSnapshotPoliticaOperacao(
  snapshot: unknown,
): SnapshotPoliticaOperacaoNormalizado {
  const raw = asRecord(snapshot)
  const avisos: string[] = []
  const config = asRecord(raw.configuracao)
  const rawRequirements = Array.isArray(raw.requisitos) ? raw.requisitos : []

  if (!snapshot) avisos.push('snapshot_ausente')
  if (snapshot && !Array.isArray(raw.requisitos)) avisos.push('requisitos_ausentes_no_snapshot')

  const requisitos = rawRequirements
    .map((item) => {
      const requirement = asRecord(item)
      const codigo = normalizeCode(requirement.codigo)
      const tipoDocumentoCodigo = normalizeCode(
        requirement.tipo_documento_codigo
        || requirement.tipoDocumentoCodigo
        || codigo,
      )
      const escopo = normalizeCode(requirement.escopo)
      return {
        id: asString(requirement.id),
        codigo,
        tipoDocumentoCodigo,
        escopo,
        momentoObrigatorio: normalizeCode(
          requirement.momento_obrigatorio
          || requirement.momentoObrigatorio
          || escopo,
        ),
        obrigatorio: requirement.obrigatorio !== false,
        ativo: requirement.ativo !== false,
        responsavelUpload: asString(
          requirement.responsavel_upload || requirement.responsavelUpload,
        ),
      }
    })
    .filter((item) => item.codigo || item.tipoDocumentoCodigo)

  const aceite = asBoolean(raw.aceite_sacado_obrigatorio)
    ?? asBoolean(raw.aceite_sacado_exigido)
    ?? false
  const acompanhamento = asBoolean(raw.cria_acompanhamento_entrega)
    ?? asBoolean(raw.usa_acompanhamento_logistico)
    ?? false

  if (
    raw.aceite_sacado_obrigatorio === undefined
    && raw.aceite_sacado_exigido === undefined
  ) avisos.push('aceite_sacado_flag_ausente')
  if (
    raw.cria_acompanhamento_entrega === undefined
    && raw.usa_acompanhamento_logistico === undefined
  ) avisos.push('acompanhamento_entrega_flag_ausente')

  return {
    schema: asString(raw.schema),
    aceiteSacadoObrigatorio: aceite,
    criaAcompanhamentoEntrega: acompanhamento,
    requisitos,
    configuracao: config,
    avisos,
  }
}

export function obterCapacidadesOperacao(
  operacao: OperacaoParaPolitica,
  evidencias: {
    documentos?: DocumentoOperacaoParaPolitica[]
    logistica?: LogisticaOperacaoParaPolitica[]
  } = {},
): CapabilitiesOperacao {
  const snapshot = normalizarSnapshotPoliticaOperacao(operacao.politica_snapshot)
  const requisitosAplicaveis = snapshot.requisitos.filter((item) => item.ativo && item.obrigatorio)
  const codes = new Set(
    requisitosAplicaveis.flatMap((item) => [item.codigo, item.tipoDocumentoCodigo]),
  )
  const has = (...values: string[]) => values.some((value) => codes.has(value))
  const config = snapshot.configuracao
  const legacy = !operacao.politica_snapshot
    || snapshot.avisos.includes('requisitos_ausentes_no_snapshot')
  const evidenceDocuments = evidencias.documentos || []
  const evidenceCodes = new Set(
    evidenceDocuments.map((item) => normalizeCode(
      item.tipo_documento_codigo_snapshot || item.codigo,
    )),
  )
  const evidenceHas = (...values: string[]) => values.some((value) => evidenceCodes.has(value))
  const evidenceLogistics = (evidencias.logistica || []).length > 0
    || evidenceDocuments.some((item) => (
      ['pos_cessao', 'entrega'].includes(normalizarMomento(item.escopo_snapshot))
    ))

  return {
    exigeAceiteSacado: operacao.aceite_sacado_exigido ?? snapshot.aceiteSacadoObrigatorio,
    usaAcompanhamentoLogistico: snapshot.criaAcompanhamentoEntrega || (legacy && evidenceLogistics),
    exigeCteXml: has('cte', 'cte_xml') || (legacy && evidenceHas('cte', 'cte_xml')),
    exigeDacte: has('cte_pdf_dacte', 'cte_dacte_pdf', 'dacte')
      || (legacy && evidenceHas('cte_pdf_dacte', 'cte_dacte_pdf', 'dacte')),
    exigeCanhoto: has('canhoto') || (legacy && evidenceHas('canhoto')),
    exigeComprovanteEntrega: has('comprovante_entrega')
      || (legacy && evidenceHas('comprovante_entrega')),
    usaEscrow: Boolean(operacao.conta_escrow_id)
      || flagFromConfiguration(config, ['usa_escrow', 'escrow']),
    exigeNotificacaoSacado: has('notificacao_sacado', 'notificacao_cessao'),
    exigeQuitacao: has('quitacao', 'termo_quitacao'),
    exigeDocumentosJuridicos: requisitosAplicaveis.some((item) => (
      normalizarMomento(item.momentoObrigatorio || item.escopo) === 'operacao'
      && (
        LEGAL_CODES.has(item.codigo)
        || LEGAL_CODES.has(item.tipoDocumentoCodigo)
      )
    )),
    usaCnab: flagFromConfiguration(config, ['usa_cnab', 'cnab']),
    usaPortalFidc: flagFromConfiguration(
      config,
      ['usa_portal_fidc', 'portal_fidc', 'fromtis'],
    ),
    avisos: snapshot.avisos,
  }
}

function documentoConcluido(documento: DocumentoOperacaoParaPolitica): boolean {
  if (documento.versao_aprovada_id) return true
  return [
    'satisfeito',
    'aprovado',
    'aceita',
    'validado',
    'concluido',
    'publicado',
    'dispensado',
  ].includes(normalizeCode(documento.status))
}

function documentosParaCodigo(
  documentos: DocumentoOperacaoParaPolitica[],
  codes: Set<string>,
) {
  return documentos.filter((documento) => codes.has(codigoDoDocumento(documento)))
}

function statusPorDocumentos(
  documentos: DocumentoOperacaoParaPolitica[],
  codes: Set<string>,
): EtapaOperacaoStatus {
  const itens = documentosParaCodigo(documentos, codes)
  if (
    itens.some((item) => ['rejeitado', 'reprovado'].includes(normalizeCode(item.status)))
  ) return 'rejeitada'
  if (itens.length > 0 && itens.every(documentoConcluido)) return 'concluida'
  return 'pendente'
}

function momentoDoDocumento(
  documento: DocumentoOperacaoParaPolitica,
): MomentoRequisito {
  return normalizarMomento(documento.escopo_snapshot)
}

function codigoDoDocumento(documento: DocumentoOperacaoParaPolitica): string {
  return normalizeCode(documento.tipo_documento_codigo_snapshot || documento.codigo)
}

function requisitoTemCodigo(
  requisito: SnapshotRequisitoOperacao,
  codes: Set<string>,
): boolean {
  return codes.has(requisito.codigo) || codes.has(requisito.tipoDocumentoCodigo)
}

function requisitosPorMomento(
  snapshot: SnapshotPoliticaOperacaoNormalizado,
  momentos: Set<MomentoRequisito>,
) {
  return snapshot.requisitos.filter((item) => (
    item.ativo
    && item.obrigatorio
    && momentos.has(normalizarMomento(item.momentoObrigatorio || item.escopo))
  ))
}

function documentosObrigatoriosPorMomento(
  documentos: DocumentoOperacaoParaPolitica[],
  momentos: Set<MomentoRequisito>,
) {
  return documentos.filter((item) => (
    item.obrigatorio !== false
    && momentos.has(momentoDoDocumento(item))
  ))
}

function requisitosDocumentaisConcluidos({
  requisitos,
  documentos,
}: {
  requisitos: SnapshotRequisitoOperacao[]
  documentos: DocumentoOperacaoParaPolitica[]
}) {
  if (requisitos.length === 0) {
    return documentos.length === 0 || documentos.every(documentoConcluido)
  }

  return requisitos.every((requisito) => {
    const codes = new Set([requisito.codigo, requisito.tipoDocumentoCodigo])
    const instancias = documentosParaCodigo(documentos, codes)
    return instancias.length > 0 && instancias.every(documentoConcluido)
  })
}

function dataDocumentoConcluido(documentos: DocumentoOperacaoParaPolitica[]) {
  const dates = documentos
    .filter(documentoConcluido)
    .map((item) => item.analisado_em || item.enviado_em)
    .filter((value): value is string => Boolean(value))
    .sort()
  return dates.at(-1) ?? null
}

function etapa(
  input: Omit<EtapaOperacao, 'status' | 'concluidaEm' | 'ator'> & {
    status?: EtapaOperacaoStatus
    concluidaEm?: string | null
    ator?: string | null
  },
): EtapaOperacao {
  return {
    ...input,
    status: input.status ?? 'pendente',
    concluidaEm: input.concluidaEm ?? null,
    ator: input.ator ?? null,
  }
}

/**
 * Garante uma única etapa atual. Etapas futuras continuam pendentes; quando
 * existe rejeição ou bloqueio anterior, os marcos posteriores ficam bloqueados.
 */
export function resolverStatusEtapasOperacao(
  etapas: EtapaOperacao[],
): EtapaOperacao[] {
  let encontrouAtual = false
  let fluxoBloqueado = false

  return etapas
    .filter((item) => item.aplicavel)
    .sort((left, right) => left.ordem - right.ordem)
    .map((item) => {
      if (fluxoBloqueado) return { ...item, status: 'bloqueada' }
      if (item.status === 'concluida') return item
      if (item.status === 'rejeitada' || item.status === 'bloqueada') {
        fluxoBloqueado = true
        return item
      }
      if (!encontrouAtual) {
        encontrouAtual = true
        return { ...item, status: 'atual' }
      }
      return { ...item, status: 'pendente' }
    })
}

export function construirEtapasCronologicasOperacao({
  operacao,
  capacidades,
  documentos,
  logistica,
}: {
  operacao: OperacaoParaPolitica
  capacidades: CapabilitiesOperacao
  documentos: DocumentoOperacaoParaPolitica[]
  logistica: LogisticaOperacaoParaPolitica[]
}): EtapaOperacao[] {
  const status = normalizeCode(operacao.status)
  const snapshot = normalizarSnapshotPoliticaOperacao(operacao.politica_snapshot)
  const aprovada = ['aprovada', 'em_andamento', 'liquidada', 'inadimplente'].includes(status)
  const desembolsada = ['em_andamento', 'liquidada', 'inadimplente'].includes(status)
  const liquidada = status === 'liquidada' || Boolean(operacao.liquidada_em)
  const cancelada = status === 'cancelada'
  const preMoments = new Set<MomentoRequisito>(['nf_pre_cessao'])
  const operationMoments = new Set<MomentoRequisito>(['operacao'])
  const logisticsMoments = new Set<MomentoRequisito>(['pos_cessao', 'entrega'])
  const requisitosPreCessao = requisitosPorMomento(snapshot, preMoments)
  const documentosPreCessao = documentosObrigatoriosPorMomento(documentos, preMoments)
  const documentacaoValidada = requisitosDocumentaisConcluidos({
    requisitos: requisitosPreCessao,
    documentos: documentosPreCessao,
  })
  const requisitosOperacao = requisitosPorMomento(snapshot, operationMoments)
  const requisitosJuridicos = requisitosOperacao.filter((item) => (
    requisitoTemCodigo(item, LEGAL_CODES)
  ))
  const documentosJuridicos = documentosObrigatoriosPorMomento(
    documentos,
    operationMoments,
  ).filter((item) => LEGAL_CODES.has(codigoDoDocumento(item)))
  const juridicosConcluidos = capacidades.exigeDocumentosJuridicos && (
    requisitosDocumentaisConcluidos({
      requisitos: requisitosJuridicos,
      documentos: documentosJuridicos,
    })
    || Boolean(operacao.termo_assinado_url)
  )
  const requisitosLogisticos = requisitosPorMomento(snapshot, logisticsMoments)
  const documentosLogisticos = documentosObrigatoriosPorMomento(
    documentos,
    logisticsMoments,
  )
  const usaEvidenciaLegada = snapshot.requisitos.length === 0
  const cteCodes = new Set(['cte', 'cte_xml'])
  const dacteCodes = new Set(['cte_pdf_dacte', 'cte_dacte_pdf', 'dacte'])
  const proofCodes = new Set(['canhoto', 'comprovante_entrega'])
  const cteLogisticoAplicavel = capacidades.usaAcompanhamentoLogistico
    && (
      requisitosLogisticos.some((item) => requisitoTemCodigo(item, cteCodes))
      || (
        usaEvidenciaLegada
        && documentosLogisticos.some((item) => cteCodes.has(codigoDoDocumento(item)))
      )
    )
  const dacteLogisticoAplicavel = capacidades.usaAcompanhamentoLogistico
    && (
      requisitosLogisticos.some((item) => requisitoTemCodigo(item, dacteCodes))
      || (
        usaEvidenciaLegada
        && documentosLogisticos.some((item) => dacteCodes.has(codigoDoDocumento(item)))
      )
    )
  const comprovanteLogisticoAplicavel = capacidades.usaAcompanhamentoLogistico
    && (
      requisitosLogisticos.some((item) => requisitoTemCodigo(item, proofCodes))
      || (
        usaEvidenciaLegada
        && documentosLogisticos.some((item) => proofCodes.has(codigoDoDocumento(item)))
      )
    )
  const entregas = logistica.filter((item) => item.status_entrega !== 'nao_aplicavel')
  const acompanhamentoIniciado = entregas.length > 0
  const todasEntregues = entregas.length > 0
    && entregas.every((item) => item.status_entrega === 'entregue')
  const possuiPendenciaEntrega = entregas.some((item) => (
    item.status_entrega === 'entrega_com_pendencia'
    || item.status_entrega === 'devolvida'
  ))
  const aceiteStatus = normalizeCode(operacao.aceite_sacado_status)
  const aceiteConfirmado = aceiteStatus === 'aceito'
  const aceiteContestado = aceiteStatus === 'contestado'
  const analiseAplicavel = status === 'em_analise'

  const etapas = [
    etapa({
      id: 'documentacao',
      ordem: 10,
      titulo: 'Documentação validada',
      descricao: documentacaoValidada
        ? 'Os documentos aplicáveis ao fluxo foram validados.'
        : 'A documentação aplicável precisa ser validada antes do avanço da operação.',
      aplicavel: true,
      status: documentacaoValidada ? 'concluida' : cancelada ? 'bloqueada' : 'pendente',
      concluidaEm: documentacaoValidada
        ? dataDocumentoConcluido(documentosPreCessao)
        : null,
      origem: 'politica_snapshot.requisitos + documento_requisito_instancias',
    }),
    etapa({
      id: 'solicitacao',
      ordem: 20,
      titulo: 'Solicitação de antecipação enviada',
      descricao: operacao.created_at
        ? 'O cedente enviou a solicitação de antecipação.'
        : 'A solicitação será registrada após a validação documental.',
      aplicavel: true,
      status: operacao.created_at ? 'concluida' : 'pendente',
      concluidaEm: operacao.created_at ?? null,
      origem: 'operacoes.created_at',
    }),
    etapa({
      id: 'aceite_sacado',
      ordem: 30,
      titulo: 'Aceite do sacado confirmado',
      descricao: aceiteConfirmado
        ? 'O sacado confirmou o aceite da cessão.'
        : aceiteContestado
          ? 'O sacado contestou a cessão.'
          : 'Aguardando a manifestação do sacado.',
      aplicavel: capacidades.exigeAceiteSacado,
      status: aceiteConfirmado
        ? 'concluida'
        : aceiteContestado
          ? 'rejeitada'
          : 'pendente',
      concluidaEm: aceiteConfirmado || aceiteContestado
        ? operacao.aceite_sacado_em ?? null
        : null,
      origem: 'operacoes.aceite_sacado_status/aceite_sacado_em',
    }),
    etapa({
      id: 'analise',
      ordem: 40,
      titulo: 'Operação em análise',
      descricao: 'A gestora está analisando as condições da operação.',
      aplicavel: analiseAplicavel,
      origem: 'operacoes.status',
    }),
    etapa({
      id: 'aprovacao',
      ordem: 50,
      titulo: 'Operação aprovada',
      descricao: aprovada
        ? 'A análise da operação foi concluída com aprovação.'
        : status === 'reprovada'
          ? 'A operação foi reprovada na análise.'
          : 'A operação será avaliada pela gestora.',
      aplicavel: true,
      status: status === 'reprovada'
        ? 'rejeitada'
        : aprovada
          ? 'concluida'
          : 'pendente',
      concluidaEm: operacao.aprovado_em ?? null,
      origem: 'operacoes.status/aprovado_em',
    }),
    etapa({
      id: 'documentos_juridicos',
      ordem: 60,
      titulo: 'Documentos jurídicos concluídos',
      descricao: juridicosConcluidos
        ? 'Os documentos jurídicos aplicáveis foram concluídos.'
        : 'Os documentos jurídicos serão concluídos antes do desembolso.',
      aplicavel: capacidades.exigeDocumentosJuridicos,
      status: juridicosConcluidos
        ? 'concluida'
        : status === 'reprovada' || cancelada
          ? 'bloqueada'
          : 'pendente',
      concluidaEm: juridicosConcluidos
        ? dataDocumentoConcluido(documentosJuridicos)
        : null,
      origem: 'politica_snapshot.requisitos + documento_requisito_instancias',
    }),
    etapa({
      id: 'desembolso',
      ordem: 70,
      titulo: 'Desembolso realizado',
      descricao: desembolsada
        ? 'O valor aprovado foi disponibilizado ao cedente.'
        : 'O desembolso será liberado após a aprovação e as condições aplicáveis.',
      aplicavel: true,
      status: desembolsada
        ? 'concluida'
        : status === 'reprovada' || cancelada
          ? 'bloqueada'
          : 'pendente',
      concluidaEm: operacao.cessao_efetivada_em ?? null,
      origem: 'operacoes.cessao_efetivada_em',
    }),
    etapa({
      id: 'entrega_acompanhamento',
      ordem: 80,
      titulo: 'Entrega em acompanhamento',
      descricao: acompanhamentoIniciado
        ? 'A entrega está sendo acompanhada até a confirmação.'
        : 'O acompanhamento será iniciado após o desembolso.',
      aplicavel: capacidades.usaAcompanhamentoLogistico,
      status: acompanhamentoIniciado
        ? 'concluida'
        : status === 'reprovada' || cancelada
          ? 'bloqueada'
          : 'pendente',
      origem: 'nota_fiscal_entregas.status_entrega',
    }),
    etapa({
      id: 'cte',
      ordem: 90,
      titulo: 'CT-e recebido e validado',
      descricao: statusPorDocumentos(documentosLogisticos, cteCodes) === 'concluida'
        ? 'O CT-e logístico foi recebido e validado.'
        : 'O CT-e será validado conforme o momento definido na política.',
      aplicavel: cteLogisticoAplicavel,
      status: statusPorDocumentos(documentosLogisticos, cteCodes),
      concluidaEm: dataDocumentoConcluido(
        documentosParaCodigo(documentosLogisticos, cteCodes),
      ),
      origem: 'politica_snapshot.requisitos + documento_requisito_instancias',
    }),
    etapa({
      id: 'dacte',
      ordem: 91,
      titulo: 'DACTE recebido',
      descricao: statusPorDocumentos(documentosLogisticos, dacteCodes) === 'concluida'
        ? 'O DACTE aplicável foi recebido.'
        : 'O DACTE será recebido conforme o momento definido na política.',
      aplicavel: dacteLogisticoAplicavel,
      status: statusPorDocumentos(documentosLogisticos, dacteCodes),
      concluidaEm: dataDocumentoConcluido(
        documentosParaCodigo(documentosLogisticos, dacteCodes),
      ),
      origem: 'politica_snapshot.requisitos + documento_requisito_instancias',
    }),
    etapa({
      id: 'comprovante_entrega',
      ordem: 92,
      titulo: 'Comprovante de entrega recebido',
      descricao: statusPorDocumentos(documentosLogisticos, proofCodes) === 'concluida'
        ? 'O comprovante de entrega aplicável foi recebido.'
        : 'O comprovante será recebido durante o acompanhamento da entrega.',
      aplicavel: comprovanteLogisticoAplicavel,
      status: statusPorDocumentos(documentosLogisticos, proofCodes),
      concluidaEm: dataDocumentoConcluido(
        documentosParaCodigo(documentosLogisticos, proofCodes),
      ),
      origem: 'politica_snapshot.requisitos + documento_requisito_instancias',
    }),
    etapa({
      id: 'entrega_confirmada',
      ordem: 100,
      titulo: 'Entrega confirmada',
      descricao: todasEntregues
        ? 'A entrega foi confirmada no fluxo operacional.'
        : possuiPendenciaEntrega
          ? 'A entrega possui pendência que precisa ser resolvida.'
          : 'A entrega será confirmada após a conclusão do acompanhamento.',
      aplicavel: capacidades.usaAcompanhamentoLogistico,
      status: todasEntregues
        ? 'concluida'
        : possuiPendenciaEntrega
          ? 'rejeitada'
          : 'pendente',
      concluidaEm: entregas.find((item) => item.entrega_confirmada_em)
        ?.entrega_confirmada_em ?? null,
      origem: 'nota_fiscal_entregas.entrega_confirmada_em',
    }),
    etapa({
      id: 'liquidacao',
      ordem: 110,
      titulo: 'Liquidação concluída',
      descricao: liquidada
        ? 'A operação foi encerrada financeiramente.'
        : 'A liquidação concluirá o ciclo financeiro da operação.',
      aplicavel: true,
      status: liquidada ? 'concluida' : 'pendente',
      concluidaEm: operacao.liquidada_em ?? null,
      origem: 'operacoes.liquidada_em',
    }),
  ]

  return resolverStatusEtapasOperacao(etapas)
}

/**
 * Alias mantido para consumidores existentes. Toda a montagem usa o builder
 * cronológico central; não existe uma segunda sequência legada.
 */
export const construirEtapasOperacao = construirEtapasCronologicasOperacao

export function construirPendenciasOperacao({
  capacidades,
  documentos,
}: {
  capacidades: CapabilitiesOperacao
  documentos: DocumentoOperacaoParaPolitica[]
}) {
  return documentos
    .filter((documento) => documento.responsavel_upload_snapshot === 'cedente')
    .filter((documento) => documento.obrigatorio !== false)
    .filter((documento) => (
      capacidades.usaAcompanhamentoLogistico
      || !LOGISTICS_CODES.has(codigoDoDocumento(documento))
    ))
    .filter((documento) => !documentoConcluido(documento))
    .filter((documento) => (
      !['cancelado', 'dispensado'].includes(normalizeCode(documento.status))
    ))
}
