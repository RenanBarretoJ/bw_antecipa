-- ============================================================
-- BW Antecipa - Storage Buckets e Policies
-- ============================================================

-- 1. Criar buckets privados
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-cedentes', 'documentos-cedentes', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('notas-fiscais', 'notas-fiscais', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Policies para bucket documentos-cedentes
-- ============================================================

-- Cedente: upload na pasta do proprio CNPJ
CREATE POLICY storage_docs_cedente_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

-- Cedente: leitura na pasta do proprio CNPJ
CREATE POLICY storage_docs_cedente_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

-- Cedente: update (reenvio) na pasta do proprio CNPJ
CREATE POLICY storage_docs_cedente_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

-- Gestor: leitura em todos os arquivos
CREATE POLICY storage_docs_gestor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'gestor'
  );

-- Gestor: pode inserir/atualizar tambem
CREATE POLICY storage_docs_gestor_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'gestor'
  );

-- Consultor: somente leitura
CREATE POLICY storage_docs_consultor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos-cedentes'
    AND get_user_role() = 'consultor'
  );

-- ============================================================
-- 3. Policies para bucket notas-fiscais
-- ============================================================

-- Cedente: upload na pasta do proprio CNPJ
CREATE POLICY storage_nfs_cedente_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

-- Cedente: leitura na pasta do proprio CNPJ
CREATE POLICY storage_nfs_cedente_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'cedente'
    AND (storage.foldername(name))[1] = (
      SELECT cnpj FROM cedentes WHERE user_id = auth.uid()
    )
  );

-- Gestor: leitura em todas as NFs
CREATE POLICY storage_nfs_gestor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'gestor'
  );

-- Consultor: somente leitura
CREATE POLICY storage_nfs_consultor_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'notas-fiscais'
    AND get_user_role() = 'consultor'
  );
