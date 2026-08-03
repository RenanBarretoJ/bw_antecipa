import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const loader = readFileSync(join(process.cwd(), 'src/lib/logistica/acompanhamento-operacao.server.ts'), 'utf8')
const serverPage = readFileSync(join(process.cwd(), 'src/app/gestor/operacoes/[id]/page.tsx'), 'utf8')
const panel = readFileSync(join(process.cwd(), 'src/components/operacoes/AcompanhamentoLogisticoOperacao.tsx'), 'utf8')

describe('arquitetura do acompanhamento logistico da operacao', () => {
  it('valida sessao de gestor, fundo ativo, vinculo e usuario_fundos no servidor', () => {
    expect(loader).toContain('requireGestor(supabase)')
    expect(loader).toContain('obterFundoAtivoAutorizado()')
    expect(loader).toContain(".from('cedente_fundos')")
    expect(loader).toContain(".from('usuario_fundos')")
    expect(loader).toContain(".eq('usuario_id', user.id)")
  })

  it('nao usa service role nem carrega arquivos, hashes, urls assinadas ou historicos', () => {
    expect(loader).not.toContain('createAdminClient')
    expect(loader).not.toContain('storage')
    expect(loader).not.toContain('sha256')
    expect(loader).not.toContain('documento_versoes')
    expect(loader).not.toContain('documento_analises')
  })

  it('faz consultas em lote e pagina apenas o contrato compacto no servidor', () => {
    expect(loader).toContain('const PAGE_SIZE = 10')
    expect(loader).toContain('const INITIAL_SIZE = 5')
    expect(loader).toContain('paginarAcompanhamentoLogistico(filtradas')
    expect(loader).not.toMatch(/for\s*\([^)]*nota[^)]*\)\s*\{[\s\S]*?\.from\(/)
  })

  it('compoe o painel como Server Component sem tornar a pagina inteira dependente do cliente', () => {
    expect(serverPage.trimStart()).not.toMatch(/^['"]use client['"]/)
    expect(serverPage).toContain('<AcompanhamentoLogisticoOperacao')
    expect(serverPage).toContain('acompanhamentoLogistico={(')
  })

  it('mantem busca, filtros, expansao, paginacao e acesso a NF no proprio card', () => {
    expect(panel).toContain('logisticaBusca')
    expect(panel).toContain('logisticaFiltro')
    expect(panel).toContain('Ver todas')
    expect(panel).toContain('Ver NF')
    expect(panel).toContain('Página anterior')
    expect(panel).toContain('Próxima página')
  })
})
