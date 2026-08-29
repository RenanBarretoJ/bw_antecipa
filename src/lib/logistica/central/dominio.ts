import {
  classificarStatusLogisticoPreCessao,
  type EvidenciaLogisticaParaClassificacao,
  type FamiliaDocumentalLogistica,
  type StatusLogisticoPreCessao,
} from '@/lib/logistica/evidencias-logisticas'
import type {
  CteLogisticoResumo,
  CriticidadeLogistica,
  DocumentoLogisticoCentral,
  FiltrosCentralLogistica,
  IndicadoresComportamentoLogistico,
  LogisticaNfResumo,
  MomentoDocumentoLogistico,
  PendenciaLogistica,
  PrazoLogisticoRelevante,
  ResumoCentralLogistica,
  StatusDocumentoCentral,
} from './tipos'

const DIA_MS = 86_400_000

export interface VersaoDocumentoCentralRaw {
  id: string
  documentoId: string
  numero: number
  nome: string
  status: string
  enviadoEm: string
}

export interface AnaliseDocumentoCentralRaw {
  id: string
  versaoId: string
  resultado: string
  analisadoEm: string
  analisadoPor: string | null
}

export interface DocumentoCentralRaw {
  familia: FamiliaDocumentalLogistica
  documentoId: string | null
  versaoAprovadaId: string | null
  obrigatorio: boolean
  prazoOriginal: string | null
  novaPrevisao: string | null
  quantidadeNfs?: number
  versoes: VersaoDocumentoCentralRaw[]
  analises: AnaliseDocumentoCentralRaw[]
}

function inicioDiaUtc(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function diferencaDiasCivis(dataInicial: string | null, dataFinal: string | null): number | null {
  if (!dataInicial || !dataFinal) return null
  const inicio = inicioDiaUtc(dataInicial)
  const fim = inicioDiaUtc(dataFinal)
  return inicio === null || fim === null ? null : Math.round((fim - inicio) / DIA_MS)
}

export function resolverDataCessaoConfiavel(input: {
  cessaoEfetivadaEm: string | null
  aprovadoEm: string | null
  politicaSnapshot: unknown
}): string | null {
  if (input.cessaoEfetivadaEm) return input.cessaoEfetivadaEm
  if (!input.aprovadoEm || !input.politicaSnapshot || typeof input.politicaSnapshot !== 'object') return null
  const snapshot = input.politicaSnapshot as Record<string, unknown>
  return snapshot.cessao_no_desembolso === false ? input.aprovadoEm : null
}

export function classificarMomentoDocumento(
  primeiroUploadEm: string | null,
  dataCessao: string | null,
): { momento: MomentoDocumentoLogistico; diasRelativosCessao: number | null } {
  if (!primeiroUploadEm || !dataCessao) return { momento: 'INDETERMINADO', diasRelativosCessao: null }
  const dias = diferencaDiasCivis(dataCessao, primeiroUploadEm)
  if (dias === null) return { momento: 'INDETERMINADO', diasRelativosCessao: null }
  return { momento: new Date(primeiroUploadEm).getTime() < new Date(dataCessao).getTime() ? 'ANTECIPADO' : 'POS_CESSAO', diasRelativosCessao: dias }
}

function analiseMaisRecente(analises: AnaliseDocumentoCentralRaw[]) {
  return [...analises].sort((a, b) => b.analisadoEm.localeCompare(a.analisadoEm) || b.id.localeCompare(a.id))[0] ?? null
}

function resolverStatusDocumento(input: DocumentoCentralRaw, atual: VersaoDocumentoCentralRaw | null): StatusDocumentoCentral {
  if (!atual) return 'NAO_ENVIADO'
  if (input.versaoAprovadaId === atual.id || atual.status === 'aprovado') return 'APROVADO'
  const analise = analiseMaisRecente(input.analises.filter((item) => item.versaoId === atual.id))
  if (analise?.resultado === 'aprovado') return 'APROVADO'
  if (analise?.resultado === 'rejeitado' || atual.status === 'rejeitado') return 'REJEITADO'
  return 'AGUARDANDO_ANALISE'
}

export function projetarDocumentoLogistico(
  input: DocumentoCentralRaw,
  dataCessao: string | null,
): DocumentoLogisticoCentral {
  const versoes = [...input.versoes].sort((a, b) => a.numero - b.numero || a.enviadoEm.localeCompare(b.enviadoEm))
  const primeira = versoes[0] ?? null
  const atual = versoes.at(-1) ?? null
  const aprovada = input.versaoAprovadaId
    ? versoes.find((item) => item.id === input.versaoAprovadaId) ?? null
    : [...versoes].reverse().find((item) => resolverStatusDocumento(input, item) === 'APROVADO') ?? null
  const analiseAprovacao = aprovada
    ? analiseMaisRecente(input.analises.filter((item) => item.versaoId === aprovada.id && item.resultado === 'aprovado'))
    : null
  const momento = classificarMomentoDocumento(primeira?.enviadoEm ?? null, dataCessao)

  return {
    familia: input.familia,
    status: resolverStatusDocumento(input, atual),
    documentoId: input.documentoId,
    versaoAtualId: atual?.id ?? null,
    versaoAprovadaId: aprovada?.id ?? null,
    primeiraVersao: primeira?.numero ?? null,
    versaoAtual: atual?.numero ?? null,
    primeiraVersaoNome: primeira?.nome ?? null,
    versaoAtualNome: atual?.nome ?? null,
    primeiroUploadEm: primeira?.enviadoEm ?? null,
    ultimoUploadEm: atual?.enviadoEm ?? null,
    aprovadoEm: analiseAprovacao?.analisadoEm ?? (aprovada?.status === 'aprovado' ? aprovada.enviadoEm : null),
    momento: momento.momento,
    diasRelativosCessao: momento.diasRelativosCessao,
    quantidadeNfs: input.quantidadeNfs ?? 1,
    prazoOriginal: input.prazoOriginal,
    novaPrevisao: input.novaPrevisao,
    prazoEfetivo: input.novaPrevisao || input.prazoOriginal,
    obrigatorio: input.obrigatorio,
  }
}

export function classificarStatusAtual(cte: DocumentoLogisticoCentral, comprovante: DocumentoLogisticoCentral) {
  const evidencias: EvidenciaLogisticaParaClassificacao[] = [cte, comprovante].flatMap((item) => {
    if (!item.documentoId || !item.versaoAtualId) return []
    return [{
      familia: item.familia,
      documentoId: item.documentoId,
      versaoId: item.versaoAtualId,
      versaoStatus: item.status === 'APROVADO' ? 'aprovado' : 'enviado',
      analiseResultado: item.status === 'APROVADO' ? 'aprovado' : null,
      analisadoEm: item.aprovadoEm,
    }]
  })
  return classificarStatusLogisticoPreCessao(evidencias).status
}

function diasAte(data: string | null, hoje: Date): number | null {
  if (!data) return null
  const inicio = inicioDiaUtc(hoje)
  const fim = inicioDiaUtc(data)
  return inicio === null || fim === null ? null : Math.ceil((fim - inicio) / DIA_MS)
}

function pendenciaDoDocumento(
  nota: Pick<LogisticaNfResumo, 'notaFiscalId' | 'numeroNf' | 'cedente' | 'valor' | 'operacao'>,
  documento: DocumentoLogisticoCentral,
  hoje: Date,
): PendenciaLogistica | null {
  if (!documento.obrigatorio || documento.status === 'APROVADO') return null
  const dias = diasAte(documento.prazoEfetivo, hoje)
  const criticidade: CriticidadeLogistica = documento.status === 'REJEITADO' || (dias !== null && dias < 0)
    ? 'CRITICA'
    : dias === 0
      ? 'ALTA'
      : dias !== null && dias <= 3
        ? 'MEDIA'
        : 'NORMAL'
  return {
    id: `${nota.notaFiscalId}:${documento.familia}`,
    notaFiscalId: nota.notaFiscalId,
    numeroNf: nota.numeroNf,
    cedente: nota.cedente,
    documento: documento.familia === 'cte' ? 'CT-e / DACTE' : 'Comprovante de entrega',
    status: documento.status,
    criticidade,
    prazoOriginal: documento.prazoOriginal,
    novaPrevisao: documento.novaPrevisao,
    prazoEfetivo: documento.prazoEfetivo,
    dias,
    operacaoId: nota.operacao?.id ?? null,
    valor: nota.valor,
  }
}

export function complementarSituacaoNf(
  nota: Omit<LogisticaNfResumo, 'statusAtual' | 'cumprimentoDocumental' | 'prazoRelevante' | 'criticidade' | 'pendencias'>,
  hoje = new Date(),
): LogisticaNfResumo {
  const statusAtual = classificarStatusAtual(nota.cte, nota.comprovante)
  const pendencias = [nota.cte, nota.comprovante]
    .map((documento) => pendenciaDoDocumento(nota, documento, hoje))
    .filter((item): item is PendenciaLogistica => item !== null)
  const obrigatorios = [nota.cte, nota.comprovante].filter((item) => item.obrigatorio)
  const aprovados = obrigatorios.filter((item) => item.status === 'APROVADO').length
  const principal = [...pendencias].sort((a, b) => {
    const prioridade = { CRITICA: 4, ALTA: 3, MEDIA: 2, NORMAL: 1, CONCLUIDA: 0 }
    return prioridade[b.criticidade] - prioridade[a.criticidade]
      || (a.prazoEfetivo || '9999').localeCompare(b.prazoEfetivo || '9999')
  })[0] ?? null
  const situacao: PrazoLogisticoRelevante['situacao'] = principal?.status === 'REJEITADO'
    ? 'rejeitado'
    : principal?.dias !== null && principal?.dias !== undefined && principal.dias < 0
      ? 'vencido'
      : principal?.dias === 0
        ? 'vence_hoje'
        : principal?.dias !== null && principal?.dias !== undefined && principal.dias <= 7
          ? 'proximo'
          : principal?.status === 'AGUARDANDO_ANALISE'
            ? 'em_analise'
            : principal
              ? 'aguardando_envio'
              : 'sem_pendencia'
  return {
    ...nota,
    statusAtual,
    cumprimentoDocumental: {
      obrigatorios: obrigatorios.length,
      aprovados,
      pendentes: obrigatorios.length - aprovados,
      completo: obrigatorios.length === aprovados,
    },
    prazoRelevante: {
      documento: principal?.documento ?? null,
      data: principal?.prazoEfetivo ?? null,
      prazoOriginal: principal?.prazoOriginal ?? null,
      novaPrevisao: principal?.novaPrevisao ?? null,
      dias: principal?.dias ?? null,
      situacao,
    },
    criticidade: statusAtual === 'ENTREGUE' && pendencias.length === 0 ? 'CONCLUIDA' : principal?.criticidade ?? 'NORMAL',
    pendencias,
  }
}

function incluiTermo(value: string | null | undefined, termo: string) {
  return String(value || '').toLocaleLowerCase('pt-BR').includes(termo)
}

function dataDoPeriodo(nota: LogisticaNfResumo, periodo: FiltrosCentralLogistica['periodo']) {
  if (periodo === 'operacao') return nota.operacao?.criadaEm ?? null
  if (periodo === 'cessao') return nota.operacao?.dataCessao ?? null
  if (periodo === 'desembolso') return nota.operacao?.desembolsadaEm ?? null
  if (periodo === 'vencimento') return nota.vencimento
  return nota.emissao
}

function atendePendencia(nota: LogisticaNfResumo, pendencia: NonNullable<FiltrosCentralLogistica['pendencia']>) {
  if (pendencia === 'sem_pendencia') return nota.pendencias.length === 0
  return nota.pendencias.some((item) => {
    if (pendencia === 'rejeitada') return item.status === 'REJEITADO'
    if (pendencia === 'vencida') return item.dias !== null && item.dias < 0
    if (pendencia === 'vence_hoje') return item.dias === 0
    if (pendencia === 'proximos_3_dias') return item.dias !== null && item.dias >= 0 && item.dias <= 3
    if (pendencia === 'proximos_7_dias') return item.dias !== null && item.dias >= 0 && item.dias <= 7
    if (pendencia === 'aguardando_envio') return item.status === 'NAO_ENVIADO'
    return item.status === 'AGUARDANDO_ANALISE'
  })
}

export function filtrarNotasCentral(notas: LogisticaNfResumo[], filtros: FiltrosCentralLogistica) {
  const termo = filtros.busca.toLocaleLowerCase('pt-BR')
  return notas.filter((nota) => {
    if (termo && ![
      nota.numeroNf, nota.chaveAcesso, nota.cedente, nota.cedenteCnpj,
      nota.sacado, nota.sacadoCnpj, nota.operacao?.id,
      ...nota.referenciasCte,
    ].some((item) => incluiTermo(item, termo))) return false
    if (filtros.cedente && nota.cedenteCnpj !== filtros.cedente) return false
    if (filtros.sacado && nota.sacadoCnpj !== filtros.sacado) return false
    if (filtros.operacao && nota.operacao?.id !== filtros.operacao) return false
    if (filtros.statusLogistico && nota.statusAtual !== filtros.statusLogistico) return false
    if (filtros.statusCte && nota.cte.status !== filtros.statusCte) return false
    if (filtros.statusComprovante && nota.comprovante.status !== filtros.statusComprovante) return false
    if (filtros.momentoCte && nota.cte.momento !== filtros.momentoCte) return false
    if (filtros.momentoComprovante && nota.comprovante.momento !== filtros.momentoComprovante) return false
    if (filtros.pendencia && !atendePendencia(nota, filtros.pendencia)) return false
    if (filtros.statusOperacao === 'sem_operacao' && nota.operacao) return false
    if (filtros.statusOperacao && filtros.statusOperacao !== 'sem_operacao' && nota.operacao?.status !== filtros.statusOperacao) return false
    const periodo = dataDoPeriodo(nota, filtros.periodo)?.slice(0, 10) ?? null
    if (filtros.dataDe && (!periodo || periodo < filtros.dataDe)) return false
    if (filtros.dataAte && (!periodo || periodo > filtros.dataAte)) return false
    if (filtros.visao === 'atencao_imediata' && !['CRITICA', 'ALTA'].includes(nota.criticidade)) return false
    if (filtros.visao === 'aguardando_gestor' && ![nota.cte, nota.comprovante].some((item) => item.status === 'AGUARDANDO_ANALISE')) return false
    if (filtros.visao === 'enviados_antecipadamente' && ![nota.cte, nota.comprovante].some((item) => item.momento === 'ANTECIPADO')) return false
    if (filtros.visao === 'entregues_na_cessao' && nota.statusCriacao !== 'ENTREGUE') return false
    if (filtros.visao === 'em_transito_na_cessao' && nota.statusCriacao !== 'EM_TRANSITO') return false
    if (filtros.visao === 'indeterminadas' && nota.statusAtual !== 'INDETERMINADA') return false
    return true
  })
}

export function ordenarNotasCentral(notas: LogisticaNfResumo[]) {
  const prioridade = { CRITICA: 5, ALTA: 4, MEDIA: 3, NORMAL: 2, CONCLUIDA: 1 }
  return [...notas].sort((a, b) => prioridade[b.criticidade] - prioridade[a.criticidade]
    || (a.prazoRelevante.data || '9999').localeCompare(b.prazoRelevante.data || '9999')
    || b.ultimaAtualizacao.localeCompare(a.ultimaAtualizacao)
    || a.notaFiscalId.localeCompare(b.notaFiscalId))
}

function metrica(notas: LogisticaNfResumo[]) {
  return { quantidade: notas.length, valor: notas.reduce((total, nota) => total + nota.valor, 0) }
}

function percentual(parte: number, total: number) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0
}

function media(valores: Array<number | null>) {
  const validos = valores.filter((item): item is number => item !== null)
  return validos.length ? Math.round((validos.reduce((a, b) => a + b, 0) / validos.length) * 10) / 10 : null
}

export function resumirCentralLogistica(notas: LogisticaNfResumo[]): ResumoCentralLogistica {
  const entregues = notas.filter((item) => item.statusAtual === 'ENTREGUE')
  const emTransito = notas.filter((item) => item.statusAtual === 'EM_TRANSITO')
  const indeterminadas = notas.filter((item) => item.statusAtual === 'INDETERMINADA')
  const vencidas = notas.filter((item) => item.pendencias.some((pendencia) => pendencia.dias !== null && pendencia.dias < 0))
  const antecipadas = notas.filter((item) => [item.cte, item.comprovante].some((documento) => documento.momento === 'ANTECIPADO'))
  return {
    acompanhadas: metrica(notas),
    entregues: metrica(entregues),
    emTransito: metrica(emTransito),
    indeterminadas: metrica(indeterminadas),
    pendenciasVencidas: metrica(vencidas),
    aguardandoAnalise: notas.flatMap((item) => [item.cte, item.comprovante]).filter((item) => item.status === 'AGUARDANDO_ANALISE').length,
    rejeitados: notas.flatMap((item) => [item.cte, item.comprovante]).filter((item) => item.status === 'REJEITADO').length,
    enviadosAntecipadamente: { quantidade: antecipadas.length, percentual: percentual(antecipadas.length, notas.length) },
  }
}

export function indicadoresCentralLogistica(notas: LogisticaNfResumo[], postergacoes: number): IndicadoresComportamentoLogistico {
  const comCriacao = notas.filter((item) => item.statusCriacao)
  const comCessaoCte = notas.filter((item) => item.operacao?.dataCessao && item.cte.primeiroUploadEm)
  const comCessaoComprovante = notas.filter((item) => item.operacao?.dataCessao && item.comprovante.aprovadoEm)
  return {
    entreguesNaCriacaoPercentual: comCriacao.length ? percentual(comCriacao.filter((item) => item.statusCriacao === 'ENTREGUE').length, comCriacao.length) : null,
    emTransitoNaCriacaoPercentual: comCriacao.length ? percentual(comCriacao.filter((item) => item.statusCriacao === 'EM_TRANSITO').length, comCriacao.length) : null,
    ctesAntecipadosPercentual: percentual(notas.filter((item) => item.cte.momento === 'ANTECIPADO').length, notas.length),
    comprovantesAntecipadosPercentual: percentual(notas.filter((item) => item.comprovante.momento === 'ANTECIPADO').length, notas.length),
    mediaDiasCessaoComprovanteAprovado: media(comCessaoComprovante.map((item) => diferencaDiasCivis(item.operacao?.dataCessao ?? null, item.comprovante.aprovadoEm))),
    mediaDiasCessaoCteEnviado: media(comCessaoCte.map((item) => diferencaDiasCivis(item.operacao?.dataCessao ?? null, item.cte.primeiroUploadEm))),
    postergacoes,
    documentosRejeitados: notas.flatMap((item) => [item.cte, item.comprovante]).filter((item) => item.status === 'REJEITADO').length,
  }
}

export function agregarCtesCentral(input: Array<{
  cteId: string
  chave: string | null
  numero: string | null
  cedente: string
  cedenteCnpj: string
  documento: DocumentoLogisticoCentral
  nota: LogisticaNfResumo
}>): CteLogisticoResumo[] {
  const porCte = new Map<string, typeof input>()
  for (const item of input) porCte.set(item.cteId, [...(porCte.get(item.cteId) || []), item])
  return [...porCte.values()].map<CteLogisticoResumo>((itens) => {
    const base = itens[0]
    const momentos = new Set<MomentoDocumentoLogistico>(itens.map((item) => item.documento.momento))
    return {
      cteId: base.cteId,
      chave: base.chave,
      numero: base.numero,
      cedente: base.cedente,
      cedenteCnpj: base.cedenteCnpj,
      quantidadeNfs: itens.length,
      valorRelacionado: itens.reduce((total, item) => total + item.nota.valor, 0),
      status: base.documento.status,
      primeiroUploadEm: base.documento.primeiroUploadEm,
      momento: momentos.size === 1 ? ([...momentos][0] ?? 'INDETERMINADO') : 'MISTO',
      aprovadoEm: base.documento.aprovadoEm,
      operacoesRelacionadas: new Set(itens.map((item) => item.nota.operacao?.id).filter(Boolean)).size,
      nfs: itens.map((item) => ({
        notaFiscalId: item.nota.notaFiscalId,
        numeroNf: item.nota.numeroNf,
        operacaoId: item.nota.operacao?.id ?? null,
        valor: item.nota.valor,
        statusLogistico: item.nota.statusAtual,
        statusDocumental: item.documento.status,
      })),
    }
  }).sort((a, b) => (b.primeiroUploadEm || '').localeCompare(a.primeiroUploadEm || '') || a.cteId.localeCompare(b.cteId))
}

export function statusHistorico(
  memorias: Array<{ etapa: string; status: StatusLogisticoPreCessao; createdAt: string }>,
  etapa: 'criacao' | 'aprovacao',
) {
  return [...memorias]
    .filter((item) => item.etapa === etapa)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.status ?? null
}
