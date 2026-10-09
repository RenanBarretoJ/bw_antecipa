-- R1.16 FWD-07: preserve or add the approved nonunique btree(cedente_id).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;
DO $r116$
DECLARE
  v_index regclass := to_regclass('public.idx_taxas_cedente_id');
BEGIN
  IF v_index IS NULL THEN
    CREATE INDEX idx_taxas_cedente_id ON public.taxas_cedente USING btree (cedente_id);
    v_index := 'public.idx_taxas_cedente_id'::regclass;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='cedente_id'
    JOIN pg_opclass op ON op.oid=i.indclass[0] JOIN pg_namespace n ON n.oid=op.opcnamespace
    WHERE i.indexrelid=v_index AND i.indrelid='public.taxas_cedente'::regclass
      AND am.amname='btree' AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indkey[0]=a.attnum
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indoption[0]=0
      AND op.opcname='uuid_ops' AND n.nspname='pg_catalog'
      AND pg_get_indexdef(v_index)='CREATE INDEX idx_taxas_cedente_id ON public.taxas_cedente USING btree (cedente_id)'
      AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conindid=v_index)
  ) THEN
    RAISE EXCEPTION 'R1_16_INDEX_SAME_NAME_DIFFERENT_DEFINITION';
  END IF;
END;
$r116$;
COMMIT;
