import { normalizarSnapshotPoliticaOperacao } from '@/lib/operacoes/politica-operacao'

export const CODIGOS_CTE_LOGISTICO = new Set(['cte', 'cte_xml', 'cte_pdf_dacte', 'cte_dacte_pdf', 'dacte'])
export const CODIGOS_COMPROVANTE_ENTREGA = new Set(['canhoto', 'comprovante_entrega'])

export type CategoriaDocumentoLogistico = 'cte' | 'comprovante_entrega'
export type StatusDocumentoLogistico =
  | 'nao_exigido'
  | 'aguardando_upload'
  | 'enviado'
  | 'em_analise'
  | 'aprovado'
  | 'rejeitado'
  | 'prazo_vencido'

export type CriticidadePrazoLogistico = 'sem_prazo' | 'normal' | 'proximo' | 'vence_hoje' | 'vencido'
export type StatusConsolidadoLogistico =
  | 'preparando'
  | 'rejeitado'
  | 'prazo_vencido'
  | 'vence_hoje'
  | 'prazo_proximo'
  | 'aguardando_upload'
  | 'em_analise'
  | 'em_andamento'
  | 'concluido'

export type FiltroAcompanhamentoLogistico = 'todos' | 'atencao' | 'pendentes' | 'em_analise' | 'concluidos'

export interface AplicabilidadeDocumentoLogistico {
  aplicavel: boolean
  obrigatorio: boolean
}

export interface AplicabilidadeLogistica {
  habilitada: boolean
  cte: AplicabilidadeDocumentoLogistico
  comprovanteEntrega: AplicabilidadeDocumentoLogistico
}

export interface DocumentoLogisticoCompactoRaw {
  codigo: string
  obrigatorio: boolean
  statusInstancia: string | null
  statusDocumento: string | null
  prazoLimite: string | null
  atualizadoEm: string | null
}

export interface EntregaLogisticaCompactaRaw {
  id: string
  status: string
  dataLimiteCte: string | null
  dataLimiteComprovante: string | null
  entregaConfirmadaEm: string | null
  motivoPendencia: string | null
}

export interface PostergacaoComprovanteCompactaRaw {
  prazoOriginal: string
  novaPrevisao: string
  comunicadaEm: string
}

export interface DocumentoLogisticoResumo {
  aplicavel: boolean
  obrigatorio: boolean
  status: StatusDocumentoLogistico
  prazoOriginal: string | null
  prazoEfetivo: string | null
  novaPrevisao: string | null
  criticidadePrazo: CriticidadePrazoLogistico
  criticidadePrazoOriginal: CriticidadePrazoLogistico
  atualizadoEm: string | null
}

export interface LinhaAcompanhamentoLogistico {
  notaFiscalId: string
  numeroNf: string
  vencimentoNf: string | null
  entregaId: string | null
  statusEntrega: string | null
  status: StatusConsolidadoLogistico
  cte: DocumentoLogisticoResumo
  comprovanteEntrega: DocumentoLogisticoResumo
  prazoMaisProximo: string | null
  criticidadePrazo: CriticidadePrazoLogistico
  motivoPendencia: string | null
}

export interface ResumoAcompanhamentoLogistico {
  statusGeral: 'atencao' | 'em_andamento' | 'concluido'
  total: number
  concluidas: number
  emAnalise: number
  pendentes: number
  atencao: number
  percentualConclusao: number
}

export type EstadoInicialAcompanhamentoLogistico = 'oculto' | 'aguardando_desembolso' | 'pronto'

export interface PaginaAcompanhamentoLogistico {
  linhas: LinhaAcompanhamentoLogistico[]
  pagina: number
  totalPaginas: number
}

export function resolverEstadoInicialAcompanhamentoLogistico({
  aplicavel,
  desembolsada,
}: {
  aplicavel: boolean
  desembolsada: boolean
}): EstadoInicialAcompanhamentoLogistico {
  if (!aplicavel) return 'oculto'
  return desembolsada ? 'pronto' : 'aguardando_desembolso'
}

export function paginarAcompanhamentoLogistico(
  linhas: LinhaAcompanhamentoLogistico[],
  { expandido, pagina, tamanhoInicial = 5, tamanhoPagina = 10 }: {
    expandido: boolean
    pagina: number
    tamanhoInicial?: number
    tamanhoPagina?: number
  },
): PaginaAcompanhamentoLogistico {
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / tamanhoPagina))
  const paginaValida = expandido ? Math.min(Math.max(1, pagina), totalPaginas) : 1
  const inicio = expandido ? (paginaValida - 1) * tamanhoPagina : 0
  const limite = expandido ? tamanhoPagina : tamanhoInicial
  return {
    linhas: linhas.slice(inicio, inicio + limite),
    pagina: paginaValida,
    totalPaginas,
  }
}

function normalizarCodigo(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function categoriaDoCodigo(codigo: string): CategoriaDocumentoLogistico | null {
  const normalizado = normalizarCodigo(codigo)
  if (CODIGOS_CTE_LOGISTICO.has(normalizado)) return 'cte'
  if (CODIGOS_COMPROVANTE_ENTREGA.has(normalizado)) return 'comprovante_entrega'
  return null
}

export function resolverAplicabilidadeLogistica(snapshot: unknown): AplicabilidadeLogistica {
  const normalizado = normalizarSnapshotPoliticaOperacao(snapshot)
  const aplicabilidade: AplicabilidadeLogistica = {
    habilitada: normalizado.criaAcompanhamentoEntrega,
    cte: { aplicavel: false, obrigatorio: false },
    comprovanteEntrega: { aplicavel: false, obrigatorio: false },
  }

  for (const requisito of normalizado.requisitos) {
    if (!requisito.ativo || !['pos_cessao', 'entrega', 'apos_desembolso', 'logistica'].includes(requisito.escopo)) continue
    const categoria = categoriaDoCodigo(requisito.tipoDocumentoCodigo || requisito.codigo)
    if (!categoria) continue
    const destino = categoria === 'cte' ? aplicabilidade.cte : aplicabilidade.comprovanteEntrega
    destino.aplicavel = true
    destino.obrigatorio = destino.obrigatorio || requisito.obrigatorio
    aplicabilidade.habilitada = true
  }

  return aplicabilidade
}

export function resolverAplicabilidadeLogisticaDosRequisitos(
  requisitos: Array<Pick<DocumentoLogisticoCompactoRaw, 'codigo' | 'obrigatorio'>>,
): AplicabilidadeLogistica {
  const aplicabilidade: AplicabilidadeLogistica = {
    habilitada: false,
    cte: { aplicavel: false, obrigatorio: false },
    comprovanteEntrega: { aplicavel: false, obrigatorio: false },
  }
  for (const requisito of requisitos) {
    const categoria = categoriaDoCodigo(requisito.codigo)
    if (!categoria) continue
    const destino = categoria === 'cte' ? aplicabilidade.cte : aplicabilidade.comprovanteEntrega
    destino.aplicavel = true
    destino.obrigatorio = destino.obrigatorio || requisito.obrigatorio
    aplicabilidade.habilitada = true
  }
  return aplicabilidade
}

function parseData(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const date = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(date) ? null : date
}

function dataHojeUtc(hoje: Date) {
  return Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
}

export function calcularCriticidadePrazoLogistico({
  prazo,
  concluido,
  hoje = new Date(),
  limiteProximoDias = 3,
}: {
  prazo: string | null
  concluido: boolean
  hoje?: Date
  limiteProximoDias?: number
}): CriticidadePrazoLogistico {
  if (concluido) return 'sem_prazo'
  const prazoMs = parseData(prazo)
  if (prazoMs === null) return 'sem_prazo'
  const dias = Math.ceil((prazoMs - dataHojeUtc(hoje)) / 86_400_000)
  if (dias < 0) return 'vencido'
  if (dias === 0) return 'vence_hoje'
  if (dias <= limiteProximoDias) return 'proximo'
  return 'normal'
}

function prioridadeStatusDocumento(status: StatusDocumentoLogistico) {
  return ({
    rejeitado: 70,
    prazo_vencido: 60,
    em_analise: 50,
    enviado: 40,
    aguardando_upload: 30,
    aprovado: 20,
    nao_exigido: 10,
  } satisfies Record<StatusDocumentoLogistico, number>)[status]
}

function statusDocumento(raw: DocumentoLogisticoCompactoRaw | undefined): StatusDocumentoLogistico {
  if (!raw) return 'aguardando_upload'
  const documento = normalizarCodigo(raw.statusDocumento)
  const instancia = normalizarCodigo(raw.statusInstancia)
  if (documento === 'rejeitado') return 'rejeitado'
  if (documento === 'aprovado' || instancia === 'satisfeito') return 'aprovado'
  if (documento === 'em_analise') return 'em_analise'
  if (documento === 'enviado') return 'enviado'
  return 'aguardando_upload'
}

export function resolverStatusDocumentoLogistico({
  categoria,
  aplicabilidade,
  documentos,
  prazoOriginal,
  novaPrevisao = null,
  hoje = new Date(),
}: {
  categoria: CategoriaDocumentoLogistico
  aplicabilidade: AplicabilidadeDocumentoLogistico
  documentos: DocumentoLogisticoCompactoRaw[]
  prazoOriginal: string | null
  novaPrevisao?: string | null
  hoje?: Date
}): DocumentoLogisticoResumo {
  if (!aplicabilidade.aplicavel) {
    return {
      aplicavel: false,
      obrigatorio: false,
      status: 'nao_exigido',
      prazoOriginal: null,
      prazoEfetivo: null,
      novaPrevisao: null,
      criticidadePrazo: 'sem_prazo',
      criticidadePrazoOriginal: 'sem_prazo',
      atualizadoEm: null,
    }
  }

  const relacionados = documentos.filter((item) => categoriaDoCodigo(item.codigo) === categoria)
  const statusEncontrados = relacionados.map(statusDocumento)
  let status = statusEncontrados.sort((a, b) => prioridadeStatusDocumento(b) - prioridadeStatusDocumento(a))[0] || 'aguardando_upload'
  const prazoEfetivo = novaPrevisao || relacionados.map((item) => item.prazoLimite).find(Boolean) || prazoOriginal
  const criticidadePrazoEfetivo = calcularCriticidadePrazoLogistico({
    prazo: prazoEfetivo,
    concluido: status === 'aprovado',
    hoje,
  })
  const criticidadePrazoOriginal = calcularCriticidadePrazoLogistico({
    prazo: prazoOriginal,
    concluido: status === 'aprovado',
    hoje,
  })
  const criticidadePrazo = criticidadeMaisAlta([
    { criticidadePrazo: criticidadePrazoEfetivo },
    { criticidadePrazo: criticidadePrazoOriginal },
  ])
  if (criticidadePrazo === 'vencido' && !['aprovado', 'rejeitado'].includes(status)) status = 'prazo_vencido'

  return {
    aplicavel: true,
    obrigatorio: aplicabilidade.obrigatorio || relacionados.some((item) => item.obrigatorio),
    status,
    prazoOriginal,
    prazoEfetivo,
    novaPrevisao,
    criticidadePrazo,
    criticidadePrazoOriginal,
    atualizadoEm: relacionados.map((item) => item.atualizadoEm).filter(Boolean).sort().at(-1) || null,
  }
}

function documentosObrigatorios(linha: Pick<LinhaAcompanhamentoLogistico, 'cte' | 'comprovanteEntrega'>) {
  return [linha.cte, linha.comprovanteEntrega].filter((documento) => documento.aplicavel && documento.obrigatorio)
}

function criticidadeMaisAlta(documentos: Array<Pick<DocumentoLogisticoResumo, 'criticidadePrazo'>>): CriticidadePrazoLogistico {
  const prioridade: Record<CriticidadePrazoLogistico, number> = { vencido: 5, vence_hoje: 4, proximo: 3, normal: 2, sem_prazo: 1 }
  return documentos.map((item) => item.criticidadePrazo).sort((a, b) => prioridade[b] - prioridade[a])[0] || 'sem_prazo'
}

export function calcularConclusaoLogisticaNf(linha: Pick<LinhaAcompanhamentoLogistico, 'entregaId' | 'statusEntrega' | 'cte' | 'comprovanteEntrega'>): StatusConsolidadoLogistico {
  if (!linha.entregaId) return 'preparando'
  const obrigatorios = documentosObrigatorios(linha)
  const statuses = obrigatorios.map((item) => item.status)
  const criticidade = criticidadeMaisAlta(obrigatorios)
  if (linha.statusEntrega === 'entrega_com_pendencia' || linha.statusEntrega === 'devolvida' || statuses.includes('rejeitado')) return 'rejeitado'
  if (criticidade === 'vencido' || statuses.includes('prazo_vencido')) return 'prazo_vencido'
  if (criticidade === 'vence_hoje') return 'vence_hoje'
  if (criticidade === 'proximo') return 'prazo_proximo'
  if (statuses.includes('aguardando_upload')) return 'aguardando_upload'
  if (statuses.some((status) => status === 'enviado' || status === 'em_analise')) return 'em_analise'
  const documentosConcluidos = obrigatorios.every((item) => item.status === 'aprovado')
  if (linha.statusEntrega === 'entregue' && documentosConcluidos) return 'concluido'
  return 'em_andamento'
}

export function construirLinhaAcompanhamentoLogistico({
  notaFiscalId,
  numeroNf,
  vencimentoNf = null,
  entrega,
  documentos,
  postergacao,
  aplicabilidade,
  hoje = new Date(),
}: {
  notaFiscalId: string
  numeroNf: string
  vencimentoNf?: string | null
  entrega: EntregaLogisticaCompactaRaw | null
  documentos: DocumentoLogisticoCompactoRaw[]
  postergacao: PostergacaoComprovanteCompactaRaw | null
  aplicabilidade: AplicabilidadeLogistica
  hoje?: Date
}): LinhaAcompanhamentoLogistico {
  const cte = resolverStatusDocumentoLogistico({
    categoria: 'cte',
    aplicabilidade: aplicabilidade.cte,
    documentos,
    prazoOriginal: entrega?.dataLimiteCte || null,
    hoje,
  })
  const comprovanteEntrega = resolverStatusDocumentoLogistico({
    categoria: 'comprovante_entrega',
    aplicabilidade: aplicabilidade.comprovanteEntrega,
    documentos,
    prazoOriginal: postergacao?.prazoOriginal || entrega?.dataLimiteComprovante || null,
    novaPrevisao: postergacao?.novaPrevisao || null,
    hoje,
  })
  const documentosAplicaveis = [cte, comprovanteEntrega].filter((item) => item.aplicavel && item.obrigatorio)
  const prazos = documentosAplicaveis.map((item) => item.prazoEfetivo).filter(Boolean).sort() as string[]
  const linha: LinhaAcompanhamentoLogistico = {
    notaFiscalId,
    numeroNf,
    vencimentoNf,
    entregaId: entrega?.id || null,
    statusEntrega: entrega?.status || null,
    status: 'em_andamento',
    cte,
    comprovanteEntrega,
    prazoMaisProximo: prazos[0] || null,
    criticidadePrazo: criticidadeMaisAlta(documentosAplicaveis),
    motivoPendencia: entrega?.motivoPendencia || null,
  }
  linha.status = calcularConclusaoLogisticaNf(linha)
  return linha
}

const STATUS_ATENCAO = new Set<StatusConsolidadoLogistico>(['rejeitado', 'prazo_vencido', 'vence_hoje', 'prazo_proximo'])

export function resumirAcompanhamentoLogistico(linhas: LinhaAcompanhamentoLogistico[]): ResumoAcompanhamentoLogistico {
  const concluidas = linhas.filter((linha) => linha.status === 'concluido').length
  const emAnalise = linhas.filter((linha) => linha.status === 'em_analise').length
  const atencao = linhas.filter((linha) => STATUS_ATENCAO.has(linha.status)).length
  const pendentes = Math.max(0, linhas.length - concluidas - emAnalise - atencao)
  return {
    statusGeral: atencao > 0 ? 'atencao' : concluidas === linhas.length && linhas.length > 0 ? 'concluido' : 'em_andamento',
    total: linhas.length,
    concluidas,
    emAnalise,
    pendentes,
    atencao,
    percentualConclusao: linhas.length > 0 ? Math.round((concluidas / linhas.length) * 100) : 0,
  }
}

export function filtrarLinhasAcompanhamentoLogistico(
  linhas: LinhaAcompanhamentoLogistico[],
  filtro: FiltroAcompanhamentoLogistico,
  busca: string,
) {
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  return linhas.filter((linha) => {
    if (termo && !linha.numeroNf.toLocaleLowerCase('pt-BR').includes(termo)) return false
    if (filtro === 'atencao') return STATUS_ATENCAO.has(linha.status)
    if (filtro === 'pendentes') return ['preparando', 'aguardando_upload', 'em_andamento'].includes(linha.status)
    if (filtro === 'em_analise') return linha.status === 'em_analise'
    if (filtro === 'concluidos') return linha.status === 'concluido'
    return true
  })
}

export function ordenarLinhasAcompanhamentoLogistico(linhas: LinhaAcompanhamentoLogistico[]) {
  const prioridade: Record<StatusConsolidadoLogistico, number> = {
    rejeitado: 90,
    prazo_vencido: 80,
    vence_hoje: 70,
    prazo_proximo: 60,
    aguardando_upload: 50,
    em_analise: 40,
    preparando: 30,
    em_andamento: 20,
    concluido: 10,
  }
  return [...linhas].sort((a, b) => {
    const porStatus = prioridade[b.status] - prioridade[a.status]
    if (porStatus) return porStatus
    const prazoA = a.prazoMaisProximo || '9999-12-31'
    const prazoB = b.prazoMaisProximo || '9999-12-31'
    const porPrazo = prazoA.localeCompare(prazoB)
    if (porPrazo) return porPrazo
    const vencimentoA = a.vencimentoNf || '9999-12-31'
    const vencimentoB = b.vencimentoNf || '9999-12-31'
    const porVencimento = vencimentoA.localeCompare(vencimentoB)
    if (porVencimento) return porVencimento
    return a.numeroNf.localeCompare(b.numeroNf, 'pt-BR', { numeric: true }) || a.notaFiscalId.localeCompare(b.notaFiscalId)
  })
}
