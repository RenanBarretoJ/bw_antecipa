import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildOperacaoNotaFiscalView, prazoDiasAteVencimento, resolveStatusCurtoDaNota } from './OperacaoNotaFiscalCard'

const baseNf = {
  id: 'nf-1',
  numero_nf: '13197',
  cnpj_destinatario: '40439661000132',
  razao_social_destinatario: 'SPE PAUPINA EMPREENDIMENTOS IMOBILIARIOS LTDA COM NOME MUITO LONGO',
  valor_bruto: 5974,
  data_vencimento: '2026-08-24',
  status: 'em_antecipacao',
}

describe('OperacaoNotaFiscalCard helpers', () => {
  it('calcula prazo ate vencimento para exibicao operacional', () => {
    const now = new Date('2026-07-24T12:00:00Z').getTime()
    expect(prazoDiasAteVencimento('2026-08-24', now)).toBe(31)
  })

  it('monta a view preservando valores da NF e valor antecipado calculado', () => {
    const view = buildOperacaoNotaFiscalView({
      notaFiscal: baseNf,
      valorAntecipado: 5737.3,
      nowMs: new Date('2026-07-24T12:00:00Z').getTime(),
    })

    expect(view.numero_nf).toBe('13197')
    expect(view.razao_social_destinatario).toContain('SPE PAUPINA')
    expect(view.valor_bruto).toBe(5974)
    expect(view.valor_antecipado).toBe(5737.3)
    expect(view.prazo_dias).toBe(31)
  })

  it('preserva antecipado ausente sem inventar valor antes da memória aprovada', () => {
    const view = buildOperacaoNotaFiscalView({ notaFiscal: baseNf, valorAntecipado: null })
    expect(view.valor_antecipado).toBeNull()
  })

  it('usa quebra responsiva e truncamento em vez de comprimir o sacado', () => {
    const source = readFileSync('src/components/operacoes/OperacaoNotaFiscalCard.tsx', 'utf8')
    expect(source).toContain('flex min-w-0 flex-col gap-4 2xl:flex-row')
    expect(source).toContain('grid-cols-2 gap-3 sm:grid-cols-4')
    expect(source).toContain('truncate text-sm font-medium')
    expect(source).toContain('title={notaFiscal.razao_social_destinatario}')
  })

  it('resume status longo de aceite dispensado sem esconder a regra', () => {
    expect(resolveStatusCurtoDaNota('em_antecipacao', null, true)).toBe('Aceite dispensado')
  })

  it('prioriza status logistico quando a NF esta em transito', () => {
    expect(resolveStatusCurtoDaNota('em_antecipacao', 'em_transito', true)).toBe('Em trânsito')
  })

  it('mantem status curto para operacao liquidada', () => {
    expect(resolveStatusCurtoDaNota('liquidada')).toBe('Liquidada')
  })
})
