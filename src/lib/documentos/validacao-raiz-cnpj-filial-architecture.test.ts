import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260819190000_p0_validacao_raiz_cnpj_filial.sql', 'utf8')

describe('P0: validar raiz do CNPJ antes de cadastrar nova Filial', () => {
  it('cria um helper reutilizavel de raiz, normalizando sem assumir apenas digitos', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.raiz_cnpj(p_cnpj text)')
    expect(migration).toContain("regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')")
    expect(migration).toContain('upper(')
    expect(migration).toContain('FROM 1 FOR 8')
  })

  it('camada A (RPC cadastrar_filial_cedente) valida a raiz com a mensagem esperada', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(')
    expect(migration).toContain("RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.'")
  })

  it('unicidade global e checada antes da raiz (preserva a mensagem de conflito existente)', () => {
    const inicioRpc = migration.indexOf('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(')
    const corpoRpc = migration.slice(inicioRpc)
    const indiceUnicidade = corpoRpc.indexOf("RAISE EXCEPTION 'CNPJ ja cadastrado para outro Cedente'")
    const indiceRaiz = corpoRpc.indexOf('raiz_cnpj(v_cnpj) <> private.raiz_cnpj(v_matriz.cnpj)')
    expect(indiceUnicidade).toBeGreaterThan(-1)
    expect(indiceRaiz).toBeGreaterThan(-1)
    expect(indiceUnicidade).toBeLessThan(indiceRaiz)
  })

  it('camada B (trigger validar_cedente_estabelecimento) protege qualquer outro caminho de escrita', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.validar_cedente_estabelecimento()')
    const inicioTrigger = migration.indexOf('CREATE OR REPLACE FUNCTION private.validar_cedente_estabelecimento()')
    const fimTrigger = migration.indexOf('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(')
    const corpoTrigger = migration.slice(inicioTrigger, fimTrigger)
    expect(corpoTrigger).toContain("IF private.raiz_cnpj(NEW.cnpj) <> private.raiz_cnpj(v_matriz.cnpj) THEN")
    expect(corpoTrigger).toContain("RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.'")
  })

  it('nao remove nenhuma validacao existente (CNPJ valido, matriz aprovada, unicidade)', () => {
    expect(migration).toContain("IF NOT private.cnpj_valido(v_cnpj) THEN RAISE EXCEPTION 'CNPJ da filial e invalido'; END IF;")
    expect(migration).toContain("IF v_matriz.id IS NULL THEN RAISE EXCEPTION 'A Matriz precisa estar aprovada antes do cadastro de Filiais'; END IF;")
  })

  it('helper e revogado de PUBLIC (uso interno apenas via RPC/trigger SECURITY DEFINER)', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.raiz_cnpj(text) FROM PUBLIC')
  })
})
