-- P0 Claude: fundacao de autenticacao da Vortx VRS 2.0 (mTLS + Key/Secret),
-- somente em homologacao. Este ticket NAO implementa remessa, relatorios,
-- estoque ou liquidacao -- apenas o armazenamento seguro das credenciais por
-- fundo/ambiente e o teste tecnico de login.
--
-- Decisao de arquitetura: a Vortx NAO entra no modelo de
-- integracoes_fundo/integracao_fundo_versoes/credenciais_integracao (fase 7 +
-- SA3 P2.2.1). Esse modelo e propositalmente acoplado ao fluxo Portal
-- FIDC/Sinqia: integracoes_fundo.provedor tem CHECK fixo em
-- ('fromtis','sinqia'); a publicacao de uma versao exige selecionar ao menos
-- uma capability (CESSAO_ENVIO/ESTOQUE/AQUISICOES/LIQUIDACOES/CARTEIRA), que
-- este ticket explicitamente proibe implementar para a Vortx; e
-- credenciais_integracao so guarda 2 segredos (usuario/senha), nao 4
-- (Key, Secret, certificado, chave privada). Forcar a Vortx nesse modelo
-- exigiria uma capability fake so para publicar uma versao, o que violaria o
-- escopo do ticket. Por isso, seguindo o mesmo precedente ja adotado para
-- integracoes_transportadoras (webhook de comprovante de entrega), a Vortx
-- ganha uma tabela minima e independente, reaproveitando: (a) o mecanismo de
-- criptografia AES-256-GCM ja existente (criptografarPortalFidcValor /
-- descriptografarPortalFidcValor, generico para qualquer string secreta,
-- nao exclusivo do Portal FIDC); (b) o padrao de RLS deny-all para
-- authenticated + acesso somente via service_role/RPC SECURITY DEFINER; (c) o
-- padrao de Super Admin + fresh TOTP (autorizarEConsumirAcaoSensivel) para
-- toda escrita sensivel.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.autorizacoes_acoes_sensiveis') IS NULL
    OR to_regprocedure('private.usuario_e_super_admin()') IS NULL
    OR to_regprocedure('private.sa3_auditar(text, uuid, text, uuid, jsonb, jsonb, uuid)') IS NULL
    OR to_regprocedure('public.criar_autorizacao_acao_sensivel(text, text)') IS NULL
  THEN
    RAISE EXCEPTION 'Dependencias obrigatorias ausentes: fundos/profiles/autorizacoes_acoes_sensiveis/private.usuario_e_super_admin/private.sa3_auditar/criar_autorizacao_acao_sensivel.';
  END IF;
END $$;

-- 1. Credenciais Vortx VRS por fundo e ambiente ------------------------------
-- Uma linha "ativa" por (fundo_id, ambiente); reconfigurar revoga a anterior
-- e cria uma nova (nunca UPDATE dos segredos -- imutavel, igual a
-- credenciais_integracao).

CREATE TABLE IF NOT EXISTS public.integracoes_vortx_vrs_credenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ambiente text NOT NULL,
  base_url text NOT NULL,
  key_criptografada text NOT NULL,
  secret_criptografada text NOT NULL,
  certificado_criptografado text NOT NULL,
  chave_privada_criptografada text NOT NULL,
  chave_versao text NOT NULL,
  status text NOT NULL DEFAULT 'ativa',
  criada_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  criada_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  revogada_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracoes_vortx_vrs_credenciais_ambiente_check CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT integracoes_vortx_vrs_credenciais_status_check CHECK (status IN ('ativa', 'revogada')),
  CONSTRAINT integracoes_vortx_vrs_credenciais_base_url_check CHECK (base_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT integracoes_vortx_vrs_credenciais_chave_versao_check CHECK (length(trim(chave_versao)) >= 1),
  CONSTRAINT integracoes_vortx_vrs_credenciais_key_cipher_check CHECK (key_criptografada ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT integracoes_vortx_vrs_credenciais_secret_cipher_check CHECK (secret_criptografada ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT integracoes_vortx_vrs_credenciais_cert_cipher_check CHECK (certificado_criptografado ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT integracoes_vortx_vrs_credenciais_pk_cipher_check CHECK (chave_privada_criptografada ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT integracoes_vortx_vrs_credenciais_revogada_check CHECK (
    (status = 'revogada' AND revogada_em IS NOT NULL AND revogada_por IS NOT NULL)
    OR (status <> 'revogada')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_vortx_vrs_credenciais_ativa
  ON public.integracoes_vortx_vrs_credenciais (fundo_id, ambiente)
  WHERE status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_integracoes_vortx_vrs_credenciais_fundo
  ON public.integracoes_vortx_vrs_credenciais (fundo_id, ambiente, status, criada_em DESC);

DROP TRIGGER IF EXISTS update_integracoes_vortx_vrs_credenciais_updated_at ON public.integracoes_vortx_vrs_credenciais;
CREATE TRIGGER update_integracoes_vortx_vrs_credenciais_updated_at
  BEFORE UPDATE ON public.integracoes_vortx_vrs_credenciais
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.validar_credencial_vortx_vrs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.fundo_id <> NEW.fundo_id
      OR OLD.ambiente <> NEW.ambiente
      OR OLD.base_url <> NEW.base_url
      OR OLD.key_criptografada <> NEW.key_criptografada
      OR OLD.secret_criptografada <> NEW.secret_criptografada
      OR OLD.certificado_criptografado <> NEW.certificado_criptografado
      OR OLD.chave_privada_criptografada <> NEW.chave_privada_criptografada
      OR OLD.chave_versao <> NEW.chave_versao
    THEN
      RAISE EXCEPTION 'Credenciais Vortx VRS sao imutaveis; reconfigure para criar um novo registro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_credencial_vortx_vrs_trigger ON public.integracoes_vortx_vrs_credenciais;
CREATE TRIGGER validar_credencial_vortx_vrs_trigger
  BEFORE UPDATE ON public.integracoes_vortx_vrs_credenciais
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_credencial_vortx_vrs();

ALTER TABLE public.integracoes_vortx_vrs_credenciais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracoes_vortx_vrs_credenciais FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.integracoes_vortx_vrs_credenciais TO service_role;

-- 2. RPCs administrativas -----------------------------------------------------
-- Escrita: SECURITY DEFINER + gate de Super Admin (a criptografia acontece no
-- backend TS antes de chamar a RPC -- a RPC so persiste ciphertext ja
-- validado pelo CHECK). Leitura: nunca retorna ciphertext, so metadados --
-- o valor decifrado so existe em memoria de processo server-side
-- (integracoes/vortx/credenciais.server.ts), nunca trafega para o navegador.

CREATE OR REPLACE FUNCTION public.admin_configurar_credencial_vortx_vrs(
  p_fundo_id uuid,
  p_ambiente text,
  p_base_url text,
  p_key_criptografada text,
  p_secret_criptografada text,
  p_certificado_criptografado text,
  p_chave_privada_criptografada text,
  p_chave_versao text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') THEN
    RAISE EXCEPTION 'Ambiente invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('vortx_vrs:' || p_ambiente));

  UPDATE public.integracoes_vortx_vrs_credenciais
     SET status = 'revogada', revogada_em = v_agora, revogada_por = (SELECT auth.uid())
   WHERE fundo_id = p_fundo_id AND ambiente = p_ambiente AND status = 'ativa';

  INSERT INTO public.integracoes_vortx_vrs_credenciais (
    fundo_id, ambiente, base_url, key_criptografada, secret_criptografada,
    certificado_criptografado, chave_privada_criptografada, chave_versao,
    status, criada_por, criada_em
  ) VALUES (
    p_fundo_id, p_ambiente, p_base_url, p_key_criptografada, p_secret_criptografada,
    p_certificado_criptografado, p_chave_privada_criptografada, p_chave_versao,
    'ativa', (SELECT auth.uid()), v_agora
  ) RETURNING id INTO v_id;

  PERFORM private.sa3_auditar('VORTX_VRS_CREDENCIAL_CONFIGURADA', p_fundo_id,
    'integracoes_vortx_vrs_credenciais', v_id, NULL,
    jsonb_build_object('ambiente', p_ambiente, 'base_url', p_base_url), p_correlation_id);

  RETURN jsonb_build_object('id', v_id, 'fundo_id', p_fundo_id, 'ambiente', p_ambiente);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_configurar_credencial_vortx_vrs(
  uuid, text, text, text, text, text, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_configurar_credencial_vortx_vrs(
  uuid, text, text, text, text, text, text, text, uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_obter_configuracao_vortx_vrs(
  p_fundo_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'ambiente', c.ambiente,
    'base_url', c.base_url,
    'status', c.status,
    'criada_em', c.criada_em,
    'revogada_em', c.revogada_em
  ) ORDER BY c.ambiente, c.criada_em DESC), '[]'::jsonb)
  INTO v_resultado
  FROM public.integracoes_vortx_vrs_credenciais c
  WHERE c.fundo_id = p_fundo_id;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obter_configuracao_vortx_vrs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_configuracao_vortx_vrs(uuid) TO authenticated, service_role;

-- 3. Fresh TOTP: registra as novas acoes sensiveis na lista fechada ---------

ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural',
      'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo',
      'revogar_gestor_fundo', 'reativar_gestor_fundo',
      'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin',
      'criar_integracao_versao', 'publicar_integracao',
      'desativar_integracao', 'testar_integracao',
      'atualizar_cnab', 'atualizar_codigo_originador',
      'publicar_base_financeira', 'confirmar_match_manual',
      'revogar_match_manual', 'revisar_risco_operacao',
      'criar_integracao_transportadora', 'ativar_integracao_transportadora',
      'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
      'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora',
      'configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs'
    ])
  );

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
RETURNS TABLE (expira_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;

  IF p_action_type IS NULL OR p_action_type NOT IN (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural',
    'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo',
    'revogar_gestor_fundo', 'reativar_gestor_fundo',
    'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin',
    'criar_integracao_versao', 'publicar_integracao',
    'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador',
    'publicar_base_financeira', 'confirmar_match_manual',
    'revogar_match_manual', 'revisar_risco_operacao',
    'criar_integracao_transportadora', 'ativar_integracao_transportadora',
    'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
    'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora',
    'configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;

  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
     WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;

  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );

  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$$;

COMMENT ON TABLE public.integracoes_vortx_vrs_credenciais IS
  'Credenciais Vortx VRS 2.0 (Key/Secret + certificado/chave mTLS) por fundo e ambiente. Sempre criptografadas (AES-256-GCM); nunca expostas em texto puro fora do processo server-side que autentica na Vortx.';

COMMIT;
