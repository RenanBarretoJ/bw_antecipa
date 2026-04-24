-- Migration: renomeia aceite_sacado_em para aprovacao_sacado_em em notas_fiscais
ALTER TABLE notas_fiscais
  RENAME COLUMN aceite_sacado_em TO aprovacao_sacado_em;
