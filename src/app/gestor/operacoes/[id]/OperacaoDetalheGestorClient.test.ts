import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx', 'utf8')
const header = source.split('{/* Header */}')[1].split('{/* Modal reprovar */}')[0]

describe('cabecalho responsivo da operacao do Gestor', () => {
  it('permite encolher os containers e quebrar a linha dos metadados', () => {
    expect(header).toContain('flex min-w-0 items-start justify-between')
    expect(header).toContain('flex min-w-0 w-full items-start gap-3')
    expect(header).toContain('min-w-0 flex-1')
    expect(header).toContain('flex min-w-0 flex-wrap items-center gap-2')
    expect(header).toContain('<Link href={returnTo} className="shrink-0">')
  })

  it('preserva nome longo, titulo e aceite completos sem largura fixa ou truncamento', () => {
    expect(header).toContain('text-foreground wrap-anywhere')
    expect(header).toContain('min-w-0 max-w-full text-sm text-muted-foreground wrap-anywhere')
    expect(header).toContain('h-auto max-w-full whitespace-normal text-left wrap-anywhere')
    expect(header).not.toMatch(/truncate|line-clamp|overflow-hidden/)
    expect(header).toContain('op.cedentes.razao_social')
    expect(header).toContain('formatCNPJ(op.cedentes.cnpj)')
    expect(header).toContain('Aceite do sacado: dispensado pela política')
    expect(header).toContain("op.aceite_sacado_status || 'pendente'")
  })
})
