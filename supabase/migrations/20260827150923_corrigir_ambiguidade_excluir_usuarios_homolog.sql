-- Historical anchor recovered from the homolog migration history.
--
-- The original remote-only migration replaced a destructive, homolog-only
-- cleanup helper. Its material effect was deliberately removed by
-- 20260922161558_reconcile_runtime_policies_reset_functions_grants.sql and
-- must not be recreated in the canonical chain or carried into production.
-- Keeping this no-op anchor preserves the immutable remote version while
-- allowing the Supabase CLI to reconcile history without marking it reverted.

DO $$
BEGIN
  NULL;
END
$$;
