import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const loader = readFileSync('src/lib/logistica/central/central-logistica.server.ts', 'utf8')
const route = readFileSync('src/app/gestor/logistica/exportar/route.ts', 'utf8')

describe('arquitetura da central logistica', () => {
  it('valida gestor e fundo ativo autorizado sem service role', () => {
    expect(loader).toContain('requireGestor(supabase)')
    expect(loader).toContain('resolverContextoFundoGestor(auth)')
    expect(loader).not.toContain('createAdminClient')
    expect(loader).not.toContain('service_role')
  })

  it('executa consultas em lotes e nao cria N+1 por linha projetada', () => {
    expect(loader).toContain('consultarPorIds')
    expect(loader).toContain('coletarPaginas')
    expect(loader).not.toMatch(/\.map\s*\(\s*async/)
  })

  it('nao carrega signed URLs, hashes ou payload documental para a listagem', () => {
    expect(loader).not.toContain('createSignedUrl')
    expect(loader).not.toContain('sha256')
    expect(loader).not.toContain('politica_snapshot_hash')
    expect(loader).not.toContain('dados_estruturados')
  })

  it('exporta CSV autenticado pela mesma projecao e sem IDs internos como colunas', () => {
    expect(route).toContain('carregarCentralLogistica')
    expect(route).toContain("tab: 'notas'")
    expect(route).not.toContain("'notaFiscalId'")
    expect(route).not.toContain("'cteId'")
  })
})
