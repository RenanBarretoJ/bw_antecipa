-- Corrige a resolucao do SHA-256 no ciclo de tokens das integracoes de
-- transportadoras. Em homologacao, pgcrypto esta instalado no schema
-- extensions, enquanto as RPCs usam search_path restrito a public.
--
-- As migrations 20260824180000 e 20260824190000 ja foram aplicadas e nao
-- devem ser alteradas. Esta migration incremental qualifica explicitamente
-- extensions.digest(bytea, text) e preserva o mesmo SHA-256 UTF-8 usado pelo
-- resolver de Bearer token no servidor.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora(
  p_fundo_id uuid,
  p_provider text,
  p_nome text DEFAULT NULL,
  p_cnpj_transportadora text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_token text;
  v_hash text;
  v_display text;
  v_id uuid;
  v_cnpj_limpo text := NULLIF(regexp_replace(coalesce(p_cnpj_transportadora, ''), '\D', '', 'g'), '');
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_provider !~ '^[a-z0-9_-]{2,64}$' THEN
    RAISE EXCEPTION 'Provider invalido -- use apenas letras minusculas, digitos, hifen e underscore';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos WHERE id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado';
  END IF;

  v_token := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.gen_random_uuid()::text
          || pg_catalog.gen_random_uuid()::text
          || pg_catalog.clock_timestamp()::text,
        'UTF8'::name
      ),
      'sha256'::text
    ),
    'hex'::text
  );
  v_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_token, 'UTF8'::name),
      'sha256'::text
    ),
    'hex'::text
  );
  v_display := right(v_token, 4);

  INSERT INTO public.integracoes_transportadoras (fundo_id, provider, nome, cnpj_transportadora, created_by)
  VALUES (p_fundo_id, p_provider, p_nome, v_cnpj_limpo, actor_id)
  RETURNING id INTO v_id;

  INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, token_display, status, criado_por)
  VALUES (v_id, v_hash, v_display, 'ativo', actor_id);

  RETURN jsonb_build_object('integracao_id', v_id, 'token', v_token, 'token_display', v_display);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora(p_integracao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_token text;
  v_hash text;
  v_display text;
  v_old_id uuid;
  v_new_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integracoes_transportadoras WHERE id = p_integracao_id) THEN
    RAISE EXCEPTION 'Integracao nao encontrada';
  END IF;

  v_token := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.gen_random_uuid()::text
          || pg_catalog.gen_random_uuid()::text
          || pg_catalog.clock_timestamp()::text,
        'UTF8'::name
      ),
      'sha256'::text
    ),
    'hex'::text
  );
  v_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_token, 'UTF8'::name),
      'sha256'::text
    ),
    'hex'::text
  );
  v_display := right(v_token, 4);

  UPDATE public.integracoes_transportadoras_tokens
  SET status = 'substituido'
  WHERE integracao_id = p_integracao_id AND status = 'ativo'
  RETURNING id INTO v_old_id;

  INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, token_display, status, criado_por)
  VALUES (p_integracao_id, v_hash, v_display, 'ativo', actor_id)
  RETURNING id INTO v_new_id;

  IF v_old_id IS NOT NULL THEN
    UPDATE public.integracoes_transportadoras_tokens
    SET substituido_por = v_new_id
    WHERE id = v_old_id;
  END IF;

  RETURN jsonb_build_object('token', v_token, 'token_display', v_display);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) IS
  'Cria integracao de transportadora e emite token one-way SHA-256 usando pgcrypto qualificado.';
COMMENT ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) IS
  'Rotaciona token de integracao de transportadora usando pgcrypto qualificado e preserva o historico.';

COMMIT;
