BEGIN;

-- Mantem a criacao transacional existente e apenas fecha o lifecycle dos
-- convites expirados antes da verificacao de duplicidade. O lookup no Auth
-- permanece no adaptador server-only, pois auth.users nao deve ser exposta.
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
  v_convite_expirado record;
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

  SELECT f.nome INTO v_fundo_nome
  FROM public.fundos f
  WHERE f.id = p_fundo_id AND f.ativo IS TRUE;

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

  FOR v_convite_expirado IN
    UPDATE public.cedente_usuario_convites ci
    SET status = 'EXPIRADO', expirado_em = now()
    WHERE ci.tipo = 'NOVO_CEDENTE'
      AND ci.status = 'PENDENTE'
      AND ci.expires_at <= now()
      AND (ci.cnpj_normalizado = v_cnpj OR ci.email_normalizado = v_email)
    RETURNING ci.id, ci.fundo_id, ci.cnpj_normalizado, ci.email_normalizado
  LOOP
    INSERT INTO public.logs_auditoria (
      usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id,
      dados_antes, dados_depois
    ) VALUES (
      v_usuario_id,
      'usuario',
      'onboarding_cedentes',
      'CONVITE_NOVO_CEDENTE_EXPIRADO',
      'cedente_usuario_convites',
      v_convite_expirado.id,
      jsonb_build_object('status', 'PENDENTE'),
      jsonb_build_object(
        'status', 'EXPIRADO',
        'motivo', 'lifecycle_retry',
        'fundo_id', v_convite_expirado.fundo_id,
        'correlation_id', p_correlation_id
      )
    );
  END LOOP;

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

REVOKE ALL ON FUNCTION public.criar_convite_novo_cedente(uuid, text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_convite_novo_cedente(uuid, text, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.criar_convite_novo_cedente(uuid, text, text, text, uuid) IS
  'Cria convite invite-first para novo Cedente e expira equivalentes vencidos antes de bloquear duplicidade.';

COMMIT;
