-- Migration 008: Colunas para solicitação de atualização de documentos
ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS atualizacao_solicitada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS atualizacao_solicitada_por UUID REFERENCES auth.users(id);
