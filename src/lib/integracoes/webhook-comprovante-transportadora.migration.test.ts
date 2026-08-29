import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824100000_p0_webhook_comprovante_transportadora.sql'),
  'utf8',
)

describe('contrato da migration do webhook de comprovante de transportadora', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('integracoes_transportadoras guarda so o hash do token, nunca o valor original, e e unico', () => {
    const tabela = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.integracoes_transportadoras'), migration.indexOf('CREATE INDEX IF NOT EXISTS idx_integracoes_transportadoras_fundo_provider'))
    expect(tabela).toContain('token_hash text NOT NULL')
    expect(tabela).not.toMatch(/token\s+text/)
    expect(tabela).toContain('CONSTRAINT integracoes_transportadoras_token_hash_unique UNIQUE (token_hash)')
    expect(tabela).toContain("created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT")
  })

  it('RLS de integracoes_transportadoras: policy idempotente e apenas SELECT para authenticated (sem escrita fora de RPC)', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS integracoes_transportadoras_gestor_select ON public.integracoes_transportadoras;')
    expect(migration).toContain('CREATE POLICY integracoes_transportadoras_gestor_select ON public.integracoes_transportadoras')
    expect(migration).toContain('REVOKE ALL ON public.integracoes_transportadoras FROM PUBLIC, anon;')
    expect(migration).toContain('GRANT SELECT ON public.integracoes_transportadoras TO authenticated;')
  })

  it('admin_criar_integracao_transportadora exige gestor com acesso ao fundo e devolve o token em texto puro apenas nesta chamada', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.admin_criar_integracao_transportadora'),
    )
    expect(funcao).toContain("get_user_role() <> 'gestor'")
    expect(funcao).toContain('private.usuario_tem_acesso_fundo(p_fundo_id)')
    expect(funcao).toContain("digest(v_token, 'sha256')")
    expect(funcao).toContain("jsonb_build_object('integracao_id', v_id, 'token', v_token)")
  })

  it('inbox de webhook modela pelo menos os status exigidos pelo ticket e garante idempotencia dupla (idempotency_key + integracao+external_event_id)', () => {
    const tabela = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.integracao_logistica_webhook_eventos'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_integracao_logistica_webhook_eventos_chave_nfe'),
    )
    for (const status of [
      'RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'DUPLICADO', 'NAO_IDENTIFICADO',
      'REVISAO_MATCH', 'IGNORADO_CANHOTO_JA_APROVADO', 'ERRO_REPROCESSAVEL', 'ERRO_FINAL',
    ]) {
      expect(tabela).toContain(status)
    }
    expect(tabela).toContain('CONSTRAINT integracao_logistica_webhook_eventos_idempotency_unique UNIQUE (idempotency_key)')
    expect(tabela).toContain('CONSTRAINT integracao_logistica_webhook_eventos_external_unique UNIQUE (integracao_id, external_event_id)')
  })

  it('inbox: leitura restrita a gestor do fundo, escrita restrita a service_role (rota do webhook nunca usa sessao de usuario)', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS integracao_logistica_webhook_eventos_gestor_select ON public.integracao_logistica_webhook_eventos;')
    expect(migration).toContain('REVOKE ALL ON public.integracao_logistica_webhook_eventos FROM PUBLIC, anon;')
    expect(migration).toContain('GRANT SELECT ON public.integracao_logistica_webhook_eventos TO authenticated;')
    expect(migration).toContain('GRANT INSERT, UPDATE ON public.integracao_logistica_webhook_eventos TO service_role;')
  })

  it('registrar_comprovante_entrega_webhook e exclusiva de service_role -- nunca authenticated/anon (nunca chamavel com sessao de usuario)', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook(uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text)\n  FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.registrar_comprovante_entrega_webhook(uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text)\n  TO service_role;',
    )
  })

  it('registrar_comprovante_entrega_webhook revalida cross-fund deny dentro da propria RPC (defesa em profundidade, nao confia so na TypeScript)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).toContain('v_venda.fundo_id IS DISTINCT FROM v_integracao.fundo_id')
    expect(funcao).toContain('cross-fund deny')
  })

  it('nunca bloqueia por status_entrega -- so bloqueia por canhoto ja aprovado ou falta de entrega', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).not.toMatch(/status_entrega\s*(NOT\s+)?IN\s*\(/i)
    expect(funcao).toContain("RETURN jsonb_build_object('status', 'AGUARDANDO_ENTREGA', 'canhoto_id', NULL, 'requisito_id', NULL);")
    expect(funcao).toContain("RETURN jsonb_build_object('status', 'IGNORADO_CANHOTO_JA_APROVADO'")
  })

  it('insere o canhoto sempre em em_analise, nunca aprovado, e carrega nota_fiscal_remessa_id quando VIA_REMESSA', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).toContain("v_entrega.id, 'em_analise', now(), v_doc_id, v_version_id, p_nota_fiscal_remessa_id")
    expect(funcao).not.toMatch(/INSERT INTO public\.canhotos[\s\S]*?'aprovado'/)
  })

  it('usa FOR UPDATE ao carregar a venda e a entrega, evitando corrida entre webhooks concorrentes', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).toContain('WHERE id = p_nota_fiscal_venda_id FOR UPDATE')
    expect(funcao).toContain('LIMIT 1\n  FOR UPDATE')
  })

  it('criado_por/enviado_por usam integracoes_transportadoras.created_by, nunca NULL nem um profile sintetico novo', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).toContain("VALUES (v_tipo.id, 'enviado', v_integracao.created_by)")
    expect(funcao).toContain('v_integracao.created_by\n  ) RETURNING id INTO v_version_id;')
  })

  it('registra o evento de entrega com ator_tipo integracao e a origem tecnica no jsonb de dados', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook'),
    )
    expect(funcao).toContain("'canhoto_enviado', v_entrega.status_entrega, v_entrega.status_entrega, 'integracao'")
    expect(funcao).toContain("'origem', 'INTEGRACAO_TRANSPORTADORA', 'provider', p_provider, 'webhook_evento_id', p_webhook_evento_id")
  })
})
