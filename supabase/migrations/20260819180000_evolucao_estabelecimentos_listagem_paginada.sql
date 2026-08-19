-- Evolucao de Estabelecimentos: listagem paginada/filtrada server-side para
-- as telas "Meus CNPJs" (Cedente) e "CNPJs/Estabelecimentos" (Gestor).
--
-- Uma unica RPC serve as duas telas (evita inventar componente/engine
-- paralelo): quem chama informa o cedente_id e o acesso e checado com os
-- mesmos helpers usados em todo o dominio (usuario_tem_acesso_cedente /
-- gestor_tem_acesso_cedente). Agrega e pagina no banco -- nunca carrega
-- todos os documentos de todas as Filiais no primeiro render (evita N+1
-- com 50+ filiais: uma query agregada por pagina, sem 1 query por linha).

BEGIN;

CREATE OR REPLACE FUNCTION public.listar_estabelecimentos_pagina(
  p_cedente_id uuid,
  p_tipo text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_pendencia text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10
)
RETURNS TABLE (
  estabelecimento_id uuid,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  tipo text,
  status text,
  ativo boolean,
  total_obrigatorios integer,
  aprovados_obrigatorios integer,
  aguardando_analise integer,
  tem_conta_principal boolean,
  pendencia text,
  total_itens bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := CASE WHEN coalesce(p_page_size, 10) IN (10, 20, 40) THEN p_page_size ELSE 10 END;
BEGIN
  IF NOT (
    private.usuario_tem_acesso_cedente(p_cedente_id)
    OR private.gestor_tem_acesso_cedente(p_cedente_id)
  ) THEN RAISE EXCEPTION 'Cedente nao encontrado'; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.tipo, e.status, e.ativo,
      count(r.id) FILTER (WHERE r.obrigatorio AND r.ativo) AS total_obrigatorios,
      count(r.id) FILTER (
        WHERE r.obrigatorio AND r.ativo
          AND coalesce(dv.status, CASE WHEN legado.id IS NOT NULL THEN 'aprovado' ELSE 'pendente' END) = 'aprovado'
      ) AS aprovados_obrigatorios,
      count(r.id) FILTER (WHERE r.ativo AND coalesce(dv.status, 'pendente') IN ('enviado', 'em_analise')) AS aguardando_analise,
      EXISTS (
        SELECT 1 FROM public.cedente_estabelecimento_contas_bancarias c
        WHERE c.estabelecimento_id = e.id AND c.principal AND c.ativo
      ) AS tem_conta_principal
    FROM public.cedente_estabelecimentos e
    LEFT JOIN public.cedente_estabelecimento_requisitos r ON r.estabelecimento_id = e.id AND r.ativo
    LEFT JOIN public.documento_tipos dt ON dt.id = r.documento_tipo_id
    LEFT JOIN LATERAL (
      SELECT dv2.status
      FROM public.documento_vinculos vinc
      JOIN public.documentos_repositorio dr ON dr.id = vinc.documento_id AND dr.documento_tipo_id = r.documento_tipo_id
      JOIN public.documento_versoes dv2 ON dv2.documento_id = dr.id
      WHERE vinc.estabelecimento_id = r.estabelecimento_id
      ORDER BY dv2.numero_versao DESC
      LIMIT 1
    ) dv ON true
    LEFT JOIN LATERAL (
      SELECT d.id
      FROM public.documentos d
      WHERE e.tipo = 'matriz'
        AND r.id IS NOT NULL
        AND dv.status IS NULL
        AND d.cedente_id = e.cedente_id
        AND d.representante_id IS NULL
        AND d.status::text = 'aprovado'
        AND d.tipo::text = CASE dt.codigo
          WHEN 'estabelecimento_cartao_cnpj' THEN 'cartao_cnpj'
          WHEN 'estabelecimento_comprovante_endereco' THEN 'comprovante_endereco'
          WHEN 'estabelecimento_contrato_social' THEN 'contrato_social'
          WHEN 'estabelecimento_comprovante_faturamento' THEN 'extrato_bancario'
          ELSE NULL
        END
      ORDER BY d.versao DESC
      LIMIT 1
    ) legado ON true
    WHERE e.cedente_id = p_cedente_id
      AND (p_tipo IS NULL OR e.tipo = p_tipo)
      AND (p_status IS NULL OR e.status = p_status)
      AND (
        p_q IS NULL OR length(trim(p_q)) = 0
        OR e.cnpj ILIKE '%' || p_q || '%'
        OR e.razao_social ILIKE '%' || p_q || '%'
        OR coalesce(e.nome_fantasia, '') ILIKE '%' || p_q || '%'
      )
    GROUP BY e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.tipo, e.status, e.ativo
  ),
  classificado AS (
    SELECT b.*,
      CASE
        WHEN b.status = 'aprovado' AND b.aprovados_obrigatorios < b.total_obrigatorios THEN 'pendencia_pos_aprovacao'
        WHEN NOT b.tem_conta_principal THEN 'conta_bancaria_pendente'
        WHEN b.aguardando_analise > 0 THEN 'documentos_aguardando_analise'
        WHEN b.aprovados_obrigatorios < b.total_obrigatorios THEN 'aguardando_documentos'
        ELSE 'completo'
      END AS pendencia_calculada
    FROM base b
  ),
  filtrado AS (
    SELECT * FROM classificado WHERE p_pendencia IS NULL OR pendencia_calculada = p_pendencia
  )
  SELECT
    f.id, f.cnpj, f.razao_social, f.nome_fantasia, f.tipo, f.status, f.ativo,
    f.total_obrigatorios::integer, f.aprovados_obrigatorios::integer, f.aguardando_analise::integer,
    f.tem_conta_principal, f.pendencia_calculada, count(*) OVER ()::bigint
  FROM filtrado f
  ORDER BY (f.tipo = 'matriz') DESC, f.razao_social
  LIMIT v_page_size OFFSET (v_page - 1) * v_page_size;
END;
$function$;

REVOKE ALL ON FUNCTION public.listar_estabelecimentos_pagina(uuid, text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_estabelecimentos_pagina(uuid, text, text, text, text, integer, integer) TO authenticated;

COMMIT;
