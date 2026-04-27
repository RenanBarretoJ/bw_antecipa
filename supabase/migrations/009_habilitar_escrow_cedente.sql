-- Migration 009: Flag de habilitação de extrato escrow por cedente
ALTER TABLE cedentes ADD COLUMN IF NOT EXISTS habilitar_escrow boolean NOT NULL DEFAULT false;
