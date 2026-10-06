import { describe, expect, it } from 'vitest'
import {
  compactarNotificacao,
  deduplicarNotificacoes,
  notificacaoMatchesFilter,
  eventoDoEscopo,
  chaveEscopo,
  parseNotificacaoFiltro,
  type NotificacaoListagemItem,
} from './contracts'

const item: NotificacaoListagemItem = {
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-07-30T10:00:00.000000Z',
  titulo: 'Titulo',
  mensagem: 'Mensagem',
  tipo: 'info',
  lida: false,
  entidadeTipo: null,
  entidadeId: null,
  href: null,
  scope: 'FUNDO',
  fundoId: '00000000-0000-4000-8000-000000000002',
}

describe('notification compact contract', () => {
  it('rejects malformed realtime payloads', () => {
    expect(compactarNotificacao({ id: item.id })).toBeNull()
  })

  it('maps only public list fields', () => {
    const mapped = compactarNotificacao({
      id: item.id,
      created_at: item.createdAt,
      titulo: item.titulo,
      mensagem: item.mensagem,
      tipo: item.tipo,
      lida: item.lida,
      usuario_id: 'private-user',
      dedupe_key: 'internal',
      scope_type: 'FUNDO',
      fundo_id: item.fundoId,
    })
    expect(mapped).toEqual({ ...item, href: `/notificacoes/abrir/${item.id}?fundo=${item.fundoId}` })
    expect(mapped).not.toHaveProperty('usuario_id')
    expect(mapped).not.toHaveProperty('dedupe_key')
  })

  it('deduplicates realtime and server items by id', () => {
    expect(deduplicarNotificacoes([item, item])).toEqual([item])
  })

  it('applies the active read filter locally only to realtime rows', () => {
    expect(notificacaoMatchesFilter(item, 'nao_lidas')).toBe(true)
    expect(notificacaoMatchesFilter({ ...item, lida: true }, 'nao_lidas')).toBe(false)
  })

  it('ignores another fund, user and legacy/global events while in A', () => {
    const scope = { scope: 'FUNDO' as const, fundoId: 'A' }
    expect(eventoDoEscopo({ usuario_id: 'U', scope_type: 'FUNDO', fundo_id: 'A' }, 'U', scope)).toBe(true)
    for (const row of [{ usuario_id: 'U', scope_type: 'FUNDO', fundo_id: 'B' }, { usuario_id: 'X', scope_type: 'FUNDO', fundo_id: 'A' }, { usuario_id: 'U', scope_type: 'GLOBAL', fundo_id: null }, { id: 'deleted-partial-payload' }]) expect(eventoDoEscopo(row, 'U', scope)).toBe(false)
    expect(chaveEscopo(scope)).not.toBe(chaveEscopo({ scope: 'FUNDO', fundoId: 'B' }))
    expect(chaveEscopo(null)).not.toBe(chaveEscopo({ scope: 'GLOBAL', fundoId: null }))
  })
  it.each([['documentos','boleto_parcela_aprovado'],['operacoes','operacao_aprovada'],['logistica','canhoto_enviado'],['integracoes','cnab_falha'],['alertas','cte_vencido']] as const)('filters %s on the typed event, not message text', (filter, tipo) => {
    expect(parseNotificacaoFiltro(filter)).toBe(filter)
    expect(notificacaoMatchesFilter({ ...item, tipo }, filter)).toBe(true)
    expect(notificacaoMatchesFilter({ ...item, mensagem: tipo }, filter)).toBe(false)
  })
})
