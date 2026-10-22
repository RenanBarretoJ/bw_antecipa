import Decimal from 'decimal.js'
import type { ReconciliationResult, ReconciliationRow, ReconciliationStatus } from './types'

// Same precedence as diagnosticar_variacao_estoques; never join by invoice alone.
export function identidadeCanonicaConciliacao(row: Record<string, unknown>): string | null {
  for (const field of ['external_title_key', 'id_recebivel', 'seu_numero']) {
    const value = row[field]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

type Inputs = {
  fundoId: string; estoqueD2: ReconciliationRow[]; estoqueD1: ReconciliationRow[]
  aquisicoesD1: ReconciliationRow[]; liquidacoesD1: ReconciliationRow[]
  aquisicoesRecebidas: boolean; liquidacoesRecebidas: boolean
}
const principal = (value: string | null | undefined) => {
  if (value === null || value === undefined || value === '') return null
  const amount = new Decimal(value)
  if (!amount.isFinite() || amount.isNegative()) throw new Error('Principal financeiro invalido.')
  return amount
}
const sum = (rows: ReconciliationRow[], field: 'valorPrincipal' | 'valorPrincipalBaixado') => {
  const values = rows.map(row => principal(row[field]))
  return values.some(value => value === null) ? null : values.reduce<Decimal>((total, value) => total.plus(value!), new Decimal(0))
}

export function reconciliarTitulosV2(input: Inputs): ReconciliationResult[] {
  const groups = [input.estoqueD2, input.estoqueD1, input.aquisicoesD1, input.liquidacoesD1].map(rows => {
    const map = new Map<string, ReconciliationRow[]>()
    for (const row of rows) {
      if (row.fundoId !== input.fundoId || !row.provedor || !row.identidadeExterna || !row.cedenteDocumento) {
        throw new Error('Identidade financeira ou Fundo invalido na conciliacao.')
      }
      const key = JSON.stringify([row.provedor, row.cedenteDocumento.replace(/\D/g, ''), row.identidadeExterna])
      map.set(key, [...(map.get(key) || []), row])
    }
    return map
  })
  const identities = [...new Set(groups.flatMap(group => [...group.keys()]))].sort()
  return identities.map(key => {
    const [d2, d1, acq, liq] = groups.map(group => group.get(key) || [])
    if (d2.length > 1 || d1.length > 1) throw new Error('Chave duplicada no estoque da conciliacao.')
    const before = d2.length ? principal(d2[0].valorPrincipal) : new Decimal(0)
    const after = d1.length ? principal(d1[0].valorPrincipal) : new Decimal(0)
    if (before === null || after === null) throw new Error('Saldo principal ausente no estoque.')
    const acquired = sum(acq, 'valorPrincipal'), paid = sum(liq, 'valorPrincipalBaixado')
    const partial = liq.some(row => /PARCIAL|PARTIAL/i.test(`${row.tipoMovimento || ''}|${row.statusRecebivel || ''}`))
    const balanced = acquired !== null && paid !== null && before.plus(acquired).minus(paid).eq(after)
    let status: ReconciliationStatus = 'DIVERGENCIA_VALOR'
    if (!d2.length && d1.length && !acq.length) status = 'ENTRADA_SEM_AQUISICAO'
    else if (d2.length && !d1.length && !liq.length) status = 'SAIDA_SEM_LIQUIDACAO'
    else if (!d2.length && !d1.length && acq.length && !liq.length) status = 'ENTRADA_NAO_INCORPORADA'
    else if (liq.length > 1) status = 'LIQUIDACAO_REPETIDA_MESMO_DIA'
    else if (balanced) {
      if (!d2.length && d1.length && acq.length) status = 'ENTRADA_INCORPORADA'
      else if (d2.length && !d1.length && liq.length) status = 'SAIDA_REFLETIDA'
      else if (d2.length && d1.length && after.lt(before) && partial) status = 'LIQUIDACAO_PARCIAL_SALDO'
      else if (d2.length && d1.length && before.eq(after) && !acq.length && !liq.length) status = 'MANTIDO_CORRETO'
      else if (d2.length && d1.length && acq.length && !liq.length && after.gt(before)) status = 'ENTRADA_INCORPORADA'
    }
    const all = [...d1, ...d2, ...acq, ...liq]
    const noteIds = [...new Set(all.map(row => row.notaFiscalId).filter(Boolean))]
    const linkIds = [...new Set(all.map(row => row.vinculoId).filter(Boolean))]
    return {
      identidadeExterna: key, fundoId: input.fundoId, provedor: all[0].provedor,
      notaFiscalId: noteIds.length === 1 ? noteIds[0]! : null, vinculoId: linkIds.length === 1 ? linkIds[0]! : null,
      presenteD2: Boolean(d2.length), presenteD1: Boolean(d1.length),
      valorAquisicaoD2: d2[0]?.valorAquisicao || null, valorAquisicaoD1: d1[0]?.valorAquisicao || null,
      aquisicoesCount: acq.length, aquisicoesValor: acq.reduce((total, row) => total.plus(row.valorMovimento || row.valorAquisicao || 0), new Decimal(0)).toFixed(2),
      liquidacoesCount: liq.length, liquidacoesValorPago: liq.reduce((total, row) => total.plus(row.valorMovimento || 0), new Decimal(0)).toFixed(2),
      status,
      detalhes: {
        regra: 'FIN_RECON_V2', chave_titulo: all[0].identidadeExterna, cedente_documento: all[0].cedenteDocumento,
        principal_d2: d2.length ? before.toFixed(4) : null, principal_d1: d1.length ? after.toFixed(4) : null,
        principal_adquirido: acquired?.toFixed(4) ?? null, principal_baixado: paid?.toFixed(4) ?? null,
        saldo_principal_conferido: balanced, baixa_parcial_comprovada: status === 'LIQUIDACAO_PARCIAL_SALDO',
        principal_baixa_nao_comprovado: paid === null,
        aquisicoes_relatorio_recebido: input.aquisicoesRecebidas, liquidacoes_relatorio_recebido: input.liquidacoesRecebidas,
        semCalculoDeSaldo: true,
      },
    }
  })
}
