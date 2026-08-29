import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { etapa3Schema } from '@/lib/validations/cedente'

const root = process.cwd()
const loader = fs.readFileSync(path.join(root, 'src/lib/remessas/loader.server.ts'), 'utf8')
const mapper = fs.readFileSync(path.join(root, 'src/lib/remessas/vrs/mapper.ts'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260826220731_p4_1_pagamento_vrs_estabelecimento.sql'),
  'utf8',
)

describe('P4.1 - fonte bancaria estruturada por estabelecimento', () => {
  it('loader abandona os campos bancarios legados do Cedente e carrega as contas dos emissores em lote', () => {
    expect(loader).toContain("admin.from('cedentes').select('id, cnpj, razao_social, coobrigacao')")
    expect(loader).not.toContain("select('id, cnpj, razao_social, coobrigacao, banco_codigo, agencia, conta')")
    expect(loader).toContain("admin.from('cedente_estabelecimento_contas_bancarias')")
    expect(loader).toContain(".in('estabelecimento_id', estabelecimentoIds)")
  })

  it('mapper bloqueia multiplas contas sem alterar o agrupamento POR_CEDENTE', () => {
    expect(mapper).toContain('REMESSA_VRS_MULTIPLAS_CONTAS_NAO_SUPORTADA')
    expect(mapper).toContain('nota.emissor.contasBancarias.filter')
    expect(mapper).not.toContain('cedente?.bancoCodigo')
  })

  it('cadastro exige COMPE, ISPB e nome estruturados', () => {
    expect(etapa3Schema.safeParse({
      banco: '001 - BCO DO BRASIL S.A.',
      agencia: '1234',
      conta: '100-7',
      tipo_conta: 'corrente',
      banco_codigo: '001',
      banco_ispb: '00000000',
      banco_nome: 'BCO DO BRASIL S.A.',
    }).success).toBe(true)

    expect(etapa3Schema.safeParse({
      banco: '001 - Banco do Brasil',
      agencia: '1234',
      conta: '100-7',
      tipo_conta: 'corrente',
    }).success).toBe(false)
  })

  it('migration faz backfill conservador e endurece novas gravacoes no banco', () => {
    expect(migration).toContain("~ '^[0-9]{3}[[:space:]]*-[[:space:]]*[^[:space:]].*$'")
    expect(migration).toContain('SET banco_codigo = coalesce')
    expect(migration).toContain('CREATE TRIGGER validar_conta_bancaria_estruturada')
    expect(migration).toContain('Dados bancarios divergem do catalogo vigente.')
    expect(migration).toContain('banco_codigo, banco_ispb, banco_nome')
  })
})
