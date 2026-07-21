import { describe, expect, it } from 'vitest'
import { CedenteFundoError, assertFundoAtivo, selecionarVinculoAtivo } from './cedente-fundo'
import type { CedenteFundo, Fundo } from '@/types/database'

const link = (id: string, status: CedenteFundo['status'] = 'ativo'): CedenteFundo => ({
  id, cedente_id: 'cedente-1', fundo_id: `fundo-${id}`, codigo_externo: null, status,
  vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, observacoes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})

const fund = (ativo: boolean): Fundo => ({
  id: 'fundo-1', nome: 'Fundo', cnpj: '123', administradora_nome: 'Adm', administradora_cnpj: '456',
  gestora_nome: 'Gestora', gestora_cnpj: '789', custodiante_nome: null, custodiante_cnpj: null,
  conta_vinculada: null, agencia: null, banco: null, administradora_endereco: null,
  administradora_ato_declaratorio: null, contato_nome: null, contato_email: null, ativo, created_at: null,
})

describe('vinculo cedente-fundo', () => {
  it('aceita nenhum ou um vinculo ativo e rejeita ambiguidade', () => {
    expect(selecionarVinculoAtivo([])).toBeNull()
    expect(selecionarVinculoAtivo([link('1')])?.id).toBe('1')
    expect(() => selecionarVinculoAtivo([link('1'), link('2')])).toThrow(CedenteFundoError)
  })

  it('distingue fundo ativo de fundo inativo', () => {
    expect(() => assertFundoAtivo(fund(true))).not.toThrow()
    expect(() => assertFundoAtivo(fund(false))).toThrow(/inativo/i)
  })
})
