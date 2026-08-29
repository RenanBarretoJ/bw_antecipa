import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260825100000_p0_vortx_vrs2_auth_mtls.sql'),
  'utf8',
)

describe('contrato da migration P0 (Vortx VRS 2.0 -- autenticacao mTLS)', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('depende explicitamente das dependencias de Super Admin e fresh TOTP (guard defensivo no topo)', () => {
    expect(migration).toContain("to_regprocedure('private.usuario_e_super_admin()')")
    expect(migration).toContain("to_regprocedure('public.criar_autorizacao_acao_sensivel(text, text)')")
  })

  it('a tabela de credenciais exige os 4 segredos criptografados no formato v1 (Key, Secret, certificado, chave privada)', () => {
    const tabela = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.integracoes_vortx_vrs_credenciais'),
      migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_vortx_vrs_credenciais_ativa'),
    )
    expect(tabela).toContain("CONSTRAINT integracoes_vortx_vrs_credenciais_key_cipher_check CHECK (key_criptografada ~ '^v1:")
    expect(tabela).toContain("CONSTRAINT integracoes_vortx_vrs_credenciais_secret_cipher_check CHECK (secret_criptografada ~ '^v1:")
    expect(tabela).toContain("CONSTRAINT integracoes_vortx_vrs_credenciais_cert_cipher_check CHECK (certificado_criptografado ~ '^v1:")
    expect(tabela).toContain("CONSTRAINT integracoes_vortx_vrs_credenciais_pk_cipher_check CHECK (chave_privada_criptografada ~ '^v1:")
    expect(tabela).toContain("CONSTRAINT integracoes_vortx_vrs_credenciais_base_url_check CHECK (base_url ~ '^https://")
  })

  it('permite no maximo uma credencial ativa por fundo e ambiente (indice unico parcial)', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_vortx_vrs_credenciais_ativa')
    expect(migration).toContain("ON public.integracoes_vortx_vrs_credenciais (fundo_id, ambiente)\n  WHERE status = 'ativa'")
  })

  it('credenciais sao imutaveis -- trigger bloqueia UPDATE dos campos criptografados/identidade', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.validar_credencial_vortx_vrs'),
      migration.indexOf('DROP TRIGGER IF EXISTS validar_credencial_vortx_vrs_trigger'),
    )
    expect(funcao).toContain('OLD.key_criptografada <> NEW.key_criptografada')
    expect(funcao).toContain('OLD.secret_criptografada <> NEW.secret_criptografada')
    expect(funcao).toContain('OLD.certificado_criptografado <> NEW.certificado_criptografado')
    expect(funcao).toContain('OLD.chave_privada_criptografada <> NEW.chave_privada_criptografada')
    expect(funcao).toContain('sao imutaveis')
  })

  it('nega todo acesso direto de authenticated -- somente service_role/RPC SECURITY DEFINER', () => {
    const secao = migration.slice(
      migration.indexOf('ALTER TABLE public.integracoes_vortx_vrs_credenciais ENABLE ROW LEVEL SECURITY'),
      migration.indexOf('-- 2. RPCs administrativas'),
    )
    expect(secao).toContain('REVOKE ALL ON public.integracoes_vortx_vrs_credenciais FROM PUBLIC, anon, authenticated;')
    expect(secao).not.toContain('CREATE POLICY')
    expect(secao).toContain('GRANT ALL ON public.integracoes_vortx_vrs_credenciais TO service_role;')
  })

  it('admin_configurar_credencial_vortx_vrs e admin_obter_configuracao_vortx_vrs sao gated por Super Admin', () => {
    for (const fn of ['admin_configurar_credencial_vortx_vrs', 'admin_obter_configuracao_vortx_vrs']) {
      const inicio = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
      expect(inicio, `funcao ${fn} nao encontrada`).toBeGreaterThan(-1)
      const corpo = migration.slice(inicio, inicio + 900)
      expect(corpo, `${fn} sem gate de super admin`).toContain('usuario_e_super_admin()')
    }
  })

  it('reconfigurar revoga a credencial ativa anterior ANTES de inserir a nova (nunca duas ativas ao mesmo tempo)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_configurar_credencial_vortx_vrs'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_configuracao_vortx_vrs'),
    )
    const posRevoga = funcao.indexOf("SET status = 'revogada'")
    const posInsert = funcao.indexOf('INSERT INTO public.integracoes_vortx_vrs_credenciais')
    expect(posRevoga).toBeGreaterThan(-1)
    expect(posInsert).toBeGreaterThan(posRevoga)
  })

  it('admin_obter_configuracao_vortx_vrs nunca retorna os segredos criptografados, so metadados', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_configuracao_vortx_vrs'),
      migration.indexOf('-- 3. Fresh TOTP'),
    )
    expect(funcao).not.toMatch(/key_criptografada|secret_criptografada|certificado_criptografado|chave_privada_criptografada/)
    expect(funcao).toContain("'status', c.status")
    expect(funcao).toContain("'base_url', c.base_url")
  })

  it('registra as 2 novas acoes sensiveis tanto no CHECK quanto no IN-list de criar_autorizacao_acao_sensivel (dois espelhos sincronizados)', () => {
    const posCheck = migration.indexOf('ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK')
    const posFuncao = migration.indexOf('CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel')
    const trechoCheck = migration.slice(posCheck, posFuncao)
    const trechoFuncao = migration.slice(posFuncao)
    for (const acao of ['configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs']) {
      expect(trechoCheck, `${acao} ausente do CHECK`).toContain(`'${acao}'`)
      expect(trechoFuncao, `${acao} ausente do IN-list da funcao`).toContain(`'${acao}'`)
    }
  })

  it('preserva todas as acoes sensiveis pre-existentes (nunca remove uma acao ja em uso)', () => {
    const acoesPreExistentes = [
      'alterar_senha', 'cadastrar_credencial_integracao', 'criar_fundo', 'conceder_super_admin',
      'publicar_base_financeira', 'revisar_risco_operacao', 'criar_integracao_transportadora',
      'reprocessar_webhook_evento_transportadora',
    ]
    for (const acao of acoesPreExistentes) {
      expect(migration).toContain(`'${acao}'`)
    }
  })
})
