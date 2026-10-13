-- Local corrective candidate. The earlier global guard remains immutable evidence.
-- Scope is determined by canonical fiscal registrations, never filename/MIME.
-- Existing entity/fund policies still authorize each object independently.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.obter_sessao_mfa_atual()') IS NULL
     OR to_regclass('private.fiscal_storage_intents') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.documento_versoes'::regclass
         AND attname = 'fiscal_reservation_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class
       WHERE oid = 'storage.objects'::regclass AND relrowsecurity
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid = 'storage.objects'::regclass
         AND polname = 'storage_private_objects_select_authorized'
         AND polcmd = 'r' AND polpermissive
     ) THEN
    RAISE EXCEPTION 'Canonical fiscal Storage guard prerequisites are missing';
  END IF;
END;
$$;

-- Same live-session contract as the frozen guard, with no new object authority.
CREATE OR REPLACE FUNCTION private.usuario_tem_sessao_storage_valida()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2'
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.status = 'ativo'
     ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
    WHERE estado.status = 'valid'
  );
END;
$$;

-- Exact bucket/path lookup, backed by existing intent/version/NF indexes.
-- No state/generation filter: retry, aborted, pending cleanup and tombstone
-- paths retain their fiscal classification, including before domain commit.
CREATE OR REPLACE FUNCTION private.objeto_storage_tem_identidade_fiscal(
  p_bucket text,
  p_path text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_bucket IS NULL OR p_path IS NULL
     OR p_bucket NOT IN ('notas-fiscais', 'documentos-v2') THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.fiscal_storage_intents intent
    WHERE intent.bucket = p_bucket AND intent.path = p_path
  ) OR EXISTS (
    SELECT 1 FROM public.documento_versoes versao
    WHERE versao.bucket = p_bucket AND versao.path = p_path
      AND versao.fiscal_reservation_id IS NOT NULL
  ) THEN
    RETURN true;
  END IF;

  -- Legacy NF files are fiscal because the domain registered this exact path.
  IF p_bucket = 'notas-fiscais' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.notas_fiscais nf WHERE nf.arquivo_url = p_path
    );
  END IF;

  -- Legacy NFS-e original resolution mirrors obterUrlArquivoNotaFiscal:
  -- NFSE + nf_danfe_pdf requirement + original provenance SHA, not every
  -- document linked to a NF (e.g. boleto or cadastral/operational evidence).
  RETURN EXISTS (
    SELECT 1 FROM public.documento_versoes versao
    JOIN public.documento_requisito_instancias requisito
      ON requisito.documento_id = versao.documento_id
    JOIN public.notas_fiscais nf ON nf.id = requisito.nota_fiscal_id
    WHERE versao.bucket = p_bucket AND versao.path = p_path
      AND requisito.tipo_documento_codigo_snapshot = 'nf_danfe_pdf'
      AND nf.tipo_documento_fiscal = 'NFSE'
      AND nf.fiscal_reservation_id IS NULL
      AND versao.sha256 = (nf.fiscal_proveniencia ->> 'sha256')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.usuario_tem_sessao_storage_valida()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.objeto_storage_tem_identidade_fiscal(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.usuario_tem_sessao_storage_valida()
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.objeto_storage_tem_identidade_fiscal(text, text)
  TO authenticated;

-- Supports both the original 22-SQL baseline and a local prior-global replay.
-- Never change any permissive entity/fund policy or grant access to an object.
DROP POLICY IF EXISTS storage_select_requires_valid_mfa_session ON storage.objects;
DROP POLICY IF EXISTS storage_fiscal_objects_select_requires_live_session ON storage.objects;
CREATE POLICY storage_fiscal_objects_select_requires_live_session
  ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.usuario_tem_sessao_storage_valida())
    OR NOT private.objeto_storage_tem_identidade_fiscal(bucket_id, name)
  );

COMMIT;
