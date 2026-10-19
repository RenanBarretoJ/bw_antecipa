BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Preserve the complete current allowlist, including events introduced by other modules.
-- Only these four already-emitted VRS events are added; unknown types remain rejected.
DO $audit_types$
DECLARE
  current_expression text;
  event_column smallint;
  already_allowed boolean;
  added_types constant text[] := ARRAY[
    'VORTX_CALLBACK_CONFIGURADO', 'VORTX_CALLBACK_REVOGADO',
    'VORTX_CALLBACK_RECEBIDO', 'VORTX_CALLBACK_ADMIN_ALTERADO'
  ];
BEGIN
  LOCK TABLE public.seguranca_eventos IN ACCESS EXCLUSIVE MODE;
  SELECT attnum INTO STRICT event_column FROM pg_attribute
   WHERE attrelid='public.seguranca_eventos'::regclass AND attname='tipo_evento' AND NOT attisdropped;
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT current_expression FROM pg_constraint
   WHERE conrelid='public.seguranca_eventos'::regclass AND conname='seguranca_eventos_tipo_check'
    AND contype='c' AND convalidated AND NOT connoinherit AND conkey=ARRAY[event_column];
  EXECUTE format('SELECT bool_and((%s) IS TRUE) FROM unnest($1::text[]) AS events(tipo_evento)', current_expression)
    INTO already_allowed USING added_types;
  IF already_allowed THEN RETURN; END IF;
  EXECUTE format(
    'ALTER TABLE public.seguranca_eventos DROP CONSTRAINT seguranca_eventos_tipo_check, ADD CONSTRAINT seguranca_eventos_tipo_check CHECK ((%s) OR tipo_evento = ANY (%L::text[]))',
    current_expression, added_types
  );
END;
$audit_types$;
COMMIT;
