import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260826110000_p0_cadastro_cnpj_cep_bancos_filiais.sql'),
  'utf8',
)
const cadastroPage = readFileSync(resolve(process.cwd(), 'src/app/cedente/cadastro/page.tsx'), 'utf8')
const meusEstabelecimentos = readFileSync(
  resolve(process.cwd(), 'src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx'),
  'utf8',
)
const estabelecimentoActions = readFileSync(resolve(process.cwd(), 'src/lib/actions/estabelecimento.ts'), 'utf8')

describe('migration P0 Cadastro Cedente: CNPJ, CEP, Bancos e Filiais', () => {
  it('cria catalogo canonico de bancos com RLS restrita e seed local (sem depender de rede)', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.bancos')
    expect(migration).toContain('CONSTRAINT bancos_codigo_key UNIQUE (codigo)')
    expect(migration).toContain('ALTER TABLE public.bancos ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT ON TABLE public.bancos TO authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE public.bancos FROM PUBLIC, anon')
    expect(migration).toContain("('260', 'Nu Pagamentos (Nubank)', 'seed')")
    expect(migration).toContain('ON CONFLICT (codigo) DO NOTHING')
  })

  it('expande cedente_estabelecimentos com os dados cadastrais completos da Filial (aditivo, idempotente)', () => {
    for (const coluna of [
      'cnae_principal', 'situacao_cadastral', 'cep', 'logradouro', 'numero', 'complemento',
      'bairro', 'cidade', 'uf', 'email', 'telefone', 'dados_consultados_em', 'dados_consultados_fonte',
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`)
    }
  })

  it('adiciona colunas estruturadas de banco de forma aditiva, preservando a coluna texto legada', () => {
    expect(migration).toContain('ALTER TABLE public.cedentes\n  ADD COLUMN IF NOT EXISTS banco_codigo text')
    expect(migration).toContain('ALTER TABLE public.cedente_estabelecimento_contas_bancarias\n  ADD COLUMN IF NOT EXISTS banco_codigo text')
    expect(migration).not.toMatch(/DROP COLUMN.*banco\b/)
  })

  it('cadastrar_filial_cedente persiste os dados cadastrais completos e mantem as regras de gate existentes', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente('))
    expect(corpo).toContain('p_dados_consultados_fonte text DEFAULT NULL')
    expect(corpo).toContain("RAISE EXCEPTION 'O cadastro de novas Filiais nao esta habilitado para este Cedente.'")
    expect(corpo).toContain('private.raiz_cnpj(v_cnpj) <> private.raiz_cnpj(v_matriz.cnpj)')
    expect(corpo).toContain('cnae_principal, situacao_cadastral, cep, logradouro, numero, complemento, bairro, cidade, uf,')
    expect(corpo).toContain("CASE WHEN nullif(trim(coalesce(p_dados_consultados_fonte, '')), '') IS NOT NULL THEN now() ELSE NULL END")
  })

  it('salvar_conta_estabelecimento_cedente aceita banco estruturado e continua gravando a coluna texto legada', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.salvar_conta_estabelecimento_cedente('))
    expect(corpo).toContain('p_banco_codigo text DEFAULT NULL')
    expect(corpo).toContain('p_banco_ispb text DEFAULT NULL')
    expect(corpo).toContain('p_banco_nome text DEFAULT NULL')
    expect(corpo).toContain('estabelecimento_id, banco, agencia, conta, tipo_conta, principal, criado_por,\n    banco_codigo, banco_ispb, banco_nome')
  })

  it('concluir_onboarding_cedente aceita banco estruturado no allowlist e no INSERT da Matriz', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente('))
    expect(corpo).toContain("'banco_codigo', 'banco_ispb', 'banco_nome'")
    expect(corpo).toContain('banco_codigo, banco_ispb, banco_nome\n  )')
  })

  it('sincronizar_bancos_super_admin e restrita a super_admin e faz upsert idempotente por codigo', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.sincronizar_bancos_super_admin('))
    expect(corpo).toContain("v_papel IS DISTINCT FROM 'super_admin'")
    expect(corpo).toContain('ON CONFLICT (codigo) DO UPDATE SET')
  })
})

describe('UI: Matriz e Filial nao aceitam mais banco em texto livre', () => {
  it('cadastro/alteracao da Matriz usa o combobox pesquisavel, sem <select> de bancosBrasileiros', () => {
    expect(cadastroPage).toContain('BancoCombobox')
    expect(cadastroPage).not.toContain('bancosBrasileiros')
  })

  it('conta bancaria da Filial usa o mesmo combobox pesquisavel, sem input de texto livre para banco', () => {
    expect(meusEstabelecimentos).toContain('BancoCombobox')
    expect(meusEstabelecimentos).not.toContain('<Input name="banco"')
  })

  it('cadastrarFilial e salvarContaEstabelecimento repassam os novos campos estruturados para as RPCs', () => {
    expect(estabelecimentoActions).toContain('p_cnae_principal')
    expect(estabelecimentoActions).toContain('p_banco_codigo')
    expect(estabelecimentoActions).toContain('p_banco_ispb')
  })
})
