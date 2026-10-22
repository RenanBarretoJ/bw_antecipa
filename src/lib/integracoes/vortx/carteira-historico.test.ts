import { describe, expect, it } from 'vitest'
import { hrefHistoricoCarteira, lerFiltrosCarteira, lerPaginaCarteira } from './carteira-historico'
import { destinoCentralBases } from '@/lib/navigation/central-bases'
import { hrefBases } from './central-bases'

describe('navegação independente do histórico de carteira', () => {
  it('valida data e enum sem aceitar arrays ou estados de callbacks', () => {
    expect(lerFiltrosCarteira({ carteiraEstado: 'PUBLICADA', carteiraReferencia: '2026-10-21' })).toEqual({ estado: 'PUBLICADA', referencia: '2026-10-21' })
    expect(lerFiltrosCarteira({ carteiraEstado: ['PUBLICADA'], carteiraReferencia: '2026-02-30' })).toEqual({})
    expect(lerFiltrosCarteira({ carteiraEstado: 'aceita' })).toEqual({})
  })
  it.each([[undefined, 1], [['2'], 1], ['-3', 1], ['3foo', 1], ['99999', 10000], ['0', 1], ['2', 2]])('limita página %j a %s', (input, expected) => {
    expect(lerPaginaCarteira(input)).toBe(expected)
  })
  it('mantém o tab administrativo e filtros dos relatórios ao navegar pela carteira', () => {
    const base = destinoCentralBases({ pagina: '3', tipo: 'Inclusao', carteiraEstado: 'PUBLICADA', carteiraReferencia: '2026-10-20', carteiraPagina: '2', fundoId: 'evil' }, 'qa')
    const url = hrefHistoricoCarteira(base, { estado: 'RETIFICADA' }, 4)
    expect(url).toBe('/admin/fundos/qa?tab=central-bases&pagina=3&tipo=Inclusao&carteiraPagina=4&carteiraEstado=RETIFICADA#historico-carteira')
    expect(url).not.toContain('evil')
    expect(hrefBases(base, { tipo: 'Exclusao' }, 5)).toContain('carteiraPagina=2')
  })
  it('limpa somente os filtros de carteira e volta à primeira página', () => {
    expect(hrefHistoricoCarteira('/gestor/central-bases?origem=CRON&carteiraEstado=PUBLICADA&carteiraPagina=3', {}))
      .toBe('/gestor/central-bases?origem=CRON&carteiraPagina=1#historico-carteira')
  })
})
