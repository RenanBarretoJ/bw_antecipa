import { describe, expect, it } from 'vitest'
import {
  LIMITE_PADRAO_POSTERGACAO_CANHOTO_DIAS,
  addCalendarDays,
  avaliarPossibilidadePostergacaoCanhoto,
  calcularStatusPrazoUploadCanhoto,
  resolverConfiguracaoPostergacaoCanhoto,
  snapshotExigeCanhoto,
  validarNovaPrevisaoCanhoto,
} from './postergacao-canhoto'

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  permite_postergacao_upload_canhoto: true,
  limite_postergacao_upload_canhoto_dias: 5,
  requisitos: [{
    ativo: true,
    obrigatorio: true,
    escopo: 'pos_cessao',
    tipo_documento_codigo: 'comprovante_entrega',
  }],
  ...overrides,
})

const avaliar = (overrides: Partial<Parameters<typeof avaliarPossibilidadePostergacaoCanhoto>[0]> = {}) =>
  avaliarPossibilidadePostergacaoCanhoto({
    snapshot: snapshot(),
    prazoOriginal: '2026-08-20',
    hoje: '2026-08-18',
    postergacaoJaUtilizada: false,
    primeiroUploadEm: null,
    notaCedida: true,
    ...overrides,
  })

describe('postergação única do upload do canhoto', () => {
  it('reconhece somente canhoto obrigatório no pós-cessão', () => {
    expect(snapshotExigeCanhoto(snapshot())).toBe(true)
    expect(snapshotExigeCanhoto(snapshot({ requisitos: [] }))).toBe(false)
    expect(snapshotExigeCanhoto(snapshot({ requisitos: [{ ativo: true, obrigatorio: true, escopo: 'nf_pre_cessao', tipo_documento_codigo: 'canhoto' }] }))).toBe(false)
    expect(snapshotExigeCanhoto(snapshot({ requisitos: [{ ativo: true, obrigatorio: false, escopo: 'pos_cessao', tipo_documento_codigo: 'canhoto' }] }))).toBe(false)
  })

  it('mantém snapshots antigos desabilitados e aplica o padrão de cinco dias somente quando habilitado', () => {
    expect(resolverConfiguracaoPostergacaoCanhoto({ requisitos: [] })).toEqual({ permite: false, limiteDias: null })
    expect(resolverConfiguracaoPostergacaoCanhoto(snapshot({ limite_postergacao_upload_canhoto_dias: null }))).toEqual({
      permite: true,
      limiteDias: LIMITE_PADRAO_POSTERGACAO_CANHOTO_DIAS,
    })
    expect(resolverConfiguracaoPostergacaoCanhoto(snapshot({ limite_postergacao_upload_canhoto_dias: 9 }))).toEqual({ permite: true, limiteDias: 9 })
    expect(resolverConfiguracaoPostergacaoCanhoto(snapshot({ limite_postergacao_upload_canhoto_dias: 0 }))).toEqual({ permite: false, limiteDias: null })
  })

  it('calcula dias corridos sem depender do fuso do navegador', () => {
    expect(addCalendarDays('2026-08-20', 5)).toBe('2026-08-25')
    expect(addCalendarDays('2026-02-27', 2)).toBe('2026-03-01')
  })

  it('permite comunicar antes, no dia ou depois do prazo original dentro do limite', () => {
    expect(avaliar({ hoje: '2026-08-18' })).toMatchObject({ permitida: true, dataMinima: '2026-08-21', dataMaxima: '2026-08-25' })
    expect(avaliar({ hoje: '2026-08-20' })).toMatchObject({ permitida: true, dataMinima: '2026-08-21', dataMaxima: '2026-08-25' })
    expect(avaliar({ hoje: '2026-08-23' })).toMatchObject({ permitida: true, dataMinima: '2026-08-23', dataMaxima: '2026-08-25' })
  })

  it('bloqueia quando a janela máxima já acabou', () => {
    expect(avaliar({ hoje: '2026-08-26' })).toMatchObject({ permitida: false, dataMaxima: '2026-08-25' })
  })

  it('bloqueia política sem canhoto, configuração desabilitada, NF sem cessão e prazo ausente', () => {
    expect(avaliar({ snapshot: snapshot({ requisitos: [] }) }).permitida).toBe(false)
    expect(avaliar({ snapshot: snapshot({ permite_postergacao_upload_canhoto: false }) }).permitida).toBe(false)
    expect(avaliar({ notaCedida: false }).permitida).toBe(false)
    expect(avaliar({ prazoOriginal: null }).permitida).toBe(false)
  })

  it('bloqueia segunda comunicação e qualquer upload histórico, inclusive documento rejeitado', () => {
    expect(avaliar({ postergacaoJaUtilizada: true }).permitida).toBe(false)
    expect(avaliar({ primeiroUploadEm: '2026-08-19T10:00:00Z' }).permitida).toBe(false)
  })

  it('valida data igual ao prazo, passada, anterior ao mínimo e superior ao limite', () => {
    const base = {
      prazoOriginal: '2026-08-20',
      hoje: '2026-08-23',
      dataMinima: '2026-08-23',
      dataMaxima: '2026-08-25',
    }
    expect(validarNovaPrevisaoCanhoto({ ...base, novaPrevisao: '2026-08-20' })).toMatch(/posterior/i)
    expect(validarNovaPrevisaoCanhoto({ ...base, novaPrevisao: '2026-08-22' })).toMatch(/passado/i)
    expect(validarNovaPrevisaoCanhoto({ ...base, dataMinima: '2026-08-24', novaPrevisao: '2026-08-23' })).toMatch(/entre/i)
    expect(validarNovaPrevisaoCanhoto({ ...base, novaPrevisao: '2026-08-26' })).toMatch(/entre/i)
    expect(validarNovaPrevisaoCanhoto({ ...base, novaPrevisao: '2026-08-24' })).toBeNull()
  })

  it('deriva separadamente prazo vigente, vencimento no dia, atraso e cumprimento', () => {
    expect(calcularStatusPrazoUploadCanhoto({ prazo: '2026-08-20', hoje: '2026-08-19', primeiroUploadEm: null })).toBe('pendente')
    expect(calcularStatusPrazoUploadCanhoto({ prazo: '2026-08-20', hoje: '2026-08-20', primeiroUploadEm: null })).toBe('vence_hoje')
    expect(calcularStatusPrazoUploadCanhoto({ prazo: '2026-08-20', hoje: '2026-08-21', primeiroUploadEm: null })).toBe('vencido')
    expect(calcularStatusPrazoUploadCanhoto({ prazo: '2026-08-20', hoje: '2026-08-30', primeiroUploadEm: '2026-08-20T23:00:00Z' })).toBe('atendido_no_prazo')
    expect(calcularStatusPrazoUploadCanhoto({ prazo: '2026-08-20', hoje: '2026-08-30', primeiroUploadEm: '2026-08-21T00:00:00Z' })).toBe('atendido_em_atraso')
  })
})
