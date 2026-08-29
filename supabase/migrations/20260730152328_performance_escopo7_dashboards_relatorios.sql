-- Escopo 7: dashboards e relatorios.
-- Agregacoes sao executadas no PostgreSQL sem bypass de RLS. As funcoes
-- validam novamente o contexto operacional recebido do servidor.

CREATE OR REPLACE FUNCTION public.dashboard_gestor_resumo(p_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'gestor'
     OR NOT EXISTS (
       SELECT 1
       FROM public.usuario_fundos uf
       JOIN public.fundos f ON f.id = uf.fundo_id
       WHERE uf.usuario_id = auth.uid()
         AND uf.fundo_id = p_fundo_id
         AND uf.status = 'ativo'
         AND f.ativo IS NOT FALSE
     )
  THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado'
      USING ERRCODE = '42501';
  END IF;

  WITH links AS (
    SELECT cf.id, cf.cedente_id
    FROM public.cedente_fundos cf
    WHERE cf.fundo_id = p_fundo_id
      AND cf.status = 'ativo'
  ),
  cedentes_escopo AS (
    SELECT DISTINCT c.id, c.status
    FROM links l
    JOIN public.cedentes c ON c.id = l.cedente_id
  ),
  operacoes_escopo AS (
    SELECT o.*
    FROM public.operacoes o
    JOIN links l ON l.id = o.cedente_fundo_id
  ),
  recentes AS (
    SELECT
      o.id,
      c.razao_social,
      o.valor_bruto_total,
      o.valor_liquido_desembolso,
      o.status::text AS status,
      o.aceite_sacado_exigido,
      o.aceite_sacado_status::text AS aceite_sacado_status,
      o.data_vencimento,
      o.created_at
    FROM operacoes_escopo o
    JOIN public.cedentes c ON c.id = o.cedente_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'totalCedentes', (SELECT count(*) FROM cedentes_escopo),
    'cedentesAtivos', (SELECT count(*) FROM cedentes_escopo WHERE status::text = 'ativo'),
    'docsPendentes', (
      SELECT count(*)
      FROM public.documentos d
      JOIN cedentes_escopo c ON c.id = d.cedente_id
      WHERE d.status::text IN ('enviado', 'em_analise')
    ),
    'opsAtivas', (SELECT count(*) FROM operacoes_escopo WHERE status::text = 'em_andamento'),
    'opsSolicitadas', (
      SELECT count(*)
      FROM operacoes_escopo
      WHERE status::text IN ('solicitada', 'em_analise')
        AND (
          aceite_sacado_exigido IS FALSE
          OR aceite_sacado_status::text IN ('dispensado', 'aceito')
        )
    ),
    'opsInadimplentes', (SELECT count(*) FROM operacoes_escopo WHERE status::text = 'inadimplente'),
    'volumeAtivo', COALESCE((
      SELECT sum(valor_liquido_desembolso)
      FROM operacoes_escopo
      WHERE status::text = 'em_andamento'
    ), 0),
    'volumeMes', COALESCE((
      SELECT sum(valor_bruto_total)
      FROM operacoes_escopo
      WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        AND created_at < (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '1 month'
        AND status::text NOT IN ('cancelada', 'reprovada')
    ), 0),
    'saldoEscrowTotal', COALESCE((
      SELECT sum(ce.saldo_disponivel + ce.saldo_bloqueado)
      FROM public.contas_escrow ce
      JOIN cedentes_escopo c ON c.id = ce.cedente_id
    ), 0),
    'nfsPendentes', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.fundo_id = p_fundo_id
        AND nf.status::text IN ('submetida', 'em_analise')
    ),
    'entregasEmTransito', (
      SELECT count(*)
      FROM public.nota_fiscal_entregas e
      JOIN public.notas_fiscais nf ON nf.id = e.nota_fiscal_id
      WHERE nf.fundo_id = p_fundo_id
        AND e.status_entrega::text IN ('em_transito', 'aguardando_validacao')
    ),
    'entregasComPendencia', (
      SELECT count(*)
      FROM public.nota_fiscal_entregas e
      JOIN public.notas_fiscais nf ON nf.id = e.nota_fiscal_id
      WHERE nf.fundo_id = p_fundo_id
        AND e.status_entrega::text = 'entrega_com_pendencia'
    ),
    'entregasEntregues', (
      SELECT count(*)
      FROM public.nota_fiscal_entregas e
      JOIN public.notas_fiscais nf ON nf.id = e.nota_fiscal_id
      WHERE nf.fundo_id = p_fundo_id
        AND e.status_entrega::text = 'entregue'
    ),
    'operacoesRecentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'cedenteNome', r.razao_social,
        'valorBruto', r.valor_bruto_total,
        'status', r.status,
        'aceiteSacadoExigido', r.aceite_sacado_exigido,
        'aceiteSacadoStatus', r.aceite_sacado_status,
        'dataVencimento', r.data_vencimento,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC, r.id DESC)
      FROM recentes r
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_cedente_resumo(p_cedente_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'cedente'
     OR NOT EXISTS (
       SELECT 1
       FROM public.cedente_fundos cf
       JOIN public.cedentes c ON c.id = cf.cedente_id
       JOIN public.fundos f ON f.id = cf.fundo_id
       WHERE cf.id = p_cedente_fundo_id
         AND cf.status = 'ativo'
         AND c.user_id = auth.uid()
         AND f.ativo IS NOT FALSE
     )
  THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao autorizado'
      USING ERRCODE = '42501';
  END IF;

  WITH contexto AS (
    SELECT cf.id AS cedente_fundo_id, c.id AS cedente_id, c.habilitar_escrow
    FROM public.cedente_fundos cf
    JOIN public.cedentes c ON c.id = cf.cedente_id
    WHERE cf.id = p_cedente_fundo_id
  ),
  operacoes_escopo AS (
    SELECT o.*
    FROM public.operacoes o
    JOIN contexto c ON c.cedente_fundo_id = o.cedente_fundo_id
  ),
  latest_docs AS (
    SELECT DISTINCT ON (d.tipo, d.representante_id)
      d.tipo, d.representante_id, d.status
    FROM public.documentos d
    JOIN contexto c ON c.cedente_id = d.cedente_id
    ORDER BY d.tipo, d.representante_id, d.versao DESC, d.id DESC
  ),
  escrow AS (
    SELECT ce.*
    FROM public.contas_escrow ce
    JOIN contexto c ON c.cedente_id = ce.cedente_id
    ORDER BY ce.created_at, ce.id
    LIMIT 1
  ),
  recentes AS (
    SELECT o.*
    FROM operacoes_escopo o
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'saldoDisponivel', COALESCE((SELECT saldo_disponivel FROM escrow), 0),
    'contaEscrow', (SELECT identificador FROM escrow),
    'habilitarEscrow', COALESCE((SELECT habilitar_escrow FROM contexto), FALSE),
    'nfsAprovadas', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.cedente_fundo_id = p_cedente_fundo_id
        AND nf.status::text = 'aprovada'
    ),
    'nfsTotal', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.cedente_fundo_id = p_cedente_fundo_id
    ),
    'opsAtivas', (SELECT count(*) FROM operacoes_escopo WHERE status::text = 'em_andamento'),
    'volumeAtivo', COALESCE((
      SELECT sum(valor_liquido_desembolso)
      FROM operacoes_escopo
      WHERE status::text = 'em_andamento'
    ), 0),
    'docsReprovados', (SELECT count(*) FROM latest_docs WHERE status::text = 'reprovado'),
    'operacoesRecentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'cedenteNome', '',
        'valorBruto', r.valor_bruto_total,
        'status', r.status::text,
        'aceiteSacadoExigido', r.aceite_sacado_exigido,
        'aceiteSacadoStatus', r.aceite_sacado_status::text,
        'dataVencimento', r.data_vencimento,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC, r.id DESC)
      FROM recentes r
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_consultor_resumo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'consultor' THEN
    RAISE EXCEPTION 'Perfil nao autorizado'
      USING ERRCODE = '42501';
  END IF;

  WITH carteira AS (
    SELECT cc.cedente_id, cc.comissao_percentual, cc.created_at,
           c.razao_social, c.cnpj, c.status
    FROM public.consultor_cedente cc
    JOIN public.cedentes c ON c.id = cc.cedente_id
    WHERE cc.consultor_id = auth.uid()
  ),
  operacoes_escopo AS (
    SELECT o.*, c.comissao_percentual, c.razao_social
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
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
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', c.cedente_id,
        'razaoSocial', c.razao_social,
        'cnpj', c.cnpj,
        'status', c.status::text,
        'comissaoPercentual', c.comissao_percentual
      ) ORDER BY c.created_at DESC, c.cedente_id DESC)
      FROM carteira_recente c
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_gestor_analitico(
  p_fundo_id uuid,
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
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mes_inicio timestamp with time zone;
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'gestor'
     OR NOT EXISTS (
       SELECT 1 FROM public.usuario_fundos uf
       WHERE uf.usuario_id = auth.uid()
         AND uf.fundo_id = p_fundo_id
         AND uf.status = 'ativo'
     )
  THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Mes de referencia invalido' USING ERRCODE = '22023';
  END IF;

  IF p_offset < 0 OR p_offset > 39999960 OR p_page_size NOT IN (10, 20, 40)
     OR p_sort NOT IN ('volume_total', 'volume_mes', 'operacoes_total', 'cedente')
     OR p_direction NOT IN ('asc', 'desc')
     OR (p_status IS NOT NULL AND p_status NOT IN (
       'solicitada', 'em_analise', 'aprovada', 'em_andamento',
       'liquidada', 'inadimplente', 'reprovada', 'cancelada'
     ))
     OR length(COALESCE(p_busca, '')) > 120
     OR (p_data_inicial IS NOT NULL AND p_data_final IS NOT NULL AND p_data_inicial > p_data_final)
  THEN
    RAISE EXCEPTION 'Parametros de paginacao ou ordenacao invalidos' USING ERRCODE = '22023';
  END IF;

  v_mes_inicio := to_date(p_mes || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'UTC';
  WITH links AS (
    SELECT cf.id, cf.cedente_id
    FROM public.cedente_fundos cf
    WHERE cf.fundo_id = p_fundo_id
      AND cf.status = 'ativo'
  ),
  cedentes_escopo AS (
    SELECT DISTINCT c.id, c.razao_social, c.cnpj, c.status
    FROM links l
    JOIN public.cedentes c ON c.id = l.cedente_id
  ),
  operacoes_escopo AS (
    SELECT o.*
    FROM public.operacoes o
    JOIN links l ON l.id = o.cedente_fundo_id
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
      c.id AS cedente_id,
      c.razao_social,
      c.cnpj,
      COALESCE(sum(o.valor_bruto_total) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
          AND (p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada'))
      ), 0) AS volume_mes,
      count(o.id) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
          AND (p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada'))
      ) AS operacoes_mes,
      COALESCE(sum(o.valor_bruto_total) FILTER (
        WHERE p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada')
      ), 0) AS volume_total,
      count(o.id) FILTER (
        WHERE p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada')
      ) AS operacoes_total,
      count(o.id) FILTER (WHERE o.status::text = 'inadimplente') AS inadimplentes
    FROM cedentes_escopo c
    LEFT JOIN operacoes_tabela o ON o.cedente_id = c.id
    WHERE c.status::text = 'ativo'
      AND (p_cedente_id IS NULL OR c.id = p_cedente_id)
      AND (
        COALESCE(trim(p_busca), '') = ''
        OR c.razao_social ILIKE '%' || trim(p_busca) || '%'
        OR (
          regexp_replace(trim(p_busca), '[^0-9]', '', 'g') <> ''
          AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') LIKE '%' || regexp_replace(trim(p_busca), '[^0-9]', '', 'g') || '%'
        )
    )
    GROUP BY c.id, c.razao_social, c.cnpj
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
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_total END DESC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_total END ASC,
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
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_total END DESC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_total END ASC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
      cedente_id
    LIMIT p_page_size OFFSET p_offset
  ),
  ops_mes AS (
    SELECT *
    FROM operacoes_escopo
    WHERE created_at >= v_mes_inicio
      AND created_at < v_mes_inicio + interval '1 month'
  ),
  ops_validas_mes AS (
    SELECT *
    FROM ops_mes
    WHERE status::text NOT IN ('cancelada', 'reprovada')
  ),
  resumo AS (
    SELECT jsonb_build_object(
      'volumeBrutoMes', COALESCE((SELECT sum(valor_bruto_total) FROM ops_validas_mes), 0),
      'receitaMes', COALESCE((SELECT sum(valor_bruto_total - valor_liquido_desembolso) FROM ops_validas_mes), 0),
      'taxaMedia', COALESCE((SELECT avg(taxa_desconto) FROM ops_validas_mes), 0),
      'operacoesValidasMes', (SELECT count(*) FROM ops_validas_mes),
      'operacoesAtivasMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'em_andamento'),
      'operacoesLiquidadasMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'liquidada'),
      'operacoesInadimplentesMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'inadimplente'),
      'operacoesAguardandoAceiteMes', (
        SELECT count(*) FROM ops_mes
        WHERE status::text IN ('solicitada', 'em_analise')
          AND aceite_sacado_exigido IS NOT FALSE
          AND aceite_sacado_status::text IS DISTINCT FROM 'aceito'
      ),
      'operacoesProntasAnaliseMes', (
        SELECT count(*) FROM ops_mes
        WHERE status::text IN ('solicitada', 'em_analise')
          AND (
            aceite_sacado_exigido IS FALSE
            OR aceite_sacado_status::text IN ('dispensado', 'aceito')
          )
      ),
      'operacoesReprovadasMes', (SELECT count(*) FROM ops_mes WHERE status::text = 'reprovada'),
      'operacoesCanceladasMes', (SELECT count(*) FROM ops_mes WHERE status::text = 'cancelada'),
      'volumeTotalGeral', COALESCE((
        SELECT sum(valor_bruto_total)
        FROM operacoes_escopo
        WHERE status::text NOT IN ('cancelada', 'reprovada')
      ), 0),
      'operacoesTotalGeral', (
        SELECT count(*)
        FROM operacoes_escopo
        WHERE status::text NOT IN ('cancelada', 'reprovada')
      ),
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
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', l.cedente_id,
        'razaoSocial', l.razao_social,
        'cnpj', l.cnpj,
        'volumeMes', l.volume_mes,
        'operacoesMes', l.operacoes_mes,
        'volumeTotal', l.volume_total,
        'operacoesTotal', l.operacoes_total,
        'inadimplentes', l.inadimplentes
      ) ORDER BY l.ordem)
      FROM linhas_paginadas l
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_consultor_analitico(
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
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mes_inicio timestamp with time zone;
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'consultor' THEN
    RAISE EXCEPTION 'Perfil nao autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
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
  WITH carteira AS (
    SELECT cc.cedente_id, cc.comissao_percentual,
           c.razao_social, c.cnpj, c.status
    FROM public.consultor_cedente cc
    JOIN public.cedentes c ON c.id = cc.cedente_id
    WHERE cc.consultor_id = auth.uid()
  ),
  operacoes_escopo AS (
    SELECT o.*, c.comissao_percentual
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
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
      COALESCE(sum(o.valor_liquido_desembolso) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ), 0) AS volume_mes,
      COALESCE(sum(o.valor_liquido_desembolso * c.comissao_percentual / 100) FILTER (
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
    GROUP BY c.cedente_id, c.razao_social, c.cnpj, c.status, c.comissao_percentual
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
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', l.cedente_id,
        'razaoSocial', l.razao_social,
        'cnpj', l.cnpj,
        'status', l.status,
        'percentual', l.comissao_percentual,
        'volumeMes', l.volume_mes,
        'comissaoMes', l.comissao_mes,
        'operacoesMes', l.operacoes_mes,
        'volumeTotal', l.volume_total
      ) ORDER BY l.ordem)
      FROM linhas_paginadas l
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_gestor_resumo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_cedente_resumo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_consultor_resumo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.relatorio_gestor_analitico(uuid, text, text, text, uuid, date, date, integer, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.relatorio_consultor_analitico(text, text, text, uuid, date, date, integer, integer, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.dashboard_gestor_resumo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_cedente_resumo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_consultor_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.relatorio_gestor_analitico(uuid, text, text, text, uuid, date, date, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relatorio_consultor_analitico(text, text, text, uuid, date, date, integer, integer, text, text) TO authenticated;

-- A policy antiga concedia ao consultor leitura de todas as operacoes. O
-- dashboard e o relatorio dependem diretamente deste escopo, portanto a
-- leitura passa a respeitar exclusivamente a carteira autenticada.
DROP POLICY IF EXISTS operacoes_consultor_select ON public.operacoes;
CREATE POLICY operacoes_consultor_select
ON public.operacoes
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'consultor'
  AND EXISTS (
    SELECT 1
    FROM public.consultor_cedente cc
    WHERE cc.consultor_id = auth.uid()
      AND cc.cedente_id = operacoes.cedente_id
  )
);

NOTIFY pgrst, 'reload schema';
