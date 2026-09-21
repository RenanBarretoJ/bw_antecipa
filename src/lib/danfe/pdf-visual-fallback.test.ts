import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { composeVisualDanfeText, recoverCanonicalTotalFromTsv, recoverDueDateFromTsv, VISUAL_PDF_LIMITS } from './pdf-visual-fallback.server'
import { extractDanfeFromText, validarDanfeParaPersistencia } from '../pdf-nf-parser'

const ACCESS_KEY = '29260912345678000195550020001548061123456780'

describe('aquisicao visual generica de DANFE', () => {
  it('compoe somente evidencias genericas validadas antes do parser P12', () => {
    const text = composeVisualDanfeText({
      accessKey: ACCESS_KEY,
      rawText: [
        'DESTINATARIO / REMETENTE',
        'SACADO 11.222.333/0001-81',
        'DATA DE EMISSAO 16/09/2026',
        'VENCIMENTO: 311 0/2026',
        'VALOR TOTAL DA NOTA R$ 8.371,99',
        '154806-01/01 31/10/2026 8371.99 |',
      ].join('\n'),
    })
    const parsed = extractDanfeFromText(text)
    expect(parsed).toMatchObject({
      numero_nf: '154806',
      serie: '2',
      cnpj_emitente: '12345678000195',
      cnpj_destinatario: '11222333000181',
      data_emissao: '2026-09-16',
      data_vencimento: '2026-10-31',
      valor_bruto: 8371.99,
    })
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it('nao promove CNPJ invalido ou ambiguo do destinatario', () => {
    const text = composeVisualDanfeText({
      accessKey: ACCESS_KEY,
      rawText: [
        'DESTINATARIO / REMETENTE',
        '11.222.333/0001-81',
        '07.312.248/0001-37',
        'DATA DE EMISSAO 16/09/2026',
      ].join('\n'),
    })
    expect(text.split('\n').slice(0, 6)).not.toContain('CNPJ 11222333000181')
  })

  it('considera repeticoes do bloco destinatario e promove somente o CNPJ estruturalmente valido', () => {
    const text = composeVisualDanfeText({
      accessKey: ACCESS_KEY,
      rawText: [
        'DESTINATARIO / REMETENTE',
        'CNPJ/CPF 11.844.038/0021-41',
        'DESTINATARIO / REMETENTE',
        'CNPJ/CPF 11.222.333/0001-81',
      ].join('\n'),
    })
    expect(text.split('\n').slice(0, 6)).toContain('CNPJ 11222333000181')
  })

  it('recupera total somente abaixo do rotulo canonico com formato monetario inequivoco', () => {
    const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
    const rows = [
      '5\t1\t1\t1\t1\t1\t100\t100\t40\t10\t90\tVALOR',
      '5\t1\t1\t1\t1\t2\t145\t100\t40\t10\t90\tTOTAL',
      '5\t1\t1\t1\t1\t3\t190\t100\t20\t10\t90\tDA',
      '5\t1\t1\t1\t1\t4\t215\t100\t40\t10\t90\tNOTA',
      '5\t1\t1\t1\t2\t1\t145\t125\t5\t20\t80\t1',
      '5\t1\t1\t1\t2\t2\t155\t125\t80\t20\t80\t6.532,21',
    ]
    expect(recoverCanonicalTotalFromTsv([header, ...rows].join('\n'))).toBe('16.532,21')
    expect(recoverCanonicalTotalFromTsv([header, ...rows.slice(0, -2), rows.at(-1)!.replace('6.532,21', '8.371.99')].join('\n'))).toBeUndefined()
  })

  it('recupera vencimento fragmentado somente na regiao estrutural do rotulo', () => {
    const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
    const rows = [
      '5\t1\t1\t1\t1\t1\t100\t100\t80\t10\t90\tVencimento:',
      '5\t1\t1\t1\t2\t1\t100\t125\t30\t20\t80\t241',
      '5\t1\t1\t1\t2\t2\t135\t125\t70\t20\t80\t0/2026',
    ]
    expect(recoverDueDateFromTsv([header, ...rows].join('\n'), '25/08/2026')).toBe('24/10/2026')
  })

  it('mantem limites explicitos e nao contem regra especifica de cedente', () => {
    expect(VISUAL_PDF_LIMITS).toEqual({
      maxPages: 2,
      maxRenderedPixels: 5_000_000,
      renderScale: 3,
      maxConcurrent: 2,
      timeoutMs: 50_000,
    })
    const source = readFileSync('src/lib/danfe/pdf-visual-fallback.server.ts', 'utf8').toUpperCase()
    expect(source).not.toContain('TADMEDICAL')
    expect(source).not.toContain('07312248000137')
  })
})
