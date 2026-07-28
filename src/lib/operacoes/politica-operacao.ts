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
  obrigatorio: boolean
  ativo: boolean
  responsavelUpload: string | null
}

export interface EtapaOperacao {
  id: string
  titulo: string
  descricao: string
  status: EtapaOperacaoStatus
  data: string | null
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
  obrigatorio?: boolean | null
  responsavel_upload_snapshot?: string | null
  prazo_limite?: string | null
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
  cessao_efetivada_em?: string | null
  liquidada_em?: string | null
  aceite_sacado_exigido?: boolean | null
  aceite_sacado_status?: string | null
  conta_escrow_id?: string | null
  remessa_gerado_em?: string | null
  remessa_enviado_em?: string | null
  politica_snapshot?: unknown | null
}

const LOGISTICS_CODES = new Set(['cte', 'cte_xml', 'cte_pdf_dacte', 'canhoto', 'comprovante_entrega'])
const LEGAL_CODES = new Set(['contrato', 'contrato_mae', 'contrato_cessao', 'termo_cessao', 'termo_de_cessao', 'procuracao'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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
    if (asRecord(value).ativo === true || asRecord(value).habilitado === true || asRecord(value).enabled === true) return true
  }
  return false
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replaceAll(' ', '_')
}

/**
 * Normaliza snapshots v1 e formatos anteriores sem alterar o JSON persistido.
 * A ausência de uma flag opcional nunca habilita o módulo por inferência ampla.
 */
export function normalizarSnapshotPoliticaOperacao(snapshot: unknown): SnapshotPoliticaOperacaoNormalizado {
  const raw = asRecord(snapshot)
  const avisos: string[] = []
  const config = asRecord(raw.configuracao)
  const rawRequirements = Array.isArray(raw.requisitos) ? raw.requisitos : []

  if (!snapshot) avisos.push('snapshot_ausente')
  if (snapshot && !Array.isArray(raw.requisitos)) avisos.push('requisitos_ausentes_no_snapshot')

  const requisitos = rawRequirements.map((item) => {
    const requirement = asRecord(item)
    const codigo = normalizeCode(requirement.codigo)
    const tipoDocumentoCodigo = normalizeCode(requirement.tipo_documento_codigo || requirement.tipoDocumentoCodigo || codigo)
    return {
      id: asString(requirement.id),
      codigo,
      tipoDocumentoCodigo,
      escopo: normalizeCode(requirement.escopo),
      obrigatorio: requirement.obrigatorio !== false,
      ativo: requirement.ativo !== false,
      responsavelUpload: asString(requirement.responsavel_upload || requirement.responsavelUpload),
    }
  }).filter((item) => item.codigo || item.tipoDocumentoCodigo)

  const aceite = asBoolean(raw.aceite_sacado_obrigatorio)
    ?? asBoolean(raw.aceite_sacado_exigido)
    ?? false
  const acompanhamento = asBoolean(raw.cria_acompanhamento_entrega)
    ?? asBoolean(raw.usa_acompanhamento_logistico)
    ?? false

  if (raw.aceite_sacado_obrigatorio === undefined && raw.aceite_sacado_exigido === undefined) avisos.push('aceite_sacado_flag_ausente')
  if (raw.cria_acompanhamento_entrega === undefined && raw.usa_acompanhamento_logistico === undefined) avisos.push('acompanhamento_entrega_flag_ausente')

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
  evidencias: { documentos?: DocumentoOperacaoParaPolitica[]; logistica?: LogisticaOperacaoParaPolitica[] } = {},
): CapabilitiesOperacao {
  const snapshot = normalizarSnapshotPoliticaOperacao(operacao.politica_snapshot)
  const requisitosAplicaveis = snapshot.requisitos.filter((item) => item.ativo && item.obrigatorio)
  const codes = new Set(requisitosAplicaveis.flatMap((item) => [item.codigo, item.tipoDocumentoCodigo]))
  const has = (...values: string[]) => values.some((value) => codes.has(value))
  const config = snapshot.configuracao
  const legacy = !operacao.politica_snapshot
  const evidenceDocuments = evidencias.documentos || []
  const evidenceCodes = new Set(evidenceDocuments.map((item) => normalizeCode(item.tipo_documento_codigo_snapshot || item.codigo)))
  const evidenceHas = (...values: string[]) => values.some((value) => evidenceCodes.has(value))
  const evidenceLogistics = (evidencias.logistica || []).length > 0 || evidenceDocuments.some((item) => ['pos_cessao', 'entrega'].includes(item.escopo_snapshot || ''))

  return {
    exigeAceiteSacado: operacao.aceite_sacado_exigido ?? snapshot.aceiteSacadoObrigatorio,
    usaAcompanhamentoLogistico: snapshot.criaAcompanhamentoEntrega || (legacy && evidenceLogistics),
    exigeCteXml: has('cte', 'cte_xml') || (legacy && evidenceHas('cte', 'cte_xml')),
    exigeDacte: has('cte_pdf_dacte', 'dacte') || (legacy && evidenceHas('cte_pdf_dacte', 'dacte')),
    exigeCanhoto: has('canhoto') || (legacy && evidenceHas('canhoto')),
    exigeComprovanteEntrega: has('comprovante_entrega') || (legacy && evidenceHas('comprovante_entrega')),
    usaEscrow: !!operacao.conta_escrow_id || flagFromConfiguration(config, ['usa_escrow', 'escrow']),
    exigeNotificacaoSacado: has('notificacao_sacado', 'notificacao_cessao'),
    exigeQuitacao: has('quitacao', 'termo_quitacao'),
    exigeDocumentosJuridicos: requisitosAplicaveis.some((item) => item.escopo === 'operacao' && LEGAL_CODES.has(item.codigo)),
    usaCnab: flagFromConfiguration(config, ['usa_cnab', 'cnab']),
    usaPortalFidc: flagFromConfiguration(config, ['usa_portal_fidc', 'portal_fidc', 'fromtis']),
    avisos: snapshot.avisos,
  }
}

function documentoConcluido(documento: DocumentoOperacaoParaPolitica): boolean {
  return ['satisfeito', 'aprovado', 'aceita', 'validado', 'concluido', 'publicado'].includes(String(documento.status ?? '').toLowerCase())
}

function documentosParaCodigo(documentos: DocumentoOperacaoParaPolitica[], codes: Set<string>) {
  return documentos.filter((documento) => codes.has(normalizeCode(documento.tipo_documento_codigo_snapshot || documento.codigo)))
}

function statusPorDocumentos(documentos: DocumentoOperacaoParaPolitica[], codes: Set<string>): EtapaOperacaoStatus {
  const itens = documentosParaCodigo(documentos, codes)
  if (itens.some((item) => ['rejeitado', 'reprovado'].includes(String(item.status ?? '').toLowerCase()))) return 'rejeitada'
  if (itens.length > 0 && itens.every(documentoConcluido)) return 'concluida'
  if (itens.some((item) => !['pendente', 'vencido', 'cancelado'].includes(String(item.status ?? '').toLowerCase()))) return 'atual'
  return 'pendente'
}

function etapa(input: Omit<EtapaOperacao, 'status'> & { status: EtapaOperacaoStatus }): EtapaOperacao {
  return input
}

export function construirEtapasOperacao({
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
  const status = String(operacao.status ?? '')
  const aprovada = ['aprovada', 'em_andamento', 'liquidada', 'inadimplente'].includes(status)
  const desembolsada = ['em_andamento', 'liquidada', 'inadimplente'].includes(status)
  const liquidada = status === 'liquidada'
  const documentacao = documentos.filter((item) => item.obrigatorio !== false && !LOGISTICS_CODES.has(normalizeCode(item.tipo_documento_codigo_snapshot || item.codigo)))
  const documentacaoValidada = documentacao.length === 0 || documentacao.every(documentoConcluido)
  const etapas: EtapaOperacao[] = [
    etapa({ id: 'solicitacao', titulo: 'Solicitação enviada', descricao: 'A operação foi registrada pelo cedente.', status: operacao.created_at ? 'concluida' : 'pendente', data: operacao.created_at ?? null, ator: null, origem: 'operacao.created_at' }),
    etapa({ id: 'documentacao', titulo: 'Documentação validada', descricao: 'Os documentos aplicáveis ao fluxo foram validados.', status: documentacaoValidada ? 'concluida' : status === 'reprovada' ? 'bloqueada' : 'atual', data: documentacaoValidada ? operacao.aprovado_em ?? null : null, ator: null, origem: 'documento_requisito_instancias + politica_snapshot' }),
    etapa({ id: 'aprovacao', titulo: 'Operação aprovada', descricao: 'A análise da operação foi concluída.', status: status === 'reprovada' ? 'rejeitada' : aprovada ? 'concluida' : status === 'em_analise' ? 'atual' : 'pendente', data: operacao.aprovado_em ?? null, ator: null, origem: 'operacoes.status' }),
    etapa({ id: 'desembolso', titulo: 'Desembolso realizado', descricao: 'O valor foi disponibilizado para a operação.', status: desembolsada ? 'concluida' : status === 'aprovada' ? 'atual' : status === 'reprovada' || status === 'cancelada' ? 'bloqueada' : 'pendente', data: operacao.cessao_efetivada_em ?? null, ator: null, origem: 'operacoes.cessao_efetivada_em' }),
  ]

  if (capacidades.exigeAceiteSacado) {
    const aceite = operacao.aceite_sacado_status
    etapas.push(etapa({ id: 'aceite_sacado', titulo: 'Aceite do sacado', descricao: aceite === 'aceito' ? 'Aceite confirmado.' : 'Aguardando manifestação do sacado.', status: aceite === 'aceito' ? 'concluida' : aceite === 'contestado' ? 'rejeitada' : 'atual', data: null, ator: null, origem: 'operacoes.aceite_sacado_status' }))
  }

  if (capacidades.usaAcompanhamentoLogistico) {
    const entregas = logistica.filter((item) => item.status_entrega !== 'nao_aplicavel')
    const todasEntregues = entregas.length > 0 && entregas.every((item) => item.status_entrega === 'entregue')
    const possuiPendencia = entregas.some((item) => item.status_entrega === 'entrega_com_pendencia' || item.status_entrega === 'devolvida')
    etapas.push(etapa({ id: 'entrega_acompanhamento', titulo: 'Entrega em acompanhamento', descricao: entregas.length === 0 ? 'Acompanhamento será iniciado após o desembolso.' : 'A operação está sendo acompanhada até a confirmação da entrega.', status: todasEntregues ? 'concluida' : possuiPendencia ? 'rejeitada' : desembolsada ? 'atual' : 'pendente', data: entregas[0]?.data_entrega ?? null, ator: null, origem: 'nota_fiscal_entregas.status_entrega' }))
    if (capacidades.exigeCteXml) etapas.push(etapa({ id: 'cte', titulo: 'CT-e recebido/validado', descricao: 'CT-e conforme o requisito da política.', status: statusPorDocumentos(documentos, new Set(['cte', 'cte_xml'])), data: null, ator: null, origem: 'documento_requisito_instancias + politica_snapshot' }))
    if (capacidades.exigeDacte) etapas.push(etapa({ id: 'dacte', titulo: 'DACTE recebido', descricao: 'DACTE conforme o requisito da política.', status: statusPorDocumentos(documentos, new Set(['cte_pdf_dacte', 'dacte'])), data: null, ator: null, origem: 'documento_requisito_instancias + politica_snapshot' }))
    if (capacidades.exigeCanhoto || capacidades.exigeComprovanteEntrega) {
      const codes = new Set<string>([])
      if (capacidades.exigeCanhoto) codes.add('canhoto')
      if (capacidades.exigeComprovanteEntrega) codes.add('comprovante_entrega')
      etapas.push(etapa({ id: 'comprovante_entrega', titulo: 'Comprovante de entrega recebido', descricao: 'Comprovante conforme o requisito da política.', status: statusPorDocumentos(documentos, codes), data: null, ator: null, origem: 'documento_requisito_instancias + politica_snapshot' }))
      etapas.push(etapa({ id: 'entrega_confirmada', titulo: 'Entrega confirmada', descricao: 'A entrega foi confirmada no fluxo operacional.', status: todasEntregues ? 'concluida' : possuiPendencia ? 'rejeitada' : 'pendente', data: entregas.find((item) => item.entrega_confirmada_em)?.entrega_confirmada_em ?? null, ator: null, origem: 'nota_fiscal_entregas.entrega_confirmada_em' }))
    }
  }

  if (capacidades.usaEscrow) {
    etapas.push(etapa({ id: 'pagamento', titulo: 'Pagamento identificado', descricao: 'O pagamento está refletido no fluxo da operação.', status: desembolsada ? 'concluida' : 'pendente', data: operacao.cessao_efetivada_em ?? null, ator: null, origem: 'operacoes.cessao_efetivada_em' }))
  }

  if (capacidades.usaCnab) etapas.push(etapa({ id: 'cnab', titulo: 'Remessa CNAB gerada/enviada', descricao: 'A remessa foi processada conforme a configuração aplicável.', status: operacao.remessa_enviado_em ? 'concluida' : operacao.remessa_gerado_em ? 'atual' : 'pendente', data: operacao.remessa_enviado_em ?? operacao.remessa_gerado_em ?? null, ator: null, origem: 'operacoes.remessa_gerado_em/remessa_enviado_em' }))
  etapas.push(etapa({ id: 'liquidacao', titulo: 'Liquidação concluída', descricao: 'A operação foi encerrada financeiramente.', status: liquidada ? 'concluida' : status === 'inadimplente' || status === 'em_andamento' ? 'atual' : 'pendente', data: operacao.liquidada_em ?? null, ator: null, origem: 'operacoes.liquidada_em' }))
  return etapas
}

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
    .filter((documento) => capacidades.usaAcompanhamentoLogistico || !LOGISTICS_CODES.has(normalizeCode(documento.tipo_documento_codigo_snapshot || documento.codigo)))
    .filter((documento) => !documentoConcluido(documento))
    .filter((documento) => !['cancelado', 'dispensado'].includes(String(documento.status ?? '').toLowerCase()))
}
