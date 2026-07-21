import { describe, expect, it } from 'vitest'
import { normalizarAtorAuditoria } from '@/lib/auth/audit-actor'

describe('auditoria de atores', () => {
  it('registra ator humano com o usuário da sessão', () => {
    expect(normalizarAtorAuditoria(undefined, 'user-1')).toEqual({
      usuario_id: 'user-1',
      ator_tipo: 'usuario',
      origem: 'server_action',
      ator_identificador: null,
    })
  })

  it('registra cron sem simular usuário humano', () => {
    expect(normalizarAtorAuditoria({ tipo: 'cron', origem: 'cron/vencimentos', identificador: 'vencimentos' }, null)).toEqual({
      usuario_id: null,
      ator_tipo: 'cron',
      origem: 'cron/vencimentos',
      ator_identificador: 'vencimentos',
    })
  })

  it('preserva origem de integração sem usuário humano', () => {
    expect(normalizarAtorAuditoria({ tipo: 'integracao', origem: 'api/escrow/sync' }, null)).toEqual({
      usuario_id: null,
      ator_tipo: 'integracao',
      origem: 'api/escrow/sync',
      ator_identificador: null,
    })
  })
})
