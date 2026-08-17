BEGIN;

-- P2.6.8: remove o ultimo alias estrutural RLX depois da generalizacao
-- financeira. O helper canonico de autorizacao permanece inalterado.
DO $p268_preconditions$
DECLARE
  target_oid oid := to_regprocedure('private.rlx_gestor_tem_acesso_fundo(uuid)');
  dependent_objects text[];
  textual_consumers text[];
BEGIN
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'P2.6.8: rotina residual private.rlx_gestor_tem_acesso_fundo(uuid) ausente';
  END IF;

  IF to_regprocedure('private.gestor_tem_acesso_fundo_operacional(uuid)') IS NULL
     OR to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P2.6.8: helpers canonicos de autorizacao ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = target_oid
      AND p.prosecdef
      AND p.provolatile = 's'
      AND position(
        'private.gestor_tem_acesso_fundo_operacional(p_fundo_id)'
        IN p.prosrc
      ) > 0
  ) THEN
    RAISE EXCEPTION 'P2.6.8: rotina residual possui semantica inesperada';
  END IF;

  SELECT array_agg(pg_describe_object(d.classid, d.objid, d.objsubid) ORDER BY 1)
  INTO dependent_objects
  FROM pg_depend d
  WHERE d.refclassid = 'pg_proc'::regclass
    AND d.refobjid = target_oid;

  IF dependent_objects IS NOT NULL THEN
    RAISE EXCEPTION 'P2.6.8: rotina residual ainda possui dependencias: %', dependent_objects;
  END IF;

  WITH consumers AS (
    SELECT format('policy %I.%I/%I', schemaname, tablename, policyname) AS object_name
    FROM pg_policies
    WHERE concat_ws(' ', qual, with_check) ILIKE '%rlx_gestor_tem_acesso_fundo%'

    UNION ALL

    SELECT format(
      'routine %I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind IN ('f', 'p')
      AND p.oid <> target_oid
      AND pg_get_functiondef(p.oid) ILIKE '%rlx_gestor_tem_acesso_fundo%'

    UNION ALL

    SELECT format('view %I.%I', n.nspname, c.relname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm')
      AND pg_get_viewdef(c.oid, true) ILIKE '%rlx_gestor_tem_acesso_fundo%'

    UNION ALL

    SELECT format('trigger %I.%I/%I', n.nspname, c.relname, t.tgname)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND pg_get_triggerdef(t.oid, true) ILIKE '%rlx_gestor_tem_acesso_fundo%'
  )
  SELECT array_agg(object_name ORDER BY object_name)
  INTO textual_consumers
  FROM consumers;

  IF textual_consumers IS NOT NULL THEN
    RAISE EXCEPTION 'P2.6.8: consumidores textuais inesperados: %', textual_consumers;
  END IF;
END
$p268_preconditions$;

REVOKE ALL ON FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid)
FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid);

DO $p268_postconditions$
BEGIN
  IF to_regprocedure('private.rlx_gestor_tem_acesso_fundo(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'P2.6.8: rotina residual permaneceu apos o DROP';
  END IF;

  IF to_regprocedure('private.gestor_tem_acesso_fundo_operacional(uuid)') IS NULL
     OR to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P2.6.8: helper canonico removido indevidamente';
  END IF;
END
$p268_postconditions$;

COMMIT;
