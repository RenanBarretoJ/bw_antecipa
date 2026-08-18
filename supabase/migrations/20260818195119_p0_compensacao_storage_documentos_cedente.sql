-- P0: permite que a API do Storage localize exclusivamente o objeto temporario
-- proprio que precisa ser removido pela compensacao. Objetos ja registrados em
-- public.documentos continuam dependendo da policy canonica de leitura.
BEGIN;

DROP POLICY IF EXISTS storage_docs_cedente_select_orphan_own
  ON storage.objects;

CREATE POLICY storage_docs_cedente_select_orphan_own
  ON storage.objects
  FOR SELECT
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
