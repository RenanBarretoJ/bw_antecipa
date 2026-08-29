import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('resolverContextoFundoGestor', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/gestor/contexto-fundo.server.ts'), 'utf8')

  it('resolve todos os fundos autorizados antes de escolher o contexto', () => {
    expect(source).toContain(".eq('usuario_id', auth.user.id)")
    expect(source).toContain(".eq('status', 'ativo')")
    expect(source).toContain('escolherFundoInicial({ fundos, cookieFundoId })')
    expect(source).not.toContain("if (!fundoId) throw")
    expect(source).not.toContain(".eq('fundo_id', fundoId)")
  })

  it('nao tenta gravar cookie durante renderizacao de Server Component', () => {
    expect(source).not.toContain('cookieStore.set')
    expect(source).not.toContain('cookieStore.delete')
  })
})
