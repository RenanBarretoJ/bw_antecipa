import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('carregamento seguro de testemunhas da operacao', () => {
  it('nao depende de SELECT cliente na tabela endurecida e valida o fundo ativo antes do service role', () => {
    const client = readFileSync(resolve('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx'), 'utf8')
    const action = readFileSync(resolve('src/lib/actions/operacao.ts'), 'utf8')

    expect(client).toContain('listarTestemunhasOperacao(opId)')
    expect(client).not.toMatch(/from\(['"]testemunhas['"]\)/)
    expect(action).toContain('await validarOperacaoNoFundoAtivo(supabase, operacaoId)')
    expect(action).toContain("createAdminClient()\n    .from('testemunhas')")
  })
})
