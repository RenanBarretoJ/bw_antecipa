BEGIN;

-- Rascunhos sao preparatorios: podem existir sem endpoint, credencial, client id
-- ou CNAB publicado. A completude operacional e validada novamente ao publicar.
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
  v_endpoint text := trim(COALESCE(p_endpoint_base, ''));
  v_identificador text := trim(COALESCE(p_identificador_cliente, ''));
  v_credential_ref text := COALESCE('credencial:' || p_credencial_integracao_id::text, 'nao_configurada');
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') THEN
    RAISE EXCEPTION 'Ambiente da integracao invalido' USING ERRCODE = '22023';
  END IF;
  IF v_endpoint <> '' AND v_endpoint !~ '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Endpoint informado no rascunho e invalido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuracao nao sensivel deve ser objeto JSON' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('portal_fidc'));
  SELECT i.id INTO v_integracao_id
    FROM public.integracoes_fundo i
   WHERE i.fundo_id = p_fundo_id AND i.provedor = 'fromtis'
   FOR UPDATE;

  IF v_integracao_id IS NULL THEN
    INSERT INTO public.integracoes_fundo (fundo_id, provedor, nome, status, created_by)
    VALUES (p_fundo_id, 'fromtis', 'Portal FIDC - Sinqia', 'rascunho', (SELECT auth.uid()))
    RETURNING id INTO v_integracao_id;
  END IF;

  IF p_credencial_integracao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.credenciais_integracao c
     WHERE c.id = p_credencial_integracao_id
       AND c.fundo_id = p_fundo_id
       AND c.integracao_fundo_id = v_integracao_id
       AND c.ambiente = p_ambiente
       AND c.status = 'ativa'
  ) THEN
    RAISE EXCEPTION 'Credencial ativa compativel nao encontrada' USING ERRCODE = '23514';
  END IF;

  SELECT v.codigo_originador INTO v_codigo_originador
    FROM public.configuracao_cnab_versoes v
    JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
   WHERE c.fundo_id = p_fundo_id
     AND c.status = 'ativa'
     AND v.status = 'publicada'
     AND v.vigente_ate IS NULL
   ORDER BY v.versao DESC
   LIMIT 1;

  IF p_versao_id IS NULL THEN
    SELECT COALESCE(max(v.versao), 0) + 1 INTO v_numero
      FROM public.integracao_fundo_versoes v
     WHERE v.integracao_fundo_id = v_integracao_id;

    INSERT INTO public.integracao_fundo_versoes (
      integracao_fundo_id, versao, ambiente, status, identificador_cliente,
      codigo_originador, endpoint_base, configuracao_nao_sensivel,
      credential_ref, credencial_integracao_id, vigente_desde
    ) VALUES (
      v_integracao_id, v_numero, p_ambiente, 'rascunho', v_identificador,
      v_codigo_originador, v_endpoint, COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
      v_credential_ref, p_credencial_integracao_id, clock_timestamp()
    ) RETURNING id, updated_at INTO v_id, v_updated_at;

    PERFORM private.sa3_auditar(
      'INTEGRACAO_VERSAO_CRIADA', p_fundo_id, 'integracao_fundo_versoes', v_id,
      NULL,
      jsonb_build_object(
        'versao', v_numero,
        'ambiente', p_ambiente,
        'codigo_originador', v_codigo_originador,
        'credencial_integracao_id', p_credencial_integracao_id,
        'endpoint_base', v_endpoint,
        'completa_para_publicacao', false
      ),
      p_correlation_id
    );
  ELSE
    UPDATE public.integracao_fundo_versoes v
       SET ambiente = p_ambiente,
           identificador_cliente = v_identificador,
           codigo_originador = v_codigo_originador,
           endpoint_base = v_endpoint,
           configuracao_nao_sensivel = COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
           credential_ref = v_credential_ref,
           credencial_integracao_id = p_credencial_integracao_id,
           secret_name = NULL,
           vault_key = NULL
     WHERE v.id = p_versao_id
       AND v.integracao_fundo_id = v_integracao_id
       AND v.status = 'rascunho'
       AND (p_updated_at_esperado IS NULL OR v.updated_at = p_updated_at_esperado)
     RETURNING v.id, v.versao, v.updated_at INTO v_id, v_numero, v_updated_at;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Rascunho alterado por outro usuario ou indisponivel' USING ERRCODE = '40001';
    END IF;

    PERFORM private.sa3_auditar(
      'INTEGRACAO_RASCUNHO_ATUALIZADO', p_fundo_id, 'integracao_fundo_versoes', v_id,
      NULL,
      jsonb_build_object(
        'versao', v_numero,
        'ambiente', p_ambiente,
        'codigo_originador', v_codigo_originador,
        'credencial_integracao_id', p_credencial_integracao_id,
        'endpoint_base', v_endpoint
      ),
      p_correlation_id
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'integracao_id', v_integracao_id,
    'versao', v_numero,
    'updated_at', v_updated_at
  );
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
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_integracao
    FROM public.integracoes_fundo i
    JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id = i.id
   WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id
   FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(v_integracao.id::text), hashtext('publicar'));
  SELECT * INTO v_versao
    FROM public.integracao_fundo_versoes v
   WHERE v.id = p_versao_id
   FOR UPDATE;

  IF v_versao.status = 'publicada' THEN
    RETURN jsonb_build_object('id', v_versao.id, 'status', 'publicada', 'idempotente', true);
  END IF;
  IF v_versao.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Somente rascunho pode ser publicado' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(trim(v_versao.endpoint_base), '') IS NULL OR v_versao.endpoint_base !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Informe o endpoint HTTPS antes de publicar' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(trim(v_versao.identificador_cliente), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o identificador do cliente antes de publicar' USING ERRCODE = '23514';
  END IF;
  IF v_versao.credencial_integracao_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.credenciais_integracao c
     WHERE c.id = v_versao.credencial_integracao_id
       AND c.fundo_id = p_fundo_id
       AND c.integracao_fundo_id = v_integracao.id
       AND c.ambiente = v_versao.ambiente
       AND c.status = 'ativa'
  ) THEN
    RAISE EXCEPTION 'Selecione uma credencial ativa antes de publicar' USING ERRCODE = '23514';
  END IF;

  SELECT v.codigo_originador INTO v_originador_cnab
    FROM public.configuracao_cnab_versoes v
    JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
   WHERE c.fundo_id = p_fundo_id
     AND c.status = 'ativa'
     AND v.status = 'publicada'
     AND v.vigente_ate IS NULL
   ORDER BY v.versao DESC
   LIMIT 1;

  IF v_originador_cnab IS NULL THEN
    RAISE EXCEPTION 'Publique a configuracao CNAB antes de publicar a integracao' USING ERRCODE = '23514';
  END IF;
  IF v_originador_cnab <> v_versao.codigo_originador THEN
    RAISE EXCEPTION 'Codigo originador da integracao diverge do CNAB publicado' USING ERRCODE = '23514';
  END IF;

  UPDATE public.integracao_fundo_versoes
     SET status = 'substituida', vigente_ate = v_agora
   WHERE integracao_fundo_id = v_integracao.id
     AND status = 'publicada'
     AND vigente_ate IS NULL
     AND id <> p_versao_id;

  UPDATE public.integracao_fundo_versoes
     SET status = 'publicada',
         vigente_desde = v_agora,
         vigente_ate = NULL,
         publicada_por = (SELECT auth.uid()),
         publicada_em = v_agora
   WHERE id = p_versao_id;

  UPDATE public.integracoes_fundo SET status = 'ativa' WHERE id = v_integracao.id;

  PERFORM private.sa3_auditar(
    'INTEGRACAO_VERSAO_PUBLICADA', p_fundo_id, 'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object(
      'status', 'publicada',
      'versao', v_versao.versao,
      'credencial_integracao_id', v_versao.credencial_integracao_id,
      'codigo_originador', v_versao.codigo_originador,
      'endpoint_base', v_versao.endpoint_base
    ),
    p_correlation_id
  );

  RETURN jsonb_build_object('id', p_versao_id, 'status', 'publicada', 'versao', v_versao.versao);
END;
$$;

COMMENT ON FUNCTION public.admin_salvar_integracao_rascunho(uuid, uuid, text, text, text, uuid, jsonb, timestamptz, uuid) IS
  'Cria ou atualiza somente uma versao rascunho. Nao exige TOTP nem completude operacional.';

COMMENT ON FUNCTION public.admin_publicar_integracao_versao(uuid, uuid, uuid) IS
  'Publica uma configuracao completa, substituindo a publicada anterior sem alterar historico.';

COMMIT;
