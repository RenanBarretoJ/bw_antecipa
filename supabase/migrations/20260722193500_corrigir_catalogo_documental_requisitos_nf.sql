-- Corrige requisitos documentais de NF sem documento_tipo_id.
-- Alguns requisitos/politicas antigas possuem tipo_documento_codigo = nf_xml
-- mas nao carregaram o FK para documento_tipos, quebrando o upload documental.

INSERT INTO public.documento_tipos (
  codigo,
  nome,
  dominio,
  mime_types_aceitos,
  extensoes_aceitas,
  tamanho_max_bytes,
  permite_multiplas_versoes,
  ativo
)
VALUES
  ('nf_xml', 'XML da NF-e', 'nf', ARRAY['application/xml', 'text/xml', 'application/octet-stream'], ARRAY['xml'], 20971520, true, true),
  ('nf_danfe_pdf', 'DANFE em PDF', 'nf', ARRAY['application/pdf'], ARRAY['pdf'], 20971520, true, true),
  ('nf_pedido_compra', 'Pedido de Compra', 'nf', ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520, true, true),
  ('cte_xml', 'CT-e XML', 'entrega', ARRAY['application/xml', 'text/xml', 'application/octet-stream'], ARRAY['xml'], 20971520, true, true),
  ('cte_pdf_dacte', 'CT-e PDF/DACTE', 'entrega', ARRAY['application/pdf'], ARRAY['pdf'], 20971520, true, true),
  ('canhoto', 'Canhoto de entrega', 'entrega', ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520, true, true)
ON CONFLICT (codigo) DO UPDATE
SET
  nome = EXCLUDED.nome,
  dominio = EXCLUDED.dominio,
  mime_types_aceitos = EXCLUDED.mime_types_aceitos,
  extensoes_aceitas = EXCLUDED.extensoes_aceitas,
  tamanho_max_bytes = EXCLUDED.tamanho_max_bytes,
  permite_multiplas_versoes = EXCLUDED.permite_multiplas_versoes,
  ativo = true,
  updated_at = now();

UPDATE public.documento_requisito_instancias dri
SET documento_tipo_id = dt.id
FROM public.documento_tipos dt
WHERE dt.codigo = dri.tipo_documento_codigo_snapshot
  AND dt.ativo = true
  AND dri.tipo_documento_codigo_snapshot IN ('nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra')
  AND dri.documento_tipo_id IS DISTINCT FROM dt.id;

UPDATE public.documento_requisito_instancias dri
SET documento_tipo_id = dt.id
FROM public.documento_tipos dt
WHERE dt.codigo = CASE
    WHEN dri.tipo_documento_codigo_snapshot = 'cte' THEN 'cte_xml'
    ELSE dri.tipo_documento_codigo_snapshot
  END
  AND dt.ativo = true
  AND dri.tipo_documento_codigo_snapshot IN ('cte', 'canhoto')
  AND dri.documento_tipo_id IS DISTINCT FROM dt.id;

CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  policy_cedente_fundo uuid;
  policy_cedente uuid;
  policy_fundo uuid;
  version_number integer;
  inserted_count integer;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  SELECT po.cedente_fundo_id, cf.cedente_id, cf.fundo_id, pov.versao
    INTO policy_cedente_fundo, policy_cedente, policy_fundo, version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundos cf ON cf.id = po.cedente_fundo_id
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND pov.cedente_fundo_id = po.cedente_fundo_id
    AND pov.publicada_em IS NOT NULL;

  IF policy_cedente IS NULL THEN RAISE EXCEPTION 'Politica operacional publicada nao encontrada'; END IF;
  IF policy_cedente <> nf_cedente THEN RAISE EXCEPTION 'Politica operacional fora do cedente da NF'; END IF;
  IF policy_cedente_fundo <> nf_cedente_fundo OR policy_fundo <> nf_fundo THEN
    RAISE EXCEPTION 'Politica operacional fora do contexto multifundo da NF';
  END IF;

  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, cedente_id,
    obrigatorio, prazo_limite, formatos_aceitos_snapshot, nivel_validacao_snapshot,
    quantidade_minima_snapshot, responsavel_upload_snapshot, responsavel_aprovacao_snapshot
  )
  SELECT r.id, r.politica_operacional_id, r.politica_operacional_versao_id, version_number,
    COALESCE(r.documento_tipo_id, dt.id), r.tipo_documento_codigo, r.escopo, p_nota_fiscal_id, nf_cedente,
    r.obrigatorio,
    CASE WHEN r.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + r.prazo_dias_corridos) END,
    r.formatos_aceitos, r.nivel_validacao, r.quantidade_minima,
    r.responsavel_upload, r.responsavel_aprovacao
  FROM public.politica_requisitos_documentais r
  LEFT JOIN public.documento_tipos dt
    ON dt.codigo = CASE
      WHEN r.tipo_documento_codigo = 'cte' THEN 'cte_xml'
      ELSE r.tipo_documento_codigo
    END
   AND dt.ativo = true
  WHERE r.politica_operacional_versao_id = p_politica_versao_id
    AND r.escopo = 'nf_pre_cessao'
    AND r.ativo
  ON CONFLICT (politica_requisito_id, nota_fiscal_id) DO UPDATE
  SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id);

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'inseridos_ou_atualizados', inserted_count, 'politica_versao', version_number, 'cedente_fundo_id', nf_cedente_fundo, 'fundo_id', nf_fundo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
