import { describe, expect, it } from 'vitest'
import {
  datasComprovanteWebhookPlausiveis,
  resolverComprovanteWebhook,
  resolverPorChaveCte,
  resolverPorChaveNfe,
  validarCruzamentoComprovanteWebhook,
  type CteVinculoPorChave,
  type NotaFiscalRemessaPorChave,
  type NotaFiscalVendaPorChave,
} from './webhook-comprovante-transportadora-matching'

const venda: NotaFiscalVendaPorChave = {
  id: 'venda-1',
  fundoId: 'fundo-1',
  cedenteId: 'cedente-1',
  cnpjEmitente: '11222333000181',
  cnpjDestinatario: '99888777000155',
}

const remessaValidada: NotaFiscalRemessaPorChave = {
  id: 'remessa-1',
  notaFiscalVendaId: 'venda-1',
  statusValidacao: 'VALIDADA',
  emitenteCnpj: '22333444000199',
}

describe('resolverPorChaveNfe', () => {
  it('resolve DIRETO_VENDA quando a chave bate com uma NF de venda', () => {
    const resultado = resolverPorChaveNfe({ vendaPorChave: venda, remessaPorChave: null })
    expect(resultado).toEqual({
      resultado: 'RESOLVIDO',
      notaFiscalVendaId: 'venda-1',
      notaFiscalRemessaId: null,
      tipoVinculo: 'DIRETO_VENDA',
      metodo: 'CHAVE_NFE_VENDA',
    })
  })

  it('resolve VIA_REMESSA quando a chave bate com uma remessa VALIDADA', () => {
    const resultado = resolverPorChaveNfe({ vendaPorChave: null, remessaPorChave: remessaValidada })
    expect(resultado).toEqual({
      resultado: 'RESOLVIDO',
      notaFiscalVendaId: 'venda-1',
      notaFiscalRemessaId: 'remessa-1',
      tipoVinculo: 'VIA_REMESSA',
      metodo: 'CHAVE_NFE_REMESSA',
    })
  })

  it('nao resolve por uma remessa que ainda nao esta VALIDADA', () => {
    const resultado = resolverPorChaveNfe({ vendaPorChave: null, remessaPorChave: { ...remessaValidada, statusValidacao: 'REVISAO_MANUAL' } })
    expect(resultado).toBeNull()
  })

  it('prioriza a venda quando, por algum motivo, ambas as consultas retornam linha', () => {
    const resultado = resolverPorChaveNfe({ vendaPorChave: venda, remessaPorChave: remessaValidada })
    expect(resultado?.resultado === 'RESOLVIDO' ? resultado.tipoVinculo : null).toBe('DIRETO_VENDA')
  })

  it('retorna null quando nenhuma das duas bateu', () => {
    expect(resolverPorChaveNfe({ vendaPorChave: null, remessaPorChave: null })).toBeNull()
  })
})

describe('resolverPorChaveCte', () => {
  it('retorna null quando o CT-e nao foi encontrado', () => {
    expect(resolverPorChaveCte({ cteEncontrado: false, vinculos: [] })).toBeNull()
  })

  it('retorna null quando o CT-e existe mas nao tem vinculo com NF', () => {
    expect(resolverPorChaveCte({ cteEncontrado: true, vinculos: [] })).toBeNull()
  })

  it('resolve quando o CT-e tem exatamente um vinculo', () => {
    const vinculo: CteVinculoPorChave = { notaFiscalId: 'venda-2', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' }
    const resultado = resolverPorChaveCte({ cteEncontrado: true, vinculos: [vinculo] })
    expect(resultado).toEqual({
      resultado: 'RESOLVIDO',
      notaFiscalVendaId: 'venda-2',
      notaFiscalRemessaId: null,
      tipoVinculo: 'DIRETO_VENDA',
      metodo: 'CHAVE_CTE',
    })
  })

  it('e AMBIGUO quando o CT-e tem mais de um vinculo (CT-e multi-NF) -- nunca escolhe um lado sozinho', () => {
    const vinculos: CteVinculoPorChave[] = [
      { notaFiscalId: 'venda-2', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' },
      { notaFiscalId: 'venda-3', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' },
    ]
    expect(resolverPorChaveCte({ cteEncontrado: true, vinculos })).toEqual({ resultado: 'AMBIGUO' })
  })
})

describe('resolverComprovanteWebhook (ordem completa de resolucao)', () => {
  it('usa a chave_nfe quando ela resolve, mesmo com chave_cte tambem presente', () => {
    const resultado = resolverComprovanteWebhook({
      chaveNfe: { vendaPorChave: venda, remessaPorChave: null },
      chaveCte: { cteEncontrado: true, vinculos: [{ notaFiscalId: 'outra-venda', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' }] },
    })
    expect(resultado).toMatchObject({ resultado: 'RESOLVIDO', metodo: 'CHAVE_NFE_VENDA' })
  })

  it('cai para chave_cte quando chave_nfe nao resolveu', () => {
    const resultado = resolverComprovanteWebhook({
      chaveNfe: { vendaPorChave: null, remessaPorChave: null },
      chaveCte: { cteEncontrado: true, vinculos: [{ notaFiscalId: 'venda-2', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' }] },
    })
    expect(resultado).toMatchObject({ resultado: 'RESOLVIDO', metodo: 'CHAVE_CTE' })
  })

  it('retorna NAO_IDENTIFICADO quando nenhuma regra resolve e nao ha chave_cte', () => {
    const resultado = resolverComprovanteWebhook({ chaveNfe: { vendaPorChave: null, remessaPorChave: null }, chaveCte: null })
    expect(resultado).toEqual({ resultado: 'NAO_IDENTIFICADO' })
  })

  it('propaga AMBIGUO do fallback por chave_cte', () => {
    const resultado = resolverComprovanteWebhook({
      chaveNfe: { vendaPorChave: null, remessaPorChave: null },
      chaveCte: {
        cteEncontrado: true,
        vinculos: [
          { notaFiscalId: 'venda-2', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' },
          { notaFiscalId: 'venda-3', notaFiscalRemessaId: null, tipoVinculo: 'DIRETO_VENDA' },
        ],
      },
    })
    expect(resultado).toEqual({ resultado: 'AMBIGUO' })
  })
})

describe('validarCruzamentoComprovanteWebhook', () => {
  const base = {
    cnpjClientePayload: '99888777000155',
    cnpjDestinatarioVenda: '99888777000155' as string | null,
    cnpjEmitentePayload: '11222333000181',
    cnpjEmitenteEsperado: '11222333000181' as string | null,
    cnpjTransportadoraPayload: '33444555000122',
    cnpjTransportadoraEsperado: '33444555000122' as string | null,
  }

  it('aceita quando tudo confere', () => {
    expect(validarCruzamentoComprovanteWebhook(base)).toEqual({ ok: true })
  })

  it('detecta CNPJ do cliente divergente do destinatario da venda', () => {
    const resultado = validarCruzamentoComprovanteWebhook({ ...base, cnpjClientePayload: '00000000000000' })
    expect(resultado).toEqual({ ok: false, motivo: 'CNPJ_CLIENTE_DIVERGENTE' })
  })

  it('detecta CNPJ do emitente divergente do esperado (venda ou remessa)', () => {
    const resultado = validarCruzamentoComprovanteWebhook({ ...base, cnpjEmitentePayload: '00000000000000' })
    expect(resultado).toEqual({ ok: false, motivo: 'CNPJ_EMITENTE_DIVERGENTE' })
  })

  it('detecta CNPJ da transportadora divergente do esperado', () => {
    const resultado = validarCruzamentoComprovanteWebhook({ ...base, cnpjTransportadoraPayload: '00000000000000' })
    expect(resultado).toEqual({ ok: false, motivo: 'CNPJ_TRANSPORTADORA_DIVERGENTE' })
  })

  it('nao valida campos esperados quando nao ha valor de referencia (null) -- evita falso positivo', () => {
    const resultado = validarCruzamentoComprovanteWebhook({ ...base, cnpjDestinatarioVenda: null, cnpjEmitenteEsperado: null, cnpjTransportadoraEsperado: null })
    expect(resultado).toEqual({ ok: true })
  })
})

describe('datasComprovanteWebhookPlausiveis', () => {
  it('aceita entrega na mesma data ou depois da emissao', () => {
    expect(datasComprovanteWebhookPlausiveis('2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(true)
    expect(datasComprovanteWebhookPlausiveis('2026-08-20T10:00:00Z', '2026-08-22T10:00:00Z')).toBe(true)
  })

  it('rejeita entrega antes da emissao', () => {
    expect(datasComprovanteWebhookPlausiveis('2026-08-22T10:00:00Z', '2026-08-20T10:00:00Z')).toBe(false)
  })

  it('rejeita datas invalidas', () => {
    expect(datasComprovanteWebhookPlausiveis('nao-e-data', '2026-08-20T10:00:00Z')).toBe(false)
    expect(datasComprovanteWebhookPlausiveis('2026-08-20T10:00:00Z', 'nao-e-data')).toBe(false)
  })
})
