import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260818200641_multi_cnpj_cedente_estabelecimentos.sql'), 'utf8')

describe('migration Multi-CNPJ do Cedente', () => {
  it('mantem CNPJ globalmente unico e exatamente uma matriz por Cedente', () => {
    expect(migration).toContain('cedente_estabelecimentos_cnpj_unique')
    expect(migration).toContain("ON public.cedente_estabelecimentos(cedente_id) WHERE tipo = 'matriz'")
    expect(migration).toContain("v_matriz.cedente_id <> NEW.cedente_id")
  })

  it('deriva a NF pelo CNPJ emitente e aplica o gate completo antes da origem', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.vincular_estabelecimento_nota_fiscal()')
    expect(migration).toContain('NEW.estabelecimento_id := v_estabelecimento.id')
    expect(migration).toContain('private.estabelecimento_pode_originar')
    expect(migration).toContain("matriz.status = 'aprovado' AND matriz.ativo")
    expect(migration).toContain("cf.status = 'ativo'")
  })

  it('nao cria decisao acidental sobre mistura de CNPJs na operacao', () => {
    expect(migration).toContain('FUTURE_DECISION_RULE_1')
    expect(migration).toContain('nao validar composicao entre estabelecimentos aqui')
    expect(migration).not.toMatch(/count\s*\(\s*distinct\s+.*estabelecimento/i)
  })

  it('nega anon, evita escrita direta e oferece mutacoes controladas', () => {
    expect(migration).toContain('REVOKE ALL ON public.cedente_estabelecimentos FROM PUBLIC, anon')
    expect(migration).toContain('GRANT SELECT ON public.cedente_estabelecimentos TO authenticated')
    expect(migration).not.toContain('GRANT INSERT ON public.cedente_estabelecimentos TO authenticated')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.decidir_estabelecimento_gestor')
  })

  it('preserva a compatibilidade criando e sincronizando a matriz legada', () => {
    expect(migration).toContain('Backfill idempotente da Matriz')
    expect(migration).toContain('CREATE TRIGGER cedentes_criar_matriz')
    expect(migration).toContain('CREATE TRIGGER cedentes_sincronizar_status_matriz')
    expect(migration).toContain('CREATE TRIGGER cedentes_sincronizar_cadastro_matriz')
  })
})
