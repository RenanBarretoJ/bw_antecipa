import { describe, expect, it } from 'vitest'
import {
  adminCriarIntegracaoTransportadoraSchema,
  adminReprocessarWebhookEventoSchema,
  adminRevogarTokenTransportadoraSchema,
  mascararTokenDisplay,
  parseAdminWebhookEventosFiltro,
  statusPodeSerReprocessado,
  WEBHOOK_EVENTO_STATUSES,
} from './integracoes-transportadoras'

describe('mascararTokenDisplay', () => {
  it('formata os ultimos 4 caracteres com marcador de mascara', () => {
    expect(mascararTokenDisplay('ab12')).toBe('•••• ab12')
  })

  it('usa um placeholder quando nao ha token (revogado sem display legado)', () => {
    expect(mascararTokenDisplay(null)).toBe('----')
  })
})

describe('statusPodeSerReprocessado', () => {
  it('permite reprocessar exatamente os 3 status do ticket', () => {
    expect(statusPodeSerReprocessado('NAO_IDENTIFICADO')).toBe(true)
    expect(statusPodeSerReprocessado('REVISAO_MATCH')).toBe(true)
    expect(statusPodeSerReprocessado('ERRO_REPROCESSAVEL')).toBe(true)
  })

  it('nunca permite reprocessar status terminais/ja resolvidos', () => {
    expect(statusPodeSerReprocessado('PROCESSADO')).toBe(false)
    expect(statusPodeSerReprocessado('DUPLICADO')).toBe(false)
    expect(statusPodeSerReprocessado('ERRO_FINAL')).toBe(false)
    expect(statusPodeSerReprocessado('IGNORADO_CANHOTO_JA_APROVADO')).toBe(false)
    expect(statusPodeSerReprocessado('AGUARDANDO_ENTREGA')).toBe(false)
    expect(statusPodeSerReprocessado('EVIDENCIA_INDISPONIVEL')).toBe(false)
  })

  it('todos os status reprocessaveis pertencem ao enum completo de status', () => {
    expect(WEBHOOK_EVENTO_STATUSES).toContain('NAO_IDENTIFICADO')
    expect(WEBHOOK_EVENTO_STATUSES).toContain('REVISAO_MATCH')
    expect(WEBHOOK_EVENTO_STATUSES).toContain('ERRO_REPROCESSAVEL')
    expect(WEBHOOK_EVENTO_STATUSES).toContain('EVIDENCIA_INDISPONIVEL')
  })
})

describe('adminCriarIntegracaoTransportadoraSchema', () => {
  const valido = { fundoId: '11111111-1111-1111-1111-111111111111', provider: 'braspress', mfaCode: '123456' }

  it('aceita payload minimo valido', () => {
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse(valido).success).toBe(true)
  })

  it('normaliza provider para minusculas', () => {
    const resultado = adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, provider: 'BrasPress' })
    expect(resultado.success).toBe(true)
    if (resultado.success) expect(resultado.data.provider).toBe('braspress')
  })

  it('rejeita provider fora do padrao', () => {
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, provider: 'a' }).success).toBe(false)
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, provider: 'tem espaco' }).success).toBe(false)
  })

  it('rejeita fundoId invalido', () => {
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, fundoId: 'nao-e-uuid' }).success).toBe(false)
  })

  it('rejeita mfaCode fora do padrao de 6 digitos', () => {
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, mfaCode: '123' }).success).toBe(false)
    expect(adminCriarIntegracaoTransportadoraSchema.safeParse({ ...valido, mfaCode: 'abcdef' }).success).toBe(false)
  })
})

describe('adminRevogarTokenTransportadoraSchema', () => {
  it('motivo e opcional', () => {
    const resultado = adminRevogarTokenTransportadoraSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', mfaCode: '123456' })
    expect(resultado.success).toBe(true)
  })
})

describe('adminReprocessarWebhookEventoSchema', () => {
  it('exige id e mfaCode validos', () => {
    expect(adminReprocessarWebhookEventoSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', mfaCode: '123456' }).success).toBe(true)
    expect(adminReprocessarWebhookEventoSchema.safeParse({ id: 'invalido', mfaCode: '123456' }).success).toBe(false)
  })
})

describe('parseAdminWebhookEventosFiltro', () => {
  it('usa defaults quando nenhum filtro e informado', () => {
    const filtro = parseAdminWebhookEventosFiltro({})
    expect(filtro).toEqual({
      fundoId: null, integracaoId: null, status: null, chaveNfe: null, chaveCte: null,
      desde: null, ate: null, pagina: 1, porPagina: 25,
    })
  })

  it('le todos os filtros informados na querystring', () => {
    const filtro = parseAdminWebhookEventosFiltro({
      fundoId: '11111111-1111-1111-1111-111111111111',
      status: 'REVISAO_MATCH',
      chaveNfe: '1'.repeat(44),
      pagina: '3',
    })
    expect(filtro.fundoId).toBe('11111111-1111-1111-1111-111111111111')
    expect(filtro.status).toBe('REVISAO_MATCH')
    expect(filtro.chaveNfe).toBe('1'.repeat(44))
    expect(filtro.pagina).toBe(3)
  })

  it('normaliza pagina invalida/negativa para 1', () => {
    expect(parseAdminWebhookEventosFiltro({ pagina: '0' }).pagina).toBe(1)
    expect(parseAdminWebhookEventosFiltro({ pagina: '-5' }).pagina).toBe(1)
    expect(parseAdminWebhookEventosFiltro({ pagina: 'abc' }).pagina).toBe(1)
  })

  it('usa apenas o primeiro valor quando o parametro repete na querystring', () => {
    const filtro = parseAdminWebhookEventosFiltro({ status: ['PROCESSADO', 'DUPLICADO'] })
    expect(filtro.status).toBe('PROCESSADO')
  })
})
