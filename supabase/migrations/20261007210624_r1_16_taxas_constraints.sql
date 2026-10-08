-- R1.16 FWD-03: the approved interval/rate invariant, without changing any row.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;
DO $r116$
DECLARE
  v_definition text;
  v_target constant text := 'CHECK (((prazo_min >= 0) AND (prazo_max >= prazo_min) AND (taxa_percentual >= (0)::numeric)))';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint
    WHERE conrelid='public.taxas_cedente'::regclass AND conname='taxas_prazo_check';
  IF FOUND THEN
    IF v_definition IS DISTINCT FROM v_target THEN RAISE EXCEPTION 'R1_16_TAXAS_UNEXPECTED_TARGET'; END IF;
  ELSE
    ALTER TABLE public.taxas_cedente ADD CONSTRAINT taxas_prazo_check
      CHECK (prazo_min >= 0 AND prazo_max >= prazo_min AND taxa_percentual >= 0) NOT VALID;
  END IF;
  ALTER TABLE public.taxas_cedente VALIDATE CONSTRAINT taxas_prazo_check;
  SELECT pg_get_constraintdef(oid) INTO v_definition FROM pg_constraint
    WHERE conrelid='public.taxas_cedente'::regclass AND conname='taxas_cedente_taxa_percentual_check';
  IF FOUND THEN
    IF v_definition IS DISTINCT FROM 'CHECK ((taxa_percentual >= (0)::numeric))' THEN
      RAISE EXCEPTION 'R1_16_TAXAS_UNEXPECTED_SUPERSEDED_CHECK';
    END IF;
    ALTER TABLE public.taxas_cedente DROP CONSTRAINT taxas_cedente_taxa_percentual_check;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.taxas_cedente'::regclass
    AND conname='taxas_prazo_check' AND convalidated AND pg_get_constraintdef(oid)=v_target) THEN
    RAISE EXCEPTION 'R1_16_TAXAS_TARGET_MISSING';
  END IF;
END;
$r116$;
COMMIT;
