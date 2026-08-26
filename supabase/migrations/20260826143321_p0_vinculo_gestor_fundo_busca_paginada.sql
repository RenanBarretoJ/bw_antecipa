-- P0: vinculo Gestor <-> Fundo com listagens atuais e busca paginada.
--
-- As funcoes de mutacao do SA2 permanecem como fonte de verdade para TOTP,
-- idempotencia e auditoria. Esta migration altera somente as consultas.

CREATE OR REPLACE FUNCTION public.admin_listar_fundos_usuario(p_usuario_id uuid)
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

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_usuario_id
       AND p.role::text = 'gestor'
  ) THEN
    RAISE EXCEPTION 'Gestor nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'fundo_id', f.id,
    'fundo_nome', f.nome,
    'fundo_cnpj', f.cnpj,
    'fundo_ativo', f.ativo,
    'vinculo_id', uf.id,
    'vinculo_status', uf.status,
    'principal', uf.principal,
    'updated_at', uf.updated_at
  ) ORDER BY f.nome, f.id), '[]'::jsonb)
  INTO v_resultado
  FROM public.usuario_fundos uf
  JOIN public.fundos f ON f.id = uf.fundo_id
  WHERE uf.usuario_id = p_usuario_id
    AND uf.status = 'ativo';

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_gestores_fundo(p_fundo_id uuid)
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'usuario_id', p.id,
    'nome_completo', p.nome_completo,
    'email', p.email,
    'usuario_status', p.status,
    'super_admin', EXISTS (
      SELECT 1
        FROM public.usuario_papeis up
       WHERE up.usuario_id = p.id
         AND up.papel::text = 'super_admin'
         AND up.ativo IS TRUE
    ),
    'vinculo_id', uf.id,
    'vinculo_status', uf.status,
    'updated_at', uf.updated_at
  ) ORDER BY p.nome_completo, p.id), '[]'::jsonb)
  INTO v_resultado
  FROM public.usuario_fundos uf
  JOIN public.profiles p ON p.id = uf.usuario_id
  WHERE uf.fundo_id = p_fundo_id
    AND uf.status = 'ativo'
    AND p.role::text = 'gestor';

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_buscar_gestores_para_fundo(
  p_fundo_id uuid,
  p_busca text,
  p_pagina integer DEFAULT 1,
  p_por_pagina integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_busca text := lower(trim(COALESCE(p_busca, '')));
  v_total bigint := 0;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_pagina < 1 OR p_por_pagina <> 20 OR length(v_busca) < 2 OR length(v_busca) > 120 THEN
    IF length(v_busca) < 2 THEN
      RETURN jsonb_build_object('itens', '[]'::jsonb, 'total', 0, 'pagina', 1, 'por_pagina', 20, 'total_paginas', 0);
    END IF;
    RAISE EXCEPTION 'Parametros de busca invalidos' USING ERRCODE = '22023';
  END IF;

  WITH elegiveis AS (
    SELECT
      p.id,
      p.nome_completo,
      p.email,
      p.status::text AS entidade_status,
      uf.status AS vinculo_status
    FROM public.profiles p
    LEFT JOIN public.usuario_fundos uf
      ON uf.usuario_id = p.id
     AND uf.fundo_id = p_fundo_id
    WHERE p.role::text = 'gestor'
      AND COALESCE(uf.status, '') <> 'ativo'
      AND (
        lower(p.nome_completo) LIKE '%' || v_busca || '%'
        OR lower(p.email) LIKE '%' || v_busca || '%'
      )
  )
  SELECT count(*) INTO v_total FROM elegiveis;

  WITH elegiveis AS (
    SELECT
      p.id,
      p.nome_completo,
      p.email,
      p.status::text AS entidade_status,
      uf.status AS vinculo_status
    FROM public.profiles p
    LEFT JOIN public.usuario_fundos uf
      ON uf.usuario_id = p.id
     AND uf.fundo_id = p_fundo_id
    WHERE p.role::text = 'gestor'
      AND COALESCE(uf.status, '') <> 'ativo'
      AND (
        lower(p.nome_completo) LIKE '%' || v_busca || '%'
        OR lower(p.email) LIKE '%' || v_busca || '%'
      )
    ORDER BY (p.status::text = 'ativo') DESC, p.nome_completo, p.id
    LIMIT p_por_pagina
    OFFSET (p_pagina - 1) * p_por_pagina
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'nome', e.nome_completo,
    'descricao', e.email,
    'entidade_status', e.entidade_status,
    'vinculo_status', e.vinculo_status
  ) ORDER BY (e.entidade_status = 'ativo') DESC, e.nome_completo, e.id), '[]'::jsonb)
  INTO v_itens
  FROM elegiveis e;

  RETURN jsonb_build_object(
    'itens', v_itens,
    'total', v_total,
    'pagina', p_pagina,
    'por_pagina', p_por_pagina,
    'total_paginas', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_por_pagina)::integer END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_buscar_fundos_para_gestor(
  p_usuario_id uuid,
  p_busca text,
  p_pagina integer DEFAULT 1,
  p_por_pagina integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_busca text := lower(trim(COALESCE(p_busca, '')));
  v_busca_digitos text := regexp_replace(COALESCE(p_busca, ''), '[^0-9]', '', 'g');
  v_total bigint := 0;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_usuario_id
       AND p.role::text = 'gestor'
  ) THEN
    RAISE EXCEPTION 'Gestor nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_pagina < 1 OR p_por_pagina <> 20 OR length(v_busca) < 2 OR length(v_busca) > 120 THEN
    IF length(v_busca) < 2 THEN
      RETURN jsonb_build_object('itens', '[]'::jsonb, 'total', 0, 'pagina', 1, 'por_pagina', 20, 'total_paginas', 0);
    END IF;
    RAISE EXCEPTION 'Parametros de busca invalidos' USING ERRCODE = '22023';
  END IF;

  WITH elegiveis AS (
    SELECT
      f.id,
      f.nome,
      f.cnpj,
      f.ativo AS entidade_ativa,
      uf.status AS vinculo_status
    FROM public.fundos f
    LEFT JOIN public.usuario_fundos uf
      ON uf.fundo_id = f.id
     AND uf.usuario_id = p_usuario_id
    WHERE COALESCE(uf.status, '') <> 'ativo'
      AND (
        lower(f.nome) LIKE '%' || v_busca || '%'
        OR (v_busca_digitos <> '' AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') LIKE '%' || v_busca_digitos || '%')
      )
  )
  SELECT count(*) INTO v_total FROM elegiveis;

  WITH elegiveis AS (
    SELECT
      f.id,
      f.nome,
      f.cnpj,
      f.ativo AS entidade_ativa,
      uf.status AS vinculo_status
    FROM public.fundos f
    LEFT JOIN public.usuario_fundos uf
      ON uf.fundo_id = f.id
     AND uf.usuario_id = p_usuario_id
    WHERE COALESCE(uf.status, '') <> 'ativo'
      AND (
        lower(f.nome) LIKE '%' || v_busca || '%'
        OR (v_busca_digitos <> '' AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') LIKE '%' || v_busca_digitos || '%')
      )
    ORDER BY f.ativo DESC, f.nome, f.id
    LIMIT p_por_pagina
    OFFSET (p_pagina - 1) * p_por_pagina
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'nome', e.nome,
    'descricao', e.cnpj,
    'entidade_status', CASE WHEN e.entidade_ativa THEN 'ativo' ELSE 'inativo' END,
    'vinculo_status', e.vinculo_status
  ) ORDER BY e.entidade_ativa DESC, e.nome, e.id), '[]'::jsonb)
  INTO v_itens
  FROM elegiveis e;

  RETURN jsonb_build_object(
    'itens', v_itens,
    'total', v_total,
    'pagina', p_pagina,
    'por_pagina', p_por_pagina,
    'total_paginas', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_por_pagina)::integer END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_buscar_gestores_para_fundo(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_buscar_fundos_para_gestor(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_buscar_gestores_para_fundo(uuid, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_buscar_fundos_para_gestor(uuid, text, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_buscar_gestores_para_fundo(uuid, text, integer, integer)
  IS 'Busca paginada de gestores elegiveis a vinculo, excluindo vinculos ativos.';
COMMENT ON FUNCTION public.admin_buscar_fundos_para_gestor(uuid, text, integer, integer)
  IS 'Busca paginada de fundos elegiveis a vinculo, excluindo vinculos ativos.';
