BEGIN;

CREATE FUNCTION private.email_health_snapshot(p_id uuid) RETURNS jsonb
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
   FROM private.email_intake_attachments t JOIN private.email_intake_messages msg ON msg.id=t.message_id WHERE msg.integration_id=i.id) q
 WHERE i.id=p_id;
$$;
REVOKE ALL ON FUNCTION private.email_health_snapshot(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.email_automation_health_snapshots() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(private.email_health_snapshot(integration_id)),'[]'::jsonb) FROM (
  SELECT integration_id FROM private.email_automation ORDER BY health_checked_at NULLS FIRST,integration_id LIMIT 100
 ) a;
$$;

CREATE FUNCTION public.email_automation_apply_health(p_id uuid,p_status text,p_alerts text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; v_code text; r private.email_operational_alerts;
BEGIN
 IF p_status NOT IN ('HEALTHY','DEGRADED','ERROR','DISABLED') OR p_alerts IS NULL OR NOT(p_alerts<@ARRAY[
   'STALE_SYNC','BACKLOG','SUBSCRIPTION_CRITICAL','GRAPH_AUTH','THROTTLING','WORKER_STUCK','RECONCILIATION_GAP','REPEATED_RETRY'])
   THEN RAISE EXCEPTION 'EMAIL_INVALID_HEALTH'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_INTEGRATION_MISSING'; END IF;
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

CREATE FUNCTION private.email_operator_allowed(p_fundo_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'aal','')='aal2'
  AND EXISTS(SELECT 1 FROM public.obter_sessao_mfa_atual() s WHERE s.status='valid' AND s.metodo='totp' AND s.expira_em>now())
  AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.fundos f ON f.id=p_fundo_id AND f.ativo
   WHERE p.id=auth.uid() AND p.status='ativo' AND (p.role='super_admin' OR (p.role='gestor' AND EXISTS(
     SELECT 1 FROM public.usuario_fundos u WHERE u.usuario_id=p.id AND u.fundo_id=p_fundo_id AND u.status='ativo'))));
$$;
REVOKE ALL ON FUNCTION private.email_operator_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.email_automation_operator_health(p_fundo_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT private.email_operator_allowed(p_fundo_id) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED'; END IF;
 SELECT coalesce(jsonb_agg(private.email_health_snapshot(id)),'[]'::jsonb) INTO v_result FROM (
   SELECT i.id FROM private.email_integrations i JOIN private.email_automation a ON a.integration_id=i.id
   WHERE i.fundo_id=p_fundo_id ORDER BY i.name,i.id LIMIT 100) q;
 RETURN v_result;
END; $$;

CREATE FUNCTION public.email_automation_manual_sync(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_fundo uuid; a private.email_automation;
BEGIN
 SELECT fundo_id INTO v_fundo FROM private.email_integrations WHERE id=p_id AND enabled;
 IF v_fundo IS NULL OR NOT private.email_operator_allowed(v_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED'; END IF;
 IF EXISTS(SELECT 1 FROM private.email_wakeups WHERE integration_id=p_id AND kind='DELTA' AND requested_at>clock_timestamp()-interval '1 minute') THEN RETURN false; END IF;
 INSERT INTO private.email_wakeups(integration_id,kind) VALUES(p_id,'DELTA') ON CONFLICT(integration_id,kind) DO UPDATE SET requested_at=clock_timestamp();
 UPDATE private.email_automation SET signal_version=signal_version+1 WHERE integration_id=p_id;
 -- An operator signal does not override provider Retry-After or permanent-error quarantine.
 INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois)
   VALUES(auth.uid(),'EMAIL_MANUAL_SYNC_REQUESTED','email_integrations',p_id,jsonb_build_object('fundo_id',v_fundo));
 RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.email_automation_health_snapshots(),public.email_automation_apply_health(uuid,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_health_snapshots(),public.email_automation_apply_health(uuid,text,text[]) TO service_role;
REVOKE ALL ON FUNCTION public.email_automation_operator_health(uuid),public.email_automation_manual_sync(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.email_automation_operator_health(uuid),public.email_automation_manual_sync(uuid) TO authenticated;
COMMIT;
