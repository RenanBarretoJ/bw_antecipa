-- Migration: adiciona aceite_sacado_em em notas_fiscais
-- Registra o timestamp exato em que o sacado confirmou o aceite da cessão.
-- Deve ser limpo (NULL) quando a NF for removida da operação e revertida para 'aprovada'.

ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS aceite_sacado_em timestamptz;

ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS aprovada_gestor_em timestamptz;
