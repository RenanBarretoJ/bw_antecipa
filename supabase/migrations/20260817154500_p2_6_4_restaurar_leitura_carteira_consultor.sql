-- P2.6.4 - contrato funcional autenticado da carteira do consultor.
--
-- A canonicalizacao de ACL removeu o SELECT herdado de authenticated em
-- public.cedentes, mas a policy cedentes_consultor_select continua sendo a
-- fronteira de isolamento por carteira. ACL e RLS sao complementares: sem o
-- grant, o PostgreSQL rejeita toda consulta antes mesmo de avaliar a policy.

BEGIN;

REVOKE ALL ON TABLE public.cedentes FROM anon;
GRANT SELECT ON TABLE public.cedentes TO authenticated;

COMMENT ON POLICY cedentes_consultor_select ON public.cedentes IS
  'Consultor autenticado le somente cedentes explicitamente vinculados a sua carteira; o SELECT da Data API permanece filtrado por RLS.';

NOTIFY pgrst, 'reload schema';

COMMIT;
