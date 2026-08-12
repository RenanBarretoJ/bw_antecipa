import { describe, expect, it } from 'vitest'
import { agregarDuplicatasDaNota, confrontarDuplicataComNotaFiscal } from './validacao'
import type { CamposDuplicata, NotaFiscalParaConfronto } from './types'

const nota: NotaFiscalParaConfronto = {
  id: '00000000-0000-4000-8000-000000000001',
  fundo_id: '00000000-0000-4000-8000-000000000002',
  cedente_fundo_id: '00000000-0000-4000-8000-000000000003',
  cedente_id: '00000000-0000-4000-8000-000000000004',
  numero_nf: '13.372',
  data_emissao: '2026-07-18',
  data_vencimento: '2026-08-17',
  cnpj_emitente: '07.312.248/0003-07',
  cnpj_destinatario: '22.761.584/0011-22',
  valor_bruto: 99573.76,
}

const titulo: CamposDuplicata = {
  numero: '13372/1',
  numero_fatura: '13372/1',
  parcela: '1',
  data_emissao: '2026-07-18',
  data_vencimento: '2026-08-17',
  valor_nominal: 99573.76,
  nome_cedente_documento: 'COMERCIAL EXEMPLO LTDA',
  cnpj_cedente_documento: '07312248000307',
  nome_sacado_documento: 'CLIENTE EXEMPLO S.A.',
  cnpj_sacado_documento: '22761584001122',
  local_pagamento: 'São Paulo - SP',
  aceite_textual: null,
  aceite_detectado_textualmente: 'INDETERMINADO',
}

describe('matching Duplicata Mercantil x Nota Fiscal', () => {
  it('aceita match perfeito mesmo quando o numero da NF difere da duplicata', () => {
    const result = confrontarDuplicataComNotaFiscal(titulo, nota)
    expect(result.resultado).toBe('COERENTE')
    expect(result.bloqueios).toHaveLength(0)
    expect(result.informacoes.some((item) => item.codigo === 'NUMERACAO_INDEPENDENTE')).toBe(true)
  })

  it('bloqueia cedente divergente', () => {
    const result = confrontarDuplicataComNotaFiscal({ ...titulo, cnpj_cedente_documento: '00000000000000' }, nota)
    expect(result.resultado).toBe('DIVERGENTE')
    expect(result.bloqueios.map((item) => item.codigo)).toContain('CEDENTE_DIVERGENTE')
  })

  it('bloqueia sacado divergente', () => {
    const result = confrontarDuplicataComNotaFiscal({ ...titulo, cnpj_sacado_documento: '00000000000000' }, nota)
    expect(result.resultado).toBe('DIVERGENTE')
    expect(result.bloqueios.map((item) => item.codigo)).toContain('SACADO_DIVERGENTE')
  })

  it('bloqueia valor individual impossivel acima do valor da NF', () => {
    const result = confrontarDuplicataComNotaFiscal({ ...titulo, valor_nominal: 120000 }, nota)
    expect(result.resultado).toBe('DIVERGENTE')
    expect(result.bloqueios.map((item) => item.codigo)).toContain('VALOR_SUPERIOR_NF')
  })

  it('trata vencimento divergente como alerta, sem parecer juridico automatico', () => {
    const result = confrontarDuplicataComNotaFiscal({ ...titulo, data_vencimento: '2026-09-17' }, nota)
    expect(result.resultado).toBe('COERENTE')
    expect(result.avisos.map((item) => item.codigo)).toContain('VENCIMENTO_DIFERENTE_NF')
  })

  it('nao reprova por ausencia isolada de aceite textual', () => {
    const result = confrontarDuplicataComNotaFiscal(titulo, nota)
    expect(result.informacoes.map((item) => item.codigo)).toContain('ACEITE_TEXTUAL_AUSENTE')
    expect(result.bloqueios).toHaveLength(0)
  })

  it('marca campos criticos ausentes como incompletos', () => {
    const result = confrontarDuplicataComNotaFiscal({ ...titulo, numero: null }, nota)
    expect(result.resultado).toBe('INCOMPLETO')
  })
})

describe('agregacao 1 NF para N duplicatas', () => {
  it('soma varias parcelas coerentes', () => {
    expect(agregarDuplicatasDaNota([{ valor_nominal: 300 }, { valor_nominal: 300 }, { valor_nominal: 400 }], 1000)).toMatchObject({
      resultado: 'COERENTE', quantidade: 3, valorNominalTotal: 1000,
    })
  })

  it('classifica soma parcial como incompleta sem inventar parcela', () => {
    expect(agregarDuplicatasDaNota([{ valor_nominal: 300 }, { valor_nominal: 300 }], 1000).resultado).toBe('INCOMPLETO')
  })

  it('classifica soma acima da NF como divergente', () => {
    expect(agregarDuplicatasDaNota([{ valor_nominal: 700 }, { valor_nominal: 400 }], 1000).resultado).toBe('DIVERGENTE')
  })

  it('classifica titulo sem valor como incompleto', () => {
    expect(agregarDuplicatasDaNota([{ valor_nominal: null }], 1000).resultado).toBe('INCOMPLETO')
  })
})
