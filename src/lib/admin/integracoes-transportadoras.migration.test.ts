import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824180000_p1_super_admin_integracao_transportadora.sql'),
  'utf8',
)

const NOVOS_ACOES_SENSIVEIS = [
  'criar_integracao_transportadora',
  'ativar_integracao_transportadora',
  'desativar_integracao_transportadora',
  'rotacionar_token_integracao_transportadora',
  'revogar_token_integracao_transportadora',
  'reprocessar_webhook_evento_transportadora',
]

describe('contrato da migration P1 (Super Admin -- integracao de transportadora)', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('cria o historico de token com uma linha ativa por integracao (indice unico parcial) e hash unico', () => {
    const tabela = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.integracoes_transportadoras_tokens'),
      migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_transportadoras_tokens_ativo') + 200,
    )
    expect(tabela).toContain("CHECK (status IN ('ativo', 'substituido', 'revogado'))")
    expect(tabela).toContain('CONSTRAINT integracoes_transportadoras_tokens_hash_unique UNIQUE (token_hash)')
    expect(tabela).toContain('ON public.integracoes_transportadoras_tokens (integracao_id) WHERE status = \'ativo\'')
  })

  it('token_hash e SHA-256 one-way -- nunca criptografia reversivel (diferente de credenciais_integracao)', () => {
    expect(migration).toContain('nunca criptografado/reversivel')
    expect(migration).not.toMatch(/token.*criptografad/i)
  })

  it('gestor nunca ve o historico de token -- nenhuma policy de SELECT para authenticated', () => {
    const secao = migration.slice(
      migration.indexOf('ALTER TABLE public.integracoes_transportadoras_tokens ENABLE ROW LEVEL SECURITY'),
      migration.indexOf('-- Migra qualquer token_hash existente'),
    )
    expect(secao).toContain('REVOKE ALL ON public.integracoes_transportadoras_tokens FROM PUBLIC, anon, authenticated;')
    expect(secao).not.toContain('CREATE POLICY')
    expect(secao).toContain('GRANT SELECT ON public.integracoes_transportadoras_tokens TO service_role;')
  })

  it('migra token_hash existente para o historico ANTES de remover a coluna antiga (nunca perde dados)', () => {
    const posBackfill = migration.indexOf('INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, status, criado_por, criado_em)')
    const posDropColumn = migration.indexOf('DROP COLUMN IF EXISTS token_hash')
    expect(posBackfill).toBeGreaterThan(-1)
    expect(posDropColumn).toBeGreaterThan(posBackfill)
  })

  it('admin_criar_integracao_transportadora nao insere mais token_hash na tabela de integracoes -- so no historico', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_ativar_integracao_transportadora'),
    )
    expect(funcao).toContain('INSERT INTO public.integracoes_transportadoras (fundo_id, provider, nome, cnpj_transportadora, created_by)')
    expect(funcao).toContain('INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, token_display, status, criado_por)')
    expect(funcao).toContain("jsonb_build_object('integracao_id', v_id, 'token', v_token, 'token_display', v_display)")
  })

  it('admin_rotacionar_token_integracao_transportadora libera o slot ativo ANTES de inserir o novo token (nunca dois tokens ativos ao mesmo tempo)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_revogar_token_integracao_transportadora'),
    )
    const posSubstituido = funcao.indexOf("SET status = 'substituido'")
    const posInsert = funcao.indexOf('INSERT INTO public.integracoes_transportadoras_tokens')
    expect(posSubstituido).toBeGreaterThan(-1)
    expect(posInsert).toBeGreaterThan(posSubstituido)
    expect(funcao).toContain('UPDATE public.integracoes_transportadoras_tokens SET substituido_por = v_new_id WHERE id = v_old_id;')
  })

  it('admin_revogar_token_integracao_transportadora falha se nao ha token ativo (fail-closed, nunca revoga silenciosamente nada)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_revogar_token_integracao_transportadora'),
      migration.indexOf('-- 4. Listagem/observabilidade'),
    )
    expect(funcao).toContain("WHERE integracao_id = p_integracao_id AND status = 'ativo'")
    expect(funcao).toContain('RAISE EXCEPTION \'Nao ha token ativo para revogar nesta integracao\'')
  })

  it('todas as novas RPCs de admin sao gated por private.usuario_e_super_admin()', () => {
    for (const fn of [
      'admin_ativar_integracao_transportadora', 'admin_rotacionar_token_integracao_transportadora',
      'admin_revogar_token_integracao_transportadora', 'admin_listar_integracoes_transportadoras',
      'admin_listar_webhook_eventos_transportadora', 'admin_obter_webhook_evento_transportadora',
    ]) {
      const inicio = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
      expect(inicio, `funcao ${fn} nao encontrada`).toBeGreaterThan(-1)
      const corpo = migration.slice(inicio, inicio + 800)
      expect(corpo, `${fn} sem gate de super admin`).toContain('usuario_e_super_admin()')
    }
  })

  it('admin_obter_webhook_evento_transportadora nunca inclui Base64 ou token na resposta', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora'),
      migration.indexOf('-- 5. Novo status para reprocessamento'),
    )
    expect(funcao.toLowerCase()).not.toMatch(/imagem_base64|payload_base64/)
    expect(funcao.toLowerCase()).not.toMatch(/token_hash|'token'|token_display/)
  })

  it('adiciona EVIDENCIA_INDISPONIVEL ao status check do inbox (idempotente)', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS integracao_logistica_webhook_eventos_status_check')
    expect(migration).toContain('EVIDENCIA_INDISPONIVEL')
  })

  it('registra as 6 novas acoes sensiveis tanto no CHECK quanto no IN-list de criar_autorizacao_acao_sensivel (dois espelhos sincronizados)', () => {
    const posCheck = migration.indexOf('ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK')
    const posFuncao = migration.indexOf('CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel')
    const trechoCheck = migration.slice(posCheck, posFuncao)
    const trechoFuncao = migration.slice(posFuncao)
    for (const acao of NOVOS_ACOES_SENSIVEIS) {
      expect(trechoCheck, `${acao} ausente do CHECK`).toContain(`'${acao}'`)
      expect(trechoFuncao, `${acao} ausente do IN-list da funcao`).toContain(`'${acao}'`)
    }
  })

  it('preserva todas as acoes sensiveis pre-existentes (nunca remove uma acao ja em uso por SA1-3/P2)', () => {
    const acoesPreExistentes = [
      'alterar_senha', 'cadastrar_credencial_integracao', 'criar_fundo', 'conceder_super_admin',
      'publicar_base_financeira', 'revisar_risco_operacao',
    ]
    for (const acao of acoesPreExistentes) {
      expect(migration).toContain(`'${acao}'`)
    }
  })

  it('depende explicitamente de private.usuario_e_super_admin e do schema do P0 (guard defensivo no topo)', () => {
    expect(migration).toContain("to_regprocedure('private.usuario_e_super_admin()')")
    expect(migration).toContain("to_regclass('public.integracoes_transportadoras')")
  })

  it('retencao de evidencia (P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora): novas colunas de arquivo no proprio evento', () => {
    const secao = migration.slice(
      migration.indexOf('-- 5. Retencao de evidencia no proprio evento'),
      migration.indexOf('-- 6. Fresh TOTP'),
    )
    expect(secao).toContain('ADD COLUMN IF NOT EXISTS bucket text')
    expect(secao).toContain('ADD COLUMN IF NOT EXISTS path text')
    expect(secao).toContain('ADD COLUMN IF NOT EXISTS tamanho_bytes bigint')
    expect(secao).toContain('ADD COLUMN IF NOT EXISTS persisted_at timestamptz')
  })

  it('admin_obter_webhook_evento_transportadora calcula evidencia_retida a partir de bucket/path (nao mais so persisted_at), nunca expoe bucket/path crus como campos JSON', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora'),
      migration.indexOf('-- 5. Retencao de evidencia no proprio evento'),
    )
    expect(funcao).toContain("'evidencia_retida', (v_evento.bucket IS NOT NULL AND v_evento.path IS NOT NULL)")
    expect(funcao).not.toMatch(/'bucket'|'path'/)
  })

  it('admin_listar_webhook_eventos_transportadora tambem calcula evidencia_retida a partir de bucket/path por linha', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_listar_webhook_eventos_transportadora'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora'),
    )
    expect(funcao).toContain("'evidencia_retida', (e.bucket IS NOT NULL AND e.path IS NOT NULL)")
  })

  it('P0_Claude_Fechar_Retry_Webhook_Transportadora: evidencia_retida nunca fica presa em true apos o arquivo ser removido (persisted_at por si so nao basta)', () => {
    expect(migration).not.toMatch(/'evidencia_retida',\s*\w+\.persisted_at IS NOT NULL/)
  })
})
