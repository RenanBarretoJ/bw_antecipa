BEGIN;

-- Keep the original transport outcome after an authorized fiscal draft deletion.
-- A historical identifier is not a live FK and cannot be used for fiscal access.
ALTER TABLE private.email_intake_attachments ADD COLUMN deleted_nota_fiscal_id uuid;

DO $$
DECLARE v_constraint name;
BEGIN
  FOR v_constraint IN
    SELECT c.conname FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid
        AND a.attname='nota_fiscal_id' AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid='private.email_intake_attachments'::regclass AND c.contype='c'
  LOOP
    EXECUTE format('ALTER TABLE private.email_intake_attachments DROP CONSTRAINT %I',v_constraint);
  END LOOP;
END;
$$;

ALTER TABLE private.email_intake_attachments ADD CONSTRAINT email_attachment_fiscal_outcome_history
  CHECK (status NOT IN ('IMPORTED','DUPLICATE') OR nota_fiscal_id IS NOT NULL OR deleted_nota_fiscal_id IS NOT NULL);
ALTER TABLE private.email_intake_attachments ADD CONSTRAINT email_attachment_single_fiscal_reference
  CHECK (nota_fiscal_id IS NULL OR deleted_nota_fiscal_id IS NULL);

CREATE FUNCTION private.email_intake_preserve_deleted_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.email_intake_attachments
    SET deleted_nota_fiscal_id=OLD.id,nota_fiscal_id=NULL
    WHERE nota_fiscal_id=OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.email_intake_preserve_deleted_draft() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER email_intake_preserve_deleted_draft BEFORE DELETE ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION private.email_intake_preserve_deleted_draft();

COMMIT;
