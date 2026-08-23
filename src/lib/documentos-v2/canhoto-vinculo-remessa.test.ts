import { describe, expect, it } from 'vitest'
import { inferirVinculoRemessaCanhoto } from './canhoto-vinculo-remessa'

describe('inferirVinculoRemessaCanhoto', () => {
  it('nenhuma remessa validada -> sem vinculo, sem ambiguidade (evidencia da venda diretamente)', () => {
    expect(inferirVinculoRemessaCanhoto([])).toEqual({ notaFiscalRemessaId: null, ambiguo: false })
  })

  it('exatamente uma remessa validada -> vincula automaticamente a essa remessa', () => {
    expect(inferirVinculoRemessaCanhoto([{ id: 'remessa-1' }])).toEqual({ notaFiscalRemessaId: 'remessa-1', ambiguo: false })
  })

  it('duas ou mais remessas validadas -> ambiguo, nenhum vinculo escolhido automaticamente', () => {
    expect(inferirVinculoRemessaCanhoto([{ id: 'remessa-1' }, { id: 'remessa-2' }])).toEqual({ notaFiscalRemessaId: null, ambiguo: true })
  })

  it('tres remessas validadas -> continua ambiguo (nao escolhe a primeira nem a ultima)', () => {
    expect(inferirVinculoRemessaCanhoto([{ id: 'remessa-1' }, { id: 'remessa-2' }, { id: 'remessa-3' }])).toEqual({ notaFiscalRemessaId: null, ambiguo: true })
  })
})
