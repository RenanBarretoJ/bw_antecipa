-- Corrige a RPC de instanciacao do checklist documental da NF para a
-- arquitetura atual:
-- - politicas_operacionais pertence ao fundo;
-- - cedente_fundo_politicas vincula cedente_fundos -> politica;
-- - documento_requisito_instancias NAO possui fundo_id/cedente_fundo_id.

CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
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

  IF nf_cedente IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;

  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  SELECT pov.versao
    INTO version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundo_politicas cfp
    ON cfp.politica_operacional_id = po.id
   AND cfp.cedente_fundo_id = nf_cedente_fundo
   AND cfp.status = 'ativa'
   AND cfp.vigente_desde <= now()
   AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND po.fundo_id = nf_fundo
    AND po.status = 'ativa'
    AND pov.fundo_id = nf_fundo
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_ate IS NULL
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF version_number IS NULL THEN
    RAISE EXCEPTION 'Politica operacional publicada nao vinculada ao contexto da NF';
  END IF;

  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id,
    politica_operacional_id,
    politica_operacional_versao_id,
    politica_versao,
    documento_tipo_id,
    tipo_documento_codigo_snapshot,
    escopo_snapshot,
    nota_fiscal_id,
    cedente_id,
    status,
    obrigatorio,
    prazo_limite,
    formatos_aceitos_snapshot,
    nivel_validacao_snapshot,
    quantidade_minima_snapshot,
    responsavel_upload_snapshot,
    responsavel_aprovacao_snapshot
  )
  SELECT
    r.id,
    r.politica_operacional_id,
    r.politica_operacional_versao_id,
    version_number,
    r.documento_tipo_id,
    r.tipo_documento_codigo,
    r.escopo,
    p_nota_fiscal_id,
    nf_cedente,
    'pendente',
    r.obrigatorio,
    CASE WHEN r.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + r.prazo_dias_corridos) END,
    r.formatos_aceitos,
    r.nivel_validacao,
    r.quantidade_minima,
    r.responsavel_upload,
    r.responsavel_aprovacao
  FROM public.politica_requisitos_documentais r
  WHERE r.politica_operacional_versao_id = p_politica_versao_id
    AND r.escopo = 'nf_pre_cessao'
    AND r.ativo
  ON CONFLICT (politica_requisito_id, nota_fiscal_id) DO UPDATE
    SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id);

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'inseridos', inserted_count,
    'politica_versao', version_number,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) TO authenticated;
