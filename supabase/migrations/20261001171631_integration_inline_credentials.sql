-- Credenciais inline: preparar sem afetar a versao vigente; ativar ao publicar.
BEGIN;

-- A migration Vortx reintroduziu o contrato Sinqia anterior a P2.2.2.
-- Espelha os conectores implementados sem habilitar CARTEIRA.
CREATE OR REPLACE FUNCTION private.integracao_adapter_capability_suportada(p_adapter_key text, p_capability text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT p_adapter_key IN ('sinqia_portal_fidc', 'vortx_vrs')
    AND p_capability IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')
$$;
REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_integracao_versao_credencial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_cred public.credenciais_integracao%ROWTYPE;
  v_fundo_id uuid;
BEGIN
  IF NEW.credencial_integracao_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_cred FROM public.credenciais_integracao WHERE id = NEW.credencial_integracao_id;
  SELECT fundo_id INTO v_fundo_id FROM public.integracoes_fundo WHERE id = NEW.integracao_fundo_id;
  IF v_cred.id IS NULL OR v_cred.integracao_fundo_id IS DISTINCT FROM NEW.integracao_fundo_id
    OR v_cred.fundo_id IS DISTINCT FROM v_fundo_id OR v_cred.ambiente IS DISTINCT FROM NEW.ambiente THEN
    RAISE EXCEPTION 'Credencial incompativel com fundo, integracao ou ambiente' USING ERRCODE = '23514';
  END IF;
  -- Encerrar uma versao nao altera seu snapshot, mesmo apos revogacao.
  IF TG_OP = 'UPDATE' AND NEW.status IN ('substituida', 'desativada')
    AND OLD.credencial_integracao_id IS NOT DISTINCT FROM NEW.credencial_integracao_id THEN
    RETURN NEW;
  END IF;
  IF (NEW.status = 'rascunho' AND v_cred.status IN ('rascunho', 'ativa') AND v_cred.revogada_em IS NULL)
    OR (NEW.status = 'publicada' AND v_cred.status = 'ativa' AND v_cred.revogada_em IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Credencial indisponivel para o estado da versao' USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_integracao_rascunho(
  p_fundo_id uuid,
  p_integracao_fundo_id uuid,
  p_versao_id uuid,
  p_provider_key text,
  p_system_name text,
  p_adapter_key text,
  p_capabilities text[],
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
  v_integracao_id uuid := p_integracao_fundo_id;
  v_cred public.credenciais_integracao%ROWTYPE;
  v_codigo_originador text;
  v_numero integer;
  v_id uuid;
  v_updated_at timestamptz;
  v_endpoint text := trim(COALESCE(p_endpoint_base, ''));
  v_identificador text := trim(COALESCE(p_identificador_cliente, ''));
  v_provider text := upper(trim(COALESCE(p_provider_key, '')));
  v_system text := trim(COALESCE(p_system_name, ''));
  v_adapter text := NULLIF(lower(trim(COALESCE(p_adapter_key, ''))), '');
  v_capability text;
  v_capabilities text[];
  v_credential_ref text := COALESCE('credencial:' || p_credencial_integracao_id::text, 'nao_configurada');
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao')
     OR v_provider !~ '^[A-Z][A-Z0-9_]{1,63}$'
     OR length(v_system) NOT BETWEEN 2 AND 160
     OR (v_adapter IS NOT NULL AND v_adapter !~ '^[a-z][a-z0-9_]{1,79}$') THEN
    RAISE EXCEPTION 'Identidade ou ambiente da integracao invalido' USING ERRCODE = '22023';
  END IF;
  IF v_endpoint <> '' AND v_endpoint !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Endpoint informado no rascunho e invalido' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'Configuracao nao sensivel deve ser objeto JSON' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(array_agg(DISTINCT upper(trim(x)) ORDER BY upper(trim(x))), ARRAY[]::text[])
    INTO v_capabilities
    FROM unnest(COALESCE(p_capabilities, ARRAY[]::text[])) x;
  FOREACH v_capability IN ARRAY v_capabilities LOOP
    IF v_capability NOT IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA') THEN
      RAISE EXCEPTION 'Capability invalida: %', v_capability USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('integracoes_tecnicas'));
  IF v_integracao_id IS NULL THEN
    INSERT INTO public.integracoes_fundo (
      fundo_id, provedor, provider_key, system_name, nome, status, created_by
    ) VALUES (
      p_fundo_id, lower(v_provider), v_provider, v_system, v_system, 'rascunho', (SELECT auth.uid())
    ) RETURNING id INTO v_integracao_id;
    PERFORM private.sa3_auditar('INTEGRACAO_CRIADA', p_fundo_id, 'integracoes_fundo', v_integracao_id,
      NULL, jsonb_build_object('provider_key', v_provider, 'system_name', v_system), p_correlation_id);
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.integracoes_fundo i
      WHERE i.id = v_integracao_id AND i.fundo_id = p_fundo_id
    ) THEN RAISE EXCEPTION 'Integracao nao encontrada neste fundo' USING ERRCODE = 'P0002'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.integracao_fundo_versoes v
      WHERE v.integracao_fundo_id = v_integracao_id AND v.status IN ('publicada', 'substituida', 'desativada')
    ) AND EXISTS (
      SELECT 1 FROM public.integracoes_fundo i
      WHERE i.id = v_integracao_id
        AND (i.provider_key <> v_provider OR i.system_name <> v_system)
    ) THEN
      RAISE EXCEPTION 'Provider e sistema de uma integracao publicada sao imutaveis' USING ERRCODE = '23514';
    END IF;
    UPDATE public.integracoes_fundo
       SET provider_key = v_provider, system_name = v_system,
           provedor = lower(v_provider), nome = v_system
     WHERE id = v_integracao_id;
  END IF;

  -- Primeiro vinculo e salvamento atomicos. O rollback desfaz ambos.
  IF p_credencial_integracao_id IS NOT NULL THEN
    SELECT * INTO v_cred FROM public.credenciais_integracao c
    WHERE c.id = p_credencial_integracao_id AND c.fundo_id = p_fundo_id FOR UPDATE;
    IF NOT FOUND OR v_cred.status NOT IN ('ativa', 'rascunho') OR v_cred.revogada_em IS NOT NULL
      OR v_cred.ambiente <> p_ambiente OR v_cred.provider_key <> v_provider
      OR v_cred.credential_type <> 'usuario_senha'
      OR NOT (v_capabilities <@ v_cred.capabilities)
      OR v_adapter = 'vortx_vrs'
      OR (v_cred.integracao_fundo_id IS NOT NULL AND v_cred.integracao_fundo_id <> v_integracao_id)
    THEN RAISE EXCEPTION 'Credencial compativel nao encontrada' USING ERRCODE = '23514'; END IF;
    IF v_cred.integracao_fundo_id IS NULL THEN
      UPDATE public.credenciais_integracao SET integracao_fundo_id = v_integracao_id WHERE id = v_cred.id;
      PERFORM private.sa3_auditar('CREDENCIAL_VINCULADA', p_fundo_id, 'credenciais_integracao', v_cred.id,
        jsonb_build_object('integracao_fundo_id', NULL),
        jsonb_build_object('integracao_fundo_id', v_integracao_id), p_correlation_id);
    END IF;
  END IF;

  IF p_credencial_integracao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
    WHERE c.id = p_credencial_integracao_id
      AND c.fundo_id = p_fundo_id
      AND c.integracao_fundo_id = v_integracao_id
      AND c.ambiente = p_ambiente
      AND c.status IN ('ativa', 'rascunho')
  ) THEN RAISE EXCEPTION 'Credencial compativel nao encontrada' USING ERRCODE = '23514'; END IF;

  SELECT v.codigo_originador INTO v_codigo_originador
  FROM public.configuracao_cnab_versoes v
  JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
  WHERE c.fundo_id = p_fundo_id AND c.status = 'ativa'
    AND v.status = 'publicada' AND v.vigente_ate IS NULL
  ORDER BY v.versao DESC LIMIT 1;

  IF p_versao_id IS NULL THEN
    SELECT COALESCE(max(v.versao), 0) + 1 INTO v_numero
    FROM public.integracao_fundo_versoes v WHERE v.integracao_fundo_id = v_integracao_id;
    INSERT INTO public.integracao_fundo_versoes (
      integracao_fundo_id, versao, ambiente, status, identificador_cliente,
      codigo_originador, endpoint_base, configuracao_nao_sensivel,
      credential_ref, credencial_integracao_id, adapter_key, vigente_desde
    ) VALUES (
      v_integracao_id, v_numero, p_ambiente, 'rascunho', v_identificador,
      v_codigo_originador, v_endpoint, COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
      v_credential_ref, p_credencial_integracao_id, v_adapter, clock_timestamp()
    ) RETURNING id, updated_at INTO v_id, v_updated_at;
  ELSE
    UPDATE public.integracao_fundo_versoes v
       SET ambiente = p_ambiente, identificador_cliente = v_identificador,
           codigo_originador = v_codigo_originador, endpoint_base = v_endpoint,
           configuracao_nao_sensivel = COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
           credential_ref = v_credential_ref, credencial_integracao_id = p_credencial_integracao_id,
           adapter_key = v_adapter, secret_name = NULL, vault_key = NULL
     WHERE v.id = p_versao_id AND v.integracao_fundo_id = v_integracao_id
       AND v.status = 'rascunho'
       AND (p_updated_at_esperado IS NULL OR v.updated_at = p_updated_at_esperado)
     RETURNING v.id, v.versao, v.updated_at INTO v_id, v_numero, v_updated_at;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Rascunho alterado por outro usuario ou indisponivel' USING ERRCODE = '40001'; END IF;
    DELETE FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = v_id;
  END IF;

  INSERT INTO public.integracao_fundo_versao_capacidades (
    integracao_fundo_versao_id, fundo_id, ambiente, capability
  ) SELECT v_id, p_fundo_id, p_ambiente, x FROM unnest(v_capabilities) x;

  PERFORM private.sa3_auditar(
    CASE WHEN p_versao_id IS NULL THEN 'INTEGRACAO_VERSAO_CRIADA' ELSE 'INTEGRACAO_RASCUNHO_ATUALIZADO' END,
    p_fundo_id, 'integracao_fundo_versoes', v_id, NULL,
    jsonb_build_object('versao', v_numero, 'ambiente', p_ambiente, 'adapter_key', v_adapter,
      'credencial_integracao_id', p_credencial_integracao_id, 'endpoint_base', v_endpoint,
      'capabilities', to_jsonb(v_capabilities)), p_correlation_id);
  PERFORM private.sa3_auditar('INTEGRACAO_CAPABILITIES_ATUALIZADAS', p_fundo_id,
    'integracao_fundo_versoes', v_id, NULL,
    jsonb_build_object('capabilities', to_jsonb(v_capabilities)), p_correlation_id);

  RETURN jsonb_build_object('id', v_id, 'integracao_id', v_integracao_id,
    'versao', v_numero, 'updated_at', v_updated_at);
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
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('integracoes_tecnicas'));
  SELECT *
    INTO v_cred
    FROM public.credenciais_integracao c
   WHERE c.id = p_credencial_id
     AND c.fundo_id = p_fundo_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credencial nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_cred.status = 'ativa' THEN
    RETURN jsonb_build_object('id', v_cred.id, 'status', 'ativa', 'idempotente', true);
  END IF;

  IF v_cred.status NOT IN ('rascunho', 'ativa') THEN
    RAISE EXCEPTION 'Somente credencial em rascunho pode ser ativada' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(COALESCE(v_cred.integracao_fundo_id, v_cred.id)::text),
    pg_catalog.hashtext(v_cred.ambiente)
  );

  SELECT c.id
    INTO v_anterior_id
    FROM public.credenciais_integracao c
   WHERE c.integracao_fundo_id = v_cred.integracao_fundo_id
     AND c.ambiente = v_cred.ambiente
     AND c.status = 'ativa'
   FOR UPDATE;

  -- A publicacao encerra a versao anterior antes de ativar a substituta.
  -- A ativacao isolada nunca pode interromper uma versao publicada.
  IF EXISTS (
    SELECT 1 FROM public.integracao_fundo_versoes v
    WHERE v.credencial_integracao_id = v_anterior_id AND v.status = 'publicada'
      AND v.vigente_ate IS NULL
  ) THEN
    RAISE EXCEPTION 'Publique o rascunho da integracao para concluir a rotacao sem interromper a versao vigente'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.credenciais_integracao
     SET status = 'substituida',
         substituida_por = p_credencial_id,
         updated_at = v_agora
   WHERE id = v_anterior_id;

  UPDATE public.credenciais_integracao
     SET status = 'ativa',
         ativada_em = v_agora,
         revogada_em = NULL,
         updated_at = v_agora
   WHERE id = p_credencial_id;

  PERFORM private.sa3_auditar(
    CASE WHEN v_anterior_id IS NULL THEN 'CREDENCIAL_ATIVADA' ELSE 'CREDENCIAL_ROTACIONADA' END,
    p_fundo_id,
    'credenciais_integracao',
    p_credencial_id,
    jsonb_build_object('status', v_cred.status, 'ambiente', v_cred.ambiente),
    jsonb_build_object(
      'status', 'ativa',
      'ambiente', v_cred.ambiente,
      'credencial_anterior_id', v_anterior_id
    ),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'id', p_credencial_id,
    'status', 'ativa',
    'anterior_id', v_anterior_id
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
  v_agora timestamptz := clock_timestamp();
  v_capability text;
  v_substituida record;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('integracoes_tecnicas'));
  SELECT i.* INTO v_integracao
  FROM public.integracoes_fundo i
  JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id = i.id
  WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_versao FROM public.integracao_fundo_versoes v WHERE v.id = p_versao_id FOR UPDATE;
  IF v_versao.status = 'publicada' THEN RETURN jsonb_build_object('id', v_versao.id, 'status', 'publicada', 'idempotente', true); END IF;
  IF v_versao.status <> 'rascunho' THEN RAISE EXCEPTION 'Somente rascunho pode ser publicado' USING ERRCODE = '23514'; END IF;
  IF v_versao.adapter_key IS NULL THEN RAISE EXCEPTION 'Adapter nao implementado para esta integracao' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integracao_fundo_versao_capacidades c WHERE c.integracao_fundo_versao_id = p_versao_id) THEN
    RAISE EXCEPTION 'Selecione ao menos uma capability antes de publicar' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = p_versao_id
      AND NOT private.integracao_adapter_capability_suportada(v_versao.adapter_key, c.capability)
  ) THEN
    RAISE EXCEPTION 'Adapter nao implementado para todas as capabilities selecionadas' USING ERRCODE = '23514';
  END IF;
  IF v_versao.adapter_key = 'sinqia_portal_fidc' THEN
    IF NULLIF(trim(v_versao.endpoint_base), '') IS NULL OR v_versao.endpoint_base !~ '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'Informe o endpoint HTTPS antes de publicar' USING ERRCODE = '23514';
    END IF;
    IF v_versao.credencial_integracao_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.credenciais_integracao c
      WHERE c.id = v_versao.credencial_integracao_id AND c.fundo_id = p_fundo_id
        AND c.integracao_fundo_id = v_integracao.id AND c.ambiente = v_versao.ambiente
        AND c.status IN ('ativa', 'rascunho') AND c.revogada_em IS NULL
    ) THEN RAISE EXCEPTION 'Selecione uma credencial ativa antes de publicar' USING ERRCODE = '23514'; END IF;
  END IF;

  FOR v_capability IN
    SELECT c.capability FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = p_versao_id ORDER BY c.capability
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      hashtextextended(p_fundo_id::text || ':' || v_versao.ambiente || ':' || v_capability, 0)
    );
  END LOOP;

  -- A nova versao substitui integralmente a anterior da mesma integracao.
  UPDATE public.integracao_fundo_versao_capacidades c SET disponivel_ate = v_agora
  FROM public.integracao_fundo_versoes old_v
  WHERE old_v.id = c.integracao_fundo_versao_id
    AND old_v.integracao_fundo_id = v_integracao.id
    AND old_v.status = 'publicada' AND old_v.id <> p_versao_id
    AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL;

  UPDATE public.integracao_fundo_versoes
  SET status = 'substituida', vigente_ate = v_agora
  WHERE integracao_fundo_id = v_integracao.id
    AND status = 'publicada' AND vigente_ate IS NULL AND id <> p_versao_id;

  -- A troca de credencial e a publicacao pertencem a mesma transacao.
  -- Qualquer falha posterior restaura inclusive a credencial anterior.
  IF v_versao.credencial_integracao_id IS NOT NULL THEN
    PERFORM public.admin_ativar_credencial_integracao(
      p_fundo_id, v_versao.credencial_integracao_id, p_correlation_id
    );
  END IF;

  -- Transfere somente as capabilities selecionadas de outras integracoes.
  FOR v_substituida IN
    SELECT c.id, c.capability, c.integracao_fundo_versao_id
    FROM public.integracao_fundo_versao_capacidades c
    WHERE c.fundo_id = p_fundo_id AND c.ambiente = v_versao.ambiente
      AND c.capability IN (
        SELECT n.capability FROM public.integracao_fundo_versao_capacidades n
        WHERE n.integracao_fundo_versao_id = p_versao_id
      )
      AND c.integracao_fundo_versao_id <> p_versao_id
      AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.integracao_fundo_versao_capacidades
    SET disponivel_ate = v_agora WHERE id = v_substituida.id;
    PERFORM private.sa3_auditar('CAPABILITY_FONTE_SUBSTITUIDA', p_fundo_id,
      'integracao_fundo_versoes', p_versao_id,
      jsonb_build_object('capability', v_substituida.capability,
        'integracao_fundo_versao_id', v_substituida.integracao_fundo_versao_id),
      jsonb_build_object('capability', v_substituida.capability,
        'integracao_fundo_versao_id', p_versao_id), p_correlation_id);
  END LOOP;

  UPDATE public.integracao_fundo_versao_capacidades
  SET disponivel_desde = v_agora, disponivel_ate = NULL
  WHERE integracao_fundo_versao_id = p_versao_id;

  UPDATE public.integracao_fundo_versoes
  SET status = 'publicada', vigente_desde = v_agora, vigente_ate = NULL,
      publicada_por = (SELECT auth.uid()), publicada_em = v_agora
  WHERE id = p_versao_id;
  UPDATE public.integracoes_fundo SET status = 'ativa' WHERE id = v_integracao.id;

  -- Uma versao de outra integracao sem capabilities restantes deixa de ser vigente.
  UPDATE public.integracao_fundo_versoes ov
  SET status = 'substituida', vigente_ate = v_agora
  WHERE ov.id <> p_versao_id AND ov.status = 'publicada' AND ov.vigente_ate IS NULL
    AND ov.integracao_fundo_id IN (SELECT i.id FROM public.integracoes_fundo i WHERE i.fundo_id = p_fundo_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.integracao_fundo_versao_capacidades c
      WHERE c.integracao_fundo_versao_id = ov.id
        AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    );

  UPDATE public.integracoes_fundo i SET status = 'desativada'
  WHERE i.fundo_id = p_fundo_id AND i.id <> v_integracao.id
    AND NOT EXISTS (
      SELECT 1 FROM public.integracao_fundo_versoes v
      JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id = v.id
      WHERE v.integracao_fundo_id = i.id AND v.status = 'publicada'
        AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    );

  PERFORM private.sa3_auditar('INTEGRACAO_PUBLICADA', p_fundo_id,
    'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object('status', 'publicada', 'versao', v_versao.versao,
      'adapter_key', v_versao.adapter_key,
      'capabilities', (SELECT jsonb_agg(c.capability ORDER BY c.capability)
        FROM public.integracao_fundo_versao_capacidades c
        WHERE c.integracao_fundo_versao_id = p_versao_id)), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'publicada', 'versao', v_versao.versao);
END;
$$;

-- Os segredos chegam exclusivamente cifrados pela server action.
-- As capabilities da credencial sao metadados do conector, nao uma segunda
-- configuracao de autorizacao: a fonte operacional continua sendo a versao.
CREATE OR REPLACE FUNCTION public.admin_salvar_integracao_com_credencial(
  p_fundo_id uuid, p_integracao_fundo_id uuid, p_versao_id uuid,
  p_provider_key text, p_system_name text, p_adapter_key text,
  p_capabilities text[], p_ambiente text, p_endpoint_base text,
  p_identificador_cliente text, p_configuracao_nao_sensivel jsonb,
  p_updated_at_esperado timestamptz, p_nome text,
  p_usuario_criptografado text, p_senha_criptografada text,
  p_chave_versao text, p_usuario_mascarado text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_cred jsonb;
  v_result jsonb;
  v_supported text[] := ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES'];
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin())
     OR COALESCE((SELECT auth.jwt())->>'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'Acesso administrativo com MFA obrigatorio' USING ERRCODE = '42501';
  END IF;
  IF p_adapter_key IS DISTINCT FROM 'sinqia_portal_fidc'
     OR p_provider_key IS DISTINCT FROM 'SINQIA'
     OR (p_integracao_fundo_id IS NULL AND p_system_name IS DISTINCT FROM 'Portal FIDC')
     OR p_capabilities IS NULL OR NOT (p_capabilities <@ v_supported) THEN
    RAISE EXCEPTION 'Provedor ou funcionalidades incompativeis com usuario e senha' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('integracoes_tecnicas'));
  v_cred := public.admin_cadastrar_credencial_integracao(
    p_fundo_id => p_fundo_id, p_integracao_fundo_id => NULL,
    p_ambiente => p_ambiente, p_nome => p_nome,
    p_usuario_criptografado => p_usuario_criptografado,
    p_senha_criptografada => p_senha_criptografada, p_chave_versao => p_chave_versao,
    p_usuario_mascarado => p_usuario_mascarado, p_provider_key => p_provider_key,
    p_capabilities => v_supported, p_correlation_id => p_correlation_id
  );
  v_result := public.admin_salvar_integracao_rascunho(
    p_fundo_id, p_integracao_fundo_id, p_versao_id, p_provider_key, p_system_name,
    p_adapter_key, p_capabilities, p_ambiente, p_endpoint_base,
    p_identificador_cliente, (v_cred->>'id')::uuid, p_configuracao_nao_sensivel,
    p_updated_at_esperado, p_correlation_id
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_integracao_com_credencial(
  uuid,uuid,uuid,text,text,text,text[],text,text,text,jsonb,timestamptz,text,text,text,text,text,uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_integracao_com_credencial(
  uuid,uuid,uuid,text,text,text,text[],text,text,text,jsonb,timestamptz,text,text,text,text,text,uuid
) TO authenticated;

-- SHA-256 nativo evita depender do schema da extensao pgcrypto com search_path vazio.
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
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(gen_random_uuid()::text || p_versao_id::text, 'UTF8')), 'hex'),
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_versao.endpoint_base || ':' || p_versao_id::text, 'UTF8')), 'hex'),
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

NOTIFY pgrst, 'reload schema';
COMMIT;
