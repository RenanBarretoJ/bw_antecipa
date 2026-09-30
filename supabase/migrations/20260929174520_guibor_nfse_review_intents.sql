-- Server-owned review receipts. No fiscal payload or credentials are stored here.
-- Authenticated NF writes and their atomic audit continue to use existing RLS.
CREATE TABLE public.nfse_review_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id),
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  fiscal_sha256 text NOT NULL CHECK (fiscal_sha256 ~ '^[0-9a-f]{64}$'),
  identity_sha256 text NOT NULL CHECK (identity_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'REVIEW'
    CHECK (state IN ('REVIEW','PROCESSING','COMPLETED','FAILED','CLEANUP_PENDING')),
  storage_path text,
  document_storage_path text,
  nf_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (state NOT IN ('PROCESSING','COMPLETED','CLEANUP_PENDING') OR storage_path IS NOT NULL),
  CHECK (state <> 'COMPLETED' OR nf_id IS NOT NULL)
);
ALTER TABLE public.nfse_review_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfse_review_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfse_review_intents TO service_role;
-- Claim is a short CAS statement, not a transaction held open across parsing/Storage.
-- An interrupted worker keeps its claim and recovery path: never auto-release it.
CREATE UNIQUE INDEX nfse_review_active_identity ON public.nfse_review_intents(identity_sha256)
  WHERE state IN ('PROCESSING','COMPLETED','CLEANUP_PENDING');
CREATE INDEX nfse_review_actor ON public.nfse_review_intents(actor_id);
CREATE INDEX nfse_review_cedente ON public.nfse_review_intents(cedente_id);
CREATE INDEX nfse_review_vinculo ON public.nfse_review_intents(cedente_fundo_id);
CREATE INDEX nfse_review_fundo ON public.nfse_review_intents(fundo_id);
COMMENT ON TABLE public.nfse_review_intents IS
  'GUIBOR server-only review receipts; PROCESSING/CLEANUP_PENDING require explicit reconciliation, never blind retry.';

-- A legitimately deleted draft may be imported again; retain the receipt for audit.
CREATE FUNCTION private.guibor_release_deleted_nfse_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.nfse_review_intents SET state = 'FAILED', nf_id = NULL, updated_at = now()
  WHERE nf_id = OLD.id AND state = 'COMPLETED';
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.guibor_release_deleted_nfse_review() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guibor_release_deleted_nfse_review AFTER DELETE ON public.notas_fiscais
FOR EACH ROW WHEN (OLD.tipo_documento_fiscal = 'NFSE')
EXECUTE FUNCTION private.guibor_release_deleted_nfse_review();
CREATE INDEX nfse_review_nf ON public.nfse_review_intents(nf_id) WHERE nf_id IS NOT NULL;
