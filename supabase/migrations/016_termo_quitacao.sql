-- Migration: termo de quitacao da operacao (minuta gerada + assinado) e data de liquidacao

ALTER TABLE operacoes
  ADD COLUMN IF NOT EXISTS liquidada_em timestamptz,
  ADD COLUMN IF NOT EXISTS quitacao_url text,
  ADD COLUMN IF NOT EXISTS quitacao_gerado_em timestamptz,
  ADD COLUMN IF NOT EXISTS quitacao_assinada_url text;
