-- Credenciais podem preceder a integracao; o primeiro vinculo permanece exclusivo.
-- Nenhum segredo, vinculo existente, adapter ou politica de acesso e reescrito.
BEGIN;

ALTER TABLE public.credenciais_integracao
  ALTER COLUMN integracao_fundo_id DROP NOT NULL,
  ADD COLUMN provider_key text,
  ADD COLUMN credential_type text NOT NULL DEFAULT 'usuario_senha',
  ADD COLUMN capabilities text[] NOT NULL DEFAULT ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES','CARTEIRA']::text[];

-- Backfill de metadados apenas; ciphertext e FK existentes permanecem intactos.
UPDATE public.credenciais_integracao c SET provider_key = i.provider_key
FROM public.integracoes_fundo i WHERE i.id = c.integracao_fundo_id;

ALTER TABLE public.credenciais_integracao
  ALTER COLUMN provider_key SET NOT NULL,
  ADD CONSTRAINT credenciais_provider_check CHECK (provider_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT credenciais_type_check CHECK (credential_type = 'usuario_senha'),
  ADD CONSTRAINT credenciais_capabilities_check CHECK (
    capabilities <@ ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES','CARTEIRA']::text[]
    AND array_position(capabilities, NULL) IS NULL
  );

-- A assinatura antiga continua utilizavel pelos defaults, sem overload ambiguo.
DROP FUNCTION public.admin_cadastrar_credencial_integracao(uuid,uuid,text,text,text,text,text,text,uuid,uuid);
CREATE OR REPLACE FUNCTION public.validar_credencial_integracao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  integracao_fundo uuid;
BEGIN
  SELECT i.fundo_id
  INTO integracao_fundo
  FROM public.integracoes_fundo i
  WHERE i.id = NEW.integracao_fundo_id;

  IF NEW.integracao_fundo_id IS NOT NULL AND integracao_fundo IS NULL THEN
    RAISE EXCEPTION 'Integracao do fundo nao encontrada.';
  END IF;

  IF integracao_fundo <> NEW.fundo_id THEN
    RAISE EXCEPTION 'Credencial nao pertence ao mesmo fundo da integracao.';
  END IF;

  IF NEW.integracao_fundo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.integracoes_fundo i
    WHERE i.id = NEW.integracao_fundo_id AND i.provider_key = NEW.provider_key
  ) THEN
    RAISE EXCEPTION 'Provider da credencial incompativel' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.usuario_criptografado <> NEW.usuario_criptografado
      OR OLD.senha_criptografada <> NEW.senha_criptografada
      OR OLD.chave_versao <> NEW.chave_versao
      OR OLD.fundo_id <> NEW.fundo_id
      OR (OLD.integracao_fundo_id IS NOT NULL AND OLD.integracao_fundo_id IS DISTINCT FROM NEW.integracao_fundo_id)
      OR OLD.provider_key IS DISTINCT FROM NEW.provider_key
      OR OLD.credential_type IS DISTINCT FROM NEW.credential_type
      OR OLD.capabilities IS DISTINCT FROM NEW.capabilities
      OR OLD.ambiente <> NEW.ambiente
    THEN
      RAISE EXCEPTION 'Credenciais sao imutaveis; rotacione criando novo registro.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cadastrar_credencial_integracao(
  p_fundo_id uuid,
  p_integracao_fundo_id uuid,
  p_ambiente text,
  p_nome text,
  p_usuario_criptografado text,
  p_senha_criptografada text,
  p_chave_versao text,
  p_usuario_mascarado text,
  p_credencial_anterior_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_provider_key text DEFAULT NULL,
  p_capabilities text[] DEFAULT ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES','CARTEIRA']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_provider text := upper(trim(p_provider_key));
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
  IF p_integracao_fundo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.integracoes_fundo i
    WHERE i.id = p_integracao_fundo_id AND i.fundo_id = p_fundo_id
  ) THEN
    RAISE EXCEPTION 'Integracao nao encontrada neste fundo' USING ERRCODE = 'P0002';
  END IF;

  IF p_integracao_fundo_id IS NOT NULL THEN
    SELECT i.provider_key INTO v_provider FROM public.integracoes_fundo i WHERE i.id = p_integracao_fundo_id;
  END IF;
  IF v_provider IS NULL OR v_provider !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'Informe o provider da credencial' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(COALESCE(p_integracao_fundo_id,p_fundo_id)::text), hashtext('credencial:' || p_ambiente));
  IF p_credencial_anterior_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
    WHERE c.id = p_credencial_anterior_id
      AND c.fundo_id = p_fundo_id
      AND c.integracao_fundo_id IS NOT DISTINCT FROM p_integracao_fundo_id
      AND c.provider_key = v_provider
      AND c.status = 'ativa'
      AND c.ambiente = p_ambiente
  ) THEN
    RAISE EXCEPTION 'Credencial anterior nao encontrada no fundo, integracao e ambiente informados' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.credenciais_integracao (
    fundo_id, integracao_fundo_id, ambiente, nome, provider_key, capabilities,
    usuario_criptografado, senha_criptografada, chave_versao,
    status, criada_por, metadados
  ) VALUES (
    p_fundo_id, p_integracao_fundo_id, p_ambiente, trim(p_nome), v_provider, p_capabilities,
    p_usuario_criptografado, p_senha_criptografada, trim(p_chave_versao),
    'rascunho', (SELECT auth.uid()), jsonb_build_object('usuario_mascarado', p_usuario_mascarado)
  ) RETURNING id INTO v_id;

  PERFORM private.sa3_auditar(v_evento, p_fundo_id, 'credenciais_integracao', v_id, NULL,
    jsonb_build_object('integracao_fundo_id', p_integracao_fundo_id, 'ambiente', p_ambiente,
      'status', 'rascunho', 'credencial_anterior_id', p_credencial_anterior_id,
      'chave_versao', p_chave_versao), p_correlation_id);
  RETURN jsonb_build_object('id', v_id, 'integracao_id', p_integracao_fundo_id);
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
    IF NOT FOUND OR v_cred.status <> 'ativa' OR v_cred.revogada_em IS NOT NULL
      OR v_cred.ambiente <> p_ambiente OR v_cred.provider_key <> v_provider
      OR v_cred.credential_type <> 'usuario_senha'
      OR NOT (v_capabilities <@ v_cred.capabilities)
      OR v_adapter = 'vortx_vrs'
      OR (v_cred.integracao_fundo_id IS NOT NULL AND v_cred.integracao_fundo_id <> v_integracao_id)
    THEN RAISE EXCEPTION 'Credencial ativa compativel nao encontrada' USING ERRCODE = '23514'; END IF;
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
      AND c.status = 'ativa'
  ) THEN RAISE EXCEPTION 'Credencial ativa compativel nao encontrada' USING ERRCODE = '23514'; END IF;

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
        'id', i.id, 'provedor', i.provedor, 'provider_key', i.provider_key,
        'system_name', i.system_name, 'nome', i.nome, 'status', i.status,
        'created_at', i.created_at, 'updated_at', i.updated_at,
        'versoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'versao', v.versao, 'ambiente', v.ambiente,
            'status', v.status, 'adapter_key', v.adapter_key,
            'identificador_cliente', v.identificador_cliente,
            'codigo_originador', v.codigo_originador, 'endpoint_base', v.endpoint_base,
            'configuracao_nao_sensivel', v.configuracao_nao_sensivel,
            'credencial_integracao_id', v.credencial_integracao_id,
            'vigente_desde', v.vigente_desde, 'vigente_ate', v.vigente_ate,
            'publicada_em', v.publicada_em, 'created_at', v.created_at,
            'updated_at', v.updated_at,
            'capabilities', COALESCE((
              SELECT jsonb_agg(c.capability ORDER BY c.capability)
              FROM public.integracao_fundo_versao_capacidades c
              WHERE c.integracao_fundo_versao_id = v.id
            ), '[]'::jsonb),
            'active_capabilities', COALESCE((
              SELECT jsonb_agg(c.capability ORDER BY c.capability)
              FROM public.integracao_fundo_versao_capacidades c
              WHERE c.integracao_fundo_versao_id = v.id
                AND c.disponivel_desde IS NOT NULL
                AND c.disponivel_ate IS NULL
            ), '[]'::jsonb)
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
        'fundo_id', c.fundo_id, 'provider_key', c.provider_key,
        'credential_type', c.credential_type, 'capabilities', to_jsonb(c.capabilities),
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
          SELECT jsonb_agg(to_jsonb(v) ORDER BY v.versao DESC)
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
         LIMIT p_execucoes_limite OFFSET p_execucoes_offset
      ) e
    ), '[]'::jsonb)
  ) INTO v_resultado
  FROM public.fundos f WHERE f.id = p_fundo_id;
  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cadastrar_credencial_integracao(uuid,uuid,text,text,text,text,text,text,uuid,uuid,text,text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cadastrar_credencial_integracao(uuid,uuid,text,text,text,text,text,text,uuid,uuid,text,text[]) TO authenticated;
-- As demais funcoes mantem os ACLs existentes via CREATE OR REPLACE.
-- RLS e ausencia de grants diretos sobre ciphertext permanecem inalterados.
COMMIT;
