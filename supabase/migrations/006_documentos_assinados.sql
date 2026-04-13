-- Migration: colunas para armazenar documentos assinados e comprovante de pagamento

ALTER TABLE cedentes
  ADD COLUMN IF NOT EXISTS contrato_assinado_url text;

ALTER TABLE operacoes
  ADD COLUMN IF NOT EXISTS termo_assinado_url text,
  ADD COLUMN IF NOT EXISTS comprovante_pagamento_url text;
