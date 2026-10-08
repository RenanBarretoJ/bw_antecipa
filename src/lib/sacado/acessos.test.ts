import { describe, expect, it } from 'vitest'
import { filtrarAcessosSacado, possuiAcessoSacado, type SacadoAcesso } from './acessos'

const acessos: SacadoAcesso[] = ['11344038002141', '11344038002060'].map(cnpj => ({ user_id: 'a', sacado_id: cnpj, cnpj, razao_social: 'QA', fundo_id: 'health', status: 'ativo' }))
describe('Sacado explicit company/fund memberships', () => {
  it('allows both explicitly granted full CNPJs', () => {
    expect(possuiAcessoSacado(acessos, '11.344.038/0021-41', 'health')).toBe(true)
    expect(possuiAcessoSacado(acessos, '11344038002060', 'health')).toBe(true)
  })
  it('denies same root, cross-fund, missing fund and revoked membership', () => {
    expect(possuiAcessoSacado(acessos, '11344038009910', 'health')).toBe(false)
    expect(possuiAcessoSacado(acessos, acessos[0].cnpj, 'other')).toBe(false)
    expect(possuiAcessoSacado(acessos, acessos[0].cnpj, null)).toBe(false)
    expect(possuiAcessoSacado([{ ...acessos[0], status: 'revogado' }], acessos[0].cnpj, 'health')).toBe(false)
  })
  it('URL filter only narrows and never grants access', () => {
    expect(filtrarAcessosSacado(acessos)).toHaveLength(2)
    expect(filtrarAcessosSacado(acessos, acessos[1].cnpj)).toEqual([acessos[1]])
    expect(filtrarAcessosSacado(acessos, '11344038')).toEqual([])
    expect(filtrarAcessosSacado(acessos, '11344038009910')).toEqual([])
  })
})
