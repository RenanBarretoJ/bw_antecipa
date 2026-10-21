import { describe, expect, it } from 'vitest'
import { nomeCurtoFundo, nomeDocumentoDownload, nomeRemessaFromtis } from './nomes'

const fundoNome = 'HEALTH I FUNDO DE INVESTIMENTO EM DIREITOS CREDITORIOS - RESPONSABILIDADE LIMITADA'
describe('nomes de transporte padronizados', () => {
  it.each([
    ['termo', '90c3df7c-1111-4222-8333-444444444444', 'TERMO_CESSAO_FIDC_HEALTH_90C3DF7C.PDF'],
    ['notificacao', '90c3df7c-1111-4222-8333-444444444444', 'NOTIFICACAO_SACADO_FIDC_HEALTH_90C3DF7C.PDF'],
    ['contrato', '14.224.864/0001-00', 'CONTRATO_CESSAO_FIDC_HEALTH_14224864000100.PDF'],
    ['contrato_assinado', '14224864000100', 'CONTRATO_CESSAO_ASSINADO_FIDC_HEALTH_14224864000100.PDF'],
    ['termo_assinado', '90c3df7c-1111-4222-8333-444444444444', 'TERMO_CESSAO_ASSINADO_FIDC_HEALTH_90C3DF7C.PDF'],
    ['quitacao', '90c3df7c-1111-4222-8333-444444444444', 'TERMO_QUITACAO_FIDC_HEALTH_90C3DF7C.PDF'],
  ] as const)('%s usa identidade correta e extensao maiuscula', (tipo, identificador, expected) => {
    expect(nomeDocumentoDownload({tipo, identificador, fundoNome})).toBe(expected)
  })
  it('encurta remessa Fromtis com oito caracteres do ID e data UTC', () => {
    expect(nomeRemessaFromtis({fundoNome,remessaId:'4378dk32-restante',dataGeracao:'2026-10-16T10:00:00Z'})).toBe('REM_HEALTH_4378DK32_20261016.REM')
  })
  it('normaliza acentos, espacos e caracteres perigosos sem regra por Fundo', () => {
    expect(nomeCurtoFundo('  São Vale FIDC')).toBe('SAO')
    expect(nomeCurtoFundo('../RLX\r\nHeader: test')).toBe('RLX')
    expect(nomeCurtoFundo('A'.repeat(200))).toHaveLength(24)
    expect(nomeCurtoFundo('')).toBe('FUNDO')
  })
  it('nao reclassifica remessas/comprovantes nem emite identificadores invalidos', () => {
    for(const tipo of ['remessa','comprovante_pagamento','contrato','termo'] as const)
      expect(nomeDocumentoDownload({tipo,fundoNome,identificador:'../bad'})).toBeNull()
    expect(()=>nomeRemessaFromtis({fundoNome,remessaId:'../bad',dataGeracao:'2026-10-16'})).toThrow()
    expect(()=>nomeRemessaFromtis({fundoNome,remessaId:'12345678',dataGeracao:'invalid'})).toThrow()
  })
})
