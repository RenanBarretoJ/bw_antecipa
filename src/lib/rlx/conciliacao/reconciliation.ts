import Decimal from 'decimal.js'
import type {
  RlxReconciliationContext,
  RlxReconciliationResult,
  RlxReconciliationRow,
  RlxReconciliationStatus,
} from './types'

type ReconciliationInputs = {
  fundoId: string
  estoqueD2: RlxReconciliationRow[]
  estoqueD1: RlxReconciliationRow[]
  aquisicoesD1: RlxReconciliationRow[]
  liquidacoesD1: RlxReconciliationRow[]
  contexto?: RlxReconciliationContext
}

export type ReconciliationBaseInput = {
  nome: 'ESTOQUE_D2' | 'ESTOQUE_D1' | 'AQUISICOES_D1' | 'LIQUIDACOES_D1'
  existe: boolean
  completude: string | null
}

const money = (value: string | null | undefined) => new Decimal(value || 0)
const fixed = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2)

export function avaliarCompletudeBases(inputs: ReconciliationBaseInput[]) {
  return inputs
    .filter((item) => !item.existe || !['COMPLETO_COM_DADOS', 'COMPLETO_VAZIO'].includes(item.completude || ''))
    .map((item) => item.nome)
}

function group(rows: RlxReconciliationRow[]) {
  const map = new Map<string, RlxReconciliationRow[]>()
  for (const row of rows) {
    if (!row.identidadeExterna) continue
    const items = map.get(row.identidadeExterna) || []
    items.push(row)
    map.set(row.identidadeExterna, items)
  }
  return map
}

function classify(input: {
  identity: string
  d2: RlxReconciliationRow[]
  d1: RlxReconciliationRow[]
  acquisitions: RlxReconciliationRow[]
  liquidations: RlxReconciliationRow[]
  context: RlxReconciliationContext
}): RlxReconciliationStatus {
  const hasD2 = input.d2.length > 0
  const hasD1 = input.d1.length > 0
  const hasAcquisition = input.acquisitions.length > 0
  const hasLiquidation = input.liquidations.length > 0
  const movementLabels = input.liquidations.map((row) => `${row.tipoMovimento || ''}|${row.statusRecebivel || ''}`.toUpperCase())
  const hasPartialLiquidation = movementLabels.some((label) => label.includes('PARCIAL') || label.includes('PARTIAL'))

  if (input.context.arquivoDuplicadoIdentidades?.has(input.identity)) return 'ARQUIVO_DUPLICADO_HASH'
  if (input.context.estoqueRetificadoIdentidades?.has(input.identity)) return 'RETIFICACAO_ESTOQUE'
  if (input.context.aquisicaoRetificadaIdentidades?.has(input.identity)) return 'RETIFICACAO_AQUISICAO'
  if (input.context.identidadesSemConciliacao?.has(input.identity)) return 'NAO_CONCILIADO'
  if (input.context.diaSemMovimentoIdentidades?.has(input.identity)) return 'DIA_SEM_MOVIMENTO'
  if (input.liquidations.length > 1) return 'LIQUIDACAO_REPETIDA_MESMO_DIA'
  if (hasPartialLiquidation && hasD1) return 'LIQUIDACAO_PARCIAL_SALDO'

  if (hasD2 && hasD1) {
    if (hasLiquidation) {
      return input.context.liquidacaoExigeSaidaIdentidades?.has(input.identity)
        ? 'SAIDA_NAO_REFLETIDA'
        : 'LIQUIDADO_AINDA_NO_ESTOQUE'
    }
    if (!money(input.d2[0].valorAquisicao).eq(money(input.d1[0].valorAquisicao))) return 'DIVERGENCIA_VALOR'
    return 'MANTIDO_CORRETO'
  }
  if (!hasD2 && hasD1) return hasAcquisition ? 'ENTRADA_INCORPORADA' : 'ENTRADA_SEM_AQUISICAO'
  if (!hasD2 && !hasD1 && hasAcquisition) return 'ENTRADA_NAO_INCORPORADA'
  if (hasD2 && !hasD1) return hasLiquidation ? 'SAIDA_REFLETIDA' : 'SAIDA_SEM_LIQUIDACAO'
  return 'NAO_CONCILIADO'
}

export function reconciliarTitulosD2D1(input: ReconciliationInputs): RlxReconciliationResult[] {
  const d2 = group(input.estoqueD2)
  const d1 = group(input.estoqueD1)
  const acquisitions = group(input.aquisicoesD1)
  const liquidations = group(input.liquidacoesD1)
  const identities = new Set([...d2.keys(), ...d1.keys(), ...acquisitions.keys(), ...liquidations.keys()])

  return [...identities].sort().map((identity) => {
    const rowsD2 = d2.get(identity) || []
    const rowsD1 = d1.get(identity) || []
    const rowsAcq = acquisitions.get(identity) || []
    const rowsLiq = liquidations.get(identity) || []
    const all = [...rowsD1, ...rowsD2, ...rowsAcq, ...rowsLiq]
    const acquisitionTotal = rowsAcq.reduce((sum, row) => sum.plus(money(row.valorMovimento || row.valorAquisicao)), new Decimal(0))
    const liquidationTotal = rowsLiq.reduce((sum, row) => sum.plus(money(row.valorMovimento)), new Decimal(0))
    const status = classify({
      identity,
      d2: rowsD2,
      d1: rowsD1,
      acquisitions: rowsAcq,
      liquidations: rowsLiq,
      context: input.contexto || {},
    })
    const noteIds = [...new Set(all.map((row) => row.notaFiscalId).filter(Boolean))]
    const linkIds = [...new Set(all.map((row) => row.vinculoId).filter(Boolean))]

    return {
      identidadeExterna: identity,
      fundoId: input.fundoId,
      provedor: all[0]?.provedor || '',
      notaFiscalId: noteIds.length === 1 ? noteIds[0] || null : null,
      vinculoId: linkIds.length === 1 ? linkIds[0] || null : null,
      presenteD2: rowsD2.length > 0,
      presenteD1: rowsD1.length > 0,
      valorAquisicaoD2: rowsD2[0]?.valorAquisicao || null,
      valorAquisicaoD1: rowsD1[0]?.valorAquisicao || null,
      aquisicoesCount: rowsAcq.length,
      aquisicoesValor: fixed(acquisitionTotal),
      liquidacoesCount: rowsLiq.length,
      liquidacoesValorPago: fixed(liquidationTotal),
      status,
      detalhes: {
        multiplasLiquidacoes: rowsLiq.length > 1,
        movimentoParcialDescritivo: rowsLiq.some((row) =>
          `${row.tipoMovimento || ''}|${row.statusRecebivel || ''}`.toUpperCase().match(/PARCIAL|PARTIAL/),
        ),
        notaFiscalAmbigua: noteIds.length > 1,
        semCalculoDeSaldo: true,
      },
    }
  })
}
