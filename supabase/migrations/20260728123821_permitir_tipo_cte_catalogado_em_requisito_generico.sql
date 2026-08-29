-- Permite que requisitos documentais com codigo generico "cte" aceitem os
-- tipos catalogados concretos usados no upload: "cte_xml" e "cte_pdf_dacte".
--
-- A regra anterior comparava apenas documento_tipo_id do requisito contra o
-- tipo enviado. Em politicas publicadas o requisito pode permanecer semanticamente
-- como "cte", enquanto o arquivo real precisa ser validado como XML ou PDF/DACTE.
-- A compatibilidade abaixo e estrita: apenas CT-e possui aliases aceitos.

CREATE OR REPLACE FUNCTION public.documento_tipo_compativel_com_requisito(
  p_requisito_codigo text,
  p_documento_tipo_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documento_tipos dt
    WHERE dt.id = p_documento_tipo_id
      AND dt.ativo = true
      AND (
        dt.codigo = p_requisito_codigo
        OR (
          p_requisito_codigo = 'cte'
          AND dt.codigo IN ('cte_xml', 'cte_pdf_dacte')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.documento_tipo_compativel_com_requisito(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.documento_tipo_compativel_com_requisito(text, uuid) TO authenticated, service_role;

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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE id = p_requisito_id
    AND nota_fiscal_id = p_nota_fiscal_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> nf_cedente THEN RAISE EXCEPTION 'Requisito documental fora do cedente da NF'; END IF;
  IF NOT public.documento_tipo_compativel_com_requisito(requirement.tipo_documento_codigo_snapshot, p_documento_tipo_id) THEN
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
  ELSE
    UPDATE public.documentos_repositorio
    SET documento_tipo_id = p_documento_tipo_id
    WHERE id = doc_id
      AND documento_tipo_id IS DISTINCT FROM p_documento_tipo_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    'em_analise', p_substitui_versao_id, p_enviado_por
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'em_analise', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id,
      documento_tipo_id = p_documento_tipo_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
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

REVOKE ALL ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_documento_entrega_upload(
  p_nota_fiscal_entrega_id uuid,
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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  entrega record;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('gestor', 'cedente') OR p_enviado_por <> actor_id THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento de entrega';
  END IF;

  SELECT nfe.*, n.cedente_id, n.cedente_fundo_id, n.fundo_id
    INTO entrega
  FROM public.nota_fiscal_entregas nfe
  JOIN public.notas_fiscais n ON n.id = nfe.nota_fiscal_id
  WHERE nfe.id = p_nota_fiscal_entrega_id
  FOR UPDATE;

  IF entrega.id IS NULL THEN RAISE EXCEPTION 'Entrega documental nao encontrada'; END IF;
  IF entrega.status_entrega IN ('nao_aplicavel', 'cancelada', 'devolvida', 'entregue') THEN
    RAISE EXCEPTION 'Entrega nao esta aberta para upload documental';
  END IF;
  IF entrega.cedente_fundo_id IS NULL OR entrega.fundo_id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND entrega.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Entrega fora do cedente autenticado';
  END IF;

  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id
    AND nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental de entrega invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> entrega.cedente_id THEN RAISE EXCEPTION 'Requisito documental fora do cedente da entrega'; END IF;
  IF NOT public.documento_tipo_compativel_com_requisito(requirement.tipo_documento_codigo_snapshot, p_documento_tipo_id) THEN
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

    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_entrega_id, entrega.cedente_id);
  ELSE
    UPDATE public.documentos_repositorio
    SET documento_tipo_id = p_documento_tipo_id
    WHERE id = doc_id
      AND documento_tipo_id IS DISTINCT FROM p_documento_tipo_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    'em_analise', p_substitui_versao_id, p_enviado_por
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'em_analise', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id,
      documento_tipo_id = p_documento_tipo_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
  WHERE id = p_requisito_id;

  IF entrega.status_entrega IN ('em_transito', 'entrega_com_pendencia') THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'aguardando_validacao',
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;
  END IF;

  PERFORM public.registrar_evento_entrega(
    p_nota_fiscal_entrega_id,
    CASE
      WHEN requirement.tipo_documento_codigo_snapshot = 'cte' THEN 'cte_enviado'
      ELSE 'documento_entrega_enviado'
    END,
    entrega.status_entrega,
    'aguardando_validacao',
    'usuario',
    jsonb_build_object('requisito_id', p_requisito_id, 'versao_id', version_id, 'tipo_documento_codigo', requirement.tipo_documento_codigo_snapshot)
  );

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'nota_fiscal_entrega_id', p_nota_fiscal_entrega_id,
    'cedente_fundo_id', entrega.cedente_fundo_id,
    'fundo_id', entrega.fundo_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_documento_entrega_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_documento_entrega_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;
