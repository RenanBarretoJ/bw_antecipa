import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'src/app/gestor/sem-fundo/page.tsx'), 'utf8')
const middleware = readFileSync(resolve(process.cwd(), 'src/lib/supabase/middleware.ts'), 'utf8')

describe('gestor sem fundo', () => {
  it('renderiza estado vazio sem resolver contexto de fundo', () => {
    expect(page).toContain('Nenhum fundo autorizado')
    expect(page).not.toContain('resolverContextoFundoGestor')
  })

  it('evita loop e libera o dashboard quando um vinculo se torna ativo', () => {
    expect(middleware).toContain("pathname !== '/gestor/sem-fundo'")
    expect(middleware).toContain("access.gestorPossuiFundoAtivo && pathname === '/gestor/sem-fundo'")
  })
})
