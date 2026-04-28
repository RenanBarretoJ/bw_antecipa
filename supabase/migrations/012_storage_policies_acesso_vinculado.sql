-- Migration 012: Corrigir policies de storage para suportar usuarios vinculados via cedente_acessos
-- As policies anteriores usavam (SELECT cnpj FROM cedentes WHERE user_id = auth.uid()),
-- que nao funciona para usuarios convidados. Substituir por get_user_cedente_id().

-- documentos-cedentes
DROP POLICY IF EXISTS storage_docs_cedente_insert ON storage.objects;
DROP POLICY IF EXISTS storage_docs_cedente_select ON storage.objects;
DROP POLICY IF EXISTS storage_docs_cedente_update ON storage.objects;

CREATE POLICY storage_docs_cedente_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documentos-cedentes'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);
CREATE POLICY storage_docs_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'documentos-cedentes'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);
CREATE POLICY storage_docs_cedente_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'documentos-cedentes'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);

-- notas-fiscais
DROP POLICY IF EXISTS storage_nfs_cedente_insert ON storage.objects;
DROP POLICY IF EXISTS storage_nfs_cedente_select ON storage.objects;

CREATE POLICY storage_nfs_cedente_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'notas-fiscais'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);
CREATE POLICY storage_nfs_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'notas-fiscais'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);

-- contratos
DROP POLICY IF EXISTS storage_contratos_cedente_select ON storage.objects;

CREATE POLICY storage_contratos_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'contratos'
  AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE id = get_user_cedente_id())
);
