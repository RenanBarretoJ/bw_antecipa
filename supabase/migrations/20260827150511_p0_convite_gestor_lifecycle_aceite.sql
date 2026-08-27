BEGIN;

-- O Auth precisa precriar auth.users/profiles para emitir o token de invite,
-- mas nenhum acesso operacional pode existir antes do aceite humano. O estado
-- pendente e os fundos pretendidos ficam em schema privado, fora da Data API.
CREATE TABLE private.gestor_usuario_convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_normalizado text NOT NULL,
  nome_completo text NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE',
  convidado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  aceito_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gestor_usuario_convites_usuario_unique UNIQUE (usuario_id),
  CONSTRAINT gestor_usuario_convites_email_check CHECK (
    email_normalizado = lower(pg_catalog.btrim(email_normalizado))
    AND pg_catalog.strpos(email_normalizado, '@') > 1
  ),
  CONSTRAINT gestor_usuario_convites_nome_check CHECK (
    pg_catalog.char_length(pg_catalog.btrim(nome_completo)) BETWEEN 2 AND 160
  ),
  CONSTRAINT gestor_usuario_convites_status_check CHECK (
    status IN ('PENDENTE', 'ACEITO', 'EXPIRADO', 'CANCELADO')
  ),
  CONSTRAINT gestor_usuario_convites_ciclo_vida_check CHECK (
    (status = 'ACEITO' AND aceito_em IS NOT NULL)
    OR (status <> 'ACEITO' AND aceito_em IS NULL)
  )
);

CREATE TABLE private.gestor_usuario_convite_fundos (
  convite_id uuid NOT NULL REFERENCES private.gestor_usuario_convites(id) ON DELETE CASCADE,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (convite_id, fundo_id)
);

CREATE INDEX gestor_usuario_convites_status_expiracao_idx
  ON private.gestor_usuario_convites (status, expires_at);

ALTER TABLE private.gestor_usuario_convites ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.gestor_usuario_convite_fundos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.gestor_usuario_convites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.gestor_usuario_convite_fundos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_preparar_convite_gestor(
  p_usuario_id uuid,
  p_nome text,
  p_fundo_ids uuid[],
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
  v_convite_id uuid;
  v_fundo_ids uuid[];
  v_fundos jsonb;
  v_email text;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_usuario_id IS NULL
     OR p_correlation_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(p_nome, ''))) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Dados do convite invalidos' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT item ORDER BY item), ARRAY[]::uuid[])
    INTO v_fundo_ids
    FROM pg_catalog.unnest(COALESCE(p_fundo_ids, ARRAY[]::uuid[])) AS requested(item);
  IF pg_catalog.cardinality(v_fundo_ids) <> pg_catalog.cardinality(COALESCE(p_fundo_ids, ARRAY[]::uuid[]))
     OR pg_catalog.cardinality(v_fundo_ids) > 100 THEN
    RAISE EXCEPTION 'Fundos do convite invalidos' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_perfil
    FROM public.profiles p
   WHERE p.id = p_usuario_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_perfil.role::text <> 'gestor'
     OR v_perfil.senha_alterada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Perfil criado pelo convite nao esta no estado esperado' USING ERRCODE = '22023';
  END IF;

  SELECT lower(u.email)
    INTO v_email
    FROM auth.users u
   WHERE u.id = p_usuario_id;
  IF v_email IS NULL OR v_email IS DISTINCT FROM lower(v_perfil.email) THEN
    RAISE EXCEPTION 'Identidade Auth do convite divergente' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(v_fundo_ids) solicitado(fundo_id)
      LEFT JOIN public.fundos f ON f.id = solicitado.fundo_id AND f.ativo IS TRUE
     WHERE f.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fundo do convite nao encontrado ou inativo' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET nome_completo = pg_catalog.btrim(p_nome),
         status = 'inativo'::public.user_status
   WHERE id = p_usuario_id;

  INSERT INTO private.gestor_usuario_convites (
    usuario_id, email_normalizado, nome_completo, status,
    convidado_por, correlation_id, expires_at
  ) VALUES (
    p_usuario_id, v_email, pg_catalog.btrim(p_nome), 'PENDENTE',
    (SELECT auth.uid()), p_correlation_id, now() + interval '1 hour'
  )
  RETURNING id INTO v_convite_id;

  INSERT INTO private.gestor_usuario_convite_fundos (convite_id, fundo_id)
  SELECT v_convite_id, item FROM pg_catalog.unnest(v_fundo_ids) AS requested(item);

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', f.id, 'nome', f.nome)
      ORDER BY f.nome, f.id
    ),
    '[]'::jsonb
  )
    INTO v_fundos
    FROM public.fundos f
   WHERE f.id = ANY(v_fundo_ids);

  PERFORM private.registrar_auditoria_usuario(
    'CONVITE_GESTOR_CRIADO', p_usuario_id, NULL, NULL,
    pg_catalog.jsonb_build_object(
      'status', 'PENDENTE',
      'fundo_ids', to_jsonb(v_fundo_ids),
      'expires_at', now() + interval '1 hour'
    ),
    p_correlation_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'convite_id', v_convite_id,
    'status', 'PENDENTE',
    'fundos', v_fundos
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_consultar_convite_gestor(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_convite private.gestor_usuario_convites%ROWTYPE;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_convite
    FROM private.gestor_usuario_convites c
   WHERE c.usuario_id = p_usuario_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'id', v_convite.id,
    'status', CASE
      WHEN v_convite.status = 'PENDENTE' AND v_convite.expires_at <= now() THEN 'EXPIRADO'
      ELSE v_convite.status
    END,
    'expires_at', v_convite.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consultar_convite_gestor_atual()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usuario_id uuid := (SELECT auth.uid());
  v_convite private.gestor_usuario_convites%ROWTYPE;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_convite
    FROM private.gestor_usuario_convites c
   WHERE c.usuario_id = v_usuario_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'id', v_convite.id,
    'status', CASE
      WHEN v_convite.status = 'PENDENTE' AND v_convite.expires_at <= now() THEN 'EXPIRADO'
      ELSE v_convite.status
    END,
    'expires_at', v_convite.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aceitar_convite_gestor(p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usuario_id uuid := (SELECT auth.uid());
  v_convite private.gestor_usuario_convites%ROWTYPE;
  v_perfil public.profiles%ROWTYPE;
  v_fundo_id uuid;
  v_vinculo public.usuario_fundos%ROWTYPE;
  v_antes jsonb;
BEGIN
  IF v_usuario_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de aceite invalido' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_convite
    FROM private.gestor_usuario_convites c
   WHERE c.usuario_id = v_usuario_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'CONVITE_GESTOR_INVALIDO');
  END IF;
  IF v_convite.status = 'ACEITO' THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'CONVITE_GESTOR_JA_ACEITO');
  END IF;
  IF v_convite.status = 'CANCELADO' THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'CONVITE_GESTOR_CANCELADO');
  END IF;
  IF v_convite.status = 'EXPIRADO' OR v_convite.expires_at <= now() THEN
    UPDATE private.gestor_usuario_convites
       SET status = 'EXPIRADO', updated_at = now()
     WHERE id = v_convite.id;
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'CONVITE_GESTOR_EXPIRADO');
  END IF;

  SELECT * INTO v_perfil
    FROM public.profiles p
   WHERE p.id = v_usuario_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_perfil.role::text <> 'gestor'
     OR v_perfil.status::text <> 'inativo'
     OR v_perfil.senha_alterada_em IS NOT NULL
     OR lower(v_perfil.email) IS DISTINCT FROM v_convite.email_normalizado THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'PROFILE_INVALID');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM private.gestor_usuario_convite_fundos cf
      LEFT JOIN public.fundos f ON f.id = cf.fundo_id AND f.ativo IS TRUE
     WHERE cf.convite_id = v_convite.id
       AND f.id IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'FUNDO_INDISPONIVEL');
  END IF;

  FOR v_fundo_id IN
    SELECT cf.fundo_id
      FROM private.gestor_usuario_convite_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id AND f.ativo IS TRUE
     WHERE cf.convite_id = v_convite.id
     ORDER BY cf.fundo_id
  LOOP
    SELECT to_jsonb(uf) INTO v_antes
      FROM public.usuario_fundos uf
     WHERE uf.usuario_id = v_usuario_id AND uf.fundo_id = v_fundo_id
     FOR UPDATE;

    INSERT INTO public.usuario_fundos (usuario_id, fundo_id, perfil_no_fundo, status, principal)
    VALUES (v_usuario_id, v_fundo_id, 'gestor', 'ativo', false)
    ON CONFLICT (usuario_id, fundo_id) DO UPDATE
      SET perfil_no_fundo = 'gestor', status = 'ativo'
    RETURNING * INTO v_vinculo;

    PERFORM private.registrar_auditoria_usuario(
      CASE WHEN v_antes IS NULL THEN 'GESTOR_VINCULADO_FUNDO' ELSE 'GESTOR_VINCULO_REATIVADO' END,
      v_usuario_id, v_fundo_id, v_antes, to_jsonb(v_vinculo), p_correlation_id
    );
  END LOOP;

  UPDATE public.profiles
     SET nome_completo = v_convite.nome_completo,
         status = 'ativo'::public.user_status,
         senha_alterada_em = now()
   WHERE id = v_usuario_id;

  UPDATE private.gestor_usuario_convites
     SET status = 'ACEITO', aceito_em = now(), updated_at = now()
   WHERE id = v_convite.id;

  PERFORM private.registrar_auditoria_usuario(
    'CONVITE_GESTOR_ACEITO', v_usuario_id, NULL,
    pg_catalog.jsonb_build_object('status', 'PENDENTE'),
    pg_catalog.jsonb_build_object('status', 'ACEITO'),
    p_correlation_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'code', 'CONVITE_GESTOR_ACEITO',
    'usuario_id', v_usuario_id
  );
END;
$$;

-- Compatibilidade controlada: captura somente usuarios Auth convidados que
-- nunca confirmaram nem iniciaram sessao e ainda nao definiram senha no portal.
WITH candidatos AS (
  SELECT
    u.id AS usuario_id,
    lower(u.email) AS email_normalizado,
    p.nome_completo,
    u.invited_at,
    CASE WHEN u.invited_at + interval '1 hour' <= now() THEN 'EXPIRADO' ELSE 'PENDENTE' END AS status
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE u.invited_at IS NOT NULL
    AND u.confirmed_at IS NULL
    AND u.last_sign_in_at IS NULL
    AND p.role::text = 'gestor'
    AND p.senha_alterada_em IS NULL
), convites AS (
  INSERT INTO private.gestor_usuario_convites (
    usuario_id, email_normalizado, nome_completo, status,
    convidado_por, correlation_id, expires_at
  )
  SELECT
    c.usuario_id, c.email_normalizado, c.nome_completo, c.status,
    NULL, gen_random_uuid(), c.invited_at + interval '1 hour'
  FROM candidatos c
  ON CONFLICT (usuario_id) DO NOTHING
  RETURNING id, usuario_id
)
INSERT INTO private.gestor_usuario_convite_fundos (convite_id, fundo_id)
SELECT c.id, uf.fundo_id
FROM convites c
JOIN public.usuario_fundos uf ON uf.usuario_id = c.usuario_id
ON CONFLICT DO NOTHING;

UPDATE public.usuario_fundos uf
   SET status = 'suspenso', principal = false
 WHERE EXISTS (
   SELECT 1 FROM private.gestor_usuario_convites c
   WHERE c.usuario_id = uf.usuario_id AND c.aceito_em IS NULL
 );

UPDATE public.profiles p
   SET status = 'inativo'::public.user_status
 WHERE EXISTS (
   SELECT 1 FROM private.gestor_usuario_convites c
   WHERE c.usuario_id = p.id AND c.aceito_em IS NULL
 );

REVOKE ALL ON FUNCTION public.admin_preparar_convite_gestor(uuid, text, uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_consultar_convite_gestor(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_convite_gestor_atual() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aceitar_convite_gestor(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_preparar_convite_gestor(uuid, text, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_consultar_convite_gestor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_convite_gestor_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_gestor(uuid) TO authenticated;

COMMENT ON TABLE private.gestor_usuario_convites IS
  'Estado privado do convite Gestor; nenhum acesso operacional e concedido antes do aceite humano.';
COMMENT ON FUNCTION public.aceitar_convite_gestor(uuid) IS
  'Ativa atomicamente o profile e os fundos exatos do convite Gestor autenticado.';

COMMIT;
