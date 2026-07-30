import { describe, expect, it } from 'vitest'
import {
  compactarNotificacao,
  deduplicarNotificacoes,
  notificacaoMatchesFilter,
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
    })
    expect(mapped).toEqual(item)
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
})
