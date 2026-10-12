BEGIN;

-- The admission boundary is immutable per message. Moving the integration's
-- start_at later must not revoke an identity legitimately admitted earlier.
ALTER TABLE private.email_intake_messages
  ADD COLUMN admission_start_at timestamptz,
  ADD COLUMN provider_removed_at timestamptz,
  ADD CONSTRAINT email_message_admission_boundary CHECK (
    admission_start_at IS NULL OR (isfinite(admission_start_at) AND isfinite(received_at) AND received_at >= admission_start_at));

-- Legacy rows outside the current boundary remain untrusted metadata. Preserve
-- all receipts and fiscal history; never infer admission from mere row existence.
UPDATE private.email_intake_messages m SET admission_start_at=i.start_at
FROM private.email_integrations i WHERE i.id=m.integration_id
  AND isfinite(i.start_at) AND isfinite(m.received_at) AND m.received_at>=i.start_at;

CREATE FUNCTION private.email_message_snapshot_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE boundary timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.integration_id IS DISTINCT FROM OLD.integration_id OR NEW.external_id IS DISTINCT FROM OLD.external_id
      OR NEW.received_at IS DISTINCT FROM OLD.received_at
      OR (OLD.admission_start_at IS NOT NULL AND NEW.admission_start_at IS DISTINCT FROM OLD.admission_start_at)
    THEN RAISE EXCEPTION 'EMAIL_ADMISSION_IMMUTABLE'; END IF;
    IF OLD.admission_start_at IS NOT NULL OR NEW.admission_start_at IS NULL THEN RETURN NEW; END IF;
  END IF;
  SELECT start_at INTO boundary FROM private.email_integrations WHERE id=NEW.integration_id FOR SHARE;
  NEW.admission_start_at:=CASE WHEN isfinite(boundary) AND isfinite(NEW.received_at)
    AND NEW.received_at>=boundary THEN boundary ELSE NULL END;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.email_message_snapshot_admission() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER email_message_snapshot_admission BEFORE INSERT OR UPDATE
ON private.email_intake_messages FOR EACH ROW EXECUTE FUNCTION private.email_message_snapshot_admission();

CREATE FUNCTION private.email_message_processable(m private.email_intake_messages) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT m.admission_start_at IS NOT NULL AND m.received_at>=m.admission_start_at AND m.provider_removed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION private.email_message_processable(private.email_intake_messages) FROM PUBLIC,anon,authenticated,service_role;

-- Bounded lookup scoped by the active discovery lease. No browser/table access.
CREATE FUNCTION public.email_intake_known_messages(p_id uuid,p_mode text,p_token uuid,p_revision bigint,p_external_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_external_ids IS NULL OR cardinality(p_external_ids)>1000 THEN RAISE EXCEPTION 'EMAIL_INVALID_PAGE'; END IF;
  PERFORM 1 FROM private.email_sync_state s JOIN private.email_integrations i ON i.id=s.integration_id
    JOIN public.fundos f ON f.id=i.fundo_id WHERE s.integration_id=p_id AND s.mode=p_mode
    AND s.lease_token=p_token AND s.revision=p_revision AND s.lease_expires_at>clock_timestamp() AND i.enabled AND f.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('externalId',m.external_id,'receivedAt',m.received_at)),'[]'::jsonb)
    INTO result FROM private.email_intake_messages m WHERE m.integration_id=p_id AND m.external_id=ANY(p_external_ids)
    AND m.admission_start_at IS NOT NULL;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.email_intake_known_messages(uuid,text,uuid,bigint,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_intake_known_messages(uuid,text,uuid,bigint,text[]) TO service_role;

CREATE FUNCTION private.email_received_instant(value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
BEGIN
  IF value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION private.email_received_instant(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.email_intake_commit_page(
  p_integration_id uuid,p_mode text,p_token uuid,p_revision bigint,p_messages jsonb,
  p_cursor_ciphertext text,p_cursor_key_version text,p_complete boolean
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb; a jsonb; v_message private.email_intake_messages; v_start timestamptz; v_received timestamptz; new_revision bigint;
BEGIN
  IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_messages)>1000
    OR pg_column_size(p_messages)>4194304 OR p_complete IS NULL
    OR (p_cursor_ciphertext IS NULL)<>(p_cursor_key_version IS NULL)
    OR (p_mode='DELTA' AND p_cursor_ciphertext IS NULL) THEN RAISE EXCEPTION 'EMAIL_INVALID_PAGE'; END IF;
  PERFORM 1 FROM private.email_sync_state s JOIN private.email_integrations i ON i.id=s.integration_id
    JOIN public.fundos f ON f.id=i.fundo_id WHERE s.integration_id=p_integration_id AND s.mode=p_mode AND s.lease_token=p_token
    AND s.revision=p_revision AND s.lease_expires_at>clock_timestamp() AND i.enabled AND f.ativo FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
  SELECT start_at INTO v_start FROM private.email_integrations WHERE id=p_integration_id FOR SHARE;
  IF NOT isfinite(v_start) THEN RAISE EXCEPTION 'EMAIL_INVALID_BOUNDARY'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
    IF nullif(m->>'externalId','') IS NULL OR length(m->>'externalId')>2048 THEN RAISE EXCEPTION 'EMAIL_INVALID_MESSAGE'; END IF;
    SELECT * INTO v_message FROM private.email_intake_messages WHERE integration_id=p_integration_id
      AND external_id=m->>'externalId' FOR UPDATE;
    IF coalesce((m->>'removed')::boolean,false) THEN
      -- Known removals update transport state only. Preserve imported NFs/review/history.
      IF v_message.id IS NOT NULL AND v_message.admission_start_at IS NOT NULL THEN
        UPDATE private.email_intake_messages SET provider_removed_at=coalesce(provider_removed_at,clock_timestamp()) WHERE id=v_message.id;
      END IF;
      CONTINUE;
    END IF;
    IF v_message.id IS NULL OR v_message.admission_start_at IS NULL THEN
      v_received:=private.email_received_instant(m->>'receivedAt');
      IF v_received IS NULL OR NOT isfinite(v_received) OR v_received<v_start THEN CONTINUE; END IF;
      -- Existing unadmitted incident metadata cannot be laundered with a changed timestamp.
      IF v_message.id IS NOT NULL AND v_message.received_at IS DISTINCT FROM v_received THEN CONTINUE; END IF;
      INSERT INTO private.email_intake_messages(integration_id,external_id,received_at)
      VALUES(p_integration_id,m->>'externalId',v_received)
      ON CONFLICT(integration_id,external_id) DO UPDATE SET
        admission_start_at=coalesce(email_intake_messages.admission_start_at,EXCLUDED.admission_start_at)
      RETURNING * INTO v_message;
    END IF;
    IF v_message.admission_start_at IS NULL THEN CONTINUE; END IF;
    UPDATE private.email_intake_messages SET provider_removed_at=NULL WHERE id=v_message.id;
    IF jsonb_typeof(m->'attachments') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'attachments')>2000 THEN RAISE EXCEPTION 'EMAIL_INVALID_ATTACHMENTS'; END IF;
    FOR a IN SELECT value FROM jsonb_array_elements(m->'attachments') LOOP
      INSERT INTO private.email_intake_attachments(message_id,external_id,file_name,content_type,size_bytes,inline,kind,status)
      VALUES(v_message.id,a->>'externalId',a->>'name',a->>'contentType',(a->>'size')::bigint,(a->>'inline')::boolean,a->>'kind',
        CASE WHEN (a->>'inline')::boolean THEN 'IGNORED' WHEN a->>'kind'<>'FILE' OR (a->>'size')::bigint>20971520 THEN 'REJECTED' ELSE 'PENDING' END)
      ON CONFLICT(message_id,external_id) DO NOTHING;
    END LOOP;
  END LOOP;
  UPDATE private.email_sync_state s SET cursor_ciphertext=p_cursor_ciphertext,cursor_key_version=p_cursor_key_version,
    revision=s.revision+1,last_success_at=clock_timestamp(),last_error_code=NULL,
    lease_token=CASE WHEN p_complete THEN NULL ELSE s.lease_token END,
    lease_expires_at=CASE WHEN p_complete THEN NULL ELSE clock_timestamp()+interval '5 minutes' END,
    next_run_at=clock_timestamp()+CASE WHEN NOT p_complete THEN interval '0 seconds' WHEN p_mode='DELTA' THEN interval '5 minutes' ELSE interval '1 day' END
    WHERE s.integration_id=p_integration_id AND s.mode=p_mode RETURNING s.revision INTO new_revision;
  RETURN new_revision;
END; $$;

-- R3 aligned entrypoints: preserve all authorization, lease, routing and history checks.
CREATE OR REPLACE FUNCTION public.email_intake_claim_attachment(p_queue text)
RETURNS TABLE(id uuid, token uuid, attempt integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_queue NOT IN ('TEXT', 'VISUAL') THEN RAISE EXCEPTION 'EMAIL_INVALID_QUEUE'; END IF;
  -- Expired claims exhaust their budget without leaving jobs stuck in PROCESSING.
  UPDATE private.email_intake_attachments a SET status = 'FAILED', lease_token = NULL,
    lease_expires_at = NULL, last_error_code = 'RETRY_EXHAUSTED', completed_at = clock_timestamp()
  WHERE a.queue = p_queue AND a.status = 'PROCESSING' AND a.lease_expires_at <= clock_timestamp() AND a.attempts >= a.max_attempts;
  RETURN QUERY
  WITH candidate AS (
    SELECT a.id FROM private.email_intake_attachments a
    JOIN private.email_intake_messages m ON m.id = a.message_id
    JOIN private.email_integrations i ON i.id = m.integration_id
    JOIN public.fundos f ON f.id = i.fundo_id
    WHERE a.queue = p_queue AND i.enabled AND f.ativo AND private.email_message_processable(m) AND a.attempts < a.max_attempts
      AND a.available_at <= clock_timestamp() AND (a.status IN ('PENDING', 'RETRY')
        OR (a.status = 'PROCESSING' AND a.lease_expires_at <= clock_timestamp()))
    ORDER BY a.available_at, a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1
  ) UPDATE private.email_intake_attachments a SET status = 'PROCESSING', attempts = a.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes'
    FROM candidate c WHERE a.id = c.id RETURNING a.id, a.lease_token, a.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_intake_get_attachment_claim(p_id uuid,p_token uuid)
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
      AND i.enabled AND f.ativo AND private.email_message_processable(m) FOR UPDATE OF a;
  IF v_result IS NULL THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION private.fiscal_validate_email_claim(p_actor jsonb,p_fundo_id uuid,p_cedente_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_integration private.email_integrations%ROWTYPE;
BEGIN
  SELECT i.* INTO v_integration FROM private.email_integrations i
    JOIN private.email_intake_messages m ON m.integration_id=i.id
    JOIN private.email_intake_attachments a ON a.message_id=m.id
    WHERE i.id=(p_actor->>'integrationId')::uuid AND i.fundo_id=p_fundo_id AND i.enabled
      AND m.id=(p_actor->>'messageId')::uuid AND private.email_message_processable(m)
      AND a.id=(p_actor->>'attachmentId')::uuid AND a.status='PROCESSING'
      AND a.lease_token=(p_actor->>'attachmentToken')::uuid AND a.lease_expires_at>clock_timestamp()
      AND a.kind='FILE' AND NOT a.inline AND a.size_bytes BETWEEN 1 AND 20971520
    FOR UPDATE OF a;
  IF v_integration.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  IF v_integration.routing_mode='ALLOWLIST' AND NOT EXISTS (
    SELECT 1 FROM private.email_integration_cedentes c WHERE c.integration_id=v_integration.id AND c.cedente_id=p_cedente_id AND c.active
  ) THEN RAISE EXCEPTION 'FISCAL_ROUTING_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_intake_get_review_source(p_review_id uuid,p_fundo_id uuid,p_cedente_fundo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('integrationId',i.id,'fundoId',i.fundo_id,'provider',i.provider,
    'mailbox',i.mailbox_address,'folderId',i.folder_id,'credentialEnvRef',i.credential_env_ref,
    'credentialCiphertext',i.credential_ciphertext,'credentialKeyVersion',i.credential_key_version,
    'messageExternalId',m.external_id,'attachmentExternalId',a.external_id,'fileName',a.file_name,
    'contentType',a.content_type,'size',a.size_bytes,'inline',a.inline,'kind',a.kind)
    INTO v_result FROM public.nfse_review_intents v JOIN private.fiscal_identity_reservations r ON r.id=v.fiscal_reservation_id
    JOIN private.email_intake_attachments a ON a.id=r.attachment_id AND a.message_id=r.message_id
    JOIN private.email_intake_messages m ON m.id=a.message_id AND m.integration_id=r.integration_id
    JOIN private.email_integrations i ON i.id=m.integration_id AND i.fundo_id=r.fundo_id
    JOIN public.fundos f ON f.id=i.fundo_id
    WHERE v.id=p_review_id AND r.fundo_id=p_fundo_id AND r.cedente_fundo_id=p_cedente_fundo_id
      AND v.state='REVIEW' AND v.expires_at>clock_timestamp() AND r.state='REQUIRES_REVIEW'
      AND r.source_channel='EMAIL_INTAKE' AND a.status='REQUIRES_REVIEW' AND i.enabled AND f.ativo
      AND private.email_message_processable(m) AND a.kind='FILE' AND NOT a.inline AND a.size_bytes BETWEEN 1 AND 20971520
      AND private.estabelecimento_pode_originar(r.estabelecimento_id,r.cedente_id,r.fundo_id)
      AND (i.routing_mode='ALL_ACTIVE_CEDENTES' OR EXISTS (SELECT 1 FROM private.email_integration_cedentes c
        WHERE c.integration_id=i.id AND c.cedente_id=r.cedente_id AND c.active));
  IF v_result IS NULL THEN RAISE EXCEPTION 'FISCAL_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION private.email_health_snapshot(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('integrationId',i.id,'name',i.name,'provider',i.provider,'mailbox',i.mailbox_address,
  'enabled',i.enabled AND a.enabled AND f.ativo,'createdAt',a.created_at,'lastConnectionSuccess',a.last_connection_success,
  'lastDeltaSuccess',a.last_delta_success,'lastWebhookSignal',a.last_webhook_signal,
  'lastMessageDiscovered',m.last_discovered,'lastAttachmentProcessed',q.last_processed,
  'pendingCount',q.pending,'processingCount',q.processing,'retryableCount',q.retryable,'failedCount',q.failed,
  'requiresReviewCount',q.review,'oldestPendingAt',q.oldest,'stuckCount',q.stuck+CASE WHEN a.lease_expires_at<now() THEN 1 ELSE 0 END,
  'subscriptionStatus',a.subscription_status,'subscriptionExpiresAt',i.subscription_expires_at,
  'lastReconciliationAt',a.last_reconciliation_at,'lastReconciliationResult',a.reconciliation_result,
  'lastErrorCode',a.last_error_code,'subscriptionError',a.subscription_error,'consecutiveFailures',greatest(a.consecutive_failures,a.subscription_failures),
  'throttledCount',a.throttled_count,'blockedModes',a.blocked_modes)
 FROM private.email_integrations i JOIN private.email_automation a ON a.integration_id=i.id
 JOIN public.fundos f ON f.id=i.fundo_id
 CROSS JOIN LATERAL(SELECT max(discovered_at) last_discovered FROM private.email_intake_messages WHERE integration_id=i.id) m
 CROSS JOIN LATERAL(SELECT count(*) FILTER(WHERE t.status='PENDING') pending,
   count(*) FILTER(WHERE t.status='PROCESSING') processing,count(*) FILTER(WHERE t.status='RETRY') retryable,
   count(*) FILTER(WHERE t.status='FAILED') failed,count(*) FILTER(WHERE t.status='REQUIRES_REVIEW') review,
   count(*) FILTER(WHERE t.status='PROCESSING' AND t.lease_expires_at<now()) stuck,
   min(t.created_at) FILTER(WHERE t.status IN ('PENDING','PROCESSING','RETRY')) oldest,max(t.completed_at) last_processed
   FROM private.email_intake_attachments t JOIN private.email_intake_messages msg ON msg.id=t.message_id WHERE msg.integration_id=i.id AND private.email_message_processable(msg)) q
 WHERE i.id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.email_automation_claim(p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; i private.email_integrations; a private.email_automation; c record; v_token uuid;
BEGIN
 IF p_kind NOT IN ('DELTA','RECONCILIATION','SUBSCRIPTION') THEN RAISE EXCEPTION 'EMAIL_INVALID_JOB'; END IF;
 SELECT r.integration_id INTO v_id FROM private.email_automation r
 JOIN private.email_integrations e ON e.id=r.integration_id JOIN public.fundos f ON f.id=e.fundo_id
 LEFT JOIN private.email_sync_state s ON s.integration_id=r.integration_id AND s.mode=p_kind
 WHERE r.enabled AND e.enabled AND f.ativo AND NOT(p_kind=ANY(r.blocked_modes)) AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=clock_timestamp())
   AND NOT EXISTS(SELECT 1 FROM private.email_sync_state busy WHERE busy.integration_id=r.integration_id AND busy.lease_expires_at>clock_timestamp())
   AND CASE WHEN p_kind='SUBSCRIPTION' THEN r.subscription_next_at<=clock_timestamp()
     ELSE coalesce(s.next_run_at,r.created_at)<=clock_timestamp()
       OR (p_kind='DELTA' AND s.last_error_code IS NULL AND EXISTS(SELECT 1 FROM private.email_wakeups w WHERE w.integration_id=r.integration_id AND w.kind='DELTA')) END
 ORDER BY CASE WHEN p_kind='SUBSCRIPTION' THEN r.subscription_next_at ELSE coalesce(s.next_run_at,r.created_at) END,r.integration_id
 FOR UPDATE OF r SKIP LOCKED LIMIT 1;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 v_token:=gen_random_uuid();
 UPDATE private.email_automation SET lease_token=v_token,lease_kind=p_kind,
   lease_expires_at=clock_timestamp()+interval '5 minutes',claimed_signal_version=signal_version
   WHERE integration_id=v_id RETURNING * INTO a;
 SELECT * INTO i FROM private.email_integrations WHERE id=v_id;
 SELECT NULL::uuid token,NULL::bigint revision,NULL::text cursor_ciphertext,NULL::text cursor_key_version INTO c;
 IF p_kind<>'SUBSCRIPTION' THEN
  SELECT * INTO c FROM public.email_intake_claim_discovery(v_id,p_kind);
  IF c.token IS NULL THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
  INSERT INTO private.email_operational_events(integration_id,event) VALUES(v_id,
    CASE WHEN p_kind='DELTA' THEN 'EMAIL_DELTA_STARTED' ELSE 'EMAIL_RECONCILIATION_STARTED' END);
 END IF;
 RETURN jsonb_build_object('integrationId',i.id,'fundoId',i.fundo_id,'provider',i.provider,'mailbox',i.mailbox_address,
   'folderId',i.folder_id,'credentialEnvRef',i.credential_env_ref,'credentialCiphertext',i.credential_ciphertext,
   'credentialKeyVersion',i.credential_key_version,'token',v_token,'kind',p_kind,'tenantId',a.tenant_id,
   'mailboxObjectId',a.mailbox_object_id,'resource',a.subscription_resource,'subscriptionId',i.subscription_id,
   'subscriptionStatus',a.subscription_status,'subscriptionExpiresAt',i.subscription_expires_at,
   'clientStateCiphertext',i.client_state_ciphertext,'clientStateKeyVersion',i.client_state_key_version,
   'attempt',CASE WHEN p_kind='SUBSCRIPTION' THEN a.subscription_failures ELSE a.consecutive_failures END+1,
   'admissionStartAt',i.start_at,'startAt',CASE WHEN p_kind='RECONCILIATION' THEN greatest(i.start_at,clock_timestamp()-make_interval(days=>a.reconciliation_days)) ELSE i.start_at END)
   || CASE WHEN p_kind='SUBSCRIPTION' THEN '{}'::jsonb ELSE jsonb_build_object('discoveryToken',c.token,
       'revision',c.revision,'cursorCiphertext',c.cursor_ciphertext,'cursorKeyVersion',c.cursor_key_version) END;
END; $$;

CREATE OR REPLACE FUNCTION public.email_automation_commit_page(p_id uuid,p_token uuid,p_kind text,p_discovery_token uuid,
 p_revision bigint,p_messages jsonb,p_cursor_ciphertext text,p_cursor_key_version text,p_complete boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint; v_scanned integer; v_missing integer; a private.email_automation;
BEGIN
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token
   AND lease_kind=p_kind AND lease_expires_at>clock_timestamp() AND enabled FOR UPDATE;
 IF NOT FOUND OR p_kind NOT IN ('DELTA','RECONCILIATION') THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 SELECT count(*)::integer,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM private.email_intake_messages m
   WHERE m.integration_id=p_id AND m.external_id=x->>'externalId'))::integer INTO v_scanned,v_missing
   FROM jsonb_array_elements(p_messages) x
   WHERE NOT coalesce((x->>'removed')::boolean,false)
     AND (EXISTS(SELECT 1 FROM private.email_intake_messages m WHERE m.integration_id=p_id
       AND m.external_id=x->>'externalId' AND m.admission_start_at IS NOT NULL)
       OR private.email_received_instant(x->>'receivedAt') >= (SELECT start_at FROM private.email_integrations WHERE id=p_id));
 v_revision:=public.email_intake_commit_page(p_id,p_kind,p_discovery_token,p_revision,p_messages,
   p_cursor_ciphertext,p_cursor_key_version,p_complete);
 IF p_kind='RECONCILIATION' THEN
   UPDATE private.email_intake_messages SET discovery_source='RECONCILIATION'
     WHERE integration_id=p_id AND discovered_at>=transaction_timestamp() AND external_id IN(SELECT value->>'externalId' FROM jsonb_array_elements(p_messages));
   UPDATE private.email_automation SET reconciliation_progress=jsonb_build_object(
     'scanned',coalesce((reconciliation_progress->>'scanned')::integer,0)+v_scanned,
     'missing',coalesce((reconciliation_progress->>'missing')::integer,0)+v_missing,
     'recovered',coalesce((reconciliation_progress->>'recovered')::integer,0)+v_missing,
     'duplicates',coalesce((reconciliation_progress->>'duplicates')::integer,0)+v_scanned-v_missing,
     'errors',coalesce((reconciliation_progress->>'errors')::integer,0)) WHERE integration_id=p_id;
   IF v_missing>0 THEN INSERT INTO private.email_operational_events(integration_id,event,amount)
     VALUES(p_id,'EMAIL_RECONCILIATION_RECOVERED',v_missing); END IF;
 END IF;
 -- Bound each request to one page; release the transport lease without losing its durable cursor.
 UPDATE private.email_sync_state SET lease_token=NULL,lease_expires_at=NULL WHERE integration_id=p_id AND mode=p_kind;
 UPDATE private.email_automation SET lease_token=NULL,lease_expires_at=NULL,lease_kind=NULL,
   last_connection_success=clock_timestamp(),consecutive_failures=0,throttled_count=0,last_error_code=NULL,
   last_delta_success=CASE WHEN p_kind='DELTA' AND p_complete THEN clock_timestamp() ELSE last_delta_success END,
   last_reconciliation_at=CASE WHEN p_kind='RECONCILIATION' AND p_complete THEN clock_timestamp() ELSE last_reconciliation_at END,
   reconciliation_result=CASE WHEN p_kind='RECONCILIATION' AND p_complete THEN reconciliation_progress ELSE reconciliation_result END,
   reconciliation_progress=CASE WHEN p_kind='RECONCILIATION' AND p_complete THEN '{"scanned":0,"missing":0,"recovered":0,"duplicates":0,"errors":0}'::jsonb ELSE reconciliation_progress END
   WHERE integration_id=p_id;
 IF p_complete THEN
   DELETE FROM private.email_wakeups WHERE integration_id=p_id AND kind='DELTA' AND p_kind='DELTA' AND a.claimed_signal_version=a.signal_version;
   INSERT INTO private.email_operational_events(integration_id,event,amount) VALUES(p_id,
     CASE WHEN p_kind='DELTA' THEN 'EMAIL_DELTA_COMPLETED' ELSE 'EMAIL_RECONCILIATION_COMPLETED' END,v_scanned);
 END IF;
 RETURN v_revision;
END; $$;

-- CREATE OR REPLACE preserves existing service-only/private grants. No new table
-- grants, policies or browser RPC access are introduced by this migration.
COMMIT;
