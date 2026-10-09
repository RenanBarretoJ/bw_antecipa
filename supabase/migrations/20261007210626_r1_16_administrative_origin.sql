-- R1.16 FWD-04: preserve all accepted origins and accept bootstrap_producao.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;
DO $r116$
DECLARE
  v_definition text;
  v_old constant text := 'CHECK ((origem = ANY (ARRAY[''perfil_primario''::text, ''bootstrap_homolog''::text, ''administracao''::text])))';
  v_target constant text := 'CHECK ((origem = ANY (ARRAY[''perfil_primario''::text, ''bootstrap_homolog''::text, ''bootstrap_producao''::text, ''administracao''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint
    WHERE conrelid='public.usuario_papeis'::regclass AND conname='usuario_papeis_origem_check' AND convalidated;
  IF NOT FOUND OR v_definition NOT IN (v_old,v_target) THEN
    RAISE EXCEPTION 'R1_16_ORIGIN_UNEXPECTED_BASELINE';
  END IF;
  IF v_definition=v_old THEN
    ALTER TABLE public.usuario_papeis ADD CONSTRAINT r116_usuario_papeis_origem_check
      CHECK (origem IN ('perfil_primario','bootstrap_homolog','bootstrap_producao','administracao')) NOT VALID;
    ALTER TABLE public.usuario_papeis VALIDATE CONSTRAINT r116_usuario_papeis_origem_check;
    ALTER TABLE public.usuario_papeis DROP CONSTRAINT usuario_papeis_origem_check;
    ALTER TABLE public.usuario_papeis RENAME CONSTRAINT r116_usuario_papeis_origem_check TO usuario_papeis_origem_check;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.usuario_papeis'::regclass
    AND conname='usuario_papeis_origem_check' AND convalidated AND pg_get_constraintdef(oid)=v_target) THEN
    RAISE EXCEPTION 'R1_16_ORIGIN_TARGET_MISSING';
  END IF;
END;
$r116$;
COMMIT;
