import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260805160000_metodos_calculo_financeiro_operacao.sql'),
  'utf8',
).toLowerCase()
const approvalCorrectionMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260805170000_corrigir_ambiguidade_valor_bruto_aprovacao.sql',
  ),
  'utf8',
).toLowerCase()
const approvalHardeningMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260805180000_endurecer_aprovacao_financeira.sql',
  ),
  'utf8',
).toLowerCase()

const action = readFileSync(join(process.cwd(), 'src/lib/actions/operacao.ts'), 'utf8')
const managerClient = readFileSync(
  join(process.cwd(), 'src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx'),
  'utf8',
)
const managerPage = readFileSync(
  join(process.cwd(), 'src/app/gestor/operacoes/[id]/page.tsx'),
  'utf8',
)

describe('contrato de persistencia do calculo financeiro', () => {
  it('e incremental, transacional e nao recalcula historico', () => {
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
    expect(migration).not.toMatch(/update\s+public\.operacoes\s+set\s+metodo_calculo_financeiro/)
    expect(migration).not.toMatch(/update\s+public\.notas_fiscais\s+set[\s\S]{0,120}where\s+.*created_at/)
  })

  it('preserva fallback legado e exige metodo somente em novas publicacoes', () => {
    expect(migration).toContain("'legado_mensal_dias_reais_30'")
    expect(migration).toContain("old.publicada_em is null")
    expect(migration).toContain('selecione o metodo de calculo financeiro antes de publicar')
    expect(migration).not.toMatch(/alter column metodo_calculo_financeiro set not null/)
  })

  it('preserva liquido nulo quando a solicitacao ainda nao possui taxa', () => {
    expect(migration).toContain('if new.taxa_desconto is null then')
    expect(migration).toContain('new.valor_liquido_desembolso := null')
  })

  it('grava memoria individual e protege leitura por fundo ou cedente', () => {
    expect(migration).toContain('create table if not exists public.operacao_calculo_nfs')
    expect(migration).toContain('unique (operacao_id, nota_fiscal_id)')
    expect(migration).toContain('private.usuario_tem_acesso_fundo(fundo_id)')
    expect(migration).toContain('cedente_id = (select public.get_user_cedente_id())')
    expect(migration).not.toContain('for insert to authenticated')
  })

  it('recalcula na RPC com data de Sao Paulo e sem valor liquido do cliente', () => {
    const chamadaAprovacao = action.match(/supabase\.rpc\('aprovar_operacao_atomica',[\s\S]*?\}\s+as never\)/)?.[0]
    expect(migration).toContain('public.aprovar_operacao_atomica(\n  p_operacao_id uuid,\n  p_taxa_desconto numeric')
    expect(migration).toContain("timezone('america/sao_paulo'")
    expect(migration).toContain('private.calcular_memoria_financeira_nf')
    expect(migration).toContain('for update of o')
    expect(migration).toContain('a operacao foi alterada concorrentemente')
    expect(chamadaAprovacao).toBeDefined()
    expect(chamadaAprovacao).not.toContain('p_valor_liquido_desembolso')
    expect(chamadaAprovacao).not.toContain('p_valor_liquido')
    expect(migration).toContain("set_config('app.calculo_aprovacao', 'true', true)")
    expect(migration).toContain('previa_valor_liquido_solicitacao')
    expect(migration).toContain('diferenca_previa_aprovacao')
  })

  it('remove a edicao livre do liquido e aceita apenas taxa configurada', () => {
    expect(managerClient).not.toContain('id="valorLiquido"')
    expect(managerClient).not.toContain('onChange={(e) => setValorLiquido')
    expect(action).toContain(".from('taxas_cedente')")
    expect(action).toContain('Selecione uma taxa configurada')
  })

  it('congela metodo e data-base e protege o resultado aprovado', () => {
    expect(migration).toContain('create or replace function public.proteger_resultado_financeiro_operacao()')
    expect(migration).toContain('metodo financeiro e data-base da operacao sao imutaveis')
    expect(migration).toContain('resultado financeiro aprovado e imutavel')
    expect(migration).toContain('before update on public.operacoes')
  })

  it('usa data civil do servidor nas simulacoes e nao duplica formula no cliente', () => {
    expect(managerPage).toContain('obterDataCivilOperacional()')
    expect(managerClient).toContain('dataBaseServidor')
    expect(managerClient).not.toContain("new Intl.DateTimeFormat('en-CA'")
    expect(managerClient).not.toContain('Math.pow(')
    expect(action).not.toContain('Math.pow(')
  })

  it('mantem memoria vinculada ao ciclo de vida da operacao', () => {
    expect(migration).toContain('operacao_id uuid not null references public.operacoes(id) on delete cascade')
    expect(migration).toContain('nota_fiscal_id uuid not null references public.notas_fiscais(id) on delete restrict')
  })

  it('usa a sintaxe nativa do PostgreSQL para extract', () => {
    expect(migration).not.toContain('pg_catalog.extract')
    expect(migration).toContain('extract(year from p_data)')
    expect(migration).toContain('extract(isodow from p_data)')
  })

  it('elimina a ambiguidade entre o acumulador e a coluna valor_bruto_total', () => {
    expect(approvalCorrectionMigration).toContain('v_valor_bruto_total numeric := 0')
    expect(approvalCorrectionMigration).toContain(
      'valor_bruto_total = round(v_valor_bruto_total, 2)',
    )
    expect(approvalCorrectionMigration).toContain(
      "'valor_bruto_total', round(v_valor_bruto_total, 2)",
    )
    expect(approvalCorrectionMigration).not.toMatch(
      /\n\s*valor_bruto_total\s+numeric\s*:=/,
    )
    expect(approvalCorrectionMigration).not.toContain('round(valor_bruto_total, 2)')
  })

  it('recusa segunda aprovacao e remove o indice redundante da memoria', () => {
    expect(approvalHardeningMigration).toContain(
      "if operacao_status = 'aprovada' then",
    )
    expect(approvalHardeningMigration).toContain(
      'a operacao ja foi aprovada e nao pode ser aprovada novamente',
    )
    expect(approvalHardeningMigration).toContain(
      'drop index if exists public.idx_operacao_calculo_nfs_operacao',
    )
    expect(approvalHardeningMigration).toContain('for update of o')
    expect(approvalHardeningMigration).toContain("set search_path = ''")
    expect(action).not.toContain('Operacao ja estava aprovada.')
  })

  it('bloqueia aprovacao direta da tabela fora da RPC atomica', () => {
    expect(approvalHardeningMigration).toContain(
      'create or replace function public.bloquear_aprovacao_financeira_direta()',
    )
    expect(approvalHardeningMigration).toContain(
      "current_setting('app.calculo_aprovacao', true)",
    )
    expect(approvalHardeningMigration).toContain(
      'before insert or update of status on public.operacoes',
    )
    expect(approvalHardeningMigration).toContain(
      'aprovacao financeira deve ocorrer pela rpc atomica',
    )
  })
})
