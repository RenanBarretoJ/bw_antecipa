import Decimal from 'decimal.js'
import { calcularDefasagemPl } from '@/lib/financeiro/pl-referencia'

export type ClassificacaoExposicaoOperacional =
  | 'ABAIXO_LIMITE'
  | 'NO_LIMITE'
  | 'ACIMA_LIMITE'
  | 'INDETERMINADA'

export type StatusExposicaoDashboard =
  | 'DENTRO_LIMITE'
  | 'NO_LIMITE'
  | 'PROXIMO_LIMITE'
  | 'ACIMA_LIMITE'
  | 'INDETERMINADA'

export type ControleExposicaoSnapshot = {
  ativo: boolean
  limitePct: number | null
}

export type VisaoExposicaoOperacional = {
  aplicavel: boolean
  fundoNome: string | null
  patrimonioLiquido: number | null
  dataBasePl: string | null
  defasagemPl: string | null
  origemPl: string | null
  exposicaoAtualValor: number | null
  exposicaoAtualPct: number | null
  candidatoValor: number | null
  candidatoPct: number | null
  candidatoEmTransitoValor: number | null
  exposicaoProjetadaValor: number | null
  exposicaoProjetadaPct: number | null
  limitePct: number
  margemValor: number | null
  margemPct: number | null
  classificacao: ClassificacaoExposicaoOperacional
  statusDashboard: StatusExposicaoDashboard
  motivo: string | null
  avaliadaEm: string | null
}

export type ProformaExposicaoSelecao = VisaoExposicaoOperacional & {
  quantidadeNfs: number
  quantidadeParcelas: number
}

export type RiskExecutionLike = {
  status_tecnico?: unknown
  decisao?: unknown
  patrimonio_liquido_d2?: unknown
  exposicao_atual_valor?: unknown
  exposicao_atual_pct?: unknown
  operacao_valor_aquisicao?: unknown
  operacao_valor_em_transito?: unknown
  exposicao_projetada_valor?: unknown
  exposicao_projetada_pct?: unknown
  limite_pct?: unknown
  finalizado_em?: unknown
  created_at?: unknown
  data_operacional?: unknown
}

export type ExposureExecutionLike = {
  status?: unknown
  patrimonio_liquido_d2?: unknown
  exposicao_em_transito_total?: unknown
  percentual_exposicao?: unknown
  limite_referencia_pct?: unknown
  data_referencia_pl?: unknown
  data_operacional?: unknown
  finalizado_em?: unknown
  created_at?: unknown
}

export type PlReferenciaExposicaoAtual = {
  patrimonioLiquido: string | number
  dataBase: string
  dataOperacional: string
}

const MOTIVOS_OPERACIONAIS: Record<string, string> = {
  EXPOSICAO_ACIMA_LIMITE: 'A exposição projetada ultrapassa o limite definido pela política.',
  PL_D2_INDISPONIVEL: 'O patrimônio líquido oficial da data-base ainda não está disponível.',
  PL_D2_INVALIDO: 'O patrimônio líquido oficial da data-base é inválido.',
  PL_OFICIAL_INDISPONIVEL: 'A primeira posição oficial do fundo ainda não foi publicada.',
  POSICAO_SEM_MATCH: 'Existem posições financeiras sem conciliação segura.',
  EXPOSICAO_INDETERMINADA: 'Parte da exposição atual do fundo ainda está indeterminada.',
  OPERACAO_NAO_INCORPORADA_ESTOQUE: 'Existem operações anteriores ainda não incorporadas ao estoque oficial.',
  VALOR_AQUISICAO_INDISPONIVEL: 'Existem posições sem valor de aquisição disponível.',
  VALOR_AQUISICAO_OPERACAO_INDISPONIVEL: 'O valor presente da operação ainda não pôde ser determinado.',
  AVALIACAO_RISCO_INDISPONIVEL: 'A avaliação depende de dados financeiros oficiais que ainda não estão disponíveis.',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function decimal(value: number | null): Decimal | null {
  return value === null ? null : new Decimal(value)
}

export function resolverControleExposicaoDoSnapshot(snapshot: unknown): ControleExposicaoSnapshot {
  const raw = asRecord(snapshot)
  const limitePct = numeric(raw.limite_exposicao_em_transito_pct)
  return {
    ativo: raw.controle_exposicao_logistica_ativo === true && limitePct !== null && limitePct > 0,
    limitePct,
  }
}

function resolverClassificacao(input: {
  concluida: boolean
  percentual: number | null
  limite: number
  motivos: string[]
}): ClassificacaoExposicaoOperacional {
  if (!input.concluida || input.percentual === null) return 'INDETERMINADA'
  if (input.motivos.includes('EXPOSICAO_ACIMA_LIMITE') || input.percentual > input.limite) return 'ACIMA_LIMITE'
  if (input.motivos.includes('NO_LIMITE') || input.percentual === input.limite) return 'NO_LIMITE'
  return 'ABAIXO_LIMITE'
}

function resolverStatusDashboard(classificacao: ClassificacaoExposicaoOperacional, percentual: number | null, limite: number): StatusExposicaoDashboard {
  if (classificacao === 'INDETERMINADA') return 'INDETERMINADA'
  if (classificacao === 'ACIMA_LIMITE') return 'ACIMA_LIMITE'
  if (classificacao === 'NO_LIMITE') return 'NO_LIMITE'
  return percentual !== null && new Decimal(percentual).gte(new Decimal(limite).times('0.9'))
    ? 'PROXIMO_LIMITE'
    : 'DENTRO_LIMITE'
}

function calcularMargens(pl: number | null, exposicao: number | null, percentual: number | null, limite: number) {
  const limiteValor = decimal(pl)?.times(limite).dividedBy(100) ?? null
  return {
    margemValor: limiteValor !== null && exposicao !== null ? limiteValor.minus(exposicao).toNumber() : null,
    margemPct: percentual !== null ? new Decimal(limite).minus(percentual).toNumber() : null,
  }
}

export function montarProformaExposicaoSelecao(input: {
  atual: VisaoExposicaoOperacional
  candidatoValor: number | null
  quantidadeNfs: number
  quantidadeParcelas: number
  motivoCandidato?: string | null
}): ProformaExposicaoSelecao {
  const { atual } = input
  const candidato = decimal(input.candidatoValor)
  const exposicaoAtual = decimal(atual.exposicaoAtualValor)
  const pl = decimal(atual.patrimonioLiquido)
  const baseDeterminada = atual.classificacao !== 'INDETERMINADA'
    && exposicaoAtual !== null
    && atual.exposicaoAtualPct !== null
    && pl !== null
    && pl.gt(0)
  const projetada = baseDeterminada && candidato !== null
    ? exposicaoAtual.plus(candidato)
    : null
  const projetadaPct = projetada !== null && pl !== null
    ? projetada.dividedBy(pl).times(100).toNumber()
    : null
  const classificacao = resolverClassificacao({
    concluida: projetadaPct !== null,
    percentual: projetadaPct,
    limite: atual.limitePct,
    motivos: [],
  })
  const margem = calcularMargens(
    atual.patrimonioLiquido,
    projetada?.toNumber() ?? null,
    projetadaPct,
    atual.limitePct,
  )
  const candidatoPct = candidato !== null && pl !== null && pl.gt(0)
    ? candidato.dividedBy(pl).times(100).toNumber()
    : null

  return {
    ...atual,
    candidatoValor: candidato?.toNumber() ?? null,
    candidatoPct,
    candidatoEmTransitoValor: candidato?.toNumber() ?? null,
    exposicaoProjetadaValor: projetada?.toNumber() ?? null,
    exposicaoProjetadaPct: projetadaPct,
    margemValor: margem.margemValor,
    margemPct: margem.margemPct,
    classificacao,
    statusDashboard: resolverStatusDashboard(classificacao, projetadaPct, atual.limitePct),
    motivo: input.motivoCandidato || (baseDeterminada ? null : atual.motivo),
    quantidadeNfs: input.quantidadeNfs,
    quantidadeParcelas: input.quantidadeParcelas,
  }
}

function motivoOperacional(codigos: string[], fallback: string | null = null) {
  const codigo = codigos.find((item) => MOTIVOS_OPERACIONAIS[item])
  return codigo ? MOTIVOS_OPERACIONAIS[codigo] : fallback
}

export function montarVisaoExposicaoOperacao(input: {
  controle: ControleExposicaoSnapshot
  execucao: RiskExecutionLike | null
  motivos?: string[]
  dataBasePl?: string | null
  dataOperacional?: string | null
  origemPl?: string | null
  fundoNome?: string | null
  motivoFallback?: string | null
}): VisaoExposicaoOperacional | null {
  if (!input.controle.ativo || input.controle.limitePct === null) return null

  const execucao = input.execucao
  const motivos = input.motivos || []
  const limite = input.controle.limitePct
  const pl = numeric(execucao?.patrimonio_liquido_d2)
  const atualValor = numeric(execucao?.exposicao_atual_valor)
  const atualPct = numeric(execucao?.exposicao_atual_pct)
  const candidatoValor = numeric(execucao?.operacao_valor_aquisicao)
  const candidatoEmTransito = numeric(execucao?.operacao_valor_em_transito)
  const projetadaValor = numeric(execucao?.exposicao_projetada_valor)
  const projetadaPct = numeric(execucao?.exposicao_projetada_pct)
  const concluida = execucao?.status_tecnico === 'CONCLUIDA'
  const classificacao = resolverClassificacao({ concluida, percentual: projetadaPct, limite, motivos })
  const margem = calcularMargens(pl, projetadaValor, projetadaPct, limite)
  const candidatoPct = pl !== null && pl > 0 && candidatoValor !== null
    ? new Decimal(candidatoValor).dividedBy(pl).times(100).toNumber()
    : null

  return {
    aplicavel: true,
    fundoNome: input.fundoNome || null,
    patrimonioLiquido: pl,
    dataBasePl: input.dataBasePl || null,
    defasagemPl: input.dataOperacional && input.dataBasePl
      ? calcularDefasagemPl(input.dataOperacional, input.dataBasePl)
      : null,
    origemPl: input.origemPl || null,
    exposicaoAtualValor: atualValor,
    exposicaoAtualPct: atualPct,
    candidatoValor,
    candidatoPct,
    candidatoEmTransitoValor: candidatoEmTransito,
    exposicaoProjetadaValor: projetadaValor,
    exposicaoProjetadaPct: projetadaPct,
    limitePct: limite,
    margemValor: margem.margemValor,
    margemPct: margem.margemPct,
    classificacao,
    statusDashboard: resolverStatusDashboard(classificacao, projetadaPct, limite),
    motivo: input.motivoFallback || (execucao
      ? motivoOperacional(motivos, concluida ? null : MOTIVOS_OPERACIONAIS.AVALIACAO_RISCO_INDISPONIVEL)
      : 'A avaliação desta operação ainda não foi executada.'),
    avaliadaEm: String(execucao?.finalizado_em || execucao?.created_at || '') || null,
  }
}

export function montarVisaoExposicaoFundo(input: {
  controle: ControleExposicaoSnapshot
  execucao: ExposureExecutionLike | null
  fundoNome: string
  plReferencia: PlReferenciaExposicaoAtual | null
  origemPl?: string | null
}): VisaoExposicaoOperacional | null {
  if (!input.controle.ativo || input.controle.limitePct === null) return null

  const execucao = input.execucao
  const limite = input.controle.limitePct
  const pl = numeric(input.plReferencia?.patrimonioLiquido)
  const atualValor = numeric(execucao?.exposicao_em_transito_total)
  const concluida = execucao?.status === 'CALCULADA'
  const atualPct = concluida && pl !== null && pl > 0 && atualValor !== null
    ? new Decimal(atualValor).dividedBy(pl).times(100).toNumber()
    : null
  const classificacao = resolverClassificacao({ concluida, percentual: atualPct, limite, motivos: [] })
  const margem = calcularMargens(pl, atualValor, atualPct, limite)

  return {
    aplicavel: true,
    fundoNome: input.fundoNome,
    patrimonioLiquido: pl,
    dataBasePl: input.plReferencia?.dataBase || null,
    defasagemPl: input.plReferencia
      ? calcularDefasagemPl(input.plReferencia.dataOperacional, input.plReferencia.dataBase)
      : null,
    origemPl: input.origemPl || null,
    exposicaoAtualValor: atualValor,
    exposicaoAtualPct: atualPct,
    candidatoValor: null,
    candidatoPct: null,
    candidatoEmTransitoValor: null,
    exposicaoProjetadaValor: null,
    exposicaoProjetadaPct: null,
    limitePct: limite,
    margemValor: margem.margemValor,
    margemPct: margem.margemPct,
    classificacao,
    statusDashboard: resolverStatusDashboard(classificacao, atualPct, limite),
    motivo: execucao && !concluida
      ? 'A exposição do fundo depende de dados financeiros oficiais que ainda não estão disponíveis.'
      : execucao ? null : 'A exposição do fundo ainda não foi calculada.',
    avaliadaEm: String(execucao?.finalizado_em || execucao?.created_at || '') || null,
  }
}

export const classificacaoExposicaoLabel: Record<ClassificacaoExposicaoOperacional, string> = {
  ABAIXO_LIMITE: 'Dentro do limite',
  NO_LIMITE: 'No limite',
  ACIMA_LIMITE: 'Acima do limite',
  INDETERMINADA: 'Indeterminada',
}

export const statusExposicaoDashboardLabel: Record<StatusExposicaoDashboard, string> = {
  DENTRO_LIMITE: 'Dentro do limite',
  NO_LIMITE: 'No limite',
  PROXIMO_LIMITE: 'Próximo do limite',
  ACIMA_LIMITE: 'Acima do limite',
  INDETERMINADA: 'Indeterminada',
}
