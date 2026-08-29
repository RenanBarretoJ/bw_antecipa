-- Fase 1: separar ator humano, sistema, cron e integração nos logs.
-- A migration é incremental e não altera migrations históricas.

ALTER TABLE public.logs_auditoria
  ALTER COLUMN usuario_id DROP NOT NULL;

ALTER TABLE public.logs_auditoria
  ADD COLUMN IF NOT EXISTS ator_tipo text NOT NULL DEFAULT 'usuario',
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'server_action',
  ADD COLUMN IF NOT EXISTS ator_identificador text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'logs_auditoria_ator_tipo_check'
      AND conrelid = 'public.logs_auditoria'::regclass
  ) THEN
    ALTER TABLE public.logs_auditoria
      ADD CONSTRAINT logs_auditoria_ator_tipo_check
      CHECK (ator_tipo IN ('usuario', 'sistema', 'integracao', 'cron'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_ator_tipo
  ON public.logs_auditoria(ator_tipo);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_origem
  ON public.logs_auditoria(origem);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_ator_identificador
  ON public.logs_auditoria(ator_identificador)
  WHERE ator_identificador IS NOT NULL;

-- Logs são imutáveis para usuários da aplicação. O service role usado por
-- ações internas, crons e integrações continua podendo inserir sem usuário.
DROP POLICY IF EXISTS logs_auditoria_gestor_all ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_insert ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_gestor_select ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_insert_usuario ON public.logs_auditoria;

CREATE POLICY logs_auditoria_gestor_select ON public.logs_auditoria
  FOR SELECT
  TO authenticated
  USING (get_user_role() = 'gestor');

CREATE POLICY logs_auditoria_insert_usuario ON public.logs_auditoria
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ator_tipo = 'usuario'
    AND usuario_id = (SELECT auth.uid())
  );
