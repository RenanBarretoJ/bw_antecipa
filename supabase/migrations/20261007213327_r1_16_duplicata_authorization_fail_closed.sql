-- R1.16 FWD-08: deny NULL authorization as well as false.
-- Depends on FWD-05 text compatibility. No business rows, ACLs or policies change.
-- Explicitly authorized after the local 20-actor baseline reproduced three bypasses.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;

DO $r116_auth$
DECLARE
  v_oid oid := 'public.corrigir_duplicata(uuid,jsonb,text,text)'::regprocedure;
  v_before text;
  v_after text;
  v_security jsonb;
  v_hash text;
  v_source_hash constant text := '6676258cee6556e26be3558a460a630f3dce2c126ecb5f2bb8a39814e7e21f90';
  v_target_hash constant text := '7bb7cab8dc3e0b47398c624abb721bb77126cadefbe1a4643cf1595ef40bb313';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'),
         to_jsonb(p) - 'prosrc'
    INTO v_before, v_security FROM pg_proc p WHERE p.oid = v_oid;
  IF pg_get_userbyid((v_security->>'proowner')::oid) IS DISTINCT FROM 'postgres'
     OR NOT (v_security->>'prosecdef')::boolean
     OR (SELECT ARRAY(SELECT a::text FROM unnest(p.proacl) a ORDER BY a::text)
         FROM pg_proc p WHERE p.oid=v_oid)
        IS DISTINCT FROM ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[] THEN
    RAISE EXCEPTION 'R1_16_AUTH_SECURITY_BASELINE_MISMATCH';
  END IF;
  v_hash := encode(sha256(convert_to(v_before, 'UTF8')), 'hex');
  IF v_hash = v_target_hash THEN RETURN; END IF;
  IF v_hash IS DISTINCT FROM v_source_hash THEN
    RAISE EXCEPTION 'R1_16_AUTH_UNEXPECTED_DEFINITION';
  END IF;
  -- Both substitutions are bounded by the exact full-definition source hash.
  v_after := replace(v_before, E'  IF NOT (\n    (v_role', E'  IF (\n    (v_role');
  v_after := replace(v_after,
    '  ) THEN RAISE EXCEPTION ''Usuario sem permissao para corrigir a duplicata''',
    '  ) IS NOT TRUE THEN RAISE EXCEPTION ''Usuario sem permissao para corrigir a duplicata''');
  IF encode(sha256(convert_to(v_after, 'UTF8')), 'hex') IS DISTINCT FROM v_target_hash THEN
    RAISE EXCEPTION 'R1_16_AUTH_TARGET_HASH_MISMATCH';
  END IF;
  EXECUTE v_after;
  IF replace(pg_get_functiondef(v_oid), E'\r\n', E'\n') IS DISTINCT FROM v_after
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid=v_oid) IS DISTINCT FROM v_security THEN
    RAISE EXCEPTION 'R1_16_AUTH_POSTCONDITION_FAILED';
  END IF;
END;
$r116_auth$;
COMMIT;
