export type SacadoPortalNfStatus =
  | 'rascunho'
  | 'submetida'
  | 'validada'
  | 'em_antecipacao'
  | 'aprovada'
  | 'aceita'
  | 'contestada'
  | 'liquidada'
  | 'cancelada'
  | string

export type SacadoPortalOperacaoStatus =
  | 'solicitada'
  | 'em_analise'
  | 'aprovada'
  | 'em_andamento'
  | 'liquidada'
  | 'inadimplente'
  | 'reprovada'
  | 'cancelada'
  | string

export type SacadoPortalAceiteStatus = 'pendente' | 'aceito' | 'contestado' | 'dispensado' | string | null

export type SacadoPortalOperacao = {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: SacadoPortalOperacaoStatus
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: SacadoPortalAceiteStatus
  created_at?: string | null
  cedentes: { razao_social: string; cnpj: string } | null
  contas_escrow: { identificador: string } | null
}

export type SacadoPortalNotaFiscal = {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_emissao?: string | null
  data_vencimento: string
  status: SacadoPortalNfStatus
  cedente_id: string
  arquivo_url?: string | null
  operacao_id: string
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: SacadoPortalAceiteStatus
  operacao_status: SacadoPortalOperacaoStatus | null
}

export type SacadoPortalNotaFiscalRecebida =
  Omit<SacadoPortalNotaFiscal, 'operacao_id' | 'aceite_sacado_exigido' | 'aceite_sacado_status' | 'operacao_status'> & {
    operacao_id: string | null
    aceite_sacado_exigido: boolean | null
    aceite_sacado_status: SacadoPortalAceiteStatus
    operacao_status: SacadoPortalOperacaoStatus | null
  }

export type SacadoPortalLink = {
  operacao_id: string
  nota_fiscal_id: string
}

export type SacadoDashboardResumo = {
  nfsAtivas: SacadoPortalNotaFiscal[]
  totalDevido: number
  vencimentosHoje: SacadoPortalNotaFiscal[]
  vencidos: SacadoPortalNotaFiscal[]
  proximos7d: SacadoPortalNotaFiscal[]
}

const OPERACAO_STATUS_PAGAMENTO_ABERTO = new Set(['aprovada', 'em_andamento', 'inadimplente'])
const OPERACAO_STATUS_TERMINAL = new Set(['liquidada', 'cancelada', 'reprovada'])
const ACEITE_STATUS_FINAL = new Set(['aceito', 'contestado', 'dispensado'])

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export function vincularNfsComOperacoes({
  nfs,
  links,
  operacoes,
}: {
  nfs: Array<Omit<SacadoPortalNotaFiscal, 'operacao_id' | 'aceite_sacado_exigido' | 'aceite_sacado_status' | 'operacao_status'>>
  links: SacadoPortalLink[]
  operacoes: SacadoPortalOperacao[]
}): SacadoPortalNotaFiscal[] {
  const operationById = new Map(operacoes.map((operation) => [operation.id, operation]))
  const linkByNf = new Map<string, string>()
  const vinculadas: SacadoPortalNotaFiscal[] = []

  for (const link of links) {
    if (!linkByNf.has(link.nota_fiscal_id)) linkByNf.set(link.nota_fiscal_id, link.operacao_id)
  }

  for (const nf of nfs) {
    const operacaoId = linkByNf.get(nf.id)
    if (!operacaoId) continue
    const operacao = operationById.get(operacaoId)
    if (!operacao) continue

    vinculadas.push({
      ...nf,
      operacao_id: operacaoId,
      aceite_sacado_exigido: operacao.aceite_sacado_exigido,
      aceite_sacado_status: operacao.aceite_sacado_status,
      operacao_status: operacao.status,
    })
  }

  return vinculadas
}

export function listarNfsRecebidasComContextoOperacional({
  nfs,
  links,
  operacoes,
}: {
  nfs: Array<Omit<SacadoPortalNotaFiscal, 'operacao_id' | 'aceite_sacado_exigido' | 'aceite_sacado_status' | 'operacao_status'>>
  links: SacadoPortalLink[]
  operacoes: SacadoPortalOperacao[]
}): SacadoPortalNotaFiscalRecebida[] {
  const operationById = new Map(operacoes.map((operation) => [operation.id, operation]))
  const linkByNf = new Map<string, string>()

  for (const link of links) {
    if (!linkByNf.has(link.nota_fiscal_id)) linkByNf.set(link.nota_fiscal_id, link.operacao_id)
  }

  return nfs.map((nf) => {
    const operacaoId = linkByNf.get(nf.id) ?? null
    const operacao = operacaoId ? operationById.get(operacaoId) : null

    return {
      ...nf,
      operacao_id: operacaoId,
      aceite_sacado_exigido: operacao?.aceite_sacado_exigido ?? null,
      aceite_sacado_status: operacao?.aceite_sacado_status ?? null,
      operacao_status: operacao?.status ?? null,
    }
  })
}

export function operacaoAbertaParaPagamento(status: SacadoPortalOperacaoStatus | null | undefined): boolean {
  return !!status && OPERACAO_STATUS_PAGAMENTO_ABERTO.has(status)
}

export function operacaoTerminal(status: SacadoPortalOperacaoStatus | null | undefined): boolean {
  return !!status && OPERACAO_STATUS_TERMINAL.has(status)
}

export function nfContaComoAtivaParaSacado(nf: SacadoPortalNotaFiscal): boolean {
  return operacaoAbertaParaPagamento(nf.operacao_status)
}

export function nfPendenteAceiteSacado(nf: SacadoPortalNotaFiscal): boolean {
  if (nf.aceite_sacado_exigido === false) return false
  if (nf.aceite_sacado_status && ACEITE_STATUS_FINAL.has(nf.aceite_sacado_status)) return false
  if (operacaoTerminal(nf.operacao_status)) return false
  return nf.status === 'em_antecipacao' || nf.status === 'aprovada' || nf.status === 'submetida' || nf.status === 'validada'
}

export function calcularDashboardSacado(nfs: SacadoPortalNotaFiscal[], hojeIso: string): SacadoDashboardResumo {
  const nfsAtivas = nfs.filter(nfContaComoAtivaParaSacado)
  const hoje = parseIsoDate(hojeIso)
  const em7d = new Date(hoje)
  em7d.setDate(em7d.getDate() + 7)

  return {
    nfsAtivas,
    totalDevido: nfsAtivas.reduce((acc, nf) => acc + Number(nf.valor_bruto || 0), 0),
    vencimentosHoje: nfsAtivas.filter((nf) => nf.data_vencimento === hojeIso),
    vencidos: nfsAtivas.filter((nf) => nf.data_vencimento < hojeIso),
    proximos7d: nfsAtivas.filter((nf) => {
      const vencimento = parseIsoDate(nf.data_vencimento)
      return vencimento > hoje && vencimento <= em7d
    }),
  }
}

export function filtrarOperacoesSacadoPorStatus(operacoes: SacadoPortalOperacao[], statuses: string[]): SacadoPortalOperacao[] {
  const allowed = new Set(statuses)
  return operacoes.filter((operacao) => allowed.has(operacao.status))
}
