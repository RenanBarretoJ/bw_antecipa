-- GUIBOR A6 R2: standalone analytical capability on C1.1 + A5.
-- Corrective migration: original applied migrations remain immutable.
-- No financial backfill, no C5 operations endpoints or raw-table policy changes.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('private.consultor_organizacao_ativa_do_usuario(uuid)') IS NULL
    OR to_regprocedure('private.consultor_usuario_tem_papel(uuid,text[])') IS NULL
    OR to_regprocedure('private.autorizar_configuracao_financeira_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'GUIBOR A6 R2 requer C1.1 e A5 completos';
  END IF;
END $$;
ALTER TABLE public.consultor_fundos ADD COLUMN IF NOT EXISTS comissao_habilitada boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.configurar_comissao_consultor_fundo(p_consultor_id uuid,p_fundo_id uuid,p_habilitada boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.autorizar_configuracao_financeira_fundo(p_fundo_id);
  IF p_habilitada IS NULL THEN RAISE EXCEPTION 'Configuracao de comissao invalida'; END IF;
  UPDATE public.consultor_fundos SET comissao_habilitada=p_habilitada
  WHERE consultor_id=p_consultor_id AND fundo_id=p_fundo_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo Consultoria/Fundo indisponivel'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.configurar_comissao_consultor_fundo(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configurar_comissao_consultor_fundo(uuid,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.proteger_comissao_consultor_fundo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.comissao_habilitada)
    OR (TG_OP='UPDATE' AND (NEW.comissao_habilitada IS DISTINCT FROM OLD.comissao_habilitada
      OR (NEW.comissao_habilitada AND ROW(NEW.fundo_id,NEW.consultor_id) IS DISTINCT FROM ROW(OLD.fundo_id,OLD.consultor_id)))) THEN
    PERFORM private.autorizar_configuracao_financeira_fundo(NEW.fundo_id);
    IF TG_OP='UPDATE' THEN PERFORM private.autorizar_configuracao_financeira_fundo(OLD.fundo_id); END IF;
    INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
    VALUES(auth.uid(),'COMISSAO_CONSULTOR_FUNDO_ALTERADA','consultor_fundos',NEW.id,
      CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('comissao_habilitada',OLD.comissao_habilitada,'consultor_id',OLD.consultor_id,'fundo_id',OLD.fundo_id) ELSE NULL END,
      jsonb_build_object('comissao_habilitada',NEW.comissao_habilitada,'consultor_id',NEW.consultor_id,'fundo_id',NEW.fundo_id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.proteger_comissao_consultor_fundo() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS consultor_fundos_proteger_comissao ON public.consultor_fundos;
CREATE TRIGGER consultor_fundos_proteger_comissao BEFORE INSERT OR UPDATE ON public.consultor_fundos
  FOR EACH ROW EXECUTE FUNCTION private.proteger_comissao_consultor_fundo();

-- Safe administrative projection; unlike the operational analytics it includes the configuration flag.
CREATE OR REPLACE FUNCTION public.listar_configuracao_comissao_fundo(p_fundo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.autorizar_configuracao_financeira_fundo(p_fundo_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('consultor_id',c.id,'nome',c.razao_social,
    'fundo_id',cf.fundo_id,'comissao_habilitada',cf.comissao_habilitada) ORDER BY c.razao_social,c.id),'[]') INTO v_result
  FROM public.consultor_fundos cf JOIN public.consultores c ON c.id=cf.consultor_id
  WHERE cf.fundo_id=p_fundo_id AND cf.status='ativo' AND c.status='ativo';
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.listar_configuracao_comissao_fundo(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.listar_configuracao_comissao_fundo(uuid) TO authenticated;


-- Internal scope, never an RPC granting raw-table access. Identity is auth.uid()
-- only. Reuse C1.1 membership primitives; LEITOR is read-only for these aggregates.
CREATE OR REPLACE FUNCTION private.consultor_escopo_analitico()
RETURNS TABLE(cedente_id uuid, cedente_fundo_id uuid, fundo_id uuid,
  comissao_percentual numeric, comissao_habilitada boolean, vinculado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $scope$
  SELECT cc.cedente_id, link.id, link.fundo_id,
         cc.comissao_percentual, cf.comissao_habilitada, cc.created_at
  FROM public.consultor_cedentes cc
  JOIN public.cedentes c ON c.id=cc.cedente_id AND c.status='ativo'
  JOIN public.cedente_fundos link ON link.cedente_id=c.id AND link.status='ativo'
  JOIN public.consultor_fundos cf ON cf.consultor_id=cc.consultor_id
    AND cf.fundo_id=link.fundo_id AND cf.status='ativo'
  JOIN public.fundos f ON f.id=link.fundo_id AND f.ativo
  WHERE cc.status='ativo'
    AND cc.consultor_id=private.consultor_organizacao_ativa_do_usuario(auth.uid())
    AND private.consultor_usuario_tem_papel(auth.uid(), ARRAY['OWNER','ADMIN','OPERADOR','LEITOR']);
$scope$;
REVOKE ALL ON FUNCTION private.consultor_escopo_analitico() FROM PUBLIC, anon, authenticated, service_role;

-- Bounded read-only projections. SECURITY DEFINER does not expose raw rows:
-- every operation is joined to the exact authorized active cedente/fund link.
-- Public API wrappers stay INVOKER; all raw-table RLS and write predicates stay unchanged.

CREATE OR REPLACE FUNCTION private.dashboard_consultor_resumo_a6()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT coalesce(private.consultor_usuario_tem_papel(auth.uid(), ARRAY['OWNER','ADMIN','OPERADOR','LEITOR']), false) THEN
    RAISE EXCEPTION 'Perfil nao autorizado'
      USING ERRCODE = '42501';
  END IF;

  WITH escopo AS MATERIALIZED (
    SELECT * FROM private.consultor_escopo_analitico()
  ), fundos_comissao AS (
    SELECT cf.fundo_id FROM public.consultor_fundos cf
    JOIN public.fundos f ON f.id=cf.fundo_id AND f.ativo
    WHERE cf.consultor_id=private.consultor_organizacao_ativa_do_usuario(auth.uid())
      AND cf.status='ativo' AND cf.comissao_habilitada
  ), carteira AS (
    SELECT e.cedente_id, e.comissao_percentual, min(e.vinculado_em) AS created_at,
           c.razao_social, c.cnpj, c.status, bool_and(e.comissao_habilitada) AS comissao_habilitada
    FROM escopo e JOIN public.cedentes c ON c.id=e.cedente_id
    GROUP BY e.cedente_id, e.comissao_percentual, c.razao_social, c.cnpj, c.status
  ),
  operacoes_escopo AS (
    SELECT o.*, CASE WHEN cf.fundo_id IN(SELECT fundo_id FROM fundos_comissao) THEN c.comissao_percentual END AS comissao_percentual, c.razao_social
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
    JOIN escopo cf ON cf.cedente_fundo_id=o.cedente_fundo_id
      AND cf.cedente_id=o.cedente_id
  ),
  recentes AS (
    SELECT *
    FROM operacoes_escopo
    ORDER BY created_at DESC, id DESC
    LIMIT 5
  ),
  carteira_recente AS (
    SELECT *
    FROM carteira
    ORDER BY created_at DESC, cedente_id DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'comissaoHabilitada', EXISTS(SELECT 1 FROM fundos_comissao),
    'cedentesTotal', (SELECT count(*) FROM carteira),
    'cedentesAtivos', (SELECT count(*) FROM carteira WHERE status::text = 'ativo'),
    'opsAtivas', (
      SELECT count(*)
      FROM operacoes_escopo
      WHERE status::text IN ('em_andamento', 'solicitada', 'em_analise')
    ),
    'volumeAtivo', COALESCE((
      SELECT sum(valor_bruto_total)
      FROM operacoes_escopo
      WHERE status::text IN ('em_andamento', 'solicitada', 'em_analise')
    ), 0),
    'volumeMes', COALESCE((
      SELECT sum(valor_bruto_total)
      FROM operacoes_escopo
      WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        AND created_at < (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '1 month'
        AND status::text NOT IN ('cancelada', 'reprovada')
    ), 0),
    'comissaoEstimada', COALESCE((
      SELECT sum(valor_liquido_desembolso * comissao_percentual / 100)
      FROM operacoes_escopo
      WHERE status::text = 'em_andamento'
    ), 0),
    'operacoesRecentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'cedenteNome', r.razao_social,
        'valorBruto', r.valor_bruto_total,
        'status', r.status::text,
        'aceiteSacadoExigido', r.aceite_sacado_exigido,
        'aceiteSacadoStatus', r.aceite_sacado_status::text,
        'dataVencimento', r.data_vencimento,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC, r.id DESC)
      FROM recentes r
    ), '[]'::jsonb),
    'carteiraRecente', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'cedenteId', c.cedente_id,
        'razaoSocial', c.razao_social,
        'cnpj', c.cnpj,
        'status', c.status::text,
        'comissaoPercentual', CASE WHEN c.comissao_habilitada THEN c.comissao_percentual END
      )) ORDER BY c.created_at DESC, c.cedente_id DESC)
      FROM carteira_recente c
    ), '[]'::jsonb)
  ) INTO v_result;

  IF NOT (v_result->>'comissaoHabilitada')::boolean THEN v_result := v_result - 'comissaoEstimada'; END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.relatorio_consultor_analitico_a6(
  p_mes text,
  p_busca text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL,
  p_data_inicial date DEFAULT NULL,
  p_data_final date DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_page_size integer DEFAULT 10,
  p_sort text DEFAULT 'volume_total',
  p_direction text DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_mes_inicio timestamp with time zone;
  v_result jsonb;
BEGIN
  IF NOT coalesce(private.consultor_usuario_tem_papel(auth.uid(), ARRAY['OWNER','ADMIN','OPERADOR','LEITOR']), false) THEN
    RAISE EXCEPTION 'Perfil nao autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_mes IS NULL OR p_offset IS NULL OR p_page_size IS NULL
     OR p_sort IS NULL OR p_direction IS NULL OR p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR p_offset < 0
     OR p_offset > 39999960
     OR p_page_size NOT IN (10, 20, 40)
     OR p_sort NOT IN ('volume_total', 'volume_mes', 'operacoes_total', 'cedente')
     OR p_direction NOT IN ('asc', 'desc')
     OR (p_status IS NOT NULL AND p_status NOT IN ('em_andamento', 'liquidada'))
     OR length(COALESCE(p_busca, '')) > 120
     OR (p_data_inicial IS NOT NULL AND p_data_final IS NOT NULL AND p_data_inicial > p_data_final)
  THEN
    RAISE EXCEPTION 'Parametros de relatorio invalidos' USING ERRCODE = '22023';
  END IF;

  v_mes_inicio := to_date(p_mes || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'UTC';
  WITH escopo AS MATERIALIZED (
    SELECT * FROM private.consultor_escopo_analitico()
  ), fundos_comissao AS (
    SELECT cf.fundo_id FROM public.consultor_fundos cf
    JOIN public.fundos f ON f.id=cf.fundo_id AND f.ativo
    WHERE cf.consultor_id=private.consultor_organizacao_ativa_do_usuario(auth.uid())
      AND cf.status='ativo' AND cf.comissao_habilitada
  ), carteira AS (
    SELECT e.cedente_id, e.comissao_percentual, min(e.vinculado_em) AS created_at,
           c.razao_social, c.cnpj, c.status, bool_and(e.comissao_habilitada) AS comissao_habilitada
    FROM escopo e JOIN public.cedentes c ON c.id=e.cedente_id
    GROUP BY e.cedente_id, e.comissao_percentual, c.razao_social, c.cnpj, c.status
  ),
  operacoes_escopo AS (
    SELECT o.*, CASE WHEN cf.fundo_id IN(SELECT fundo_id FROM fundos_comissao) THEN c.comissao_percentual END AS comissao_percentual
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
    JOIN escopo cf ON cf.cedente_fundo_id=o.cedente_fundo_id
      AND cf.cedente_id=o.cedente_id
    WHERE o.status::text IN ('em_andamento', 'liquidada')
  ),
  operacoes_tabela AS (
    SELECT o.*
    FROM operacoes_escopo o
    WHERE (p_status IS NULL OR o.status::text = p_status)
      AND (p_data_inicial IS NULL OR o.created_at >= (p_data_inicial::timestamp AT TIME ZONE 'UTC'))
      AND (p_data_final IS NULL OR o.created_at < ((p_data_final + 1)::timestamp AT TIME ZONE 'UTC'))
  ),
  linhas AS (
    SELECT
      c.cedente_id,
      c.razao_social,
      c.cnpj,
      c.status::text AS status,
      c.comissao_percentual,
      c.comissao_habilitada AS percentual_habilitado,
      c.comissao_habilitada OR coalesce(bool_or(o.comissao_percentual IS NOT NULL),false) AS comissao_habilitada,
      COALESCE(sum(o.valor_liquido_desembolso) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ), 0) AS volume_mes,
      COALESCE(sum(o.valor_liquido_desembolso * o.comissao_percentual / 100) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ), 0) AS comissao_mes,
      count(o.id) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ) AS operacoes_mes,
      COALESCE(sum(o.valor_bruto_total), 0) AS volume_total
    FROM carteira c
    LEFT JOIN operacoes_tabela o ON o.cedente_id = c.cedente_id
    WHERE (p_cedente_id IS NULL OR c.cedente_id = p_cedente_id)
      AND (
        COALESCE(trim(p_busca), '') = ''
        OR c.razao_social ILIKE '%' || trim(p_busca) || '%'
        OR (
          regexp_replace(trim(p_busca), '[^0-9]', '', 'g') <> ''
          AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') LIKE '%' || regexp_replace(trim(p_busca), '[^0-9]', '', 'g') || '%'
        )
      )
    GROUP BY c.cedente_id, c.razao_social, c.cnpj, c.status, c.comissao_percentual, c.comissao_habilitada
    HAVING (
      (p_status IS NULL AND p_data_inicial IS NULL AND p_data_final IS NULL)
      OR count(o.id) > 0
    )
  ),
  linhas_paginadas AS (
    SELECT *,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_mes END DESC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_mes END ASC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
          cedente_id
      ) AS ordem
    FROM linhas
    ORDER BY
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_mes END DESC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_mes END ASC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
      cedente_id
    LIMIT p_page_size OFFSET p_offset
  ),
  resumo AS (
    SELECT jsonb_build_object(
      'comissaoHabilitada', EXISTS(SELECT 1 FROM fundos_comissao),
      'volumeMes', COALESCE((
        SELECT sum(valor_bruto_total)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ), 0),
      'operacoesMes', (
        SELECT count(*)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ),
      'comissaoMes', COALESCE((
        SELECT sum(valor_liquido_desembolso * comissao_percentual / 100)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ), 0),
      'volumeAcumulado', COALESCE((SELECT sum(valor_bruto_total) FROM operacoes_escopo), 0),
      'cedentesAtivos', (SELECT count(*) FROM carteira WHERE status::text = 'ativo'),
      'mesesDisponiveis', COALESCE((
        SELECT jsonb_agg(mes ORDER BY mes DESC)
        FROM (
          SELECT DISTINCT to_char(timezone('UTC', created_at), 'YYYY-MM') AS mes
          FROM operacoes_escopo
        ) meses
      ), '[]'::jsonb)
    ) AS value
  )
  SELECT jsonb_build_object(
    'resumo', (SELECT value FROM resumo),
    'total', (SELECT count(*) FROM linhas),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'cedenteId', l.cedente_id,
        'razaoSocial', l.razao_social,
        'cnpj', l.cnpj,
        'status', l.status,
        'percentual', CASE WHEN l.percentual_habilitado THEN l.comissao_percentual END,
        'volumeMes', l.volume_mes,
        'comissaoMes', CASE WHEN l.comissao_habilitada THEN l.comissao_mes END,
        'operacoesMes', l.operacoes_mes,
        'volumeTotal', l.volume_total
      )) ORDER BY l.ordem)
      FROM linhas_paginadas l
    ), '[]'::jsonb)
  ) INTO v_result;

  IF NOT (v_result#>>'{resumo,comissaoHabilitada}')::boolean THEN
    v_result := jsonb_set(v_result,'{resumo}',(v_result->'resumo')-'comissaoMes');
  END IF;
  RETURN v_result;
END;
$function$;


REVOKE ALL ON FUNCTION private.dashboard_consultor_resumo_a6() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION private.relatorio_consultor_analitico_a6(text,text,text,uuid,date,date,integer,integer,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.dashboard_consultor_resumo_a6() TO authenticated;
GRANT EXECUTE ON FUNCTION private.relatorio_consultor_analitico_a6(text,text,text,uuid,date,date,integer,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_consultor_resumo()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $wrapper$
  SELECT private.dashboard_consultor_resumo_a6();
$wrapper$;

CREATE OR REPLACE FUNCTION public.relatorio_consultor_analitico(
  p_mes text, p_busca text DEFAULT NULL, p_status text DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL, p_data_inicial date DEFAULT NULL, p_data_final date DEFAULT NULL,
  p_offset integer DEFAULT 0, p_page_size integer DEFAULT 10,
  p_sort text DEFAULT 'volume_total', p_direction text DEFAULT 'desc'
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $wrapper$
  SELECT private.relatorio_consultor_analitico_a6(p_mes,p_busca,p_status,p_cedente_id,
    p_data_inicial,p_data_final,p_offset,p_page_size,p_sort,p_direction);
$wrapper$;

REVOKE ALL ON FUNCTION public.dashboard_consultor_resumo() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_consultor_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) TO authenticated;

COMMENT ON FUNCTION public.dashboard_consultor_resumo() IS
  'A6 R2: projecao analitica organizacional C1.1, com escopo por fundo e comissao opt-in.';
COMMENT ON FUNCTION public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) IS 'A6 R2: relatorio organizacional C1.1, sem dependencia de endpoints ou RLS C5.';


NOTIFY pgrst, 'reload schema';
COMMIT;
