import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260823130000_p0_nf_remessa_aprovacao_documental.sql'),
  'utf8',
)

describe('contrato da migration: separacao matching tecnico / aprovacao documental do requisito nf_remessa', () => {
  it('e incremental e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('toda ADD CONSTRAINT/CREATE TRIGGER e precedida do DROP ... IF EXISTS correspondente (idempotencia)', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS nota_fiscal_remessas_aprovacao_documental_check')
    expect(migration).toContain('ADD CONSTRAINT nota_fiscal_remessas_aprovacao_documental_check')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS nota_fiscal_remessas_aprovacao_motivo_rejeicao_check')
    expect(migration).toContain('ADD CONSTRAINT nota_fiscal_remessas_aprovacao_motivo_rejeicao_check')
    expect(migration).toContain('DROP TRIGGER IF EXISTS nota_fiscal_remessas_reconciliar_requisito')
    expect(migration).toContain('CREATE TRIGGER nota_fiscal_remessas_reconciliar_requisito')

    const posDropConstraintDocumental = migration.indexOf('DROP CONSTRAINT IF EXISTS nota_fiscal_remessas_aprovacao_documental_check')
    const posAddConstraintDocumental = migration.indexOf('ADD CONSTRAINT nota_fiscal_remessas_aprovacao_documental_check')
    expect(posDropConstraintDocumental).toBeGreaterThan(-1)
    expect(posDropConstraintDocumental).toBeLessThan(posAddConstraintDocumental)

    const posDropTrigger = migration.indexOf('DROP TRIGGER IF EXISTS nota_fiscal_remessas_reconciliar_requisito')
    const posCreateTrigger = migration.indexOf('CREATE TRIGGER nota_fiscal_remessas_reconciliar_requisito')
    expect(posDropTrigger).toBeLessThan(posCreateTrigger)
  })

  it('novas colunas aditivas (ADD COLUMN IF NOT EXISTS) -- nunca DROP/RENAME de coluna existente', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS aprovacao_documental text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS aprovacao_analisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS aprovacao_analisado_em timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS aprovacao_motivo_rejeicao text')
    expect(migration).not.toContain('DROP COLUMN')
    expect(migration).not.toContain('RENAME COLUMN')
  })

  it('CHECK restringe aprovacao_documental a NULL/aguardando_analise/aprovado/rejeitado', () => {
    const trecho = migration.slice(
      migration.indexOf('ADD CONSTRAINT nota_fiscal_remessas_aprovacao_documental_check'),
      migration.indexOf('ADD CONSTRAINT nota_fiscal_remessas_aprovacao_motivo_rejeicao_check') - 1,
    )
    expect(trecho).toContain("IN ('aguardando_analise', 'aprovado', 'rejeitado')")
    expect(trecho).toContain('aprovacao_documental IS NULL')
  })

  it('motivo de rejeicao documental obrigatorio quando rejeitado (mesmo padrao de ctes/canhotos)', () => {
    expect(migration).toContain("CHECK (aprovacao_documental <> 'rejeitado' OR length(trim(coalesce(aprovacao_motivo_rejeicao, ''))) > 0)")
  })

  it('registrar_nota_fiscal_remessa resolve o nivel_validacao a partir do snapshot instanciado (nao da politica viva)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa'),
      migration.indexOf('-- 3. reconciliar_requisito_nf_remessa'),
    )
    expect(funcao).toContain('FROM public.documento_requisito_instancias dri')
    expect(funcao).toContain("dri.tipo_documento_codigo_snapshot = 'nf_remessa'")
    expect(funcao).toContain('ORDER BY dri.created_at DESC')
    expect(funcao).toContain('LIMIT 1')
  })

  it('registrar_nota_fiscal_remessa so marca aguardando_analise quando o matching e VALIDADA e o nivel e manual/hibrido; sem requisito, fica NULL (automatico, sem regressao)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa'),
      migration.indexOf('-- 3. reconciliar_requisito_nf_remessa'),
    )
    expect(funcao).toMatch(/WHEN p_status_validacao <> 'VALIDADA' THEN NULL/)
    expect(funcao).toMatch(/WHEN v_nivel_validacao IN \('manual', 'hibrido'\) THEN 'aguardando_analise'/)
    expect(funcao).toMatch(/ELSE NULL\s*END/)
  })

  it('reconciliar_requisito_nf_remessa agora tambem exige aprovacao_documental resolvida (nula ou aprovado) alem do matching VALIDADA', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa'),
      migration.indexOf('$function$;'),
    )
    expect(funcao).toContain("r.status_validacao = 'VALIDADA'")
    expect(funcao).toContain("r.aprovacao_documental IS NULL OR r.aprovacao_documental = 'aprovado'")
  })

  it('trigger de reconciliacao passa a disparar tambem em UPDATE de aprovacao_documental, alem de status_validacao', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE OF status_validacao, aprovacao_documental ON public.nota_fiscal_remessas')
  })

  it('analisar_nota_fiscal_remessa e gestor-only, exige motivo ao rejeitar e e fail-closed (so decide remessas aguardando_analise)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.analisar_nota_fiscal_remessa'),
      migration.lastIndexOf('$$;'),
    )
    expect(funcao).toContain("get_user_role() <> 'gestor'")
    expect(funcao).toContain("IF p_resultado NOT IN ('aprovado', 'rejeitado')")
    expect(funcao).toContain("p_resultado = 'rejeitado' AND length(trim(coalesce(p_motivo, ''))) = 0")
    expect(funcao).toContain("remessa_row.aprovacao_documental IS DISTINCT FROM 'aguardando_analise'")
    expect(funcao).toContain('FOR UPDATE')
  })

  it('analisar_nota_fiscal_remessa nunca decide por matching -- so atualiza as colunas de aprovacao_documental', () => {
    const funcao = migration.slice(
      migration.indexOf('UPDATE public.nota_fiscal_remessas\n  SET aprovacao_documental'),
      migration.indexOf('WHERE id = p_nota_fiscal_remessa_id;'),
    )
    expect(funcao).not.toContain('status_validacao =')
    expect(funcao).toContain('aprovacao_analisado_por = auth.uid()')
    expect(funcao).toContain('aprovacao_analisado_em = now()')
  })

  it('grants do novo RPC seguem o mesmo padrao do RPC irmao registrar_nota_fiscal_remessa (authenticated apenas, sem PUBLIC/anon)', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.analisar_nota_fiscal_remessa(uuid, text, text) FROM PUBLIC, anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.analisar_nota_fiscal_remessa(uuid, text, text) TO authenticated')
  })

  it('so altera as 3 funcoes esperadas (registrar_nota_fiscal_remessa, reconciliar_requisito_nf_remessa, analisar_nota_fiscal_remessa) -- nenhuma funcao de matching e recriada', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.avaliar_matching')
    expect(migration.match(/CREATE OR REPLACE FUNCTION/g) || []).toHaveLength(3)
  })
})
