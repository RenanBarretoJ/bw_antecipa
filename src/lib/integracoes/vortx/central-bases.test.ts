import { describe, expect, it } from 'vitest'
import { filtrosBasesSchema, hrefBases, lerFiltrosBases } from './central-bases'

describe('consulta da Central de Bases', () => {
  it('normaliza apenas filtros do contrato', () => {
    expect(lerFiltrosBases({ tipo: 'PosicaoParcela', origem: 'CRON', estado: 'aceita', referencia: '2026-10-19', fundo: 'outro' }))
      .toEqual({ tipo: 'PosicaoParcela', origem: 'CRON', estado: 'aceita', referencia: '2026-10-19' })
  })
  it.each([{ tipo: ['Inclusao', 'Exclusao'] }, { origem: 'UPLOAD' }, { estado: 'PUBLICADA' }, { referencia: '2026-02-30' }, { tipo: 'Consolidado' }])('ignora URL inválida sem inventar filtros: %j', query => {
    expect(lerFiltrosBases(query)).toEqual({})
  })
  it('rejeita campos extras e filtros adulterados no contrato do servidor', () => {
    expect(filtrosBasesSchema.safeParse({ fundoId: 'outro' }).success).toBe(false)
    expect(filtrosBasesSchema.safeParse({ tipo: "Inclusao' OR true" }).success).toBe(false)
  })
  it('preserva o tab administrativo e os filtros na paginação', () => {
    expect(hrefBases('/admin/fundos/qa?tab=central-bases', { tipo: 'Inclusao', origem: 'MANUAL' }, 2))
      .toBe('/admin/fundos/qa?tab=central-bases&tipo=Inclusao&origem=MANUAL&pagina=2#historico-bases')
  })
  it('nova busca volta à primeira página e limpar não mantém filtros anteriores', () => {
    expect(hrefBases('/gestor/central-bases?tipo=Inclusao&pagina=3', {}))
      .toBe('/gestor/central-bases?pagina=1#historico-bases')
  })
})
