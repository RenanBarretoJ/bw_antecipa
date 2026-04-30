ALTER TYPE nf_status ADD VALUE IF NOT EXISTS 'requer_ajuste';

ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS motivo_ajuste text;
