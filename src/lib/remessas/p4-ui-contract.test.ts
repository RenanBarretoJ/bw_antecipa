import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const client = readFileSync(join(process.cwd(), 'src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx'), 'utf8')
const generateRoute = readFileSync(join(process.cwd(), 'src/app/api/contratos/gerar-remessa/route.ts'), 'utf8')
const sendRoute = readFileSync(join(process.cwd(), 'src/app/api/contratos/enviar-remessa/route.ts'), 'utf8')

describe('P4 - contrato de UI e autorizacao', () => {
  it('expõe os nomes genericos de remessa e remove as acoes CNAB especificas', () => {
    expect(client).toContain('Gerar Remessa')
    expect(client).toContain('Enviar Remessa para ADM')
    expect(client).not.toContain('Gerar CNAB')
    expect(client).not.toContain('Enviar CNAB para Portal FIDC')
  })

  it('preserva Gestor, MFA e leitura RLS antes de usar o backend administrativo', () => {
    for (const route of [generateRoute, sendRoute]) {
      expect(route).toContain('requireGestor()')
      expect(route).toContain('exigirSessaoElevada(context)')
      expect(route).toContain("context.supabase")
      expect(route).toContain("from('operacoes')")
    }
  })
})
