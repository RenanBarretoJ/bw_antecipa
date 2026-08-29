-- P2.6.4: remove policies legadas de escrita direta no bucket de contratos.
-- O fluxo canonico grava via backend autorizado e nao expoe INSERT/UPDATE direto.
BEGIN;

DO $p264$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: storage.objects ausente';
  END IF;
END
$p264$;

DROP POLICY IF EXISTS storage_contratos_gestor_insert ON storage.objects;
DROP POLICY IF EXISTS storage_contratos_gestor_update ON storage.objects;

COMMIT;
