import { describe, expect, it } from 'vitest'
import { montarBaseFinanceiraDaData } from './base-financeira'
import { basesObrigatoriasConciliacao, diagnosticoEstoquesSchema, diagnosticoCompativel } from './movimentos-condicionais'
import { resumirBaseFinanceira } from '@/app/gestor/conciliacao/central-ux'
import { resolverStatusEsteiraFinanceira } from './pipeline-status.server'

const d2 = '10000000-0000-4000-8000-000000000001', d1 = '10000000-0000-4000-8000-000000000002'
const diagnostic = (entradas = 0, saidas = 0, reducoes = 0, aumentos = 0) => diagnosticoEstoquesSchema.parse({
  regraVersao: 'FIN_RECON_V2', estoqueD2ImportacaoId: d2, estoqueD1ImportacaoId: d1,
  entradas, saidas, reducoes, aumentos, invalidas: 0,
  exigeAquisicoes: entradas + aumentos > 0, exigeLiquidacoes: saidas + reducoes > 0,
  estoquesEquivalentes: entradas + saidas + reducoes + aumentos === 0,
})
function base() {
  const b = montarBaseFinanceiraDaData({ dataOperacional: '2026-10-22', importacoes: [], snapshots: [] })
  b.estoqueD2 = { ...b.estoqueD2, importacaoId: d2, estado: 'VALOR', valor: '100', dataReferencia: b.dataD2 }
  b.estoque = { ...b.estoque, importacaoId: d1, estado: 'VALOR', valor: '100', dataReferencia: b.dataD1 }
  b.carteira = { ...b.carteira, importacaoId: 'pl', estado: 'VALOR', valor: '1000' }
  b.diagnosticoEstoques = diagnostic()
  return b
}
const required = (b: ReturnType<typeof base>) => basesObrigatoriasConciliacao(b).map(item => item.key)
describe('bases condicionais da conciliacao integral', () => {
  it('dispensa movimentos ausentes so depois de comparar os estoques', () => {
    const b = base()
    expect(required(b)).toEqual(['estoqueD2', 'estoque'])
    expect(b.aquisicoes.estado).toBe('INDISPONIVEL')
    expect(b.aquisicoes.importacaoId).toBeNull()
    expect(b.liquidacoes.valor).toBeNull()
    expect(resumirBaseFinanceira(b)).toMatchObject({ tone: 'success', message: expect.stringContaining('Conciliação integral disponível') })
  })
  it.each([
    [1, 0, 0, 0, ['estoqueD2', 'estoque', 'aquisicoes']],
    [0, 1, 0, 0, ['estoqueD2', 'estoque', 'liquidacoes']],
    [0, 0, 1, 0, ['estoqueD2', 'estoque', 'liquidacoes']],
    [0, 0, 0, 1, ['estoqueD2', 'estoque', 'aquisicoes']],
    [1, 1, 1, 0, ['estoqueD2', 'estoque', 'aquisicoes', 'liquidacoes']],
  ] as const)('exige familias pelas variacoes %i/%i/%i/%i', (a, s, r, u, expected) => {
    const b = base(); b.diagnosticoEstoques = diagnostic(a, s, r, u)
    expect(required(b)).toEqual([...expected])
    expect(resumirBaseFinanceira(b).tone).toBe('warning')
  })
  it('diagnostico ausente, invalido ou de snapshot antigo nunca dispensa', () => {
    for (const d of [null, { ...diagnostic(), invalidas: 1 }, { ...diagnostic(), estoqueD1ImportacaoId: d2 }]) {
      const b = base(); b.diagnosticoEstoques = d
      expect(diagnosticoCompativel(b)).toBeNull()
      expect(required(b)).toHaveLength(4)
    }
  })
  it('rejeita flag de dispensa forjada ou contagens negativas', () => {
    expect(() => diagnosticoEstoquesSchema.parse({ ...diagnostic(1), exigeAquisicoes: false })).toThrow()
    expect(() => diagnosticoEstoquesSchema.parse({ ...diagnostic(), entradas: -1 })).toThrow()
  })
  it('habilita o botao no dominio, mantendo o PL independente', () => {
    const b = base(); b.carteira.estado = 'INDISPONIVEL'
    const empty = { matching: null, conciliacao: null, logistica: null, exposicao: null, risco: null }
    const result = resolverStatusEsteiraFinanceira({ base: b,
      politica: { estado: 'NAO_CONFIGURADA', nome: null, versao: null, versaoId: null, criaAcompanhamentoEntrega: false, controleExposicaoAtivo: false, gateRiscoAtivo: false, limitePct: null },
      execucoes: empty, execucoesAnteriores: empty, fundoVirgem: false,
    })
    expect(result.etapas.find(item => item.id === 'conciliacao')).toMatchObject({ status: 'PRONTA', acao: { habilitada: true } })
    expect(resumirBaseFinanceira(b).message).toContain('PL de referência ainda não está disponível')
  })
})
