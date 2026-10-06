import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('performance scope 5 structure', () => {
  it('renders audit from the server and removes the fixed 200/client filtering load', () => {
    const page = source('src/app/gestor/auditoria/page.tsx')
    const loader = source('src/lib/auditoria/listagem.server.ts')
    expect(page).not.toContain("'use client'")
    expect(page).not.toContain('useEffect')
    expect(page).not.toContain('buttonVariants(')
    expect(page).toContain('nativeButton={false}')
    expect(loader).not.toContain('.limit(200)')
    expect(loader).toContain('.limit(limit + 1)')
    expect(loader).toContain("requireGestor()")
    expect(loader).not.toContain("select('*')")
  })

  it('uses the canonical compound cursor in audit, history, and notifications', () => {
    const keyset = source('src/lib/pagination/keyset.ts')
    const history = source('src/lib/actions/historico.ts')
    const notifications = source('src/lib/notificacoes/listagem.server.ts')
    expect(keyset).toContain('created_at.lt.${cursor.createdAt}')
    expect(keyset).toContain('id.lt.${cursor.id}')
    expect(history).toContain('parseCursor(input.cursor)')
    expect(history).toContain('encodeCursor({ createdAt: String(last.created_at), id: String(last.id) })')
    expect(history).not.toContain("query.lt('created_at'")
    expect(notifications).toContain('p_cursor_em: cursor?.createdAt')
    expect(notifications).toContain('p_cursor_id: cursor?.id')
    const sql = source('supabase/migrations/20261006130657_notificacoes_scoped_ui.sql')
    expect(sql).toContain('(n.created_at,n.id) < (p_cursor_em,p_cursor_id)')
  })

  it('loads the shared history only after expansion and returns its first total in the same query', () => {
    const component = source('src/components/historico/HistoricoTimelineCard.tsx')
    const history = source('src/lib/actions/historico.ts')
    expect(component).not.toContain('useEffect')
    expect(component).not.toContain('carregarResumoHistorico')
    expect(component).toContain('loadPage(true, filtro, total === null)')
    expect(history).toContain("{ count: input.incluirTotal ? 'exact' : undefined }")
  })

  it('keeps all four notification routes as server components using one loader', () => {
    for (const role of ['gestor', 'cedente', 'consultor', 'sacado']) {
      const page = source(`src/app/${role}/notificacoes/page.tsx`)
      expect(page).not.toContain("'use client'")
      expect(page).not.toContain('useEffect')
      expect(page).toContain('NotificacoesPageServer')
    }
  })

  it('derives notification ownership from auth and uses compact fields', () => {
    const loader = source('src/lib/notificacoes/listagem.server.ts')
    const actions = source('src/lib/actions/notificacoes-listagem.ts')
    expect(loader).toContain('await requireAuthenticated()')
    expect(loader).toContain('validarContextoNotificacoes(context, input.escopo)')
    expect(loader).toContain('compactarNotificacao')
    expect(loader).not.toContain('createAdminClient')
    expect(loader).not.toContain("select('*')")
    expect(actions).not.toContain('usuarioId:')
    expect(actions).toContain("auth.supabase.rpc('marcar_notificacoes_lidas'")
    const sql = source('supabase/migrations/20261006130657_notificacoes_scoped_ui.sql')
    expect(sql).toContain('n.usuario_id = (SELECT auth.uid())')
  })

  it('reconciles scoped realtime without full route reload and cleans up both subscriptions', () => {
    const pageClient = source('src/components/notificacoes/notificacoes-page-client.tsx')
    const bell = source('src/components/ui/notification-bell.tsx')
    const hook = source('src/components/notificacoes/use-notificacoes.ts')
    expect(hook).toContain("event: '*'")
    expect(hook).toContain('deduplicarNotificacoes')
    expect(hook).toContain('eventoDoEscopo')
    expect(hook).toContain('boundary !== session.current')
    expect(pageClient).toContain('useNotificacoes(initialFilter, 20)')
    expect(pageClient).toContain('buildListUrl')
    expect(hook).toContain('removeChannel(channel)')
    expect(pageClient).not.toContain('router.refresh')
    expect(bell).toContain("useNotificacoes('todas', 10)")
    expect(bell).not.toContain("select('*')")
  })
})
