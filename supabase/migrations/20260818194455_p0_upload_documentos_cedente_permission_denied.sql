BEGIN;

-- O hardening de ACL preserva somente SELECT direto para authenticated.
-- Escritas cadastrais passam por esta operacao estreita e contextual.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.documentos FROM authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS documentos_storage_path_unique
  ON public.documentos (url_arquivo)
  WHERE url_arquivo IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documentos_versao_contexto_unique
  ON public.documentos (cedente_id, tipo, representante_id, versao)
  NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.registrar_documento_cadastral_cedente(
  p_tipo public.documento_tipo,
  p_storage_path text,
  p_nome_arquivo text,
  p_representante_id uuid DEFAULT NULL
)
RETURNS TABLE (
  documento_id uuid,
  versao integer,
  status public.documento_status,
  storage_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cedente_id uuid;
  v_cedente_cnpj text;
  v_cedente_user_id uuid;
  v_prefixo text;
  v_metadata jsonb;
  v_owner_id text;
  v_mime_type text;
  v_tamanho_bytes bigint;
  v_versao integer;
  v_existente public.documentos%ROWTYPE;
  v_documento public.documentos%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para registrar documento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles perfil
    WHERE perfil.id = v_user_id
      AND perfil.role = 'cedente'::public.user_role
      AND perfil.status = 'ativo'::public.user_status
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente cedente ativo pode registrar documento cadastral.';
  END IF;

  v_cedente_id := public.get_user_cedente_id();

  SELECT cedente.cnpj, cedente.user_id
  INTO v_cedente_cnpj, v_cedente_user_id
  FROM public.cedentes cedente
  WHERE cedente.id = v_cedente_id;

  IF v_cedente_id IS NULL OR v_cedente_cnpj IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cadastro de cedente nao encontrado para o usuario autenticado.';
  END IF;

  IF v_cedente_user_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.cedente_acessos acesso
       WHERE acesso.cedente_id = v_cedente_id
         AND acesso.user_id = v_user_id
         AND acesso.ativo = true
         AND acesso.perfil = 'administrador'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administrador do cedente pode registrar documento cadastral.';
  END IF;

  IF p_nome_arquivo IS NULL
     OR btrim(p_nome_arquivo) = ''
     OR length(p_nome_arquivo) > 255
     OR p_nome_arquivo ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nome de arquivo invalido.';
  END IF;

  IF p_storage_path IS NULL
     OR length(p_storage_path) > 1024
     OR p_storage_path LIKE '/%'
     OR p_storage_path LIKE '%\\%'
     OR p_storage_path LIKE '%//%'
     OR p_storage_path ~ '(^|/)\.\.(/|$)' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Caminho de Storage invalido.';
  END IF;

  IF p_representante_id IS NULL THEN
    v_prefixo := v_cedente_cnpj || '/' || p_tipo::text || '/';
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.representantes representante
      WHERE representante.id = p_representante_id
        AND representante.cedente_id = v_cedente_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Representante nao pertence ao cedente autenticado.';
    END IF;
    v_prefixo := v_cedente_cnpj || '/representantes/' || p_representante_id::text || '/';
  END IF;

  IF left(p_storage_path, length(v_prefixo)) <> v_prefixo
     OR length(p_storage_path) <= length(v_prefixo) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caminho de Storage nao pertence ao cedente autenticado.';
  END IF;

  SELECT objeto.metadata, objeto.owner_id
  INTO v_metadata, v_owner_id
  FROM storage.objects objeto
  WHERE objeto.bucket_id = 'documentos-cedentes'
    AND objeto.name = p_storage_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Arquivo nao encontrado no Storage autorizado.';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_user_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Arquivo do Storage nao pertence ao usuario autenticado.';
  END IF;

  v_mime_type := lower(COALESCE(v_metadata ->> 'mimetype', ''));
  IF v_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Formato de arquivo nao permitido.';
  END IF;

  IF COALESCE(v_metadata ->> 'size', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tamanho do arquivo nao foi registrado pelo Storage.';
  END IF;

  v_tamanho_bytes := (v_metadata ->> 'size')::bigint;
  IF v_tamanho_bytes <= 0 OR v_tamanho_bytes > 20 * 1024 * 1024 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Arquivo excede o limite permitido de 20MB.';
  END IF;

  SELECT documento.*
  INTO v_existente
  FROM public.documentos documento
  WHERE documento.url_arquivo = p_storage_path;

  IF FOUND THEN
    IF v_existente.cedente_id IS DISTINCT FROM v_cedente_id
       OR v_existente.tipo IS DISTINCT FROM p_tipo
       OR v_existente.representante_id IS DISTINCT FROM p_representante_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Caminho de Storage ja vinculado a outro contexto documental.';
    END IF;

    RETURN QUERY
    SELECT v_existente.id, v_existente.versao, v_existente.status, v_existente.url_arquivo;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_cedente_id::text || ':' || p_tipo::text || ':' || COALESCE(p_representante_id::text, 'empresa'),
      0
    )
  );

  SELECT COALESCE(MAX(documento.versao), 0) + 1
  INTO v_versao
  FROM public.documentos documento
  WHERE documento.cedente_id = v_cedente_id
    AND documento.tipo = p_tipo
    AND documento.representante_id IS NOT DISTINCT FROM p_representante_id;

  INSERT INTO public.documentos (
    cedente_id,
    tipo,
    versao,
    status,
    url_arquivo,
    nome_arquivo,
    representante_id
  )
  VALUES (
    v_cedente_id,
    p_tipo,
    v_versao,
    'enviado'::public.documento_status,
    p_storage_path,
    p_nome_arquivo,
    p_representante_id
  )
  RETURNING * INTO v_documento;

  RETURN QUERY
  SELECT v_documento.id, v_documento.versao, v_documento.status, v_documento.url_arquivo;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_documento_cadastral_cedente(public.documento_tipo, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_cadastral_cedente(public.documento_tipo, text, text, uuid) TO authenticated;

-- A compensacao pode apagar somente o objeto proprio que ainda nao foi
-- vinculado a um documento. Documentos persistidos permanecem protegidos.
DROP POLICY IF EXISTS storage_docs_cedente_delete_orphan ON storage.objects;
CREATE POLICY storage_docs_cedente_delete_orphan
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND owner_id = auth.uid()::text
    AND (storage.foldername(name))[1] = (
      SELECT cedente.cnpj
      FROM public.cedentes cedente
      WHERE cedente.id = public.get_user_cedente_id()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.documentos documento
      WHERE documento.url_arquivo = storage.objects.name
    )
  );

COMMIT;
