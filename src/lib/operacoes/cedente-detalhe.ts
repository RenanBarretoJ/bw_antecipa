export type OperacaoCedenteStatus =
  | 'solicitada'
  | 'em_analise'
  | 'aprovada'
  | 'em_andamento'
  | 'liquidada'
  | 'inadimplente'
  | 'reprovada'
  | 'cancelada'
  | string

export type EntregaCedenteStatus =
  | 'nao_aplicavel'
  | 'em_transito'
  | 'aguardando_validacao'
  | 'entregue'
  | 'entrega_com_pendencia'
  | 'devolvida'
  | 'cancelada'
  | string

export type RequisitoCedenteStatus = 'pendente' | 'satisfeito' | 'vencido' | 'dispensado' | 'cancelado' | string

export interface OperacaoCedenteRaw {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: OperacaoCedenteStatus
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  aprovado_em: string | null
  cessao_efetivada_em: string | null
  liquidada_em: string | null
  created_at: string
  motivo_reprovacao: string | null
  termo_assinado_url: string | null
  comprovante_pagamento_url: string | null
  quitacao_assinada_url: string | null
  cedentes: { razao_social: string; cnpj: string } | null
}

export interface NotaFiscalCedenteRaw {
  id: string
  numero_nf: string | null
  cnpj_destinatario: string | null
  razao_social_destinatario: string | null
  valor_bruto: number
  valor_liquido: number | null
  valor_antecipado: number | null
  data_vencimento: string
  status: string
}

export interface EntregaCedenteRaw {
  id: string
  nota_fiscal_id: string
  status_entrega: EntregaCedenteStatus
  data_limite_cte: string | null
  data_limite_canhoto: string | null
  data_entrega: string | null
  entrega_confirmada_em: string | null
  motivo_pendencia: string | null
}

export interface RequisitoCedenteRaw {
  id: string
  tipo_documento_codigo_snapshot: string
  escopo_snapshot: string
  nota_fiscal_id: string | null
  nota_fiscal_entrega_id: string | null
  operacao_id: string | null
  status: RequisitoCedenteStatus
  obrigatorio: boolean
  prazo_limite: string | null
  responsavel_upload_snapshot: string
}

export interface OperacaoCedenteDetalhe {
  id: string
  codigoCurto: string
  status: string
  statusLabel: string
  solicitadaEm: string
  cedente: { razaoSocial: string; cnpj: string }
  mensagemAceite: string | null
  possuiPendenciaCedente: boolean
  financeiro: {
    valorBrutoSolicitado: number
    valorLiquidoAprovado: number
    valorEfetivamenteDesembolsado: number | null
    taxaAplicada: number
    prazoDias: number
    vencimento: string
    aprovadoEm: string | null
    desembolsadoEm: string | null
    liquidadaEm: string | null
  }
  notasFiscais: Array<{
    id: string
    numero: string
    sacado: string
    cnpjSacado: string | null
    valorBruto: number
    valorAntecipado: number | null
    vencimento: string
    status: string
    statusLabel: string
    href: string
  }>
  timeline: Array<{ key: string; label: string; status: 'concluido' | 'atual' | 'pendente' | 'bloqueado'; date: string | null }>
  pendenciasCedente: Array<{
    id: string
    descricao: string
    notaFiscalId: string | null
    notaFiscalNumero: string | null
    prazo: string | null
    situacaoPrazo: 'sem_prazo' | 'no_prazo' | 'vence_hoje' | 'atrasado'
    dias: number | null
    status: string
    acaoHref: string | null
  }>
  logistica: {
    habilitada: boolean
    statusLabel: string
    emTransito: number
    comPendencia: number
    concluidas: number
    prazoMaisProximo: string | null
    diasPrazoMaisProximo: number | null
    notas: Array<{ notaFiscalId: string; numero: string | null; status: string; statusLabel: string; prazoMaisProximo: string | null; href: string }>
  }
  comprovantes: Array<{ key: 'termo_assinado' | 'comprovante_pagamento' | 'quitacao_assinada'; label: string; tipoDocumento: string }>
}

const operacaoStatusLabels: Record<string, string> = {
  solicitada: 'Solicitada',
  em_analise: 'Em análise',
  aprovada: 'Aprovada — aguardando desembolso',
  em_andamento: 'Em andamento',
  liquidada: 'Liquidada',
  inadimplente: 'Inadimplente',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
}

const nfStatusLabels: Record<string, string> = {
  rascunho: 'Rascunho',
  submetida: 'Submetida',
  em_analise: 'Em análise',
  aprovada: 'Validada',
  em_antecipacao: 'Em antecipação',
  aceita: 'Antecipada',
  liquidada: 'Liquidada',
  cancelada: 'Cancelada',
}

const entregaStatusLabels: Record<string, string> = {
  nao_aplicavel: 'Sem acompanhamento',
  em_transito: 'Em trânsito',
  aguardando_validacao: 'Comprovante enviado',
  entregue: 'Entrega confirmada',
  entrega_com_pendencia: 'Em atraso',
  devolvida: 'Devolvida',
  cancelada: 'Cancelada',
}

const tipoDocumentoLabels: Record<string, string> = {
  cte: 'CT-e',
  cte_xml: 'CT-e XML',
  cte_pdf_dacte: 'DACTE',
  canhoto: 'Canhoto',
  comprovante_entrega: 'Comprovante de entrega',
  nf_xml: 'XML da NF-e',
  nf_danfe_pdf: 'DANFE em PDF',
  nf_pedido_compra: 'Pedido de compra',
}

function differenceInCalendarDays(date: string, today: Date) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(`${date.slice(0, 10)}T00:00:00`).getTime()
  return Math.round((target - base) / 86_400_000)
}

export function calcularSituacaoPrazo(prazo: string | null, today = new Date()) {
  if (!prazo) return { situacaoPrazo: 'sem_prazo' as const, dias: null }
  const dias = differenceInCalendarDays(prazo, today)
  if (dias < 0) return { situacaoPrazo: 'atrasado' as const, dias }
  if (dias === 0) return { situacaoPrazo: 'vence_hoje' as const, dias }
  return { situacaoPrazo: 'no_prazo' as const, dias }
}

function prazoMaisProximo(entrega: EntregaCedenteRaw) {
  const prazos = [entrega.data_limite_cte, entrega.data_limite_canhoto].filter(Boolean) as string[]
  return prazos.sort()[0] || null
}

function statusTimeline(done: boolean, active: boolean, blocked = false): 'concluido' | 'atual' | 'pendente' | 'bloqueado' {
  if (blocked) return 'bloqueado'
  if (done) return 'concluido'
  if (active) return 'atual'
  return 'pendente'
}

export function montarDetalheOperacaoCedente({
  operacao,
  notasFiscais,
  entregas,
  requisitos,
  today = new Date(),
}: {
  operacao: OperacaoCedenteRaw
  notasFiscais: NotaFiscalCedenteRaw[]
  entregas: EntregaCedenteRaw[]
  requisitos: RequisitoCedenteRaw[]
  today?: Date
}): OperacaoCedenteDetalhe {
  const nfById = new Map(notasFiscais.map((nf) => [nf.id, nf]))
  const entregaById = new Map(entregas.map((entrega) => [entrega.id, entrega]))
  const liquidada = operacao.status === 'liquidada'
  const desembolsada = ['em_andamento', 'liquidada', 'inadimplente'].includes(operacao.status)
  const aprovada = !!operacao.aprovado_em || ['aprovada', 'em_andamento', 'liquidada', 'inadimplente'].includes(operacao.status)
  const documentacaoValidada = notasFiscais.length > 0 && notasFiscais.every((nf) => ['aprovada', 'em_antecipacao', 'aceita', 'liquidada'].includes(nf.status))
  const pendenciasCedente = requisitos
    .filter((requisito) => requisito.responsavel_upload_snapshot === 'cedente')
    .filter((requisito) => ['pendente', 'vencido'].includes(requisito.status))
    .map((requisito) => {
      const nf = requisito.nota_fiscal_id ? nfById.get(requisito.nota_fiscal_id) : requisito.nota_fiscal_entrega_id ? nfById.get(entregaById.get(requisito.nota_fiscal_entrega_id)?.nota_fiscal_id || '') : null
      const prazo = requisito.prazo_limite
      const situacao = calcularSituacaoPrazo(prazo, today)
      const tipo = tipoDocumentoLabels[requisito.tipo_documento_codigo_snapshot] || requisito.tipo_documento_codigo_snapshot
      return {
        id: requisito.id,
        descricao: `${tipo}${requisito.obrigatorio ? ' obrigatório' : ' opcional'} pendente`,
        notaFiscalId: nf?.id || requisito.nota_fiscal_id,
        notaFiscalNumero: nf?.numero_nf || null,
        prazo,
        situacaoPrazo: situacao.situacaoPrazo,
        dias: situacao.dias,
        status: requisito.status,
        acaoHref: nf?.id ? `/cedente/notas-fiscais/${nf.id}` : null,
      }
    })

  const prazoLogisticoMaisProximo = entregas.map(prazoMaisProximo).filter(Boolean).sort()[0] || null
  const statusLogistico = entregas.length === 0
    ? (desembolsada ? 'Sem acompanhamento logístico' : 'Aguardando desembolso')
    : entregas.some((entrega) => entrega.status_entrega === 'entrega_com_pendencia')
      ? 'Em atraso'
      : entregas.every((entrega) => entrega.status_entrega === 'entregue')
        ? 'Entrega confirmada'
        : entregas.some((entrega) => entrega.status_entrega === 'aguardando_validacao')
          ? 'Comprovante enviado'
          : entregas.some((entrega) => entrega.status_entrega === 'em_transito')
            ? 'Em trânsito'
            : 'Acompanhamento iniciado'

  return {
    id: operacao.id,
    codigoCurto: operacao.id.slice(0, 8),
    status: operacao.status,
    statusLabel: operacaoStatusLabels[operacao.status] || operacao.status.replaceAll('_', ' '),
    solicitadaEm: operacao.created_at,
    cedente: {
      razaoSocial: operacao.cedentes?.razao_social || 'Cedente não informado',
      cnpj: operacao.cedentes?.cnpj || '',
    },
    mensagemAceite: operacao.aceite_sacado_status === 'contestado' ? 'Contestada pelo sacado.' : null,
    possuiPendenciaCedente: pendenciasCedente.length > 0,
    financeiro: {
      valorBrutoSolicitado: operacao.valor_bruto_total,
      valorLiquidoAprovado: operacao.valor_liquido_desembolso,
      valorEfetivamenteDesembolsado: desembolsada ? operacao.valor_liquido_desembolso : null,
      taxaAplicada: operacao.taxa_desconto,
      prazoDias: operacao.prazo_dias,
      vencimento: operacao.data_vencimento,
      aprovadoEm: operacao.aprovado_em,
      desembolsadoEm: operacao.cessao_efetivada_em,
      liquidadaEm: operacao.liquidada_em,
    },
    notasFiscais: notasFiscais.map((nf) => ({
      id: nf.id,
      numero: nf.numero_nf || '—',
      sacado: nf.razao_social_destinatario || '—',
      cnpjSacado: nf.cnpj_destinatario,
      valorBruto: nf.valor_bruto,
      valorAntecipado: nf.valor_antecipado ?? nf.valor_liquido,
      vencimento: nf.data_vencimento,
      status: nf.status,
      statusLabel: nfStatusLabels[nf.status] || nf.status.replaceAll('_', ' '),
      href: `/cedente/notas-fiscais/${nf.id}`,
    })),
    timeline: [
      { key: 'solicitacao', label: 'Solicitação enviada', status: 'concluido', date: operacao.created_at },
      { key: 'documentacao', label: 'Documentação validada', status: statusTimeline(documentacaoValidada, ['solicitada', 'em_analise'].includes(operacao.status)), date: documentacaoValidada ? operacao.aprovado_em : null },
      { key: 'aprovacao', label: 'Operação aprovada', status: statusTimeline(aprovada, operacao.status === 'em_analise'), date: operacao.aprovado_em },
      { key: 'desembolso', label: 'Desembolso realizado', status: statusTimeline(desembolsada, operacao.status === 'aprovada'), date: operacao.cessao_efetivada_em },
      { key: 'transito', label: 'Entrega em acompanhamento', status: statusTimeline(entregas.length > 0, desembolsada && entregas.length === 0), date: entregas[0]?.data_entrega || null },
      { key: 'comprovante', label: 'Comprovante de entrega recebido', status: statusTimeline(entregas.some((entrega) => ['aguardando_validacao', 'entregue'].includes(entrega.status_entrega)), entregas.some((entrega) => entrega.status_entrega === 'em_transito')), date: null },
      { key: 'entrega', label: 'Entrega confirmada', status: statusTimeline(entregas.length > 0 && entregas.every((entrega) => entrega.status_entrega === 'entregue'), false), date: entregas.find((entrega) => entrega.entrega_confirmada_em)?.entrega_confirmada_em || null },
      { key: 'liquidacao', label: 'Liquidação concluída', status: statusTimeline(liquidada, operacao.status === 'em_andamento'), date: operacao.liquidada_em },
    ],
    pendenciasCedente,
    logistica: {
      habilitada: entregas.length > 0,
      statusLabel: statusLogistico,
      emTransito: entregas.filter((entrega) => entrega.status_entrega === 'em_transito').length,
      comPendencia: entregas.filter((entrega) => entrega.status_entrega === 'entrega_com_pendencia').length,
      concluidas: entregas.filter((entrega) => entrega.status_entrega === 'entregue').length,
      prazoMaisProximo: prazoLogisticoMaisProximo,
      diasPrazoMaisProximo: prazoLogisticoMaisProximo ? calcularSituacaoPrazo(prazoLogisticoMaisProximo, today).dias : null,
      notas: entregas.map((entrega) => {
        const nf = nfById.get(entrega.nota_fiscal_id)
        const prazo = prazoMaisProximo(entrega)
        return {
          notaFiscalId: entrega.nota_fiscal_id,
          numero: nf?.numero_nf || null,
          status: entrega.status_entrega,
          statusLabel: entregaStatusLabels[entrega.status_entrega] || entrega.status_entrega.replaceAll('_', ' '),
          prazoMaisProximo: prazo,
          href: `/cedente/notas-fiscais/${entrega.nota_fiscal_id}`,
        }
      }),
    },
    comprovantes: [
      ...(operacao.termo_assinado_url ? [{ key: 'termo_assinado' as const, label: 'Termo de cessão assinado', tipoDocumento: 'termo_assinado' }] : []),
      ...(operacao.comprovante_pagamento_url ? [{ key: 'comprovante_pagamento' as const, label: 'Comprovante de pagamento', tipoDocumento: 'comprovante_pagamento' }] : []),
      ...(operacao.quitacao_assinada_url ? [{ key: 'quitacao_assinada' as const, label: 'Termo de quitação assinado', tipoDocumento: 'quitacao_assinada' }] : []),
    ],
  }
}

export function contemCampoTecnicoExposto(value: unknown): boolean {
  const serialized = JSON.stringify(value)
  return ['cnab', 'remessa', 'fromtis', 'portal_fidc', 'integracao', 'configuracao_cnab', 'protocolo'].some((term) => serialized.toLowerCase().includes(term))
}
