BEGIN;
-- Extend the official A3/A4 receipt. No separate review entity or fake user.
ALTER TABLE public.nfse_review_intents ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.nfse_review_intents ADD COLUMN fiscal_reservation_id uuid REFERENCES private.fiscal_identity_reservations(id);
CREATE UNIQUE INDEX nfse_review_active_reservation ON public.nfse_review_intents(fiscal_reservation_id)
  WHERE state IN ('REVIEW','PROCESSING','COMPLETED','CLEANUP_PENDING');
ALTER TABLE public.nfse_review_intents ADD COLUMN ingest_actor jsonb;
ALTER TABLE public.nfse_review_intents ADD COLUMN review_actor_id uuid REFERENCES auth.users(id);
ALTER TABLE public.nfse_review_intents ADD CONSTRAINT nfse_review_actor_context CHECK (actor_id IS NOT NULL OR fiscal_reservation_id IS NOT NULL);
ALTER TABLE public.nfse_review_intents DROP CONSTRAINT nfse_review_intents_check1;
ALTER TABLE public.nfse_review_intents ADD CONSTRAINT nfse_review_storage_context CHECK (
  state NOT IN ('PROCESSING','COMPLETED','CLEANUP_PENDING') OR storage_path IS NOT NULL OR document_storage_path IS NOT NULL
);

CREATE FUNCTION public.fiscal_intake_open_review(p_id uuid,p_token uuid,p_generation bigint,p_fiscal_sha256 text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v_id uuid;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  IF r.document_type<>'NFSE' OR p_fiscal_sha256 IS NULL OR p_fiscal_sha256!~'^[a-f0-9]{64}$'
    OR EXISTS (SELECT 1 FROM private.fiscal_storage_intents WHERE reservation_id=p_id AND state<>'DELETED')
    THEN RAISE EXCEPTION 'NFSE_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.nfse_review_intents(actor_id,cedente_id,cedente_fundo_id,fundo_id,file_sha256,fiscal_sha256,identity_sha256,
    fiscal_reservation_id,ingest_actor)
    VALUES(r.actor_user_id,r.cedente_id,r.cedente_fundo_id,r.fundo_id,r.file_sha256,p_fiscal_sha256,r.identity_sha256,r.id,r.ingest_actor)
    ON CONFLICT (fiscal_reservation_id) WHERE state IN ('REVIEW','PROCESSING','COMPLETED','CLEANUP_PENDING')
      DO UPDATE SET state='REVIEW',updated_at=clock_timestamp()
      WHERE public.nfse_review_intents.state='REVIEW' AND public.nfse_review_intents.fiscal_sha256=EXCLUDED.fiscal_sha256
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'NFSE_REVIEW_CONFLICT'; END IF;
  UPDATE private.fiscal_identity_reservations SET state='REQUIRES_REVIEW',review_intent_id=v_id,updated_at=clock_timestamp()
    WHERE id=r.id;
  IF r.attachment_id IS NOT NULL THEN
    UPDATE private.email_intake_attachments SET status='REQUIRES_REVIEW',queue='REVIEW',lease_token=NULL,lease_expires_at=NULL,
      sha256=r.file_sha256 WHERE id=r.attachment_id AND lease_token=r.attachment_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.fiscal_intake_resume_review(p_review_id uuid,p_fundo_id uuid,p_cedente_fundo_id uuid,
  p_file_sha256 text,p_fiscal_sha256 text,p_fiscal_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v_review public.nfse_review_intents%ROWTYPE; v_attachment_token uuid;
BEGIN
  SELECT * INTO v_review FROM public.nfse_review_intents WHERE id=p_review_id;
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=v_review.fiscal_reservation_id;
  IF r.id IS NULL OR r.fundo_id IS DISTINCT FROM p_fundo_id OR r.cedente_fundo_id IS DISTINCT FROM p_cedente_fundo_id
    THEN RAISE EXCEPTION 'NFSE_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
  PERFORM private.fiscal_validate_actor(jsonb_build_object('type','HUMAN','userId',auth.uid()),r.fundo_id,r.cedente_fundo_id,r.estabelecimento_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=r.id FOR UPDATE;
  SELECT * INTO v_review FROM public.nfse_review_intents WHERE id=p_review_id FOR UPDATE;
  IF r.source_channel='MANUAL_UPLOAD' AND r.actor_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NFSE_REVIEW_INVALID'; END IF;
  IF v_review.file_sha256 IS DISTINCT FROM p_file_sha256 OR v_review.fiscal_sha256 IS DISTINCT FROM p_fiscal_sha256
    OR v_review.identity_sha256 IS DISTINCT FROM encode(extensions.digest(p_fiscal_key,'sha256'),'hex')
    THEN RAISE EXCEPTION 'NFSE_REVIEW_DRIFT' USING ERRCODE='22023'; END IF;
  IF r.state IN ('RESERVED','COMPLETED','CLEANUP_PENDING') THEN
    RETURN jsonb_build_object('status',CASE WHEN r.state='COMPLETED' THEN 'DUPLICATE' WHEN r.state='CLEANUP_PENDING' THEN 'CLEANUP_PENDING' ELSE 'IN_PROGRESS' END);
  END IF;
  IF r.state<>'REQUIRES_REVIEW' OR v_review.state<>'REVIEW' OR v_review.expires_at<=clock_timestamp()
    THEN RAISE EXCEPTION 'NFSE_REVIEW_EXPIRED' USING ERRCODE='22023'; END IF;
  IF r.attachment_id IS NOT NULL THEN
    v_attachment_token := gen_random_uuid();
    UPDATE private.email_intake_attachments SET status='PROCESSING',lease_token=v_attachment_token,lease_expires_at=clock_timestamp()+interval '5 minutes'
      WHERE id=r.attachment_id AND status='REQUIRES_REVIEW';
    IF NOT FOUND THEN RAISE EXCEPTION 'NFSE_REVIEW_CONFLICT'; END IF;
    PERFORM private.fiscal_validate_email_claim(jsonb_build_object('integrationId',r.integration_id,'messageId',r.message_id,
      'attachmentId',r.attachment_id,'attachmentToken',v_attachment_token),r.fundo_id,r.cedente_id);
  END IF;
  UPDATE private.fiscal_identity_reservations SET state='RESERVED',owner_token=gen_random_uuid(),generation=generation+1,
    lease_expires_at=clock_timestamp()+interval '5 minutes',actor_type='HUMAN',actor_user_id=auth.uid(),
    actor_session_id=(auth.jwt()->>'session_id')::uuid,attachment_token=coalesce(v_attachment_token,attachment_token),updated_at=clock_timestamp()
    WHERE id=r.id RETURNING * INTO r;
  UPDATE public.nfse_review_intents SET review_actor_id=auth.uid(),updated_at=clock_timestamp() WHERE id=p_review_id;
  RETURN jsonb_build_object('id',r.id,'token',r.owner_token,'generation',r.generation);
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_open_review(uuid,uuid,bigint,text),
  public.fiscal_intake_resume_review(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_open_review(uuid,uuid,bigint,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_resume_review(uuid,uuid,uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.fiscal_intake_resume_review(uuid,uuid,uuid,text,text,text) FROM service_role;

-- This trigger settles the SAME official review in the atomic fiscal commit.
CREATE FUNCTION private.fiscal_settle_official_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o private.fiscal_storage_intents%ROWTYPE;
BEGIN
  IF NEW.state='COMPLETED' AND NEW.review_intent_id IS NOT NULL THEN
    SELECT * INTO o FROM private.fiscal_storage_intents WHERE reservation_id=NEW.id AND generation=NEW.generation AND state='RETAINED';
    IF o.id IS NULL THEN RAISE EXCEPTION 'NFSE_REVIEW_STORAGE_MISSING'; END IF;
    UPDATE public.nfse_review_intents SET state='COMPLETED',nf_id=NEW.nota_fiscal_id,
      storage_path=CASE WHEN o.bucket='notas-fiscais' THEN o.path ELSE NULL END,
      document_storage_path=CASE WHEN o.bucket='documentos-v2' THEN o.path ELSE NULL END,updated_at=clock_timestamp()
      WHERE id=NEW.review_intent_id AND state='REVIEW';
    IF NOT FOUND THEN RAISE EXCEPTION 'NFSE_REVIEW_CONFLICT'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_settle_official_review() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fiscal_settle_official_review AFTER UPDATE OF state ON private.fiscal_identity_reservations
  FOR EACH ROW WHEN (NEW.state='COMPLETED' AND OLD.state<>'COMPLETED') EXECUTE FUNCTION private.fiscal_settle_official_review();
COMMIT;
