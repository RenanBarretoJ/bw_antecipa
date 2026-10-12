-- Forward-only production claims. Original entrypoints remain intact for existing QA/manual contracts.
-- Reviewed tuple filtering occurs BEFORE locks, leases, attempts and exhaustion updates.
-- No activation, schedules, Vault secrets, business backfill or retention changes.
BEGIN;
CREATE FUNCTION private.email_production_scope_matches(i private.email_integrations,p_scopes jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT i.provider='OUTLOOK_GRAPH' AND i.environment='producao' AND i.routing_mode='ALLOWLIST'
  AND i.credential_env_ref IS NULL AND i.credential_ciphertext IS NULL
  AND private.email_credential_compatible(i.credential_id,i.fundo_id,'producao')
  AND EXISTS(SELECT 1 FROM private.email_automation a CROSS JOIN jsonb_array_elements(p_scopes) s
   WHERE a.integration_id=i.id AND s->>'integrationId'=i.id::text AND s->>'fundoId'=i.fundo_id::text
    AND lower(s->>'mailbox')=lower(i.mailbox_address) AND s->>'folderId'=i.folder_id
    AND lower(s->>'mailboxObjectId')=a.mailbox_object_id::text
    AND lower(s->>'mailboxObjectId')=i.mailbox_object_id::text AND lower(s->>'tenantId')=a.tenant_id::text);
$$;
REVOKE ALL ON FUNCTION private.email_production_scope_matches(private.email_integrations,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.email_automation_claim_scoped(p_kind text,p_scopes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; i private.email_integrations; a private.email_automation; c record; v_token uuid;
BEGIN
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'EMAIL_INVALID_SCOPE'; END IF;
 IF p_kind NOT IN ('DELTA','RECONCILIATION','SUBSCRIPTION') THEN RAISE EXCEPTION 'EMAIL_INVALID_JOB'; END IF;
 SELECT r.integration_id INTO v_id FROM private.email_automation r
 JOIN private.email_integrations e ON e.id=r.integration_id JOIN public.fundos f ON f.id=e.fundo_id
 LEFT JOIN private.email_sync_state s ON s.integration_id=r.integration_id AND s.mode=p_kind
 WHERE private.email_production_scope_matches(e,p_scopes) AND r.enabled AND e.enabled AND f.ativo AND NOT(p_kind=ANY(r.blocked_modes)) AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=clock_timestamp())
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

CREATE FUNCTION public.email_intake_claim_attachment_scoped(p_queue text,p_scopes jsonb)
RETURNS TABLE(id uuid, token uuid, attempt integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'EMAIL_INVALID_SCOPE'; END IF;
  IF p_queue NOT IN ('TEXT', 'VISUAL') THEN RAISE EXCEPTION 'EMAIL_INVALID_QUEUE'; END IF;
  -- Expired claims exhaust their budget without leaving jobs stuck in PROCESSING.
  UPDATE private.email_intake_attachments a SET status = 'FAILED', lease_token = NULL,
    lease_expires_at = NULL, last_error_code = 'RETRY_EXHAUSTED', completed_at = clock_timestamp()
  WHERE a.queue = p_queue AND a.status = 'PROCESSING' AND a.lease_expires_at <= clock_timestamp() AND a.attempts >= a.max_attempts
    AND EXISTS(SELECT 1 FROM private.email_intake_messages m JOIN private.email_integrations i ON i.id=m.integration_id
      WHERE m.id=a.message_id AND private.email_production_scope_matches(i,p_scopes));
  RETURN QUERY
  WITH candidate AS (
    SELECT a.id FROM private.email_intake_attachments a
    JOIN private.email_intake_messages m ON m.id = a.message_id
    JOIN private.email_integrations i ON i.id = m.integration_id
    JOIN public.fundos f ON f.id = i.fundo_id
    WHERE private.email_production_scope_matches(i,p_scopes) AND a.queue = p_queue AND i.enabled AND f.ativo AND private.email_message_processable(m) AND a.attempts < a.max_attempts
      AND a.available_at <= clock_timestamp() AND (a.status IN ('PENDING', 'RETRY')
        OR (a.status = 'PROCESSING' AND a.lease_expires_at <= clock_timestamp()))
    ORDER BY a.available_at, a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1
  ) UPDATE private.email_intake_attachments a SET status = 'PROCESSING', attempts = a.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes'
    FROM candidate c WHERE a.id = c.id RETURNING a.id, a.lease_token, a.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.email_automation_claim_scoped(text,jsonb), public.email_intake_claim_attachment_scoped(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_claim_scoped(text,jsonb), public.email_intake_claim_attachment_scoped(text,jsonb) TO service_role;
CREATE FUNCTION public.email_automation_apply_health_scoped(p_id uuid,p_status text,p_alerts text[],p_scopes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; v_code text; r private.email_operational_alerts;
BEGIN
 IF p_scopes IS NULL OR jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'EMAIL_INVALID_SCOPE'; END IF;
 PERFORM 1 FROM private.email_integrations i WHERE i.id=p_id AND private.email_production_scope_matches(i,p_scopes);
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('HEALTHY','DEGRADED','ERROR','DISABLED') OR p_alerts IS NULL OR NOT(p_alerts<@ARRAY[
   'STALE_SYNC','BACKLOG','SUBSCRIPTION_CRITICAL','GRAPH_AUTH','THROTTLING','WORKER_STUCK','RECONCILIATION_GAP','REPEATED_RETRY'])
   THEN RAISE EXCEPTION 'EMAIL_INVALID_HEALTH'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_INTEGRATION_MISSING'; END IF;
 IF p_status<>'DISABLED' THEN PERFORM private.email_observe_subscription_expiry(p_id); END IF;
 IF a.health_status<>p_status THEN
  INSERT INTO private.email_operational_events(integration_id,event) VALUES(p_id,'EMAIL_HEALTH_CHANGED');
 END IF;
 UPDATE private.email_automation SET health_status=p_status,health_checked_at=clock_timestamp() WHERE integration_id=p_id;
 FOREACH v_code IN ARRAY p_alerts LOOP
  SELECT * INTO r FROM private.email_operational_alerts WHERE integration_id=p_id AND error_class=v_code;
  IF NOT FOUND THEN
   INSERT INTO private.email_operational_alerts(integration_id,error_class) VALUES(p_id,v_code);
   INSERT INTO private.email_operational_events(integration_id,event,error_class) VALUES(p_id,'EMAIL_ALERT_RAISED',v_code);
  ELSE
   IF r.last_notified_at<=clock_timestamp()-interval '1 hour' THEN
    UPDATE private.email_operational_alerts SET last_notified_at=clock_timestamp() WHERE integration_id=p_id AND error_class=v_code;
    INSERT INTO private.email_operational_events(integration_id,event,error_class) VALUES(p_id,'EMAIL_ALERT_RAISED',v_code);
   END IF;
   UPDATE private.email_operational_alerts SET active=true,resolved_at=NULL,
     raised_at=CASE WHEN r.active THEN raised_at ELSE clock_timestamp() END WHERE integration_id=p_id AND error_class=v_code;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM private.email_operational_alerts WHERE integration_id=p_id AND active AND NOT(error_class=ANY(p_alerts)) LOOP
  UPDATE private.email_operational_alerts SET active=false,resolved_at=clock_timestamp() WHERE integration_id=p_id AND error_class=r.error_class;
  INSERT INTO private.email_operational_events(integration_id,event,error_class) VALUES(p_id,'EMAIL_ALERT_RESOLVED',r.error_class);
 END LOOP;
 -- Production health does not adopt QA's 24-hour receipt/limit deletion policy.
 -- A production retention policy requires a separate reviewed maintenance path.
END; $$;
REVOKE ALL ON FUNCTION public.email_automation_apply_health_scoped(uuid,text,text[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_apply_health_scoped(uuid,text,text[],jsonb) TO service_role;
COMMIT;
