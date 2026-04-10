-- ============================================================
-- Migration: Storage buckets privados
-- O isolamento entre ambientes é garantido pelo Supabase Branching.
-- Cada branch tem seu próprio storage independente.
-- ============================================================

-- ============================================================
-- 1. Criar buckets privados
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-cedentes', 'documentos-cedentes', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('notas-fiscais', 'notas-fiscais', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos', 'contratos', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Policies para documentos-cedentes
-- ============================================================

CREATE POLICY storage_docs_cedente_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_docs_cedente_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_docs_cedente_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_docs_gestor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'gestor'
  );

CREATE POLICY storage_docs_gestor_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'gestor'
  );

CREATE POLICY storage_docs_consultor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'consultor'
  );

-- ============================================================
-- 3. Policies para notas-fiscais
-- ============================================================

CREATE POLICY storage_nfs_cedente_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_nfs_cedente_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_nfs_gestor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'gestor'
  );

CREATE POLICY storage_nfs_consultor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'consultor'
  );

-- ============================================================
-- 4. Policies para contratos
-- ============================================================

CREATE POLICY storage_contratos_gestor_all ON storage.objects
  FOR ALL USING (
    bucket_id = 'contratos'
    AND get_user_role() = 'gestor'
  );

CREATE POLICY storage_contratos_cedente_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'contratos'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = 'cedentes'
    AND (storage.foldername(name))[2] = (
      SELECT id::text FROM cedentes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY storage_contratos_consultor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'contratos'
    AND get_user_role() = 'consultor'
  );