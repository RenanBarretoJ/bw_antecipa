-- P2 runtime rehearsal: a policy de notificacoes ja restringe cada usuario
-- a auth.uid(), mas a canonicalizacao de ACL removeu os privilegios de tabela.
-- Sem SELECT, inclusive o Realtime rejeita usuario_id como filtro nao visivel.

REVOKE ALL ON TABLE public.notificacoes FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.notificacoes FROM authenticated;

GRANT SELECT, UPDATE ON TABLE public.notificacoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notificacoes TO service_role;

DROP POLICY IF EXISTS notificacoes_own_select ON public.notificacoes;
CREATE POLICY notificacoes_own_select
ON public.notificacoes
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = usuario_id);

DROP POLICY IF EXISTS notificacoes_own_update ON public.notificacoes;
CREATE POLICY notificacoes_own_update
ON public.notificacoes
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = usuario_id)
WITH CHECK ((SELECT auth.uid()) = usuario_id);
