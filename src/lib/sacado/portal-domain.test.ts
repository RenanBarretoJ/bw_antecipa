import { describe, expect, it } from 'vitest'
import {
  calcularDashboardSacado,
  listarNfsRecebidasComContextoOperacional,
  nfPendenteAceiteSacado,
  vincularNfsComOperacoes,
  type SacadoPortalNotaFiscal,
  type SacadoPortalOperacao,
} from './portal-domain'

const operacaoBase: SacadoPortalOperacao = {
  id: 'op-1',
  cedente_id: 'ced-1',
  valor_bruto_total: 1000,
  valor_liquido_desembolso: 950,
  data_vencimento: '2026-08-01',
  status: 'em_andamento',
  aceite_sacado_exigido: true,
  aceite_sacado_status: 'pendente',
  created_at: '2026-07-28T12:00:00Z',
  cedentes: { razao_social: 'Cedente A', cnpj: '00000000000001' },
  contas_escrow: { identificador: 'escrow-a' },
}

const nfBase: SacadoPortalNotaFiscal = {
  id: 'nf-1',
  numero_nf: '1',
  cnpj_emitente: '00000000000001',
  razao_social_emitente: 'Cedente A',
  valor_bruto: 100,
  data_emissao: '2026-07-01',
  data_vencimento: '2026-07-30',
  status: 'em_antecipacao',
  cedente_id: 'ced-1',
  arquivo_url: null,
  operacao_id: 'op-1',
  aceite_sacado_exigido: true,
  aceite_sacado_status: 'pendente',
  operacao_status: 'em_andamento',
}

describe('portal-domain do sacado', () => {
  it('vincula NFs somente a operacoes presentes e preserva status de aceite da operacao', () => {
    const nfRaw = {
      id: nfBase.id,
      numero_nf: nfBase.numero_nf,
      cnpj_emitente: nfBase.cnpj_emitente,
      razao_social_emitente: nfBase.razao_social_emitente,
      valor_bruto: nfBase.valor_bruto,
      data_emissao: nfBase.data_emissao,
      data_vencimento: nfBase.data_vencimento,
      status: nfBase.status,
      cedente_id: nfBase.cedente_id,
      arquivo_url: nfBase.arquivo_url,
    }
    const result = vincularNfsComOperacoes({
      nfs: [
        nfRaw,
        { ...nfRaw, id: 'nf-sem-operacao' },
      ],
      links: [{ nota_fiscal_id: 'nf-1', operacao_id: 'op-1' }],
      operacoes: [{ ...operacaoBase, aceite_sacado_status: 'aceito' }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'nf-1',
      operacao_id: 'op-1',
      aceite_sacado_status: 'aceito',
      operacao_status: 'em_andamento',
    })
  })

  it('lista NFs recebidas mesmo quando ainda nao possuem operacao vinculada', () => {
    const nfRaw = {
      id: nfBase.id,
      numero_nf: nfBase.numero_nf,
      cnpj_emitente: nfBase.cnpj_emitente,
      razao_social_emitente: nfBase.razao_social_emitente,
      valor_bruto: nfBase.valor_bruto,
      data_emissao: nfBase.data_emissao,
      data_vencimento: nfBase.data_vencimento,
      status: nfBase.status,
      cedente_id: nfBase.cedente_id,
      arquivo_url: nfBase.arquivo_url,
    }

    const result = listarNfsRecebidasComContextoOperacional({
      nfs: [nfRaw, { ...nfRaw, id: 'nf-sem-operacao' }],
      links: [{ nota_fiscal_id: 'nf-1', operacao_id: 'op-1' }],
      operacoes: [operacaoBase],
    })

    expect(result).toHaveLength(2)
    expect(result.find((nf) => nf.id === 'nf-1')).toMatchObject({
      operacao_id: 'op-1',
      aceite_sacado_status: 'pendente',
      operacao_status: 'em_andamento',
    })
    expect(result.find((nf) => nf.id === 'nf-sem-operacao')).toMatchObject({
      operacao_id: null,
      aceite_sacado_status: null,
      operacao_status: null,
    })
  })

  it('calcula dashboard com operacoes aprovadas/em andamento/inadimplentes e exclui liquidada/cancelada', () => {
    const nfs: SacadoPortalNotaFiscal[] = [
      { ...nfBase, id: 'vencida', valor_bruto: 100, data_vencimento: '2026-07-27', operacao_status: 'em_andamento' },
      { ...nfBase, id: 'hoje', valor_bruto: 200, data_vencimento: '2026-07-28', operacao_status: 'aprovada' },
      { ...nfBase, id: 'futura', valor_bruto: 300, data_vencimento: '2026-08-02', operacao_status: 'inadimplente' },
      { ...nfBase, id: 'liquidada', valor_bruto: 400, data_vencimento: '2026-07-28', operacao_status: 'liquidada' },
      { ...nfBase, id: 'cancelada', valor_bruto: 500, data_vencimento: '2026-07-28', operacao_status: 'cancelada' },
    ]

    const resumo = calcularDashboardSacado(nfs, '2026-07-28')

    expect(resumo.totalDevido).toBe(600)
    expect(resumo.nfsAtivas.map((nf) => nf.id)).toEqual(['vencida', 'hoje', 'futura'])
    expect(resumo.vencidos.map((nf) => nf.id)).toEqual(['vencida'])
    expect(resumo.vencimentosHoje.map((nf) => nf.id)).toEqual(['hoje'])
    expect(resumo.proximos7d.map((nf) => nf.id)).toEqual(['futura'])
  })

  it('mantem pendente de aceite apenas quando a politica exige e o status ainda nao e final', () => {
    expect(nfPendenteAceiteSacado({ ...nfBase, aceite_sacado_exigido: true, aceite_sacado_status: 'pendente', operacao_status: 'em_analise' })).toBe(true)
    expect(nfPendenteAceiteSacado({ ...nfBase, aceite_sacado_exigido: false, aceite_sacado_status: 'dispensado' })).toBe(false)
    expect(nfPendenteAceiteSacado({ ...nfBase, aceite_sacado_exigido: true, aceite_sacado_status: 'aceito' })).toBe(false)
    expect(nfPendenteAceiteSacado({ ...nfBase, aceite_sacado_exigido: true, aceite_sacado_status: 'pendente', operacao_status: 'liquidada' })).toBe(false)
  })
})
