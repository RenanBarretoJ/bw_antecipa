BEGIN;

-- P2: um novo Cedente somente nasce a partir de convite vinculado a um fundo.
-- A tabela criada na P1 continua suportando convites para Cedente existente.

ALTER TABLE public.cedentes
  ADD COLUMN IF NOT EXISTS onboarding_concluido_em timestamptz;

UPDATE public.cedentes
SET onboarding_concluido_em = COALESCE(onboarding_concluido_em, created_at)
WHERE onboarding_concluido_em IS NULL;

ALTER TABLE public.cedente_usuario_convites
  ALTER COLUMN cedente_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'USUARIO_CEDENTE_EXISTENTE',
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cnpj_normalizado text,
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS expirado_em timestamptz;

ALTER TABLE public.cedente_usuario_convites
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_token_hash_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_aceite_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_tipo_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_cnpj_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_contexto_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_ciclo_vida_check;

ALTER TABLE public.cedente_usuario_convites
  ADD CONSTRAINT cedente_usuario_convites_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT cedente_usuario_convites_tipo_check
    CHECK (tipo IN ('USUARIO_CEDENTE_EXISTENTE', 'NOVO_CEDENTE')),
  ADD CONSTRAINT cedente_usuario_convites_cnpj_check
    CHECK (cnpj_normalizado IS NULL OR cnpj_normalizado ~ '^[0-9]{14}$'),
  ADD CONSTRAINT cedente_usuario_convites_contexto_check CHECK (
    (tipo = 'USUARIO_CEDENTE_EXISTENTE' AND cedente_id IS NOT NULL)
    OR (
      tipo = 'NOVO_CEDENTE'
      AND fundo_id IS NOT NULL
      AND cnpj_normalizado IS NOT NULL
      AND perfil = 'ADMIN'
      AND (status <> 'ACEITO' OR cedente_id IS NOT NULL)
    )
  ),
  ADD CONSTRAINT cedente_usuario_convites_ciclo_vida_check CHECK (
    (status = 'PENDENTE'
      AND aceito_por_user_id IS NULL AND aceito_em IS NULL
      AND cancelado_em IS NULL AND expirado_em IS NULL)
    OR (status = 'ACEITO'
      AND aceito_por_user_id IS NOT NULL AND aceito_em IS NOT NULL
      AND cancelado_em IS NULL AND expirado_em IS NULL)
    OR (status = 'CANCELADO'
      AND aceito_por_user_id IS NULL AND aceito_em IS NULL
      AND cancelado_em IS NOT NULL AND expirado_em IS NULL)
    OR (status = 'EXPIRADO'
      AND aceito_por_user_id IS NULL AND aceito_em IS NULL
      AND cancelado_em IS NULL AND expirado_em IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS cedente_usuario_convites_fundo_status_idx
  ON public.cedente_usuario_convites (fundo_id, status, created_at DESC)
  WHERE fundo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cedente_usuario_convites_novo_cnpj_pendente_unique
  ON public.cedente_usuario_convites (cnpj_normalizado)
  WHERE tipo = 'NOVO_CEDENTE' AND status = 'PENDENTE';

CREATE UNIQUE INDEX IF NOT EXISTS cedente_usuario_convites_novo_email_pendente_unique
  ON public.cedente_usuario_convites (email_normalizado)
  WHERE tipo = 'NOVO_CEDENTE' AND status = 'PENDENTE';

COMMENT ON COLUMN public.cedentes.onboarding_concluido_em IS
  'Nulo somente enquanto o Cedente criado pelo aceite invite-first ainda nao concluiu o cadastro.';

COMMENT ON TABLE public.cedente_usuario_convites IS
  'Convites com token armazenado exclusivamente como SHA-256. Suporta acesso a Cedente existente e criacao invite-first de novo Cedente vinculado a fundo.';

CREATE OR REPLACE FUNCTION public.criar_convite_novo_cedente(
  p_fundo_id uuid,
  p_cnpj text,
  p_email text,
  p_token_hash text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_cnpj text := pg_catalog.regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_token_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));
  v_convite_id uuid;
  v_expires_at timestamptz := now() + interval '1 hour';
  v_fundo_nome text;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_usuario_id AND p.role::text = 'gestor' AND p.status::text = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Somente Gestor ativo pode convidar novo Cedente.' USING ERRCODE = '42501';
  END IF;

  IF p_fundo_id IS NULL OR NOT (SELECT private.usuario_pode_administrar_fundo_ativo(p_fundo_id)) THEN
    RAISE EXCEPTION 'Fundo inexistente, inativo ou nao autorizado.' USING ERRCODE = '42501';
  END IF;

  SELECT f.nome INTO v_fundo_nome FROM public.fundos f WHERE f.id = p_fundo_id AND f.ativo IS TRUE;

  IF NOT (SELECT private.cnpj_valido(v_cnpj)) THEN
    RAISE EXCEPTION 'CNPJ invalido.' USING ERRCODE = '22023';
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail invalido.' USING ERRCODE = '22023';
  END IF;

  IF v_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Hash do convite invalido.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novo-cedente-cnpj:' || v_cnpj));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novo-cedente-email:' || v_email));

  IF EXISTS (
    SELECT 1 FROM public.cedentes c
    WHERE pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g') = v_cnpj
  ) OR EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.cnpj = v_cnpj
  ) THEN
    RAISE EXCEPTION 'CNPJ ja pertence a um Cedente cadastrado.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cedente_usuario_convites ci
    WHERE ci.tipo = 'NOVO_CEDENTE'
      AND ci.status = 'PENDENTE'
      AND (ci.cnpj_normalizado = v_cnpj OR ci.email_normalizado = v_email)
  ) THEN
    RAISE EXCEPTION 'Ja existe convite pendente equivalente.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.cedente_usuario_convites (
    tipo, fundo_id, cedente_id, cnpj_normalizado, email_normalizado, perfil,
    token_hash, status, convidado_por, expires_at
  ) VALUES (
    'NOVO_CEDENTE', p_fundo_id, NULL, v_cnpj, v_email, 'ADMIN',
    v_token_hash, 'PENDENTE', v_usuario_id, v_expires_at
  )
  RETURNING id INTO v_convite_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_usuario_id, 'usuario', 'onboarding_cedentes', 'CONVITE_NOVO_CEDENTE_CRIADO',
    'cedente_usuario_convites', v_convite_id,
    jsonb_build_object(
      'fundo_id', p_fundo_id,
      'cnpj', v_cnpj,
      'email', v_email,
      'perfil', 'ADMIN',
      'expires_at', v_expires_at,
      'correlation_id', p_correlation_id
    )
  );

  RETURN jsonb_build_object(
    'convite_id', v_convite_id,
    'fundo_id', p_fundo_id,
    'fundo_nome', v_fundo_nome,
    'cnpj', v_cnpj,
    'email', v_email,
    'expires_at', v_expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_convite_novo_cedente(
  p_convite_id uuid,
  p_motivo text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_convite public.cedente_usuario_convites%ROWTYPE;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_convite
  FROM public.cedente_usuario_convites ci
  WHERE ci.id = p_convite_id AND ci.tipo = 'NOVO_CEDENTE'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelado', false, 'codigo', 'CONVITE_NAO_ENCONTRADO');
  END IF;

  IF v_convite.convidado_por IS DISTINCT FROM v_usuario_id
     OR NOT (SELECT private.usuario_pode_administrar_fundo_ativo(v_convite.fundo_id)) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao convite informado.' USING ERRCODE = '42501';
  END IF;

  IF v_convite.status <> 'PENDENTE' THEN
    RETURN jsonb_build_object('cancelado', false, 'codigo', 'CONVITE_NAO_PENDENTE');
  END IF;

  UPDATE public.cedente_usuario_convites
  SET status = 'CANCELADO', cancelado_em = now()
  WHERE id = v_convite.id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    v_usuario_id, 'usuario', 'onboarding_cedentes', 'CONVITE_NOVO_CEDENTE_CANCELADO',
    'cedente_usuario_convites', v_convite.id,
    jsonb_build_object('status', 'PENDENTE'),
    jsonb_build_object(
      'status', 'CANCELADO',
      'motivo', pg_catalog.left(coalesce(p_motivo, 'falha_no_envio'), 160),
      'correlation_id', p_correlation_id
    )
  );

  RETURN jsonb_build_object('cancelado', true, 'codigo', 'CONVITE_CANCELADO');
END;
$function$;

CREATE OR REPLACE FUNCTION public.aceitar_convite_novo_cedente(
  p_token_hash text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_email_autenticado text;
  v_token_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));
  v_convite public.cedente_usuario_convites%ROWTYPE;
  v_cedente_id uuid;
  v_cedente_fundo_id uuid;
  v_matriz_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;

  IF v_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'CONVITE_INVALIDO');
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO v_email_autenticado
  FROM auth.users u WHERE u.id = v_usuario_id;

  IF v_email_autenticado IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_usuario_id AND p.role::text = 'cedente' AND p.status::text = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Perfil autenticado nao pode aceitar convite de Cedente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_convite
  FROM public.cedente_usuario_convites ci
  WHERE ci.token_hash = v_token_hash AND ci.tipo = 'NOVO_CEDENTE'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'CONVITE_INVALIDO');
  END IF;

  IF v_convite.status <> 'PENDENTE' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'CONVITE_JA_UTILIZADO');
  END IF;

  IF v_convite.expires_at <= now() THEN
    UPDATE public.cedente_usuario_convites
    SET status = 'EXPIRADO', expirado_em = now()
    WHERE id = v_convite.id;

    INSERT INTO public.logs_auditoria (
      usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
    ) VALUES (
      v_usuario_id, 'usuario', 'convite_cedente', 'CONVITE_NOVO_CEDENTE_EXPIRADO',
      'cedente_usuario_convites', v_convite.id,
      jsonb_build_object('status', 'PENDENTE'),
      jsonb_build_object('status', 'EXPIRADO', 'correlation_id', p_correlation_id)
    );

    RETURN jsonb_build_object('ok', false, 'codigo', 'CONVITE_EXPIRADO');
  END IF;

  IF v_convite.email_normalizado IS DISTINCT FROM v_email_autenticado THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'CONVITE_EMAIL_DIVERGENTE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = v_convite.fundo_id AND f.ativo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'FUNDO_INDISPONIVEL');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novo-cedente-cnpj:' || v_convite.cnpj_normalizado));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('novo-cedente-user:' || v_usuario_id::text));

  IF (SELECT public.get_user_cedente_id()) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.cedentes c WHERE c.user_id = v_usuario_id) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'USUARIO_JA_VINCULADO');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cedentes c
    WHERE pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g') = v_convite.cnpj_normalizado
  ) OR EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.cnpj = v_convite.cnpj_normalizado
  ) THEN
    UPDATE public.cedente_usuario_convites
    SET status = 'CANCELADO', cancelado_em = now()
    WHERE id = v_convite.id;

    INSERT INTO public.logs_auditoria (
      usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
    ) VALUES (
      v_usuario_id, 'usuario', 'convite_cedente', 'CONVITE_NOVO_CEDENTE_CANCELADO',
      'cedente_usuario_convites', v_convite.id,
      jsonb_build_object('status', 'PENDENTE'),
      jsonb_build_object('status', 'CANCELADO', 'motivo', 'cnpj_ja_cadastrado', 'correlation_id', p_correlation_id)
    );

    RETURN jsonb_build_object('ok', false, 'codigo', 'CNPJ_JA_CADASTRADO');
  END IF;

  INSERT INTO public.cedentes (
    user_id, cnpj, razao_social, status, fundo_id, onboarding_concluido_em
  ) VALUES (
    v_usuario_id,
    v_convite.cnpj_normalizado,
    'Cadastro em andamento',
    'pendente'::public.cedente_status,
    v_convite.fundo_id,
    NULL
  ) RETURNING id INTO v_cedente_id;

  SELECT e.id INTO v_matriz_id
  FROM public.cedente_estabelecimentos e
  WHERE e.cedente_id = v_cedente_id AND e.tipo = 'matriz';

  IF v_matriz_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar a Matriz do Cedente.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.cedente_fundos (
    cedente_id, fundo_id, status, vigente_desde, observacoes
  ) VALUES (
    v_cedente_id, v_convite.fundo_id, 'ativo', now(), 'Criado pelo aceite invite-first'
  ) RETURNING id INTO v_cedente_fundo_id;

  INSERT INTO public.cedente_acessos (
    user_id, cedente_id, perfil, status, ativo, convidado_por, aceito_em
  ) VALUES (
    v_usuario_id, v_cedente_id, 'ADMIN', 'ATIVO', true, v_convite.convidado_por, now()
  );

  UPDATE public.cedente_usuario_convites
  SET cedente_id = v_cedente_id,
      status = 'ACEITO',
      aceito_por_user_id = v_usuario_id,
      aceito_em = now()
  WHERE id = v_convite.id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES
    (v_usuario_id, 'usuario', 'convite_cedente', 'CONVITE_NOVO_CEDENTE_ACEITO',
      'cedente_usuario_convites', v_convite.id,
      jsonb_build_object('cedente_id', v_cedente_id, 'fundo_id', v_convite.fundo_id, 'correlation_id', p_correlation_id)),
    (v_usuario_id, 'usuario', 'convite_cedente', 'CEDENTE_CRIADO_POR_CONVITE',
      'cedentes', v_cedente_id,
      jsonb_build_object('cnpj', v_convite.cnpj_normalizado, 'matriz_id', v_matriz_id, 'correlation_id', p_correlation_id)),
    (v_usuario_id, 'usuario', 'convite_cedente', 'CEDENTE_PRIMEIRO_FUNDO_VINCULADO',
      'cedente_fundos', v_cedente_fundo_id,
      jsonb_build_object('cedente_id', v_cedente_id, 'fundo_id', v_convite.fundo_id, 'correlation_id', p_correlation_id));

  RETURN jsonb_build_object(
    'ok', true,
    'codigo', 'CONVITE_ACEITO',
    'cedente_id', v_cedente_id,
    'matriz_id', v_matriz_id,
    'cedente_fundo_id', v_cedente_fundo_id
  );
END;
$function$;

-- O onboarding agora completa exclusivamente o Cedente criado pelo convite.
-- Nao existe mais INSERT de Cedente nesta funcao.
CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente(p_cadastro jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_papel text;
  v_status_perfil text;
  v_cedente public.cedentes%ROWTYPE;
  v_cnpj text;
  v_razao_social text;
  v_representante jsonb;
  v_indice bigint;
  v_chaves_invalidas text[];
  v_matriz_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.' USING ERRCODE = '42501';
  END IF;

  IF p_cadastro IS NULL OR jsonb_typeof(p_cadastro) <> 'object' THEN
    RAISE EXCEPTION 'Cadastro do cedente invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(chave ORDER BY chave) INTO v_chaves_invalidas
  FROM jsonb_object_keys(p_cadastro) AS chave
  WHERE chave <> ALL (ARRAY[
    'cnpj', 'razao_social', 'nome_fantasia', 'cep', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'estado', 'telefone_comercial',
    'email_comercial', 'cnae', 'banco', 'agencia', 'conta', 'tipo_conta',
    'representantes', 'banco_codigo', 'banco_ispb', 'banco_nome'
  ]::text[]);

  IF v_chaves_invalidas IS NOT NULL THEN
    RAISE EXCEPTION 'Campos nao permitidos no cadastro: %', array_to_string(v_chaves_invalidas, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role::text, p.status::text INTO v_papel, v_status_perfil
  FROM public.profiles p WHERE p.id = v_usuario_id;

  IF NOT FOUND OR v_status_perfil IS DISTINCT FROM 'ativo' OR v_papel IS DISTINCT FROM 'cedente' THEN
    RAISE EXCEPTION 'Somente usuario Cedente ativo pode concluir este cadastro.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('onboarding-cedente:' || v_usuario_id::text));

  SELECT c.* INTO v_cedente
  FROM public.cedentes c
  WHERE c.id = (SELECT public.get_user_cedente_id())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acesso por convite obrigatorio para iniciar o cadastro do Cedente.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cedente_acessos ca
    WHERE ca.user_id = v_usuario_id AND ca.cedente_id = v_cedente.id
      AND ca.perfil = 'ADMIN' AND ca.status = 'ATIVO' AND ca.ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'Somente o ADMIN inicial pode concluir o onboarding.' USING ERRCODE = '42501';
  END IF;

  v_cnpj := pg_catalog.regexp_replace(coalesce(p_cadastro->>'cnpj', ''), '[^0-9]', '', 'g');
  v_razao_social := pg_catalog.btrim(coalesce(p_cadastro->>'razao_social', ''));

  IF v_cnpj IS DISTINCT FROM pg_catalog.regexp_replace(v_cedente.cnpj, '[^0-9]', '', 'g') THEN
    RAISE EXCEPTION 'O CNPJ do cadastro deve ser o mesmo do convite.' USING ERRCODE = '22023';
  END IF;

  IF NOT (SELECT private.cnpj_valido(v_cnpj)) OR pg_catalog.length(v_razao_social) < 3 THEN
    RAISE EXCEPTION 'Dados principais do Cedente invalidos.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_cadastro->'representantes') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cadastro->'representantes') < 1 THEN
    RAISE EXCEPTION 'Informe pelo menos um representante legal.' USING ERRCODE = '22023';
  END IF;

  IF v_cedente.onboarding_concluido_em IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_cedente.id,
      'razao_social', v_cedente.razao_social,
      'criado', false,
      'idempotente', true
    );
  END IF;

  UPDATE public.cedentes SET
    razao_social = v_razao_social,
    nome_fantasia = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'nome_fantasia', '')), ''),
    cep = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cep', '')), ''),
    logradouro = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'logradouro', '')), ''),
    numero = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'numero', '')), ''),
    complemento = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'complemento', '')), ''),
    bairro = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'bairro', '')), ''),
    cidade = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cidade', '')), ''),
    estado = nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_cadastro->>'estado', ''))), ''),
    telefone_comercial = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'telefone_comercial', '')), ''),
    email_comercial = nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_cadastro->>'email_comercial', ''))), ''),
    cnae = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cnae', '')), ''),
    banco = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco', '')), ''),
    agencia = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'agencia', '')), ''),
    conta = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'conta', '')), ''),
    tipo_conta = (p_cadastro->>'tipo_conta')::public.tipo_conta_bancaria,
    banco_codigo = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_codigo', '')), ''),
    banco_ispb = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_ispb', '')), ''),
    banco_nome = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_nome', '')), ''),
    onboarding_concluido_em = now()
  WHERE id = v_cedente.id;

  FOR v_representante, v_indice IN
    SELECT elemento, ordinalidade
    FROM jsonb_array_elements(p_cadastro->'representantes')
      WITH ORDINALITY AS item(elemento, ordinalidade)
  LOOP
    IF jsonb_typeof(v_representante) <> 'object'
       OR pg_catalog.length(pg_catalog.btrim(coalesce(v_representante->>'nome', ''))) < 3
       OR NOT (SELECT private.cpf_valido(v_representante->>'cpf'))
       OR pg_catalog.btrim(coalesce(v_representante->>'rg', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'cargo', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'email', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'telefone', '')) = '' THEN
      RAISE EXCEPTION 'Representante legal invalido na posicao %.', v_indice USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.representantes (cedente_id, nome, cpf, rg, cargo, email, telefone, principal)
    VALUES (
      v_cedente.id,
      pg_catalog.btrim(v_representante->>'nome'),
      pg_catalog.regexp_replace(v_representante->>'cpf', '[^0-9]', '', 'g'),
      pg_catalog.btrim(v_representante->>'rg'),
      pg_catalog.btrim(v_representante->>'cargo'),
      pg_catalog.lower(pg_catalog.btrim(v_representante->>'email')),
      pg_catalog.btrim(v_representante->>'telefone'),
      v_indice = 1
    );
  END LOOP;

  SELECT e.id INTO v_matriz_id
  FROM public.cedente_estabelecimentos e
  WHERE e.cedente_id = v_cedente.id AND e.tipo = 'matriz';

  IF nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco', '')), '') IS NOT NULL
     AND nullif(pg_catalog.btrim(coalesce(p_cadastro->>'agencia', '')), '') IS NOT NULL
     AND nullif(pg_catalog.btrim(coalesce(p_cadastro->>'conta', '')), '') IS NOT NULL THEN
    INSERT INTO public.cedente_estabelecimento_contas_bancarias (
      estabelecimento_id, banco, agencia, conta, tipo_conta, principal, ativo, criado_por
    ) VALUES (
      v_matriz_id,
      pg_catalog.btrim(p_cadastro->>'banco'),
      pg_catalog.btrim(p_cadastro->>'agencia'),
      pg_catalog.btrim(p_cadastro->>'conta'),
      p_cadastro->>'tipo_conta',
      true,
      true,
      v_usuario_id
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_cedente.id,
    'razao_social', v_razao_social,
    'criado', true,
    'idempotente', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_convite_novo_cedente(uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_convite_novo_cedente(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aceitar_convite_novo_cedente(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.criar_convite_novo_cedente(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_convite_novo_cedente(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_novo_cedente(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente(jsonb) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.cedentes, public.representantes,
  public.cedente_fundos, public.cedente_acessos, public.cedente_usuario_convites
  FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
