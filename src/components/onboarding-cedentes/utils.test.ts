import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filtrarCedentes, montarCedentesOnboarding } from './utils'
import type { CedenteBase, CedenteFundoResumo, FundoResumo, PoliticaResumo, PoliticaVersaoResumo, PoliticaVinculoResumo, RequisitoResumo } from './types'

const fundos: FundoResumo[] = [
  { id: 'fundo-a', nome: 'Fundo A', cnpj: '11111111000111', ativo: true },
]

const cedentes: CedenteBase[] = [
  { id: 'cedente-sem-fundo', razao_social: 'Cedente Sem Fundo LTDA', nome_fantasia: null, cnpj: '00000000000191', status: 'ativo', created_at: '2026-07-20T00:00:00.000Z' },
  { id: 'cedente-sem-politica', razao_social: 'Cedente Sem Politica LTDA', nome_fantasia: 'Sem Politica', cnpj: '00000000000272', status: 'ativo', created_at: '2026-07-21T00:00:00.000Z' },
  { id: 'cedente-apto', razao_social: 'Cedente Apto LTDA', nome_fantasia: 'Apto', cnpj: '12345678000190', status: 'ativo', created_at: '2026-07-22T00:00:00.000Z' },
]

const links: CedenteFundoResumo[] = [
  { id: 'link-sem-politica', cedente_id: 'cedente-sem-politica', fundo_id: 'fundo-a', status: 'ativo', vigente_desde: '2026-07-01T00:00:00.000Z', vigente_ate: null },
  { id: 'link-apto', cedente_id: 'cedente-apto', fundo_id: 'fundo-a', status: 'ativo', vigente_desde: '2026-07-01T00:00:00.000Z', vigente_ate: null },
]

const politicas: PoliticaResumo[] = [
  { id: 'politica-a', fundo_id: 'fundo-a', nome: 'Politica A', codigo: 'politica_a', status: 'ativa', padrao: true },
]

const vinculosPolitica: PoliticaVinculoResumo[] = [
  { id: 'vinculo-politica', cedente_fundo_id: 'link-apto', politica_operacional_id: 'politica-a', status: 'ativa', vigente_desde: '2026-07-01T00:00:00.000Z', vigente_ate: null },
]

const versoes: PoliticaVersaoResumo[] = [
  { id: 'versao-a', politica_operacional_id: 'politica-a', versao: 3, status: 'publicada', publicada_em: '2026-07-02T00:00:00.000Z', vigente_desde: '2026-07-02T00:00:00.000Z', vigente_ate: null },
]

const requisitos: RequisitoResumo[] = [
  { id: 'req-1', politica_operacional_versao_id: 'versao-a' },
  { id: 'req-2', politica_operacional_versao_id: 'versao-a' },
]

describe('onboarding cedentes UI helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives operational status from fund links and published policy versions', () => {
    const rows = montarCedentesOnboarding({ cedentes, links, fundos, vinculosPolitica, politicas, versoes, requisitos })

    expect(rows.find((row) => row.id === 'cedente-sem-fundo')?.onboardingStatus).toBe('aguardando_vinculo_fundo')
    expect(rows.find((row) => row.id === 'cedente-sem-politica')?.onboardingStatus).toBe('aguardando_politica')
    expect(rows.find((row) => row.id === 'cedente-apto')?.onboardingStatus).toBe('apto_operar')
    expect(rows.find((row) => row.id === 'cedente-apto')?.requisitoCount).toBe(2)
  })

  it('filters initial pending queue without mixing ready cedentes', () => {
    const rows = montarCedentesOnboarding({ cedentes, links, fundos, vinculosPolitica, politicas, versoes, requisitos })
    const filtered = filtrarCedentes({ rows, etapa: 'pendencias', busca: '', fundoId: 'todos', politicaId: 'todos', status: 'todos', ordenar: 'mais_antigo' })

    expect(filtered.map((row) => row.id)).toEqual(['cedente-sem-fundo', 'cedente-sem-politica'])
  })

  it('searches by masked or unmasked CNPJ and keeps names truncated only in presentation', () => {
    const rows = montarCedentesOnboarding({ cedentes, links, fundos, vinculosPolitica, politicas, versoes, requisitos })
    const filtered = filtrarCedentes({ rows, etapa: 'todos', busca: '12.345.678/0001-90', fundoId: 'todos', politicaId: 'todos', status: 'todos', ordenar: 'mais_antigo' })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].razao_social).toBe('Cedente Apto LTDA')
  })

  it('filters by fund and policy context', () => {
    const rows = montarCedentesOnboarding({ cedentes, links, fundos, vinculosPolitica, politicas, versoes, requisitos })

    expect(filtrarCedentes({ rows, etapa: 'todos', busca: '', fundoId: 'fundo-a', politicaId: 'todos', status: 'todos', ordenar: 'mais_antigo' }).map((row) => row.id)).toEqual(['cedente-sem-politica', 'cedente-apto'])
    expect(filtrarCedentes({ rows, etapa: 'todos', busca: '', fundoId: 'todos', politicaId: 'politica-a', status: 'todos', ordenar: 'mais_antigo' }).map((row) => row.id)).toEqual(['cedente-apto'])
  })
})
