-- Escopo 4 de performance: agregacoes compactas do portal do sacado.
-- As funcoes sao SECURITY INVOKER para preservar as policies RLS das tabelas.

CREATE OR REPLACE FUNCTION public.carregar_dashboard_sacado()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH contexto AS (
    SELECT regexp_replace(s.cnpj, '\D', '', 'g') AS cnpj
      FROM public.sacados s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.user_id = auth.uid()
       AND p.role = 'sacado'
       AND p.status = 'ativo'
     LIMIT 1
  ),
  nfs_contexto AS (
    SELECT DISTINCT ON (nf.id)
      nf.id,
      nf.numero_nf,
      nf.cedente_id,
      nf.razao_social_emitente,
      regexp_replace(nf.cnpj_emitente, '\D', '', 'g') AS cnpj_emitente,
      nf.valor_bruto,
      nf.data_vencimento,
      op.id AS operacao_id,
      op.status AS operacao_status,
      ce.identificador AS conta_escrow
    FROM contexto ctx
    JOIN public.notas_fiscais nf
      ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = ctx.cnpj
    JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    JOIN public.operacoes op ON op.id = onf.operacao_id
    LEFT JOIN public.contas_escrow ce ON ce.id = op.conta_escrow_id
    ORDER BY nf.id, op.created_at DESC, op.id DESC
  ),
  ativas AS (
    SELECT *
      FROM nfs_contexto
     WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
  ),
  indicadores AS (
    SELECT
      count(*)::integer AS nfs_ativas,
      coalesce(sum(valor_bruto), 0)::numeric AS total_devido,
      count(*) FILTER (WHERE data_vencimento < current_date)::integer AS vencidas,
      coalesce(sum(valor_bruto) FILTER (WHERE data_vencimento < current_date), 0)::numeric AS valor_vencido,
      count(*) FILTER (WHERE data_vencimento = current_date)::integer AS vencem_hoje,
      coalesce(sum(valor_bruto) FILTER (WHERE data_vencimento = current_date), 0)::numeric AS valor_vence_hoje,
      count(*) FILTER (
        WHERE data_vencimento > current_date
          AND data_vencimento <= current_date + 7
      )::integer AS proximos_7_dias,
      coalesce(sum(valor_bruto) FILTER (
        WHERE data_vencimento > current_date
          AND data_vencimento <= current_date + 7
      ), 0)::numeric AS valor_proximos_7_dias
    FROM ativas
  ),
  proximos AS (
    SELECT *
      FROM ativas
     ORDER BY data_vencimento ASC, id ASC
     LIMIT 8
  ),
  cedentes AS (
    SELECT
      cedente_id,
      max(razao_social_emitente) AS nome,
      max(cnpj_emitente) AS cnpj,
      sum(valor_bruto)::numeric AS total_devido,
      count(DISTINCT id)::integer AS quantidade_nfs,
      count(DISTINCT operacao_id)::integer AS quantidade_operacoes,
      min(data_vencimento) AS proximo_vencimento,
      max(conta_escrow) AS conta_escrow
    FROM ativas
    GROUP BY cedente_id
    ORDER BY min(data_vencimento) ASC, cedente_id ASC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'indicadores', jsonb_build_object(
      'totalDevido', i.total_devido,
      'nfsAtivas', i.nfs_ativas,
      'vencidas', i.vencidas,
      'valorVencido', i.valor_vencido,
      'vencemHoje', i.vencem_hoje,
      'valorVenceHoje', i.valor_vence_hoje,
      'proximos7Dias', i.proximos_7_dias,
      'valorProximos7Dias', i.valor_proximos_7_dias
    ),
    'proximosVencimentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'numero', p.numero_nf,
        'cedenteNome', p.razao_social_emitente,
        'cedenteCnpj', p.cnpj_emitente,
        'valor', p.valor_bruto,
        'vencimentoEm', p.data_vencimento
      ) ORDER BY p.data_vencimento ASC, p.id ASC)
      FROM proximos p
    ), '[]'::jsonb),
    'cedentesEmAberto', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', c.cedente_id,
        'nome', c.nome,
        'cnpj', c.cnpj,
        'totalDevido', c.total_devido,
        'quantidadeNfs', c.quantidade_nfs,
        'quantidadeOperacoes', c.quantidade_operacoes,
        'proximoVencimento', c.proximo_vencimento,
        'contaEscrow', c.conta_escrow
      ) ORDER BY c.proximo_vencimento ASC, c.cedente_id ASC)
      FROM cedentes c
    ), '[]'::jsonb)
  )
  FROM indicadores i;
$$;

REVOKE ALL ON FUNCTION public.carregar_dashboard_sacado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carregar_dashboard_sacado() TO authenticated;

CREATE OR REPLACE FUNCTION public.carregar_indicadores_nfs_sacado()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH contexto AS (
    SELECT regexp_replace(s.cnpj, '\D', '', 'g') AS cnpj
      FROM public.sacados s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.user_id = auth.uid()
       AND p.role = 'sacado'
       AND p.status = 'ativo'
     LIMIT 1
  ),
  nfs_contexto AS (
    SELECT DISTINCT ON (nf.id)
      nf.id,
      nf.status AS nf_status,
      nf.data_vencimento,
      op.status AS operacao_status
    FROM contexto ctx
    JOIN public.notas_fiscais nf
      ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = ctx.cnpj
    LEFT JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    LEFT JOIN public.operacoes op ON op.id = onf.operacao_id
    ORDER BY nf.id, op.created_at DESC NULLS LAST, op.id DESC NULLS LAST
  )
  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'cedidas', count(*) FILTER (
      WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
    )::integer,
    'liquidadas', count(*) FILTER (
      WHERE operacao_status = 'liquidada' OR nf_status = 'liquidada'
    )::integer,
    'vencidas', count(*) FILTER (
      WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
        AND data_vencimento < current_date
    )::integer
  )
  FROM nfs_contexto;
$$;

REVOKE ALL ON FUNCTION public.carregar_indicadores_nfs_sacado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carregar_indicadores_nfs_sacado() TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_cedentes_aprovacao_sacado()
RETURNS TABLE (
  id uuid,
  nome text,
  cnpj text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    nf.cedente_id AS id,
    max(nf.razao_social_emitente) AS nome,
    max(regexp_replace(nf.cnpj_emitente, '\D', '', 'g')) AS cnpj
  FROM public.sacados s
  JOIN public.profiles p ON p.id = s.user_id
  JOIN public.notas_fiscais nf
    ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g')
      = regexp_replace(s.cnpj, '\D', '', 'g')
  JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
  JOIN public.operacoes op ON op.id = onf.operacao_id
  WHERE s.user_id = auth.uid()
    AND p.role = 'sacado'
    AND p.status = 'ativo'
    AND nf.status = 'em_antecipacao'
    AND op.aceite_sacado_exigido = true
    AND op.aceite_sacado_status = 'pendente'
    AND op.status IN ('solicitada', 'em_analise')
  GROUP BY nf.cedente_id
  ORDER BY max(nf.razao_social_emitente) ASC, nf.cedente_id ASC;
$$;

REVOKE ALL ON FUNCTION public.listar_cedentes_aprovacao_sacado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cedentes_aprovacao_sacado() TO authenticated;
