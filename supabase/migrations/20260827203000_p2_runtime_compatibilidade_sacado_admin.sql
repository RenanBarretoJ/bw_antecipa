-- P2 rehearsal: compatibilidade do runtime autenticado com o schema migrado.
--
-- A canonicalizacao de ACL removeu o SELECT de authenticated em sacados,
-- embora o portal dependa da leitura da propria linha protegida por RLS.
-- A SA1 tambem passou a referenciar quatro campos estruturais em suas RPCs,
-- mas a migration original nao os adicionava fisicamente em fundos.

BEGIN;

ALTER TABLE public.fundos
  ADD COLUMN IF NOT EXISTS administradora_endereco text,
  ADD COLUMN IF NOT EXISTS administradora_ato_declaratorio text,
  ADD COLUMN IF NOT EXISTS contato_nome text,
  ADD COLUMN IF NOT EXISTS contato_email text;

ALTER TABLE public.sacados ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.sacados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sacados TO authenticated;

DROP POLICY IF EXISTS sacados_own_select ON public.sacados;
CREATE POLICY sacados_own_select
  ON public.sacados
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMIT;

