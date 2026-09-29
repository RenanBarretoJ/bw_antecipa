import { describe, expect, it } from 'vitest'
import { extractDanfseV2, isDanfseV2, validateNfseExtraction } from './danfse-v2'
import { danfseFixture, SYNTHETIC_KEY } from './fixtures/danfse-v2'

describe('DANFSe v2 - fatos fiscais separados', () => {
  it.each([
    ['A', '49', 39521.98, 37229.70, '2026-09-14', '2026-09-09'],
    ['B', '232', 112710.81, 105779.10, '2026-09-15', '2026-09-15'],
  ] as const)('golden sintético %s', (variant, number, gross, net, issued, period) => {
    const result = extractDanfseV2(danfseFixture(variant))
    expect(validateNfseExtraction(result)).toEqual({ ok: true })
    expect(result.dados).toMatchObject({ numero_nf: number, valor_bruto: gross, valor_liquido: net,
      chave_acesso: SYNTHETIC_KEY, cnpj_emitente: '11222333000181', cnpj_destinatario: '98100001000102',
      razao_social_emitente: 'PRESTADOR SINTETICO QA LTDA', razao_social_destinatario: 'TOMADOR SINTETICO QA LTDA',
      endereco_destinatario: 'RUA AMOSTRA, 200, CENTRO', data_emissao: issued, competencia: period })
    expect(result.dados.data_vencimento).toBeUndefined()
    expect(result.vencimento_source).toBe('MISSING')
    expect(result.layout_fingerprint).toBe('danfse_v2')
    expect(result.proveniencia.valor_liquido?.anchor).toBe('VALOR LIQUIDO DA NFS-E')
    expect(result.candidatos.valor_bruto).toHaveLength(1)
  })

  it('não usa o líquido + IBS/CBS nem subtrai desconto novamente', () => {
    const result = extractDanfseV2(danfseFixture())
    expect(result.dados.valor_liquido_com_ibscbs).toBe(37376.52)
    expect(result.dados.desconto_incondicionado).toBe(395.22)
    expect(result.dados.valor_liquido).toBe(37229.70)
  })

  it('não inventa líquido ausente nem captura o rótulo seguinte', () => {
    const text = danfseFixture().replace('VALOR LÍQUIDO DA NFS-e\nR$ 37.229,70\n', '')
    const result = extractDanfseV2(text)
    expect(result.dados.valor_liquido).toBeUndefined()
    expect(result.dados.valor_bruto).toBe(39521.98)
    expect(validateNfseExtraction(result).ok).toBe(true) // extração bruta, não elegibilidade LIQUIDO
  })

  it('não substitui um líquido explícito contraditório por conta aritmética', () => {
    const result = extractDanfseV2(danfseFixture().replace('R$ 37.229,70', 'R$ 32.000,00'))
    expect(result.dados.valor_liquido).toBe(32000)
    expect(result.avisos).toContain('nfse_totals_arithmetic_review_required')
    expect(validateNfseExtraction(result).ok).toBe(false)
  })

  it.each(['VALOR DA OPERAÇÃO / SERVIÇO', 'VALOR LÍQUIDO DA NFS-e'])('rejeita conflito em %s', label => {
    const text = danfseFixture().replace('INFORMAÇÕES COMPLEMENTARES', `${label}\nR$ 100,00\nINFORMAÇÕES COMPLEMENTARES`)
    const result = extractDanfseV2(text)
    expect(validateNfseExtraction(result).ok).toBe(false)
    expect(result.motivos_bloqueio.some(reason => reason.endsWith('_conflict'))).toBe(true)
  })

  it('não transforma lacuna do bruto em valor do desconto', () => {
    const result = extractDanfseV2(danfseFixture().replace('R$ 39.521,98\n', ''))
    expect(result.dados.valor_bruto).toBeUndefined()
    expect(validateNfseExtraction(result).ok).toBe(false)
  })

  it.each(['1.234', '-100,00', '39,521.98', 'NaN', '0,00'])('bloqueia bruto não inequívoco e positivo: %s', value => {
    expect(validateNfseExtraction(extractDanfseV2(danfseFixture().replace('39.521,98', value))).ok).toBe(false)
  })

  it('exige CNPJ válido por seção, sem procurar outros CNPJs no documento', () => {
    const result = extractDanfseV2(danfseFixture().replace('11.222.333/0001-81', '11.222.333/0001-82'))
    expect(result.dados.cnpj_emitente).toBeUndefined()
    expect(validateNfseExtraction(result).ok).toBe(false)
  })

  it('permite outros CNPJs válidos sem depender do nome do fundo/empresa', () => {
    const text = danfseFixture().replace('11.222.333/0001-81', '98.100.002/0001-57')
      .replace('PRESTADOR SINTETICO QA LTDA', 'EMPRESA ALTERNATIVA QA')
    expect(validateNfseExtraction(extractDanfseV2(text)).ok).toBe(true)
  })

  it('ignora chave de substituição; chave NF-e de 44 dígitos não serve como NFS-e', () => {
    const result = extractDanfseV2(danfseFixture().replace(SYNTHETIC_KEY, '1234567890'.repeat(4) + '1234'))
    expect(result.dados.chave_acesso).toBeUndefined()
    expect(validateNfseExtraction(result).ok).toBe(false)
  })

  it('extrai somente vencimento explícito válido', () => {
    const result = extractDanfseV2(danfseFixture() + '\nVENCIMENTO: 09/11/2026')
    expect(result.dados.data_vencimento).toBe('2026-11-09')
    expect(result.vencimento_source).toBe('DOCUMENT')
    expect(validateNfseExtraction(result).ok).toBe(true)
  })

  it.each(['31/02/2026', '01/01/2026'])('bloqueia vencimento inválido/anterior: %s', date => {
    expect(validateNfseExtraction(extractDanfseV2(danfseFixture() + `\nVENCIMENTO: ${date}`)).ok).toBe(false)
  })

  it('emissão não é competência nem emissão da DPS', () => {
    const result = extractDanfseV2(danfseFixture().replace('DATA E HORA DA EMISSÃO DA NFS-e\n14/09/2026 16:44:46\n', ''))
    expect(result.dados.data_emissao).toBeUndefined()
    expect(validateNfseExtraction(result).ok).toBe(false)
  })

  it('não trata outros layouts como DANFSe nem aceita documento múltiplo', () => {
    expect(isDanfseV2('DANFE NF-e VALOR TOTAL DA NOTA')).toBe(false)
    expect(validateNfseExtraction(extractDanfseV2('')) .ok).toBe(false)
    expect(validateNfseExtraction(extractDanfseV2(danfseFixture() + '\n' + danfseFixture('B'))).ok).toBe(false)
  })

  it('tolera CRLF, acentuação normalizada e linhas em branco', () => {
    const text = danfseFixture().normalize('NFD').replace(/\n/g, '\r\n\r\n')
    expect(validateNfseExtraction(extractDanfseV2(text)).ok).toBe(true)
  })

  it('limita tamanho antes de extrair', () => {
    expect(extractDanfseV2('a'.repeat(1_000_001)).motivos_bloqueio).toEqual(['nfse_text_size_exceeded'])
  })
})
