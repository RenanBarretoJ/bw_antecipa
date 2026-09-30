BEGIN;

-- The shared reservation intentionally returns only DUPLICATE: the canonical
-- identity may already belong to another fund, so its NF id is not disclosed.
-- A transport duplicate creates no NF. Only IMPORTED requires a fiscal receipt;
-- a legitimately deleted draft retains the historical receipt introduced in R1.
ALTER TABLE private.email_intake_attachments
  DROP CONSTRAINT email_attachment_fiscal_outcome_history;
ALTER TABLE private.email_intake_attachments
  ADD CONSTRAINT email_attachment_fiscal_outcome_history
  CHECK (status <> 'IMPORTED' OR nota_fiscal_id IS NOT NULL OR deleted_nota_fiscal_id IS NOT NULL);

COMMIT;
