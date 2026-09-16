import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { agruparVinculosOperacionaisAtivos, operacaoContaComoVinculoAtivo } from './vinculo-operacional'

const nf = 'nf-1'
const vinculo = (operacao_id: string, nota_fiscal_id = nf) => ({ operacao_id, nota_fiscal_id })
const operacao = (id: string, status: string) => ({ id, status })

describe('vínculo operacional da NF para aceite do sacado', () => {
  it.each(['solicitada', 'em_analise', 'aprovada', 'em_andamento', 'liquidada', 'inadimplente'])(
    '%s continua contando como vínculo ativo',
    (status) => expect(operacaoContaComoVinculoAtivo(status)).toBe(true),
  )

  it.each(['cancelada', 'reprovada'])(
    '%s não conta como vínculo ativo',
    (status) => expect(operacaoContaComoVinculoAtivo(status)).toBe(false),
  )

  it('solicitada isolada possui um vínculo ativo', () => {
    const result = agruparVinculosOperacionaisAtivos([vinculo('atual')], [operacao('atual', 'solicitada')])
    expect([...result.get(nf)!]).toEqual(['atual'])
  })

  it('cancelada isolada não possui vínculo ativo', () => {
    const result = agruparVinculosOperacionaisAtivos([vinculo('antiga')], [operacao('antiga', 'cancelada')])
    expect(result.get(nf)).toBeUndefined()
  })

  it('cancelada + solicitada preserva o histórico e seleciona apenas a atual', () => {
    const links = [vinculo('antiga'), vinculo('atual')]
    const result = agruparVinculosOperacionaisAtivos(links, [operacao('antiga', 'cancelada'), operacao('atual', 'solicitada')])
    expect(links).toHaveLength(2)
    expect([...result.get(nf)!]).toEqual(['atual'])
  })

  it('duas operações ativas são ambíguas e devem ser bloqueadas', () => {
    const result = agruparVinculosOperacionaisAtivos(
      [vinculo('primeira'), vinculo('segunda')],
      [operacao('primeira', 'solicitada'), operacao('segunda', 'aprovada')],
    )
    expect(result.get(nf)?.size).toBe(2)
  })

  it('cancelada + aprovada conta somente a aprovada', () => {
    const result = agruparVinculosOperacionaisAtivos(
      [vinculo('antiga'), vinculo('atual')],
      [operacao('antiga', 'cancelada'), operacao('atual', 'aprovada')],
    )
    expect([...result.get(nf)!]).toEqual(['atual'])
  })

  it('duas canceladas não criam vínculo ativo', () => {
    const result = agruparVinculosOperacionaisAtivos(
      [vinculo('a'), vinculo('b')],
      [operacao('a', 'cancelada'), operacao('b', 'cancelada')],
    )
    expect(result.get(nf)).toBeUndefined()
  })

  it('parcelas ou linhas repetidas da mesma operação não multiplicam a NF', () => {
    const result = agruparVinculosOperacionaisAtivos(
      [vinculo('atual'), vinculo('atual')],
      [operacao('atual', 'solicitada')],
    )
    expect(result.get(nf)?.size).toBe(1)
  })

  it('não oculta operação inacessível, mesmo que o cliente tente apontar vínculo antigo', () => {
    expect(() => agruparVinculosOperacionaisAtivos([vinculo('desconhecida')], [])).toThrow('Operacao vinculada nao esta acessivel.')
  })

  it('action usa filtro histórico e a RPC mantém bloqueio de dois vínculos ativos', () => {
    const action = readFileSync('src/lib/actions/sacado.ts', 'utf8')
    const migration = readFileSync('supabase/migrations/20260916150333_corrigir_aceite_sacado_vinculo_nf_cancelada.sql', 'utf8')
    expect(action).toContain('agruparVinculosOperacionaisAtivos(links || [], operacoes || [])')
    expect(action).toContain('aprovarCessaoLote')
    expect(action).toContain('contestarCessao')
    expect(migration).toContain("op.status::text NOT IN ('cancelada', 'reprovada')")
    expect(migration).toContain('HAVING count(DISTINCT onf.operacao_id) <> 1')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).not.toContain('DELETE FROM public.operacoes_nfs')
  })
})
