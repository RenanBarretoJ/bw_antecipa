import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { podeGerenciarCarteiraConsultor } from '@/lib/consultor/membership'

const read = (path: string) => readFileSync(path, 'utf8')

describe('C5-R2 reader portfolio surfaces', () => {
  it('keeps LEITOR outside management capabilities', () => {
    expect(podeGerenciarCarteiraConsultor('OWNER')).toBe(true)
    expect(podeGerenciarCarteiraConsultor('ADMIN')).toBe(true)
    expect(podeGerenciarCarteiraConsultor('OPERADOR')).toBe(true)
    expect(podeGerenciarCarteiraConsultor('LEITOR')).toBe(false)
  })

  it('reuses the organizational read predicate without write policies', () => {
    const migration = read('supabase/migrations/20260928143646_c5_r2_reader_portfolio_surfaces.sql')
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_cedente_fundo')
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_nota_fiscal')
    expect(migration).toContain('consultor_pode_visualizar_nota_fiscal')
    expect(migration).toContain('REVOKE ALL')
    expect(migration).not.toMatch(/CREATE\s+POLICY[\s\S]*?FOR\s+(INSERT|UPDATE|DELETE)/i)
  })

  it('hides Cedente management controls from LEITOR', () => {
    const page = read('src/app/consultor/cedentes/page.tsx')
    const loader = read('src/lib/consultor/cedentes.server.ts')
    expect(loader).toContain("'listar_cedentes_visiveis_consultor'")
    expect(page).toContain('resultado.podeGerenciar ?')
    expect(page).toContain('Cadastrar Cedente')
    expect(page).toContain('Documentos')
  })

  it('renders the NF portfolio read-only and uses view gates for LEITOR', () => {
    const page = read('src/app/consultor/notas-fiscais/page.tsx')
    const list = read('src/app/cedente/notas-fiscais/notas-fiscais-listagem.tsx')
    const detail = read('src/app/consultor/notas-fiscais/[id]/page.tsx')
    expect(page).toContain("membership.papel === 'LEITOR'")
    expect(page).toContain("escopo={somenteLeitura ? 'visivel' : 'operacional'}")
    expect(page).toContain('somenteLeituraConsultor: somenteLeitura')
    expect(list).toContain('{!somenteLeitura ? <Card className="mb-6">')
    expect(list).toContain("!somenteLeitura && nf.status === 'rascunho'")
    expect(detail).toContain('requireNotaFiscalViewAccess')
    expect(detail).toContain('somenteLeitura={somenteLeitura}')
  })
})
