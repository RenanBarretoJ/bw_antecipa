-- SA3: administracao tecnica de fundos por Super Admin.
--
-- Reutiliza as tabelas canonicas de CNAB, integracoes e credenciais. Remove as
-- mutacoes tecnicas diretas do Gestor e concentra leitura/mutacao administrativa
-- em RPCs fechadas, auditaveis e transacionais.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.configuracoes_cnab') IS NULL
     OR to_regclass('public.configuracao_cnab_versoes') IS NULL
     OR to_regclass('public.integracoes_fundo') IS NULL
     OR to_regclass('public.integracao_fundo_versoes') IS NULL
     OR to_regclass('public.credenciais_integracao') IS NULL
     OR to_regclass('public.plataforma_auditoria') IS NULL
     OR to_regprocedure('private.usuario_e_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'SA3 depende das migrations Fase 7/8 e SA0/SA1/SA2.';
  END IF;
END;
$$;

ALTER TABLE public.integracao_fundo_versoes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.configuracao_cnab_versoes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS integracao_fundo_versoes_updated_at ON public.integracao_fundo_versoes;
CREATE TRIGGER integracao_fundo_versoes_updated_at
  BEFORE UPDATE ON public.integracao_fundo_versoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS configuracao_cnab_versoes_updated_at ON public.configuracao_cnab_versoes;
CREATE TRIGGER configuracao_cnab_versoes_updated_at
  BEFORE UPDATE ON public.configuracao_cnab_versoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS integracao_execucoes_admin_fundo_data_idx
  ON public.integracao_execucoes (fundo_id, iniciada_em DESC, id DESC);

-- Lista fechada de acoes que exigem confirmacao TOTP fresca na aplicacao.
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
      'atualizar_cnab', 'atualizar_codigo_originador'
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
    'atualizar_cnab', 'atualizar_codigo_originador'
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

CREATE OR REPLACE FUNCTION private.sa3_auditar(
  p_tipo_evento text,
  p_fundo_id uuid,
  p_entidade_tipo text,
  p_entidade_id uuid,
  p_dados_antes jsonb,
  p_dados_depois jsonb,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, origem, correlation_id, dados
  ) VALUES (
    p_tipo_evento,
    (SELECT auth.uid()),
    'admin_configuracoes_tecnicas',
    COALESCE(p_correlation_id, gen_random_uuid()),
    jsonb_build_object(
      'fundo_id', p_fundo_id,
      'entidade_tipo', p_entidade_tipo,
      'entidade_id', p_entidade_id,
      'dados_antes', COALESCE(p_dados_antes, '{}'::jsonb),
      'dados_depois', COALESCE(p_dados_depois, '{}'::jsonb)
    )
  );
$$;

REVOKE ALL ON FUNCTION private.sa3_auditar(text, uuid, text, uuid, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Leitura administrativa sanitizada. Segredos criptografados e payloads
-- operacionais nao integram o DTO.
CREATE OR REPLACE FUNCTION public.admin_obter_configuracoes_tecnicas_fundo(
  p_fundo_id uuid,
  p_execucoes_limite integer DEFAULT 20,
  p_execucoes_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
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
  IF p_execucoes_limite < 1 OR p_execucoes_limite > 100 OR p_execucoes_offset < 0 THEN
    RAISE EXCEPTION 'Limite de execucoes invalido' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'fundo', jsonb_build_object('id', f.id, 'nome', f.nome, 'cnpj', f.cnpj, 'ativo', f.ativo),
    'integracoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'provedor', i.provedor, 'nome', i.nome, 'status', i.status,
        'created_at', i.created_at, 'updated_at', i.updated_at,
        'versoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'versao', v.versao, 'ambiente', v.ambiente,
            'status', v.status, 'identificador_cliente', v.identificador_cliente,
            'codigo_originador', v.codigo_originador, 'endpoint_base', v.endpoint_base,
            'configuracao_nao_sensivel', v.configuracao_nao_sensivel,
            'credencial_integracao_id', v.credencial_integracao_id,
            'vigente_desde', v.vigente_desde, 'vigente_ate', v.vigente_ate,
            'publicada_em', v.publicada_em, 'created_at', v.created_at,
            'updated_at', v.updated_at
          ) ORDER BY v.versao DESC)
          FROM public.integracao_fundo_versoes v
          WHERE v.integracao_fundo_id = i.id
        ), '[]'::jsonb)
      ) ORDER BY i.created_at DESC)
      FROM public.integracoes_fundo i WHERE i.fundo_id = f.id
    ), '[]'::jsonb),
    'credenciais', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'integracao_fundo_id', c.integracao_fundo_id,
        'ambiente', c.ambiente, 'nome', c.nome, 'status', c.status,
        'chave_versao', c.chave_versao, 'criada_em', c.criada_em,
        'ativada_em', c.ativada_em, 'revogada_em', c.revogada_em,
        'substituida_por', c.substituida_por, 'ultimo_uso_em', c.ultimo_uso_em,
        'usuario_mascarado', c.metadados ->> 'usuario_mascarado',
        'created_at', c.created_at, 'updated_at', c.updated_at
      ) ORDER BY c.created_at DESC)
      FROM public.credenciais_integracao c WHERE c.fundo_id = f.id
    ), '[]'::jsonb),
    'cnab', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'descricao', c.descricao,
        'finalidade', c.finalidade, 'status', c.status,
        'created_at', c.created_at, 'updated_at', c.updated_at,
        'versoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'versao', v.versao, 'status', v.status,
            'layout', v.layout, 'versao_layout', v.versao_layout,
            'codigo_banco', v.codigo_banco, 'banco', v.banco,
            'agencia', v.agencia, 'conta', v.conta, 'digito_conta', v.digito_conta,
            'carteira', v.carteira, 'convenio', v.convenio,
            'codigo_originador', v.codigo_originador,
            'codigo_empresa', v.codigo_empresa, 'tipo_inscricao', v.tipo_inscricao,
            'numero_inscricao', v.numero_inscricao, 'especie_titulo', v.especie_titulo,
            'tipo_recebivel', v.tipo_recebivel, 'configuracao', v.configuracao,
            'conteudo_hash', v.conteudo_hash, 'vigente_desde', v.vigente_desde,
            'vigente_ate', v.vigente_ate, 'publicada_em', v.publicada_em,
            'created_at', v.created_at, 'updated_at', v.updated_at
          ) ORDER BY v.versao DESC)
          FROM public.configuracao_cnab_versoes v
          WHERE v.configuracao_cnab_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at DESC)
      FROM public.configuracoes_cnab c WHERE c.fundo_id = f.id
    ), '[]'::jsonb),
    'execucoes_total', (SELECT count(*) FROM public.integracao_execucoes x WHERE x.fundo_id = f.id),
    'execucoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.iniciada_em DESC, e.id DESC)
      FROM (
        SELECT x.id, x.integracao_fundo_versao_id, x.tipo_execucao, x.ambiente,
               x.status, x.tentativa, x.codigo_resposta, x.mensagem_resumida,
               x.erro_categoria, x.duracao_ms, x.iniciada_em, x.finalizada_em
          FROM public.integracao_execucoes x
         WHERE x.fundo_id = f.id
         ORDER BY x.iniciada_em DESC, x.id DESC
          LIMIT p_execucoes_limite
          OFFSET p_execucoes_offset
      ) e
    ), '[]'::jsonb)
  ) INTO v_resultado
  FROM public.fundos f
  WHERE f.id = p_fundo_id;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cadastrar_credencial_integracao(
  p_fundo_id uuid,
  p_ambiente text,
  p_nome text,
  p_usuario_criptografado text,
  p_senha_criptografada text,
  p_chave_versao text,
  p_usuario_mascarado text,
  p_credencial_anterior_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_integracao_id uuid;
  v_id uuid;
  v_evento text := CASE WHEN p_credencial_anterior_id IS NULL THEN 'CREDENCIAL_CRIADA' ELSE 'CREDENCIAL_ROTACIONADA' END;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') OR length(trim(COALESCE(p_nome, ''))) < 2 THEN
    RAISE EXCEPTION 'Dados da credencial invalidos' USING ERRCODE = '22023';
  END IF;
  IF p_usuario_criptografado !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
     OR p_senha_criptografada !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Formato criptografico invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('portal_fidc'));
  SELECT i.id INTO v_integracao_id FROM public.integracoes_fundo i
   WHERE i.fundo_id = p_fundo_id AND i.provedor = 'fromtis' FOR UPDATE;
  IF v_integracao_id IS NULL THEN
    INSERT INTO public.integracoes_fundo (fundo_id, provedor, nome, status, created_by)
    VALUES (p_fundo_id, 'fromtis', 'Portal FIDC - Sinqia', 'rascunho', (SELECT auth.uid()))
    RETURNING id INTO v_integracao_id;
  END IF;

  IF p_credencial_anterior_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
     WHERE c.id = p_credencial_anterior_id AND c.fundo_id = p_fundo_id
       AND c.integracao_fundo_id = v_integracao_id AND c.ambiente = p_ambiente
  ) THEN
    RAISE EXCEPTION 'Credencial anterior nao encontrada no fundo e ambiente informados' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.credenciais_integracao (
    fundo_id, integracao_fundo_id, ambiente, nome,
    usuario_criptografado, senha_criptografada, chave_versao,
    status, criada_por, metadados
  ) VALUES (
    p_fundo_id, v_integracao_id, p_ambiente, trim(p_nome),
    p_usuario_criptografado, p_senha_criptografada, trim(p_chave_versao),
    'rascunho', (SELECT auth.uid()), jsonb_build_object('usuario_mascarado', p_usuario_mascarado)
  ) RETURNING id INTO v_id;

  PERFORM private.sa3_auditar(v_evento, p_fundo_id, 'credenciais_integracao', v_id, NULL,
    jsonb_build_object('integracao_fundo_id', v_integracao_id, 'ambiente', p_ambiente,
      'status', 'rascunho', 'credencial_anterior_id', p_credencial_anterior_id,
      'chave_versao', p_chave_versao), p_correlation_id);
  RETURN jsonb_build_object('id', v_id, 'integracao_id', v_integracao_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ativar_credencial_integracao(
  p_fundo_id uuid,
  p_credencial_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cred public.credenciais_integracao%ROWTYPE;
  v_anterior_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_cred FROM public.credenciais_integracao c
   WHERE c.id = p_credencial_id AND c.fundo_id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_cred.status = 'revogada' THEN RAISE EXCEPTION 'Credencial revogada nao pode ser ativada' USING ERRCODE = '23514'; END IF;
  IF v_cred.status = 'ativa' THEN RETURN jsonb_build_object('id', v_cred.id, 'status', 'ativa', 'idempotente', true); END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_cred.integracao_fundo_id::text), hashtext(v_cred.ambiente));
  SELECT c.id INTO v_anterior_id FROM public.credenciais_integracao c
   WHERE c.integracao_fundo_id = v_cred.integracao_fundo_id
     AND c.ambiente = v_cred.ambiente AND c.status = 'ativa'
   FOR UPDATE;
  UPDATE public.credenciais_integracao
     SET status = 'substituida', substituida_por = p_credencial_id, updated_at = v_agora
   WHERE id = v_anterior_id;
  UPDATE public.credenciais_integracao
     SET status = 'ativa', ativada_em = v_agora, revogada_em = NULL, updated_at = v_agora
   WHERE id = p_credencial_id;

  PERFORM private.sa3_auditar(CASE WHEN v_anterior_id IS NULL THEN 'CREDENCIAL_ATIVADA' ELSE 'CREDENCIAL_ROTACIONADA' END,
    p_fundo_id, 'credenciais_integracao', p_credencial_id,
    jsonb_build_object('status', v_cred.status),
    jsonb_build_object('status', 'ativa', 'credencial_anterior_id', v_anterior_id), p_correlation_id);
  RETURN jsonb_build_object('id', p_credencial_id, 'status', 'ativa', 'anterior_id', v_anterior_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revogar_credencial_integracao(
  p_fundo_id uuid,
  p_credencial_id uuid,
  p_motivo text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cred public.credenciais_integracao%ROWTYPE;
  v_impacta_publicada boolean;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF length(trim(COALESCE(p_motivo, ''))) < 10 THEN RAISE EXCEPTION 'Motivo obrigatorio com pelo menos 10 caracteres' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_cred FROM public.credenciais_integracao c
   WHERE c.id = p_credencial_id AND c.fundo_id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_cred.status = 'revogada' THEN RETURN jsonb_build_object('id', v_cred.id, 'status', 'revogada', 'idempotente', true); END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.integracao_fundo_versoes v
     WHERE v.credencial_integracao_id = p_credencial_id AND v.status = 'publicada'
       AND v.vigente_ate IS NULL
  ) INTO v_impacta_publicada;
  UPDATE public.credenciais_integracao
     SET status = 'revogada', revogada_em = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_credencial_id;
  PERFORM private.sa3_auditar('CREDENCIAL_REVOGADA', p_fundo_id, 'credenciais_integracao', p_credencial_id,
    jsonb_build_object('status', v_cred.status),
    jsonb_build_object('status', 'revogada', 'motivo', trim(p_motivo),
      'impacta_versao_publicada', v_impacta_publicada), p_correlation_id);
  RETURN jsonb_build_object('id', p_credencial_id, 'status', 'revogada', 'impacta_versao_publicada', v_impacta_publicada);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_integracao_rascunho(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_ambiente text,
  p_endpoint_base text,
  p_identificador_cliente text,
  p_credencial_integracao_id uuid,
  p_configuracao_nao_sensivel jsonb DEFAULT '{}'::jsonb,
  p_updated_at_esperado timestamptz DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_integracao_id uuid;
  v_codigo_originador text;
  v_numero integer;
  v_id uuid;
  v_updated_at timestamptz;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao')
     OR p_endpoint_base !~ '^https://[^[:space:]]+$'
     OR NULLIF(trim(COALESCE(p_identificador_cliente, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Configuracao de integracao invalida' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuracao nao sensivel deve ser objeto JSON' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('portal_fidc'));
  SELECT i.id INTO v_integracao_id FROM public.integracoes_fundo i
   WHERE i.fundo_id = p_fundo_id AND i.provedor = 'fromtis' FOR UPDATE;
  IF v_integracao_id IS NULL THEN
    INSERT INTO public.integracoes_fundo (fundo_id, provedor, nome, status, created_by)
    VALUES (p_fundo_id, 'fromtis', 'Portal FIDC - Sinqia', 'rascunho', (SELECT auth.uid()))
    RETURNING id INTO v_integracao_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
     WHERE c.id = p_credencial_integracao_id AND c.fundo_id = p_fundo_id
       AND c.integracao_fundo_id = v_integracao_id
       AND c.ambiente = p_ambiente AND c.status = 'ativa'
  ) THEN RAISE EXCEPTION 'Credencial ativa compativel nao encontrada' USING ERRCODE = '23514'; END IF;

  SELECT v.codigo_originador INTO v_codigo_originador
    FROM public.configuracao_cnab_versoes v
    JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
   WHERE c.fundo_id = p_fundo_id AND c.status = 'ativa'
     AND v.status = 'publicada' AND v.vigente_ate IS NULL
   ORDER BY v.versao DESC LIMIT 1;
  IF v_codigo_originador IS NULL THEN RAISE EXCEPTION 'Publique o CNAB antes de configurar a integracao' USING ERRCODE = '23514'; END IF;

  IF p_versao_id IS NULL THEN
    SELECT COALESCE(max(v.versao), 0) + 1 INTO v_numero
      FROM public.integracao_fundo_versoes v WHERE v.integracao_fundo_id = v_integracao_id;
    INSERT INTO public.integracao_fundo_versoes (
      integracao_fundo_id, versao, ambiente, status, identificador_cliente,
      codigo_originador, endpoint_base, configuracao_nao_sensivel,
      credential_ref, credencial_integracao_id, vigente_desde
    ) VALUES (
      v_integracao_id, v_numero, p_ambiente, 'rascunho', trim(p_identificador_cliente),
      v_codigo_originador, trim(p_endpoint_base), COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
      'credencial:' || p_credencial_integracao_id::text, p_credencial_integracao_id, clock_timestamp()
    ) RETURNING id, updated_at INTO v_id, v_updated_at;
    PERFORM private.sa3_auditar('INTEGRACAO_VERSAO_CRIADA', p_fundo_id, 'integracao_fundo_versoes', v_id,
      NULL, jsonb_build_object('versao', v_numero, 'ambiente', p_ambiente,
      'codigo_originador', v_codigo_originador, 'credencial_integracao_id', p_credencial_integracao_id,
      'endpoint_base', p_endpoint_base), p_correlation_id);
  ELSE
    UPDATE public.integracao_fundo_versoes v
       SET ambiente = p_ambiente, identificador_cliente = trim(p_identificador_cliente),
           codigo_originador = v_codigo_originador, endpoint_base = trim(p_endpoint_base),
           configuracao_nao_sensivel = COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
           credential_ref = 'credencial:' || p_credencial_integracao_id::text,
           credencial_integracao_id = p_credencial_integracao_id,
           secret_name = NULL, vault_key = NULL
     WHERE v.id = p_versao_id AND v.integracao_fundo_id = v_integracao_id
       AND v.status = 'rascunho'
       AND (p_updated_at_esperado IS NULL OR v.updated_at = p_updated_at_esperado)
     RETURNING v.id, v.versao, v.updated_at INTO v_id, v_numero, v_updated_at;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Rascunho alterado por outro usuario ou indisponivel' USING ERRCODE = '40001'; END IF;
    PERFORM private.sa3_auditar('INTEGRACAO_RASCUNHO_ATUALIZADO', p_fundo_id, 'integracao_fundo_versoes', v_id,
      NULL, jsonb_build_object('versao', v_numero, 'ambiente', p_ambiente,
      'codigo_originador', v_codigo_originador, 'credencial_integracao_id', p_credencial_integracao_id,
      'endpoint_base', p_endpoint_base), p_correlation_id);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'integracao_id', v_integracao_id, 'versao', v_numero, 'updated_at', v_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publicar_integracao_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_integracao public.integracoes_fundo%ROWTYPE;
  v_originador_cnab text;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT i.* INTO v_integracao FROM public.integracoes_fundo i
   JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id = i.id
   WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_integracao.id::text), hashtext('publicar'));
  SELECT * INTO v_versao FROM public.integracao_fundo_versoes v WHERE v.id = p_versao_id FOR UPDATE;
  IF v_versao.status = 'publicada' THEN RETURN jsonb_build_object('id', v_versao.id, 'status', 'publicada', 'idempotente', true); END IF;
  IF v_versao.status <> 'rascunho' THEN RAISE EXCEPTION 'Somente rascunho pode ser publicado' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.credenciais_integracao c WHERE c.id = v_versao.credencial_integracao_id AND c.status = 'ativa') THEN
    RAISE EXCEPTION 'Credencial vinculada ausente ou inativa' USING ERRCODE = '23514';
  END IF;
  SELECT v.codigo_originador INTO v_originador_cnab
    FROM public.configuracao_cnab_versoes v
    JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
   WHERE c.fundo_id = p_fundo_id AND c.status = 'ativa' AND v.status = 'publicada' AND v.vigente_ate IS NULL
   ORDER BY v.versao DESC LIMIT 1;
  IF v_originador_cnab IS NULL OR v_originador_cnab <> v_versao.codigo_originador THEN
    RAISE EXCEPTION 'Codigo originador da integracao diverge do CNAB publicado' USING ERRCODE = '23514';
  END IF;
  UPDATE public.integracao_fundo_versoes SET status = 'substituida', vigente_ate = v_agora
   WHERE integracao_fundo_id = v_integracao.id AND status = 'publicada' AND vigente_ate IS NULL AND id <> p_versao_id;
  UPDATE public.integracao_fundo_versoes
     SET status = 'publicada', vigente_desde = v_agora, vigente_ate = NULL,
         publicada_por = (SELECT auth.uid()), publicada_em = v_agora
   WHERE id = p_versao_id;
  UPDATE public.integracoes_fundo SET status = 'ativa' WHERE id = v_integracao.id;
  PERFORM private.sa3_auditar('INTEGRACAO_VERSAO_PUBLICADA', p_fundo_id, 'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object('status', 'publicada', 'versao', v_versao.versao,
      'credencial_integracao_id', v_versao.credencial_integracao_id,
      'codigo_originador', v_versao.codigo_originador, 'endpoint_base', v_versao.endpoint_base), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'publicada', 'versao', v_versao.versao);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_integracao_id uuid;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT v.* INTO v_versao
    FROM public.integracao_fundo_versoes v JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
   WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id FOR UPDATE OF v, i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  v_integracao_id := v_versao.integracao_fundo_id;
  IF v_versao.status IN ('cancelada', 'substituida') THEN RETURN jsonb_build_object('id', v_versao.id, 'status', v_versao.status, 'idempotente', true); END IF;
  UPDATE public.integracao_fundo_versoes
     SET status = 'cancelada', vigente_ate = COALESCE(vigente_ate, clock_timestamp())
   WHERE id = p_versao_id;
  IF NOT EXISTS (SELECT 1 FROM public.integracao_fundo_versoes v WHERE v.integracao_fundo_id = v_integracao_id AND v.status = 'publicada' AND v.vigente_ate IS NULL) THEN
    UPDATE public.integracoes_fundo SET status = 'desativada' WHERE id = v_integracao_id;
  END IF;
  PERFORM private.sa3_auditar('INTEGRACAO_VERSAO_DESATIVADA', p_fundo_id, 'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status), jsonb_build_object('status', 'cancelada'), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'cancelada');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_cnab_rascunho(
  p_fundo_id uuid,
  p_configuracao_id uuid,
  p_versao_id uuid,
  p_codigo text,
  p_nome text,
  p_descricao text,
  p_layout text,
  p_versao_layout text,
  p_codigo_banco text,
  p_banco text,
  p_agencia text,
  p_conta text,
  p_digito_conta text,
  p_carteira text,
  p_convenio text,
  p_codigo_originador text,
  p_codigo_empresa text,
  p_tipo_inscricao text,
  p_numero_inscricao text,
  p_especie_titulo text,
  p_tipo_recebivel text,
  p_configuracao jsonb,
  p_conteudo_hash text,
  p_updated_at_esperado timestamptz DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config_id uuid := p_configuracao_id;
  v_id uuid;
  v_numero integer;
  v_updated_at timestamptz;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_layout <> 'cnab444' OR p_codigo_originador !~ '^[0-9]{1,20}$'
     OR p_conteudo_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(COALESCE(p_configuracao, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuracao CNAB invalida' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('cnab'));
  IF v_config_id IS NULL THEN
    SELECT c.id INTO v_config_id FROM public.configuracoes_cnab c
     WHERE c.fundo_id = p_fundo_id AND c.codigo = p_codigo FOR UPDATE;
  END IF;
  IF v_config_id IS NULL THEN
    INSERT INTO public.configuracoes_cnab (fundo_id, codigo, nome, descricao, finalidade, status, created_by)
    VALUES (p_fundo_id, trim(p_codigo), trim(p_nome), NULLIF(trim(COALESCE(p_descricao, '')), ''), 'remessa', 'rascunho', (SELECT auth.uid()))
    RETURNING id INTO v_config_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.configuracoes_cnab c WHERE c.id = v_config_id AND c.fundo_id = p_fundo_id) THEN
    RAISE EXCEPTION 'Configuracao CNAB nao pertence ao fundo' USING ERRCODE = '42501';
  END IF;

  IF p_versao_id IS NULL THEN
    SELECT COALESCE(max(v.versao), 0) + 1 INTO v_numero FROM public.configuracao_cnab_versoes v WHERE v.configuracao_cnab_id = v_config_id;
    INSERT INTO public.configuracao_cnab_versoes (
      configuracao_cnab_id, versao, layout, versao_layout, codigo_banco, banco,
      agencia, conta, digito_conta, carteira, convenio, codigo_originador,
      codigo_empresa, tipo_inscricao, numero_inscricao, especie_titulo,
      tipo_recebivel, configuracao, conteudo_hash, status, vigente_desde
    ) VALUES (
      v_config_id, v_numero, p_layout, trim(p_versao_layout), trim(p_codigo_banco), trim(p_banco),
      trim(p_agencia), trim(p_conta), trim(p_digito_conta), trim(p_carteira), trim(p_convenio), trim(p_codigo_originador),
      trim(p_codigo_empresa), trim(p_tipo_inscricao), trim(p_numero_inscricao), trim(p_especie_titulo),
      trim(p_tipo_recebivel), COALESCE(p_configuracao, '{}'::jsonb), p_conteudo_hash, 'rascunho', clock_timestamp()
    ) RETURNING id, updated_at INTO v_id, v_updated_at;
    PERFORM private.sa3_auditar('CNAB_VERSAO_CRIADA', p_fundo_id, 'configuracao_cnab_versoes', v_id, NULL,
      jsonb_build_object('versao', v_numero, 'layout', p_layout, 'codigo_originador', p_codigo_originador), p_correlation_id);
  ELSE
    UPDATE public.configuracao_cnab_versoes v SET
      layout = p_layout, versao_layout = trim(p_versao_layout), codigo_banco = trim(p_codigo_banco), banco = trim(p_banco),
      agencia = trim(p_agencia), conta = trim(p_conta), digito_conta = trim(p_digito_conta), carteira = trim(p_carteira),
      convenio = trim(p_convenio), codigo_originador = trim(p_codigo_originador), codigo_empresa = trim(p_codigo_empresa),
      tipo_inscricao = trim(p_tipo_inscricao), numero_inscricao = trim(p_numero_inscricao), especie_titulo = trim(p_especie_titulo),
      tipo_recebivel = trim(p_tipo_recebivel), configuracao = COALESCE(p_configuracao, '{}'::jsonb), conteudo_hash = p_conteudo_hash
    WHERE v.id = p_versao_id AND v.configuracao_cnab_id = v_config_id AND v.status = 'rascunho'
      AND (p_updated_at_esperado IS NULL OR v.updated_at = p_updated_at_esperado)
    RETURNING v.id, v.versao, v.updated_at INTO v_id, v_numero, v_updated_at;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Rascunho CNAB alterado por outro usuario ou indisponivel' USING ERRCODE = '40001'; END IF;
    PERFORM private.sa3_auditar('CNAB_RASCUNHO_ATUALIZADO', p_fundo_id, 'configuracao_cnab_versoes', v_id, NULL,
      jsonb_build_object('versao', v_numero, 'layout', p_layout, 'codigo_originador', p_codigo_originador), p_correlation_id);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'configuracao_id', v_config_id, 'versao', v_numero, 'updated_at', v_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publicar_cnab_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.configuracao_cnab_versoes%ROWTYPE;
  v_config public.configuracoes_cnab%ROWTYPE;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT c.* INTO v_config FROM public.configuracoes_cnab c
   JOIN public.configuracao_cnab_versoes v ON v.configuracao_cnab_id = c.id
   WHERE v.id = p_versao_id AND c.fundo_id = p_fundo_id FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao CNAB nao encontrada' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_config.id::text), hashtext('publicar'));
  SELECT * INTO v_versao FROM public.configuracao_cnab_versoes v WHERE v.id = p_versao_id FOR UPDATE;
  IF v_versao.status = 'publicada' THEN RETURN jsonb_build_object('id', v_versao.id, 'status', 'publicada', 'idempotente', true); END IF;
  IF v_versao.status <> 'rascunho' THEN RAISE EXCEPTION 'Somente rascunho CNAB pode ser publicado' USING ERRCODE = '23514'; END IF;
  UPDATE public.configuracao_cnab_versoes SET status = 'substituida', vigente_ate = v_agora
   WHERE configuracao_cnab_id = v_config.id AND status = 'publicada' AND vigente_ate IS NULL AND id <> p_versao_id;
  UPDATE public.configuracao_cnab_versoes
     SET status = 'publicada', vigente_desde = v_agora, vigente_ate = NULL,
         publicada_por = (SELECT auth.uid()), publicada_em = v_agora
   WHERE id = p_versao_id;
  UPDATE public.configuracoes_cnab SET status = 'ativa' WHERE id = v_config.id;
  PERFORM private.sa3_auditar('CNAB_VERSAO_PUBLICADA', p_fundo_id, 'configuracao_cnab_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object('status', 'publicada', 'versao', v_versao.versao,
      'layout', v_versao.layout, 'codigo_originador', v_versao.codigo_originador), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'publicada', 'versao', v_versao.versao);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_cnab_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.configuracao_cnab_versoes%ROWTYPE;
  v_config_id uuid;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT v.* INTO v_versao FROM public.configuracao_cnab_versoes v
  JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
  WHERE v.id = p_versao_id AND c.fundo_id = p_fundo_id FOR UPDATE OF v, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao CNAB nao encontrada' USING ERRCODE = 'P0002'; END IF;
  v_config_id := v_versao.configuracao_cnab_id;
  IF v_versao.status IN ('cancelada', 'substituida') THEN RETURN jsonb_build_object('id', v_versao.id, 'status', v_versao.status, 'idempotente', true); END IF;
  UPDATE public.configuracao_cnab_versoes SET status = 'cancelada', vigente_ate = COALESCE(vigente_ate, clock_timestamp()) WHERE id = p_versao_id;
  IF NOT EXISTS (SELECT 1 FROM public.configuracao_cnab_versoes v WHERE v.configuracao_cnab_id = v_config_id AND v.status = 'publicada' AND v.vigente_ate IS NULL) THEN
    UPDATE public.configuracoes_cnab SET status = 'desativada' WHERE id = v_config_id;
  END IF;
  PERFORM private.sa3_auditar('CNAB_VERSAO_DESATIVADA', p_fundo_id, 'configuracao_cnab_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status), jsonb_build_object('status', 'cancelada'), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'cancelada');
END;
$$;

-- O preparo do teste retorna ciphertext apenas para a Server Action autenticada.
-- O DTO nunca e repassado ao Client Component.
CREATE OR REPLACE FUNCTION public.admin_preparar_teste_integracao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_cred public.credenciais_integracao%ROWTYPE;
  v_execucao_id uuid;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT v.* INTO v_versao FROM public.integracao_fundo_versoes v
  JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
  WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_versao.status NOT IN ('rascunho', 'publicada') THEN
    RAISE EXCEPTION 'Versao de integracao indisponivel para teste' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_cred FROM public.credenciais_integracao c
  WHERE c.id = v_versao.credencial_integracao_id AND c.fundo_id = p_fundo_id AND c.status = 'ativa';
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial vinculada ausente, inativa ou revogada' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.integracao_execucoes (
    fundo_id, integracao_fundo_versao_id, tipo_execucao, ambiente, status,
    tentativa, idempotency_key, request_hash, iniciada_em
  ) VALUES (
    p_fundo_id, p_versao_id, 'teste_conexao', v_versao.ambiente, 'iniciada', 1,
    encode(digest(gen_random_uuid()::text || p_versao_id::text, 'sha256'), 'hex'),
    encode(digest(v_versao.endpoint_base || ':' || p_versao_id::text, 'sha256'), 'hex'),
    clock_timestamp()
  ) RETURNING id INTO v_execucao_id;
  PERFORM private.sa3_auditar('INTEGRACAO_TESTE_INICIADO', p_fundo_id, 'integracao_execucoes', v_execucao_id,
    NULL, jsonb_build_object('versao_id', p_versao_id, 'ambiente', v_versao.ambiente), p_correlation_id);
  RETURN jsonb_build_object(
    'execucao_id', v_execucao_id, 'endpoint_base', v_versao.endpoint_base,
    'ambiente', v_versao.ambiente, 'usuario_criptografado', v_cred.usuario_criptografado,
    'senha_criptografada', v_cred.senha_criptografada, 'chave_versao', v_cred.chave_versao,
    'credencial_id', v_cred.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_finalizar_teste_integracao(
  p_fundo_id uuid,
  p_execucao_id uuid,
  p_status text,
  p_codigo_resposta text,
  p_mensagem_resumida text,
  p_erro_categoria text,
  p_duracao_ms integer,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('sucesso', 'erro', 'timeout') OR p_duracao_ms < 0 THEN RAISE EXCEPTION 'Resultado de teste invalido' USING ERRCODE = '22023'; END IF;
  UPDATE public.integracao_execucoes e
     SET status = p_status, codigo_resposta = left(p_codigo_resposta, 80),
         mensagem_resumida = left(p_mensagem_resumida, 700),
         erro_categoria = left(p_erro_categoria, 80), duracao_ms = p_duracao_ms,
         finalizada_em = clock_timestamp()
   WHERE e.id = p_execucao_id AND e.fundo_id = p_fundo_id
     AND e.tipo_execucao = 'teste_conexao' AND e.status = 'iniciada'
   RETURNING e.id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Execucao de teste indisponivel ou ja finalizada' USING ERRCODE = '40001'; END IF;
  PERFORM private.sa3_auditar('INTEGRACAO_TESTE_FINALIZADO', p_fundo_id, 'integracao_execucoes', p_execucao_id,
    NULL, jsonb_build_object('status', p_status, 'codigo_resposta', left(p_codigo_resposta, 80),
      'erro_categoria', left(p_erro_categoria, 80), 'duracao_ms', p_duracao_ms), p_correlation_id);
  RETURN jsonb_build_object('id', p_execucao_id, 'status', p_status);
END;
$$;

-- Gestor deixa de possuir acesso direto as tabelas de configuracao tecnica.
DROP POLICY IF EXISTS configuracoes_cnab_gestor_all ON public.configuracoes_cnab;
DROP POLICY IF EXISTS configuracao_cnab_versoes_gestor_all ON public.configuracao_cnab_versoes;
DROP POLICY IF EXISTS integracoes_fundo_gestor_all ON public.integracoes_fundo;
DROP POLICY IF EXISTS integracao_fundo_versoes_gestor_all ON public.integracao_fundo_versoes;

REVOKE ALL ON TABLE public.configuracoes_cnab FROM authenticated;
REVOKE ALL ON TABLE public.configuracao_cnab_versoes FROM authenticated;
REVOKE ALL ON TABLE public.integracoes_fundo FROM authenticated;
REVOKE ALL ON TABLE public.integracao_fundo_versoes FROM authenticated;

-- Execucoes e retornos continuam legiveis no contexto operacional, mas Gestor
-- nao pode mais cria-los/alterá-los diretamente.
DROP POLICY IF EXISTS integracao_execucoes_gestor_all ON public.integracao_execucoes;
DROP POLICY IF EXISTS retornos_integracao_gestor_all ON public.retornos_integracao;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.integracao_execucoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.retornos_integracao FROM authenticated;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_integracao_execucao(p_execucao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.get_user_role()::text = 'gestor' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      JOIN public.usuario_fundos uf ON uf.fundo_id = e.fundo_id
      JOIN public.fundos f ON f.id = e.fundo_id
      WHERE e.id = p_execucao_id AND uf.usuario_id = (SELECT auth.uid())
        AND uf.status = 'ativo' AND f.ativo IS TRUE
    )
    WHEN public.get_user_role()::text = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = COALESCE(e.operacao_id, ro.operacao_id)
      JOIN public.consultor_cedente cc ON cc.cedente_id = o.cedente_id
      WHERE e.id = p_execucao_id AND cc.consultor_id = (SELECT auth.uid())
    )
    WHEN public.get_user_role()::text = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = COALESCE(e.operacao_id, ro.operacao_id)
      JOIN public.cedentes c ON c.id = o.cedente_id
      WHERE e.id = p_execucao_id AND c.user_id = (SELECT auth.uid())
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.usuario_pode_ler_integracao_execucao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_pode_ler_integracao_execucao(uuid) TO authenticated, service_role;

DO $$
DECLARE
  v_function_names text[] := ARRAY[
    'admin_obter_configuracoes_tecnicas_fundo',
    'admin_cadastrar_credencial_integracao',
    'admin_ativar_credencial_integracao',
    'admin_revogar_credencial_integracao',
    'admin_salvar_integracao_rascunho',
    'admin_publicar_integracao_versao',
    'admin_desativar_integracao_versao',
    'admin_salvar_cnab_rascunho',
    'admin_publicar_cnab_versao',
    'admin_desativar_cnab_versao',
    'admin_preparar_teste_integracao',
    'admin_finalizar_teste_integracao'
  ];
  v_signature text;
  v_found integer := 0;
BEGIN
  FOR v_signature IN
    SELECT format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    )
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_function_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
    v_found := v_found + 1;
  END LOOP;

  IF v_found <> cardinality(v_function_names) THEN
    RAISE EXCEPTION 'SA3 esperava % funcoes administrativas, mas encontrou %.', cardinality(v_function_names), v_found;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) TO authenticated;

COMMIT;
