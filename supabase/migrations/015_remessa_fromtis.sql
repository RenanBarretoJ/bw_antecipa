ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS remessa_url             text;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS remessa_gerado_em       timestamptz;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS remessa_enviado_em      timestamptz;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS remessa_fromtis_id      text;
ALTER TABLE operacoes ADD COLUMN IF NOT EXISTS remessa_fromtis_retorno text;
