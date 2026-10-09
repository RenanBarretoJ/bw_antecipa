-- R1.16 FWD-02: nullable legacy escrow and verified non-null timestamps.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;
DO $r116$
DECLARE
  r record;
  a record;
  v_check text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('sacado_banco_escrow', NULL::text),
    ('sacado_agencia_escrow', NULL::text),
    ('sacado_conta_escrow', NULL::text),
    ('sacado_tipo_conta_escrow', '''Conta Escrow''::text')
  ) AS escrow(column_name, default_expr)
  LOOP
    SELECT format_type(t.atttypid,t.atttypmod) AS type_name, t.attnotnull,
           pg_get_expr(d.adbin,d.adrelid) AS default_expr, t.attidentity, t.attgenerated
      INTO a FROM pg_attribute t LEFT JOIN pg_attrdef d ON d.adrelid=t.attrelid AND d.adnum=t.attnum
      WHERE t.attrelid='public.cedentes'::regclass AND t.attname=r.column_name AND NOT t.attisdropped;
    IF NOT FOUND THEN
      -- ADD without DEFAULT preserves NULL for existing rows; SET DEFAULT affects future writes only.
      EXECUTE format('ALTER TABLE public.cedentes ADD COLUMN %I text',r.column_name);
      IF r.default_expr IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.cedentes ALTER COLUMN %I SET DEFAULT %s',r.column_name,r.default_expr);
      END IF;
    ELSIF a.type_name IS DISTINCT FROM 'text' OR a.attnotnull
       OR a.default_expr IS DISTINCT FROM r.default_expr OR a.attidentity <> '' OR a.attgenerated <> '' THEN
      RAISE EXCEPTION 'R1_16_ESCROW_UNEXPECTED_DEFINITION: %',r.column_name;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('consultor_cedente','created_at'),
    ('taxas_cedente','created_at'),
    ('taxas_cedente','updated_at')
  ) AS timestamps(table_name,column_name)
  LOOP
    SELECT format_type(t.atttypid,t.atttypmod) AS type_name,t.attnotnull,
           pg_get_expr(d.adbin,d.adrelid) AS default_expr
      INTO a FROM pg_attribute t LEFT JOIN pg_attrdef d ON d.adrelid=t.attrelid AND d.adnum=t.attnum
      WHERE t.attrelid=format('public.%I',r.table_name)::regclass AND t.attname=r.column_name AND NOT t.attisdropped;
    IF NOT FOUND OR a.type_name IS DISTINCT FROM 'timestamp with time zone' OR a.default_expr IS DISTINCT FROM 'now()' THEN
      RAISE EXCEPTION 'R1_16_TIMESTAMP_UNEXPECTED_DEFINITION: %.%',r.table_name,r.column_name;
    END IF;
    IF NOT a.attnotnull THEN
      v_check := 'r116_' || r.table_name || '_' || r.column_name || '_nn';
      IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=format('public.%I',r.table_name)::regclass AND conname=v_check) THEN
        RAISE EXCEPTION 'R1_16_TRANSIENT_CHECK_ALREADY_EXISTS: %',v_check;
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NOT NULL) NOT VALID',r.table_name,v_check,r.column_name);
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',r.table_name,v_check);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',r.table_name,r.column_name);
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.table_name,v_check);
    END IF;
  END LOOP;
END;
$r116$;
COMMIT;
