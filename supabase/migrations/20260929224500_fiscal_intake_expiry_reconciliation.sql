BEGIN;
-- Reservation changes also retire the original official review receipt. Keep
-- audit history; only retry an email once its generation has no pending object.
CREATE FUNCTION private.fiscal_reconcile_released_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.review_intent_id IS NOT NULL THEN
    UPDATE public.nfse_review_intents SET state='FAILED',updated_at=clock_timestamp()
      WHERE id=NEW.review_intent_id AND state IN ('REVIEW','PROCESSING','CLEANUP_PENDING');
  END IF;
  IF NEW.attachment_id IS NOT NULL THEN
    UPDATE private.email_intake_attachments SET status=CASE WHEN attempts<max_attempts THEN 'RETRY' ELSE 'FAILED' END,
      queue='TEXT',lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '30 seconds',
      last_error_code='FISCAL_IMPORT_RELEASED'
      WHERE id=NEW.attachment_id AND status IN ('PROCESSING','REQUIRES_REVIEW','CLEANUP_PENDING')
        AND (NEW.actor_type='HUMAN' OR status IN ('REQUIRES_REVIEW','CLEANUP_PENDING') OR lease_expires_at<=clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_reconcile_released_generation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fiscal_reconcile_released_generation AFTER UPDATE OF state ON private.fiscal_identity_reservations
  FOR EACH ROW WHEN (NEW.state='RELEASED' AND OLD.state<>'RELEASED' AND OLD.state<>'COMPLETED')
  EXECUTE FUNCTION private.fiscal_reconcile_released_generation();

CREATE FUNCTION public.fiscal_intake_reconcile_expired(p_limit integer DEFAULT 20)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v_count integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'FISCAL_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT r0.* FROM private.fiscal_identity_reservations r0
    LEFT JOIN public.nfse_review_intents v ON v.id=r0.review_intent_id
    WHERE (r0.state='RESERVED' AND r0.lease_expires_at<=clock_timestamp())
      OR (r0.state='REQUIRES_REVIEW' AND v.expires_at<=clock_timestamp())
    ORDER BY r0.updated_at,r0.id LIMIT p_limit
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0)) THEN CONTINUE; END IF;
    SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=r.id FOR UPDATE;
    IF (r.state='RESERVED' AND r.lease_expires_at<=clock_timestamp()) OR
      (r.state='REQUIRES_REVIEW' AND EXISTS(SELECT 1 FROM public.nfse_review_intents v WHERE v.id=r.review_intent_id AND v.expires_at<=clock_timestamp())) THEN
      PERFORM public.fiscal_intake_abort(r.id,r.owner_token,r.generation);
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_reconcile_expired(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_reconcile_expired(integer) TO service_role;
COMMIT;
