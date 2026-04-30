ALTER TABLE cedentes ADD COLUMN IF NOT EXISTS coobrigacao boolean NOT NULL DEFAULT true;

ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS notificacao_url text;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS notificacao_gerado_em timestamptz;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS notificacao_assinada_url text;
