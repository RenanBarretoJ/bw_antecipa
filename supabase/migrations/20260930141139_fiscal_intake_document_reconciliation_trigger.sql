BEGIN;

-- Atomic fiscal commit already reconciles after linking the uploaded version,
-- using the caller's reservation/token/generation. Its link trigger must not
-- also call the legacy HUMAN-only wrapper in the middle of that transaction.
-- No actor is inferred or authorized here: a private staged import must exist,
-- and the explicit fenced reconciliation in fiscal_intake_commit still runs.
CREATE OR REPLACE FUNCTION public.reconciliar_base_nf_apos_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.nota_fiscal_id IS NOT NULL
     AND NEW.documento_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.documento_id IS DISTINCT FROM OLD.documento_id) THEN
    IF EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      JOIN private.fiscal_identity_reservations r ON r.id = nf.fiscal_reservation_id
        AND r.fundo_id = nf.fundo_id AND r.cedente_id = nf.cedente_id
        AND r.cedente_fundo_id = nf.cedente_fundo_id AND r.estabelecimento_id = nf.estabelecimento_id
      JOIN private.fiscal_prepared_imports s ON s.reservation_id = r.id
        AND s.generation = r.generation AND s.owner_token = r.owner_token
      JOIN private.fiscal_storage_intents o ON o.id = s.storage_intent_id
        AND o.reservation_id = r.id AND o.generation = r.generation AND o.owner_token = r.owner_token
      JOIN public.documentos_repositorio d ON d.id = NEW.documento_id AND d.fiscal_reservation_id = r.id
      WHERE nf.id = NEW.nota_fiscal_id AND nf.status::text = 'rascunho'
        AND r.state = 'RESERVED' AND o.state IN ('PLANNED', 'STORED')
    ) THEN
      RETURN NEW;
    END IF;
    PERFORM public.reconciliar_documentos_base_nf(NEW.nota_fiscal_id);
  END IF;
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE preserves the existing function ACL and trigger binding.
COMMIT;
