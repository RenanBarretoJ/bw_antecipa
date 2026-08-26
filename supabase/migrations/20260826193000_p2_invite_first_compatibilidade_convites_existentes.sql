BEGIN;

-- Preserva o contrato de convites para usuarios de Cedente existente criado
-- na P1. As regras estritas de token e ciclo de vida permanecem exclusivas
-- do fluxo NOVO_CEDENTE implementado na P2.

ALTER TABLE public.cedente_usuario_convites
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_token_hash_check,
  DROP CONSTRAINT IF EXISTS cedente_usuario_convites_ciclo_vida_check;

ALTER TABLE public.cedente_usuario_convites
  ADD CONSTRAINT cedente_usuario_convites_token_hash_check CHECK (
    (tipo = 'NOVO_CEDENTE' AND token_hash ~ '^[0-9a-f]{64}$')
    OR (tipo = 'USUARIO_CEDENTE_EXISTENTE' AND pg_catalog.length(pg_catalog.btrim(token_hash)) >= 32)
  ),
  ADD CONSTRAINT cedente_usuario_convites_ciclo_vida_check CHECK (
    (
      tipo = 'NOVO_CEDENTE'
      AND (
        (status = 'PENDENTE'
          AND aceito_por_user_id IS NULL AND aceito_em IS NULL
          AND cancelado_em IS NULL AND expirado_em IS NULL)
        OR (status = 'ACEITO'
          AND aceito_por_user_id IS NOT NULL AND aceito_em IS NOT NULL
          AND cancelado_em IS NULL AND expirado_em IS NULL)
        OR (status = 'CANCELADO'
          AND aceito_por_user_id IS NULL AND aceito_em IS NULL
          AND cancelado_em IS NOT NULL AND expirado_em IS NULL)
        OR (status = 'EXPIRADO'
          AND aceito_por_user_id IS NULL AND aceito_em IS NULL
          AND cancelado_em IS NULL AND expirado_em IS NOT NULL)
      )
    )
    OR (
      tipo = 'USUARIO_CEDENTE_EXISTENTE'
      AND (
        (status = 'ACEITO' AND aceito_por_user_id IS NOT NULL AND aceito_em IS NOT NULL)
        OR (status <> 'ACEITO' AND aceito_por_user_id IS NULL AND aceito_em IS NULL)
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
