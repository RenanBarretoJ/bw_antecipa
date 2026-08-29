-- P2.6.4: converge ACL herdada de ambientes com default privileges distintos.
-- As duas rotinas sao internas: uma e motor chamado pelo wrapper/gate e a outra
-- e funcao de trigger. Nenhuma delas deve ser invocada diretamente por API.
BEGIN;

DO $p264$
BEGIN
  IF to_regprocedure('public.aprovar_operacao_atomica_financeiro_v1(uuid,numeric)') IS NULL
     OR to_regprocedure('public.bloquear_aprovacao_financeira_direta()') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: rotinas internas de aprovacao ausentes';
  END IF;
END
$p264$;

REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica_financeiro_v1(uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bloquear_aprovacao_financeira_direta()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
