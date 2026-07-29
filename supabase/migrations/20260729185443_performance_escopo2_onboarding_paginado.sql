-- Escopo 2 da rota de performance: onboarding de cedentes.
--
-- A funcao devolve somente o contrato compacto da pagina, com filtros,
-- ordenacao, contagem e paginacao executados no PostgreSQL. Ela e
-- SECURITY INVOKER e valida explicitamente o fundo autorizado do gestor.

CREATE OR REPLACE FUNCTION public.listar_onboarding_cedentes_paginado(
  p_fundo_id uuid,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10,
  p_busca text DEFAULT NULL,
  p_etapa text DEFAULT 'pendencias',
  p_status_cadastral text DEFAULT NULL,
  p_politica_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'created_at',
  p_direction text DEFAULT 'asc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := CASE
    WHEN p_page_size IN (10, 20, 40) THEN p_page_size
    ELSE 10
  END;
  v_busca text := nullif(trim(coalesce(p_busca, '')), '');
  v_etapa text := CASE
    WHEN p_etapa IN ('pendencias', 'sem_fundo', 'sem_politica', 'aptos', 'suspensos', 'todos')
      THEN p_etapa
    ELSE 'pendencias'
  END;
  v_sort text := CASE
    WHEN p_sort IN ('created_at', 'updated_at', 'razao_social') THEN p_sort
    ELSE 'created_at'
  END;
  v_direction text := CASE WHEN lower(p_direction) = 'desc' THEN 'desc' ELSE 'asc' END;
  v_offset integer;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR public.get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Acesso restrito ao gestor autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF p_fundo_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.usuario_fundos uf
    JOIN public.fundos f ON f.id = uf.fundo_id
    WHERE uf.usuario_id = v_user_id
      AND uf.fundo_id = p_fundo_id
      AND uf.status = 'ativo'
      AND coalesce(f.ativo, true) IS TRUE
  ) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o usuario'
      USING ERRCODE = '42501';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  WITH base AS (
    SELECT
      c.id,
      c.razao_social,
      c.nome_fantasia,
      c.cnpj,
      c.status::text AS status_cadastral,
      c.created_at,
      c.updated_at,
      cf.id AS cedente_fundo_id,
      cf.status::text AS vinculo_status,
      cf.vigente_desde,
      cf.vigente_ate,
      f.id AS fundo_id,
      f.nome AS fundo_nome,
      f.cnpj AS fundo_cnpj,
      politica.id AS politica_id,
      politica.nome AS politica_nome,
      politica.codigo AS politica_codigo,
      politica.versao_id,
      politica.numero_versao,
      politica.publicada_em,
      coalesce(politica.requisito_count, 0)::integer AS requisito_count,
      CASE
        WHEN cf.id IS NULL THEN 'aguardando_vinculo_fundo'
        WHEN cf.status = 'suspenso' THEN 'suspenso'
        WHEN cf.status = 'ativo' AND politica.id IS NOT NULL THEN 'apto_operar'
        ELSE 'aguardando_politica'
      END AS onboarding_status
    FROM public.cedentes c
    LEFT JOIN LATERAL (
      SELECT vinculo.*
      FROM public.cedente_fundos vinculo
      WHERE vinculo.cedente_id = c.id
        AND vinculo.fundo_id = p_fundo_id
        AND vinculo.status IN ('ativo', 'suspenso')
        AND (vinculo.vigente_ate IS NULL OR vinculo.vigente_ate > now())
      ORDER BY
        CASE WHEN vinculo.status = 'ativo' THEN 0 ELSE 1 END,
        vinculo.vigente_desde DESC,
        vinculo.id DESC
      LIMIT 1
    ) cf ON true
    LEFT JOIN public.fundos f ON f.id = cf.fundo_id
    LEFT JOIN LATERAL (
      SELECT
        po.id,
        po.nome,
        po.codigo,
        pov.id AS versao_id,
        pov.versao AS numero_versao,
        pov.publicada_em,
        (
          SELECT count(*)
          FROM public.politica_requisitos_documentais pr
          WHERE pr.politica_operacional_versao_id = pov.id
            AND pr.ativo IS TRUE
        ) AS requisito_count
      FROM public.cedente_fundo_politicas cfp
      JOIN public.politicas_operacionais po
        ON po.id = cfp.politica_operacional_id
       AND po.fundo_id = p_fundo_id
       AND po.status = 'ativa'
      JOIN LATERAL (
        SELECT versao.id, versao.versao, versao.publicada_em
        FROM public.politica_operacional_versoes versao
        WHERE versao.politica_operacional_id = po.id
          AND versao.fundo_id = p_fundo_id
          AND versao.status = 'publicada'
          AND versao.publicada_em IS NOT NULL
          AND versao.vigente_desde <= now()
          AND (versao.vigente_ate IS NULL OR versao.vigente_ate > now())
        ORDER BY versao.versao DESC, versao.id DESC
        LIMIT 1
      ) pov ON true
      WHERE cfp.cedente_fundo_id = cf.id
        AND cfp.status = 'ativa'
        AND cfp.vigente_desde <= now()
        AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      ORDER BY cfp.vigente_desde DESC, cfp.id DESC
      LIMIT 1
    ) politica ON cf.status = 'ativo'
    WHERE cf.id IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.cedente_fundos qualquer_vinculo
         WHERE qualquer_vinculo.cedente_id = c.id
           AND qualquer_vinculo.status IN ('ativo', 'suspenso')
           AND (qualquer_vinculo.vigente_ate IS NULL OR qualquer_vinculo.vigente_ate > now())
       )
  ),
  contagens AS (
    SELECT
      count(*) FILTER (WHERE onboarding_status IN ('aguardando_vinculo_fundo', 'aguardando_politica'))::integer AS pendencias,
      count(*) FILTER (WHERE onboarding_status = 'aguardando_vinculo_fundo')::integer AS sem_fundo,
      count(*) FILTER (WHERE onboarding_status = 'aguardando_politica')::integer AS sem_politica,
      count(*) FILTER (WHERE onboarding_status = 'apto_operar')::integer AS aptos,
      count(*) FILTER (WHERE onboarding_status = 'suspenso')::integer AS suspensos,
      count(*)::integer AS todos
    FROM base
  ),
  filtrados AS (
    SELECT *
    FROM base
    WHERE (
      v_etapa = 'todos'
      OR (v_etapa = 'pendencias' AND onboarding_status IN ('aguardando_vinculo_fundo', 'aguardando_politica'))
      OR (v_etapa = 'sem_fundo' AND onboarding_status = 'aguardando_vinculo_fundo')
      OR (v_etapa = 'sem_politica' AND onboarding_status = 'aguardando_politica')
      OR (v_etapa = 'aptos' AND onboarding_status = 'apto_operar')
      OR (v_etapa = 'suspensos' AND onboarding_status = 'suspenso')
    )
      AND (p_status_cadastral IS NULL OR status_cadastral = p_status_cadastral)
      AND (p_politica_id IS NULL OR politica_id = p_politica_id)
      AND (
        v_busca IS NULL
        OR razao_social ILIKE '%' || v_busca || '%'
        OR coalesce(nome_fantasia, '') ILIKE '%' || v_busca || '%'
        OR (
          regexp_replace(v_busca, '\D', '', 'g') <> ''
          AND regexp_replace(cnpj, '\D', '', 'g') LIKE '%' || regexp_replace(v_busca, '\D', '', 'g') || '%'
        )
      )
  ),
  total_filtrado AS (
    SELECT count(*)::integer AS total FROM filtrados
  ),
  pagina AS (
    SELECT *
    FROM filtrados
    ORDER BY
      CASE WHEN v_sort = 'created_at' AND v_direction = 'asc' THEN created_at END ASC,
      CASE WHEN v_sort = 'created_at' AND v_direction = 'desc' THEN created_at END DESC,
      CASE WHEN v_sort = 'updated_at' AND v_direction = 'asc' THEN updated_at END ASC,
      CASE WHEN v_sort = 'updated_at' AND v_direction = 'desc' THEN updated_at END DESC,
      CASE WHEN v_sort = 'razao_social' AND v_direction = 'asc' THEN lower(razao_social) END ASC,
      CASE WHEN v_sort = 'razao_social' AND v_direction = 'desc' THEN lower(razao_social) END DESC,
      CASE WHEN v_direction = 'asc' THEN id END ASC,
      CASE WHEN v_direction = 'desc' THEN id END DESC
    OFFSET v_offset
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items',
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'razaoSocial', p.razao_social,
        'nomeFantasia', p.nome_fantasia,
        'cnpj', p.cnpj,
        'statusCadastral', p.status_cadastral,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'onboardingStatus', p.onboarding_status,
        'vinculo', CASE WHEN p.cedente_fundo_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.cedente_fundo_id,
          'status', p.vinculo_status,
          'vigenteDesde', p.vigente_desde,
          'vigenteAte', p.vigente_ate
        ) END,
        'fundo', CASE WHEN p.fundo_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.fundo_id,
          'nome', p.fundo_nome,
          'cnpj', p.fundo_cnpj
        ) END,
        'politica', CASE WHEN p.politica_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.politica_id,
          'nome', p.politica_nome,
          'codigo', p.politica_codigo,
          'versaoId', p.versao_id,
          'numeroVersao', p.numero_versao,
          'publicadaEm', p.publicada_em,
          'requisitoCount', p.requisito_count
        ) END
      ) ORDER BY
        CASE WHEN v_sort = 'created_at' AND v_direction = 'asc' THEN p.created_at END ASC,
        CASE WHEN v_sort = 'created_at' AND v_direction = 'desc' THEN p.created_at END DESC,
        CASE WHEN v_sort = 'updated_at' AND v_direction = 'asc' THEN p.updated_at END ASC,
        CASE WHEN v_sort = 'updated_at' AND v_direction = 'desc' THEN p.updated_at END DESC,
        CASE WHEN v_sort = 'razao_social' AND v_direction = 'asc' THEN lower(p.razao_social) END ASC,
        CASE WHEN v_sort = 'razao_social' AND v_direction = 'desc' THEN lower(p.razao_social) END DESC,
        CASE WHEN v_direction = 'asc' THEN p.id END ASC,
        CASE WHEN v_direction = 'desc' THEN p.id END DESC)
      FROM pagina p
    ), '[]'::jsonb),
    'total', (SELECT total FROM total_filtrado),
    'counts', jsonb_build_object(
      'pendencias', contagens.pendencias,
      'sem_fundo', contagens.sem_fundo,
      'sem_politica', contagens.sem_politica,
      'aptos', contagens.aptos,
      'suspensos', contagens.suspensos,
      'todos', contagens.todos
    )
  )
  INTO v_result
  FROM contagens;

  RETURN coalesce(v_result, jsonb_build_object(
    'items', '[]'::jsonb,
    'total', 0,
    'counts', jsonb_build_object(
      'pendencias', 0,
      'sem_fundo', 0,
      'sem_politica', 0,
      'aptos', 0,
      'suspensos', 0,
      'todos', 0
    )
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.listar_onboarding_cedentes_paginado(
  uuid, integer, integer, text, text, text, uuid, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.listar_onboarding_cedentes_paginado(
  uuid, integer, integer, text, text, text, uuid, text, text
) TO authenticated;
