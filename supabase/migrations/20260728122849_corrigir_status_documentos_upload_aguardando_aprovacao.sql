-- Corrige a semantica dos requisitos documentais apos upload do cedente.
--
-- Regra:
-- - upload/envio de documento pelo cedente apenas vincula a versao ao requisito;
-- - o requisito so pode ficar "satisfeito" quando existir aprovacao efetiva do gestor;
-- - XML da NF-e e DANFE/PDF importados junto com a NF nao devem aparecer como
--   "Aprovado" antes da analise.

CREATE OR REPLACE FUNCTION public.reconciliar_documentos_base_nf(
  p_nota_fiscal_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reconciled_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para reconciliar documentos da NF';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notas_fiscais nf
    WHERE nf.id = p_nota_fiscal_id
      AND (
        get_user_role() = 'gestor'
        OR nf.cedente_id = get_user_cedente_id()
      )
  ) THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada ou fora do contexto autorizado';
  END IF;

  WITH latest_base_documents AS (
    SELECT DISTINCT ON (dri.id)
      dri.id AS requisito_id,
      dr.id AS documento_id,
      dv.id AS versao_id,
      dv.status AS versao_status
    FROM public.documento_requisito_instancias dri
    JOIN public.documento_tipos requirement_type
      ON requirement_type.codigo = dri.tipo_documento_codigo_snapshot
    JOIN public.documento_vinculos vinculo
      ON vinculo.nota_fiscal_id = dri.nota_fiscal_id
    JOIN public.documentos_repositorio dr
      ON dr.id = vinculo.documento_id
    JOIN public.documento_tipos document_type
      ON document_type.id = dr.documento_tipo_id
     AND document_type.codigo = requirement_type.codigo
    JOIN public.documento_versoes dv
      ON dv.documento_id = dr.id
     AND dv.status IN ('enviado', 'em_analise', 'aprovado')
    WHERE dri.nota_fiscal_id = p_nota_fiscal_id
      AND dri.escopo_snapshot = 'nf_pre_cessao'
      AND dri.tipo_documento_codigo_snapshot IN ('nf_xml', 'nf_danfe_pdf')
      AND dri.status NOT IN ('cancelado', 'dispensado')
    ORDER BY dri.id, dv.numero_versao DESC
  ),
  updated AS (
    UPDATE public.documento_requisito_instancias dri
    SET documento_id = latest.documento_id,
        versao_aprovada_id = CASE
          WHEN latest.versao_status = 'aprovado' THEN latest.versao_id
          ELSE NULL
        END,
        status = CASE
          WHEN latest.versao_status = 'aprovado' THEN 'satisfeito'
          ELSE 'pendente'
        END,
        satisfeito_em = CASE
          WHEN latest.versao_status = 'aprovado' THEN COALESCE(dri.satisfeito_em, now())
          ELSE NULL
        END
    FROM latest_base_documents latest
    WHERE dri.id = latest.requisito_id
    RETURNING dri.id
  )
  SELECT count(*) INTO reconciled_count FROM updated;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'reconciliados', reconciled_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_documentos_base_nf(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconciliar_documentos_base_nf(uuid) TO authenticated;

-- Repara dados gerados pela versao anterior da reconciliação: se o requisito
-- foi marcado satisfeito, mas a versao aprovada e nula ou nao esta realmente
-- aprovada, volta para pendente mantendo documento_id para analise do gestor.
UPDATE public.documento_requisito_instancias dri
SET status = 'pendente',
    versao_aprovada_id = NULL,
    satisfeito_em = NULL
WHERE dri.status = 'satisfeito'
  AND dri.escopo_snapshot IN ('nf_pre_cessao', 'pos_cessao')
  AND NOT EXISTS (
    SELECT 1
    FROM public.documento_versoes dv
    WHERE dv.id = dri.versao_aprovada_id
      AND dv.status = 'aprovado'
  );
