import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824150000_p0_fechar_webhook_transportadora_gaps.sql'),
  'utf8',
)

describe('contrato da migration corretiva do webhook de comprovante de transportadora', () => {
  it('e transacional e nao edita a migration original ja aplicada', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
    expect(migration).toContain('migration CORRETIVA')
  })

  it('gap 2: provisionamento agora exige Super Admin (private.usuario_e_super_admin), nao mais gestor', () => {
    const criar = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_transportadora'),
    )
    expect(criar).toContain('private.usuario_e_super_admin()')
    expect(criar).not.toContain("get_user_role() <> 'gestor'")
    expect(criar).not.toContain('usuario_tem_acesso_fundo')

    const desativar = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_transportadora'),
      migration.indexOf('-- 2. Evidencia pendente'),
    )
    expect(desativar).toContain('private.usuario_e_super_admin()')
    expect(desativar).not.toContain("get_user_role() <> 'gestor'")
    expect(desativar).not.toContain('usuario_tem_acesso_fundo')
  })

  it('gap 1: nova tabela de evidencia pendente carrega remessa/vinculo/origem do webhook', () => {
    const tabela = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.webhook_comprovantes_entrega_pendentes'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_webhook_comprovantes_pendentes_nf_status'),
    )
    expect(tabela).toContain('webhook_evento_id uuid NOT NULL REFERENCES public.integracao_logistica_webhook_eventos(id)')
    expect(tabela).toContain('nota_fiscal_remessa_id uuid REFERENCES public.nota_fiscal_remessas(id) ON DELETE SET NULL')
    expect(tabela).toContain("CHECK (tipo_vinculo IN ('DIRETO_VENDA', 'VIA_REMESSA'))")
    expect(tabela).toContain('provider text NOT NULL')
    expect(tabela).toContain('documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id)')
    expect(tabela).toContain('documento_versao_id uuid NOT NULL REFERENCES public.documento_versoes(id)')
  })

  it('gap 1: evidencia pendente e RLS-restrita a gestor do fundo, escrita so via service_role', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS webhook_comprovantes_pendentes_gestor_select ON public.webhook_comprovantes_entrega_pendentes;')
    expect(migration).toContain('REVOKE ALL ON public.webhook_comprovantes_entrega_pendentes FROM PUBLIC, anon;')
    expect(migration).toContain('GRANT INSERT, UPDATE ON public.webhook_comprovantes_entrega_pendentes TO service_role;')
  })

  it('gap 1: registrar_comprovante_entrega_webhook sempre persiste o arquivo (mesmo sem entrega) antes de decidir', () => {
    const funcao = migration.slice(
      migration.indexOf('-- 4. registrar_comprovante_entrega_webhook'),
      migration.indexOf('-- 5. Reconciliacao automatica'),
    )
    expect(funcao).toContain('INSERT INTO public.documentos_repositorio')
    expect(funcao).toContain('INSERT INTO public.documento_versoes')
    expect(funcao.indexOf('INSERT INTO public.documentos_repositorio')).toBeLessThan(funcao.indexOf("IF v_entrega.id IS NULL THEN"))
    expect(funcao).toContain('INSERT INTO public.webhook_comprovantes_entrega_pendentes')
    expect(funcao).toContain("RETURN jsonb_build_object('status', 'AGUARDANDO_ENTREGA'")
  })

  it('gap 1: canhoto ja aprovado continua descartado ANTES de persistir qualquer documento (sem entrega, essa checagem nao existe)', () => {
    const funcao = migration.slice(
      migration.indexOf('-- 4. registrar_comprovante_entrega_webhook'),
      migration.indexOf('-- 5. Reconciliacao automatica'),
    )
    const posAprovadoCheck = funcao.indexOf("status = 'aprovado' LIMIT 1")
    const posDocInsert = funcao.indexOf('INSERT INTO public.documentos_repositorio')
    expect(posAprovadoCheck).toBeGreaterThan(-1)
    expect(posDocInsert).toBeGreaterThan(-1)
    expect(posAprovadoCheck).toBeLessThan(posDocInsert)
  })

  it('gap 1: logica de vinculo foi extraida para private.vincular_comprovante_webhook_entrega e reutilizada pela reconciliacao', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.vincular_comprovante_webhook_entrega')
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.vincular_comprovante_webhook_entrega(uuid, uuid, uuid, uuid, uuid, text, uuid)\n  FROM PUBLIC, anon, authenticated, service_role;',
    )
    const reconciliador = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_comprovantes_pendentes_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION private.reconciliar_comprovantes_pendentes_webhook'),
    )
    expect(reconciliador).toContain('private.vincular_comprovante_webhook_entrega(')
  })

  it('gap 1: reconciliacao nunca aborta o desembolso -- captura erro por evidencia e segue para a proxima', () => {
    const reconciliador = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_comprovantes_pendentes_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION private.reconciliar_comprovantes_pendentes_webhook'),
    )
    expect(reconciliador).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(reconciliador).toContain("status = 'ERRO_RECONCILIACAO'")
    expect(reconciliador).toContain('FOR UPDATE')
  })

  it('gap 1: desembolsar_operacao_com_logistica chama a reconciliacao automatica para cada NF, apos os requisitos pos-cessao', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.desembolsar_operacao_com_logistica'),
    )
    expect(funcao).toContain('PERFORM private.reconciliar_comprovantes_pendentes_webhook(nf.id, entrega_id);')
    const posRequisitosLoop = funcao.indexOf("FOR req IN")
    const posReconciliacao = funcao.indexOf('PERFORM private.reconciliar_comprovantes_pendentes_webhook')
    expect(posRequisitosLoop).toBeGreaterThan(-1)
    expect(posReconciliacao).toBeGreaterThan(posRequisitosLoop)
  })

  it('desembolsar_operacao_com_logistica preserva integralmente a autorizacao e a logica financeira original (nenhum impacto financeiro)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.desembolsar_operacao_com_logistica'),
    )
    expect(funcao).toContain("get_user_role() <> 'gestor'")
    expect(funcao).toContain('novo_saldo := escrow_saldo + op.valor_liquido_desembolso;')
    expect(funcao).toContain("UPDATE public.contas_escrow SET saldo_disponivel = novo_saldo WHERE id = op.conta_escrow_id;")
    expect(funcao).toContain('INSERT INTO public.movimentos_escrow')
  })
})
