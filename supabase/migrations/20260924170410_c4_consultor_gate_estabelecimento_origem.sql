-- C4 follow-up: o gate publico de origem precisa reconhecer o mesmo
-- vinculo operacional do Consultor usado pelas policies de Nota Fiscal.
-- O gate estrutural privado permanece inalterado e continua exigindo
-- estabelecimento/matriz aprovados, Cedente e fundo ativos.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.usuario_pode_operar_cedente(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.estabelecimento_pode_originar(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-condicoes C2/C3/Multi-CNPJ ausentes para o gate C4';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.estabelecimento_pode_originar(
  p_estabelecimento_id uuid,
  p_cedente_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.estabelecimento_pode_originar(
    p_estabelecimento_id,
    p_cedente_id,
    p_fundo_id
  )
  AND (
    private.usuario_tem_acesso_cedente(p_cedente_id)
    OR private.gestor_tem_acesso_cedente(p_cedente_id)
    OR (
      public.get_user_role() = 'consultor'
      AND private.usuario_pode_operar_cedente(p_cedente_id)
      AND private.consultor_tem_acesso_fundo(p_fundo_id)
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid) IS
  'Valida origem por estabelecimento para Cedente, Gestor ou Consultor operacionalmente autorizado.';

COMMIT;
