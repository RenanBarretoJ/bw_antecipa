-- Corrige o contexto multifundo das notas fiscais enviadas por cedente.
-- A NF passa a carregar explicitamente o vinculo cedente_fundo e o fundo usados
-- no registro documental, evitando inferencia pelo usuario autenticado.

ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS cedente_fundo_id uuid REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT;

WITH vinculos_unicos AS (
  SELECT
    cf.cedente_id,
    (array_agg(cf.id ORDER BY cf.vigente_desde DESC NULLS LAST, cf.created_at DESC))[1] AS cedente_fundo_id,
    (array_agg(cf.fundo_id ORDER BY cf.vigente_desde DESC NULLS LAST, cf.created_at DESC))[1] AS fundo_id,
    count(*) AS quantidade
  FROM public.cedente_fundos cf
  WHERE cf.status = 'ativo'
  GROUP BY cf.cedente_id
)
UPDATE public.notas_fiscais nf
SET
  cedente_fundo_id = vu.cedente_fundo_id,
  fundo_id = vu.fundo_id
FROM vinculos_unicos vu
WHERE nf.cedente_id = vu.cedente_id
  AND vu.quantidade = 1
  AND nf.cedente_fundo_id IS NULL
  AND nf.fundo_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_cedente_fundo_id
  ON public.notas_fiscais(cedente_fundo_id);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_fundo_id
  ON public.notas_fiscais(fundo_id);

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_cedente_fundo_status
  ON public.notas_fiscais(cedente_id, fundo_id, cedente_fundo_id, status);

CREATE OR REPLACE FUNCTION public.validar_contexto_multifundo_nota_fiscal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  link_row record;
BEGIN
  IF NEW.cedente_fundo_id IS NULL OR NEW.fundo_id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal deve possuir cedente_fundo_id e fundo_id.';
  END IF;

  SELECT cf.id, cf.cedente_id, cf.fundo_id, cf.status, f.ativo AS fundo_ativo
    INTO link_row
  FROM public.cedente_fundos cf
  JOIN public.fundos f ON f.id = cf.fundo_id
  WHERE cf.id = NEW.cedente_fundo_id;

  IF link_row.id IS NULL THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo da nota fiscal nao encontrado.';
  END IF;
  IF link_row.cedente_id <> NEW.cedente_id THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao pertence ao cedente da nota fiscal.';
  END IF;
  IF link_row.fundo_id <> NEW.fundo_id THEN
    RAISE EXCEPTION 'Fundo da nota fiscal diverge do vinculo cedente-fundo.';
  END IF;
  IF link_row.status <> 'ativo' THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo da nota fiscal nao esta ativo.';
  END IF;
  IF link_row.fundo_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Fundo da nota fiscal esta inativo.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notas_fiscais_validar_contexto_multifundo ON public.notas_fiscais;
CREATE TRIGGER notas_fiscais_validar_contexto_multifundo
  BEFORE INSERT OR UPDATE OF cedente_id, cedente_fundo_id, fundo_id
  ON public.notas_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_contexto_multifundo_nota_fiscal();

DROP POLICY IF EXISTS notas_fiscais_cedente_insert ON public.notas_fiscais;
CREATE POLICY notas_fiscais_cedente_insert ON public.notas_fiscais
  FOR INSERT
  TO authenticated
  WITH CHECK (
    cedente_id = (SELECT get_user_cedente_id())
    AND cedente_fundo_id IS NOT NULL
    AND fundo_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
        AND cf.status = 'ativo'
        AND f.ativo IS TRUE
    )
  );

DROP POLICY IF EXISTS notas_fiscais_cedente_update ON public.notas_fiscais;
CREATE POLICY notas_fiscais_cedente_update ON public.notas_fiscais
  FOR UPDATE
  TO authenticated
  USING (cedente_id = (SELECT get_user_cedente_id()))
  WITH CHECK (
    cedente_id = (SELECT get_user_cedente_id())
    AND (
      (cedente_fundo_id IS NULL AND fundo_id IS NULL)
      OR (
        cedente_fundo_id IS NOT NULL
        AND fundo_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.cedente_fundos cf
          JOIN public.fundos f ON f.id = cf.fundo_id
          WHERE cf.id = notas_fiscais.cedente_fundo_id
            AND cf.cedente_id = notas_fiscais.cedente_id
            AND cf.fundo_id = notas_fiscais.fundo_id
            AND cf.status = 'ativo'
            AND f.ativo IS TRUE
        )
      )
    )
  );

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
    r.documento_tipo_id, r.tipo_documento_codigo, r.escopo, p_nota_fiscal_id, nf_cedente,
    r.obrigatorio,
    CASE WHEN r.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + r.prazo_dias_corridos) END,
    r.formatos_aceitos, r.nivel_validacao, r.quantidade_minima,
    r.responsavel_upload, r.responsavel_aprovacao
  FROM public.politica_requisitos_documentais r
  WHERE r.politica_operacional_versao_id = p_politica_versao_id
    AND r.escopo = 'nf_pre_cessao'
    AND r.ativo
  ON CONFLICT (politica_requisito_id, nota_fiscal_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'inseridos', inserted_count, 'politica_versao', version_number, 'cedente_fundo_id', nf_cedente_fundo, 'fundo_id', nf_fundo);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_documento_upload(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_role text;
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  actor_role := get_user_role();
  IF auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente') OR p_enviado_por <> auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN RAISE EXCEPTION 'NF fora do cedente autenticado'; END IF;

  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id AND nota_fiscal_id = p_nota_fiscal_id AND status NOT IN ('cancelado', 'satisfeito');

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> nf_cedente THEN RAISE EXCEPTION 'Requisito documental fora do cedente da NF'; END IF;
  IF requirement.documento_tipo_id IS NULL OR requirement.documento_tipo_id <> p_documento_tipo_id THEN
    RAISE EXCEPTION 'Tipo de documento nao corresponde ao requisito';
  END IF;
  IF p_bucket <> 'documentos-v2' OR length(p_path) = 0 OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;

  doc_id := requirement.documento_id;
  IF doc_id IS NULL THEN
    INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
    VALUES (p_documento_tipo_id, 'pendente', p_enviado_por)
    RETURNING id INTO doc_id;
    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_id, nf_cedente);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, p_mime_type, p_tamanho_bytes, lower(p_sha256),
    'enviado', p_substitui_versao_id, p_enviado_por
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'enviado', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id, versao_aprovada_id = NULL, status = 'pendente', satisfeito_em = NULL
  WHERE id = p_requisito_id;

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid),
  public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC;
