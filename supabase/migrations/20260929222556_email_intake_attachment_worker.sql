BEGIN;
ALTER TABLE private.email_intake_messages ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
  CHECK (status IN ('PENDING','PROCESSING','REQUIRES_REVIEW','COMPLETED','PARTIAL','FAILED'));

CREATE FUNCTION private.email_intake_aggregate_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pending bigint; v_review bigint; v_success bigint; v_failure bigint; v_total bigint;
BEGIN
  PERFORM 1 FROM private.email_intake_messages WHERE id=NEW.message_id FOR UPDATE;
  SELECT count(*),count(*) FILTER(WHERE status IN ('PENDING','PROCESSING','RETRY','CLEANUP_PENDING')),
    count(*) FILTER(WHERE status='REQUIRES_REVIEW'),count(*) FILTER(WHERE status IN ('IMPORTED','DUPLICATE','IGNORED')),
    count(*) FILTER(WHERE status IN ('REJECTED','FAILED','QUARANTINED'))
    INTO v_total,v_pending,v_review,v_success,v_failure FROM private.email_intake_attachments WHERE message_id=NEW.message_id;
  UPDATE private.email_intake_messages SET status=CASE
    WHEN v_pending>0 AND v_pending=v_total AND NEW.status='PENDING' THEN 'PENDING'
    WHEN v_pending>0 THEN 'PROCESSING' WHEN v_review>0 THEN 'REQUIRES_REVIEW'
    WHEN v_failure=0 THEN 'COMPLETED' WHEN v_success>0 THEN 'PARTIAL' ELSE 'FAILED' END WHERE id=NEW.message_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.email_intake_aggregate_message() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER email_intake_aggregate_message AFTER INSERT OR UPDATE OF status ON private.email_intake_attachments
  FOR EACH ROW EXECUTE FUNCTION private.email_intake_aggregate_message();

CREATE FUNCTION public.email_intake_get_attachment_claim(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('id',a.id,'token',a.lease_token,'attempt',a.attempts,'messageId',m.id,'integrationId',i.id,
    'fundoId',i.fundo_id,'messageExternalId',m.external_id,'attachmentExternalId',a.external_id,
    'fileName',a.file_name,'contentType',a.content_type,'size',a.size_bytes,'inline',a.inline,'kind',a.kind,
    'provider',i.provider,'mailbox',i.mailbox_address,'folderId',i.folder_id,
    'credentialEnvRef',i.credential_env_ref,'credentialCiphertext',i.credential_ciphertext,'credentialKeyVersion',i.credential_key_version)
    INTO v_result FROM private.email_intake_attachments a JOIN private.email_intake_messages m ON m.id=a.message_id
    JOIN private.email_integrations i ON i.id=m.integration_id JOIN public.fundos f ON f.id=i.fundo_id
    WHERE a.id=p_id AND a.lease_token=p_token AND a.status='PROCESSING' AND a.lease_expires_at>clock_timestamp()
      AND i.enabled AND f.ativo AND m.received_at>=i.start_at FOR UPDATE OF a;
  IF v_result IS NULL THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.email_intake_settle_attachment(p_id uuid,p_token uuid,p_outcome text,p_retry_after_ms integer DEFAULT 30000)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a private.email_intake_attachments%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO a FROM private.email_intake_attachments WHERE id=p_id AND lease_token=p_token AND status='PROCESSING'
    AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  v_status := CASE p_outcome WHEN 'DUPLICATE' THEN 'DUPLICATE' WHEN 'IN_PROGRESS' THEN 'RETRY'
    WHEN 'UNKNOWN_CEDENTE' THEN 'QUARANTINED' WHEN 'ROUTING_DENIED' THEN 'QUARANTINED'
    WHEN 'AMBIGUOUS' THEN 'REJECTED' WHEN 'INVALID' THEN 'REJECTED' WHEN 'MISSING_IDENTITY' THEN 'REJECTED'
    WHEN 'RETRYABLE_ERROR' THEN 'RETRY' WHEN 'FAILED' THEN 'FAILED' WHEN 'CLEANUP_PENDING' THEN 'CLEANUP_PENDING'
    WHEN 'IGNORED' THEN 'IGNORED' ELSE NULL END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_OUTCOME'; END IF;
  IF v_status='RETRY' AND a.attempts>=a.max_attempts THEN v_status:='FAILED'; END IF;
  UPDATE private.email_intake_attachments SET status=v_status,lease_token=NULL,lease_expires_at=NULL,
    last_error_code=CASE WHEN v_status IN ('DUPLICATE','IGNORED') THEN NULL ELSE p_outcome END,
    completed_at=CASE WHEN v_status IN ('RETRY','CLEANUP_PENDING') THEN NULL ELSE clock_timestamp() END,
    available_at=clock_timestamp()+least(greatest(coalesce(p_retry_after_ms,30000),1000),900000)*interval '1 millisecond'
    WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.email_intake_get_attachment_claim(uuid,uuid),public.email_intake_settle_attachment(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_intake_get_attachment_claim(uuid,uuid),public.email_intake_settle_attachment(uuid,uuid,text,integer) TO service_role;
COMMIT;
