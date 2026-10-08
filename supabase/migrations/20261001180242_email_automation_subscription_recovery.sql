-- EMAIL04 operational metadata only. Certified R3 admission/claim/commit functions remain unchanged.
BEGIN;
ALTER TABLE private.email_automation
 ADD COLUMN subscription_observed_expiry timestamptz,
 ADD COLUMN subscription_last_success timestamptz,
 ADD COLUMN lifecycle_delta_at timestamptz,
 ADD COLUMN lifecycle_subscription_at timestamptz;

ALTER TABLE private.email_operational_events DROP CONSTRAINT email_operational_events_event_check;
ALTER TABLE private.email_operational_events ADD CONSTRAINT email_operational_events_event_check CHECK(event IN (
 'EMAIL_WEBHOOK_RECEIVED','EMAIL_WEBHOOK_COALESCED','EMAIL_DELTA_STARTED','EMAIL_DELTA_COMPLETED','EMAIL_DELTA_FAILED',
 'EMAIL_SUBSCRIPTION_CREATED','EMAIL_SUBSCRIPTION_RENEWED','EMAIL_SUBSCRIPTION_FAILED',
 'EMAIL_SUBSCRIPTION_EXPIRED','EMAIL_SUBSCRIPTION_RECOVERED',
 'EMAIL_RECONCILIATION_STARTED','EMAIL_RECONCILIATION_RECOVERED','EMAIL_RECONCILIATION_COMPLETED',
 'EMAIL_HEALTH_CHANGED','EMAIL_ALERT_RAISED','EMAIL_ALERT_RESOLVED'));

-- Caller owns the automation row lock. One expiry event per observed expiration instant.
CREATE FUNCTION private.email_observe_subscription_expiry(p_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE observed timestamptz;
BEGIN
 UPDATE private.email_automation a SET subscription_observed_expiry=i.subscription_expires_at
 FROM private.email_integrations i WHERE i.id=a.integration_id AND a.integration_id=p_id
   AND a.enabled AND i.enabled AND i.subscription_id IS NOT NULL
   AND i.subscription_expires_at<=clock_timestamp()
   AND a.subscription_observed_expiry IS DISTINCT FROM i.subscription_expires_at
 RETURNING a.subscription_observed_expiry INTO observed;
 IF observed IS NOT NULL THEN
   INSERT INTO private.email_operational_events(integration_id,event) VALUES(p_id,'EMAIL_SUBSCRIPTION_EXPIRED');
 END IF;
END; $$;
REVOKE ALL ON FUNCTION private.email_observe_subscription_expiry(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.email_automation_signal(p_signals jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; v_id uuid; v_kind text; v_new integer; v_pending boolean; v_lifecycle text;
BEGIN
 IF jsonb_typeof(p_signals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_signals)>100 THEN RAISE EXCEPTION 'EMAIL_INVALID_SIGNAL'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_signals) LOOP
  v_id:=(s->>'integrationId')::uuid; v_kind:=s->>'kind'; v_lifecycle:=s->>'lifecycleEvent';
  IF v_lifecycle IS NOT NULL AND NOT (
    (v_lifecycle='missed' AND v_kind='DELTA') OR
    (v_lifecycle='subscriptionRemoved' AND v_kind='RECREATE') OR
    (v_lifecycle='reauthorizationRequired' AND v_kind='RENEW')) THEN RAISE EXCEPTION 'EMAIL_INVALID_SIGNAL'; END IF;
  IF v_kind NOT IN ('DELTA','RENEW','RECREATE') THEN RAISE EXCEPTION 'EMAIL_INVALID_SIGNAL'; END IF;
  PERFORM 1 FROM private.email_automation a JOIN private.email_integrations i ON i.id=a.integration_id
    JOIN public.fundos f ON f.id=i.fundo_id WHERE a.integration_id=v_id AND a.enabled AND i.enabled AND f.ativo FOR UPDATE OF a;
  IF NOT FOUND THEN CONTINUE; END IF;
  INSERT INTO private.email_webhook_receipts(integration_id,dedupe_key) VALUES(v_id,s->>'dedupeKey')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new=ROW_COUNT;
  UPDATE private.email_automation SET last_webhook_signal=clock_timestamp() WHERE integration_id=v_id;
  IF v_new=0 THEN CONTINUE; END IF;
  IF v_lifecycle IS NOT NULL THEN
    INSERT INTO private.email_operational_events(integration_id,event)
      SELECT v_id,'EMAIL_HEALTH_CHANGED' FROM private.email_automation WHERE integration_id=v_id AND health_status='HEALTHY';
    UPDATE private.email_automation SET
      lifecycle_delta_at=CASE WHEN v_lifecycle='missed' THEN clock_timestamp() ELSE lifecycle_delta_at END,
      lifecycle_subscription_at=CASE WHEN v_lifecycle<>'missed' THEN clock_timestamp() ELSE lifecycle_subscription_at END,
      health_status=CASE WHEN health_status='HEALTHY' THEN 'DEGRADED' ELSE health_status END
      WHERE integration_id=v_id;
  END IF;
  SELECT EXISTS(SELECT 1 FROM private.email_wakeups WHERE integration_id=v_id AND kind=v_kind) INTO v_pending;
  INSERT INTO private.email_wakeups(integration_id,kind) VALUES(v_id,v_kind)
    ON CONFLICT(integration_id,kind) DO UPDATE SET requested_at=clock_timestamp();
  UPDATE private.email_automation SET signal_version=signal_version+1,
    subscription_next_at=CASE WHEN v_kind IN ('RENEW','RECREATE') AND subscription_error IS NULL THEN clock_timestamp() ELSE subscription_next_at END,
    subscription_status=CASE WHEN v_kind='RECREATE' THEN 'REMOVED' ELSE subscription_status END
    WHERE integration_id=v_id;
  INSERT INTO private.email_operational_events(integration_id,event) VALUES(v_id,
    CASE WHEN v_pending THEN 'EMAIL_WEBHOOK_COALESCED' ELSE 'EMAIL_WEBHOOK_RECEIVED' END);
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.email_automation_complete_subscription(p_id uuid,p_token uuid,p_subscription_id text,p_expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; previous text; previous_expiry timestamptz; recovering boolean;
BEGIN
 IF p_subscription_id IS NULL OR length(p_subscription_id)>256 OR p_expires_at<=clock_timestamp()+interval '1 hour' THEN RAISE EXCEPTION 'EMAIL_INVALID_SUBSCRIPTION'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token AND lease_kind='SUBSCRIPTION'
   AND lease_expires_at>clock_timestamp() AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 SELECT subscription_id,subscription_expires_at INTO previous,previous_expiry FROM private.email_integrations WHERE id=p_id AND enabled;
 recovering:=previous IS NOT NULL AND (previous<>p_subscription_id OR a.subscription_status IN ('REMOVED','ERROR') OR previous_expiry<=clock_timestamp());
 PERFORM private.email_observe_subscription_expiry(p_id);
 UPDATE private.email_integrations SET subscription_id=p_subscription_id,subscription_expires_at=p_expires_at WHERE id=p_id AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 UPDATE private.email_automation SET subscription_status='ACTIVE',subscription_next_at=CASE WHEN a.claimed_signal_version=a.signal_version THEN p_expires_at-interval '1 day' ELSE clock_timestamp() END,
   subscription_failures=0,subscription_error=NULL,subscription_last_success=clock_timestamp(),last_connection_success=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,lease_kind=NULL WHERE integration_id=p_id;
 DELETE FROM private.email_wakeups WHERE integration_id=p_id AND kind IN ('RENEW','RECREATE') AND a.claimed_signal_version=a.signal_version;
 INSERT INTO private.email_operational_events(integration_id,event) VALUES(p_id,
   CASE WHEN previous=p_subscription_id THEN 'EMAIL_SUBSCRIPTION_RENEWED' ELSE 'EMAIL_SUBSCRIPTION_CREATED' END);
 IF recovering THEN
   INSERT INTO private.email_operational_events(integration_id,event) VALUES(p_id,'EMAIL_SUBSCRIPTION_RECOVERED');
   -- Recovery requests delta without changing its cursor, admission boundary or retry delay.
   INSERT INTO private.email_wakeups(integration_id,kind) VALUES(p_id,'DELTA')
     ON CONFLICT(integration_id,kind) DO UPDATE SET requested_at=clock_timestamp();
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.email_automation_apply_health(p_id uuid,p_status text,p_alerts text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; v_code text; r private.email_operational_alerts;
BEGIN
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
 -- Expiring technical receipts/limits are not operational or fiscal history.
 DELETE FROM private.email_webhook_receipts WHERE (integration_id,dedupe_key) IN
   (SELECT integration_id,dedupe_key FROM private.email_webhook_receipts WHERE received_at<clock_timestamp()-interval '1 day' LIMIT 1000);
 DELETE FROM private.email_webhook_limits WHERE key_hash IN
   (SELECT key_hash FROM private.email_webhook_limits WHERE window_at<clock_timestamp()-interval '1 day' LIMIT 1000);
END; $$;

-- Keep the R3 snapshot's temporal predicate; add only operational lifecycle metadata.
CREATE OR REPLACE FUNCTION public.email_automation_health_snapshots() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(private.email_health_snapshot(integration_id) || jsonb_build_object(
   'lifecyclePending',(lifecycle_delta_at IS NOT NULL AND (last_delta_success IS NULL OR last_delta_success<lifecycle_delta_at))
     OR (lifecycle_subscription_at IS NOT NULL AND (subscription_last_success IS NULL OR subscription_last_success<lifecycle_subscription_at)))), '[]'::jsonb)
 FROM (SELECT integration_id,lifecycle_delta_at,lifecycle_subscription_at,last_delta_success,subscription_last_success
   FROM private.email_automation ORDER BY health_checked_at NULLS FIRST,integration_id LIMIT 100) a;
$$;

REVOKE ALL ON FUNCTION public.email_automation_signal(jsonb),
 public.email_automation_complete_subscription(uuid,uuid,text,timestamptz),
 public.email_automation_apply_health(uuid,text,text[]),public.email_automation_health_snapshots()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_signal(jsonb),
 public.email_automation_complete_subscription(uuid,uuid,text,timestamptz),
 public.email_automation_apply_health(uuid,text,text[]),public.email_automation_health_snapshots() TO service_role;
COMMIT;
