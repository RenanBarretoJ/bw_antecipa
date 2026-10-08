-- Operational transport only. No schedules are activated by schema deployment.
BEGIN;

ALTER TABLE private.email_intake_messages ADD COLUMN discovery_source text NOT NULL DEFAULT 'DELTA'
  CHECK (discovery_source IN ('DELTA','RECONCILIATION'));

CREATE TABLE private.email_automation (
  integration_id uuid PRIMARY KEY REFERENCES private.email_integrations(id),
  enabled boolean NOT NULL DEFAULT false,
  tenant_id uuid NOT NULL,
  mailbox_object_id uuid NOT NULL,
  subscription_resource text NOT NULL CHECK (length(subscription_resource) BETWEEN 1 AND 2048),
  subscription_status text NOT NULL DEFAULT 'MISSING' CHECK (subscription_status IN ('MISSING','ACTIVE','REMOVED','ERROR')),
  subscription_next_at timestamptz NOT NULL DEFAULT now(),
  subscription_failures integer NOT NULL DEFAULT 0,
  subscription_error text,
  blocked_modes text[] NOT NULL DEFAULT '{}',
  reconciliation_days integer NOT NULL DEFAULT 7 CHECK (reconciliation_days BETWEEN 1 AND 30),
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_kind text CHECK (lease_kind IN ('DELTA','RECONCILIATION','SUBSCRIPTION')),
  signal_version bigint NOT NULL DEFAULT 0,
  claimed_signal_version bigint NOT NULL DEFAULT 0,
  last_webhook_signal timestamptz,
  last_connection_success timestamptz,
  last_delta_success timestamptz,
  last_reconciliation_at timestamptz,
  reconciliation_result jsonb NOT NULL DEFAULT '{"scanned":0,"missing":0,"recovered":0,"duplicates":0,"errors":0}',
  reconciliation_progress jsonb NOT NULL DEFAULT '{"scanned":0,"missing":0,"recovered":0,"duplicates":0,"errors":0}',
  consecutive_failures integer NOT NULL DEFAULT 0,
  throttled_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  health_status text NOT NULL DEFAULT 'DISABLED' CHECK (health_status IN ('HEALTHY','DEGRADED','ERROR','DISABLED')),
  health_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_kind IS NULL))
);
CREATE INDEX email_automation_due_idx ON private.email_automation(subscription_next_at) WHERE enabled;

CREATE TABLE private.email_operational_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  event text NOT NULL CHECK (event IN ('EMAIL_WEBHOOK_RECEIVED','EMAIL_WEBHOOK_COALESCED',
    'EMAIL_DELTA_STARTED','EMAIL_DELTA_COMPLETED','EMAIL_DELTA_FAILED',
    'EMAIL_SUBSCRIPTION_CREATED','EMAIL_SUBSCRIPTION_RENEWED','EMAIL_SUBSCRIPTION_FAILED',
    'EMAIL_RECONCILIATION_STARTED','EMAIL_RECONCILIATION_RECOVERED','EMAIL_RECONCILIATION_COMPLETED',
    'EMAIL_HEALTH_CHANGED','EMAIL_ALERT_RAISED','EMAIL_ALERT_RESOLVED')),
  error_class text CHECK (error_class ~ '^[A-Z_]{1,64}$'),
  amount integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_operational_events_recent_idx ON private.email_operational_events(integration_id,created_at DESC);
CREATE TABLE private.email_operational_alerts (
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  error_class text NOT NULL CHECK (error_class IN ('STALE_SYNC','BACKLOG','SUBSCRIPTION_CRITICAL',
    'GRAPH_AUTH','THROTTLING','WORKER_STUCK','RECONCILIATION_GAP','REPEATED_RETRY')),
  active boolean NOT NULL DEFAULT true,
  raised_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY(integration_id,error_class)
);
CREATE TABLE private.email_webhook_receipts (
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(integration_id,dedupe_key)
);
CREATE INDEX email_webhook_receipts_expiry_idx ON private.email_webhook_receipts(received_at);
CREATE TABLE private.email_webhook_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  window_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
ALTER TABLE private.email_automation ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_operational_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_webhook_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.email_automation,private.email_operational_events,private.email_operational_alerts,
  private.email_webhook_receipts,private.email_webhook_limits FROM PUBLIC,anon,authenticated,service_role;

-- Fixed-shape RPCs are the sole entrypoint to private operational state.
CREATE FUNCTION public.email_automation_webhook_limit(p_key_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO private.email_webhook_limits(key_hash,window_at,attempts)
  VALUES(p_key_hash,date_trunc('minute',clock_timestamp()),1)
  ON CONFLICT(key_hash) DO UPDATE SET window_at=EXCLUDED.window_at,
    attempts=CASE WHEN email_webhook_limits.window_at=EXCLUDED.window_at THEN email_webhook_limits.attempts+1 ELSE 1 END
  RETURNING attempts INTO n;
  RETURN n<=120;
END; $$;

CREATE FUNCTION public.email_automation_webhook_bindings(p_subscription_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('subscriptionId',i.subscription_id,'integrationId',i.id,
   'fundoId',i.fundo_id,'tenantId',a.tenant_id,'mailboxObjectId',a.mailbox_object_id,'subscriptionResource',a.subscription_resource,
   'clientStateCiphertext',i.client_state_ciphertext,'clientStateKeyVersion',i.client_state_key_version)), '[]'::jsonb)
 FROM private.email_integrations i JOIN private.email_automation a ON a.integration_id=i.id
 JOIN public.fundos f ON f.id=i.fundo_id
 WHERE cardinality(p_subscription_ids)<=100 AND i.subscription_id=ANY(p_subscription_ids)
   AND i.enabled AND a.enabled AND f.ativo AND i.client_state_ciphertext IS NOT NULL;
$$;

CREATE FUNCTION public.email_automation_signal(p_signals jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; v_id uuid; v_kind text; v_new integer; v_pending boolean;
BEGIN
 IF jsonb_typeof(p_signals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_signals)>100 THEN RAISE EXCEPTION 'EMAIL_INVALID_SIGNAL'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_signals) LOOP
  v_id:=(s->>'integrationId')::uuid; v_kind:=s->>'kind';
  IF v_kind NOT IN ('DELTA','RENEW','RECREATE') THEN RAISE EXCEPTION 'EMAIL_INVALID_SIGNAL'; END IF;
  PERFORM 1 FROM private.email_automation a JOIN private.email_integrations i ON i.id=a.integration_id
    JOIN public.fundos f ON f.id=i.fundo_id WHERE a.integration_id=v_id AND a.enabled AND i.enabled AND f.ativo FOR UPDATE OF a;
  IF NOT FOUND THEN CONTINUE; END IF;
  INSERT INTO private.email_webhook_receipts(integration_id,dedupe_key) VALUES(v_id,s->>'dedupeKey')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new=ROW_COUNT;
  UPDATE private.email_automation SET last_webhook_signal=clock_timestamp() WHERE integration_id=v_id;
  IF v_new=0 THEN CONTINUE; END IF;
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

CREATE FUNCTION public.email_automation_claim(p_kind text) RETURNS jsonb
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
   'startAt',CASE WHEN p_kind='RECONCILIATION' THEN greatest(i.start_at,clock_timestamp()-make_interval(days=>a.reconciliation_days)) ELSE i.start_at END)
   || CASE WHEN p_kind='SUBSCRIPTION' THEN '{}'::jsonb ELSE jsonb_build_object('discoveryToken',c.token,
       'revision',c.revision,'cursorCiphertext',c.cursor_ciphertext,'cursorKeyVersion',c.cursor_key_version) END;
END; $$;

-- Wrap the certified transport transaction. Fiscal RPCs and 03 migrations stay unchanged.
CREATE FUNCTION public.email_automation_commit_page(p_id uuid,p_token uuid,p_kind text,p_discovery_token uuid,
 p_revision bigint,p_messages jsonb,p_cursor_ciphertext text,p_cursor_key_version text,p_complete boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint; v_scanned integer; v_missing integer; a private.email_automation;
BEGIN
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token
   AND lease_kind=p_kind AND lease_expires_at>clock_timestamp() AND enabled FOR UPDATE;
 IF NOT FOUND OR p_kind NOT IN ('DELTA','RECONCILIATION') THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 SELECT count(*)::integer,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM private.email_intake_messages m
   WHERE m.integration_id=p_id AND m.external_id=x->>'externalId'))::integer INTO v_scanned,v_missing
   FROM jsonb_array_elements(p_messages) x;
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

CREATE FUNCTION public.email_automation_fail(p_id uuid,p_token uuid,p_code text,p_retry_ms bigint,p_retryable boolean,p_reset_cursor boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; v_delay interval;
BEGIN
 IF p_code !~ '^[A-Z_]{1,64}$' OR p_retry_ms<0 OR p_retry_ms>9007199254740991 THEN RAISE EXCEPTION 'EMAIL_INVALID_ERROR'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 v_delay:=CASE WHEN p_retryable THEN make_interval(secs=>greatest(p_retry_ms,1000)::double precision/1000) ELSE interval '1 day' END;
 UPDATE private.email_automation SET throttled_count=CASE WHEN p_code='THROTTLED' THEN throttled_count+1 ELSE throttled_count END WHERE integration_id=p_id;
 IF a.lease_kind='SUBSCRIPTION' THEN
  UPDATE private.email_automation SET subscription_status='ERROR',subscription_failures=subscription_failures+1,
    subscription_error=p_code,subscription_next_at=clock_timestamp()+v_delay WHERE integration_id=p_id;
 ELSE
  UPDATE private.email_sync_state SET lease_token=NULL,lease_expires_at=NULL,last_error_code=p_code,
    next_run_at=clock_timestamp()+v_delay,
    cursor_ciphertext=CASE WHEN p_reset_cursor AND a.lease_kind='DELTA' THEN NULL ELSE cursor_ciphertext END,
    cursor_key_version=CASE WHEN p_reset_cursor AND a.lease_kind='DELTA' THEN NULL ELSE cursor_key_version END,
    revision=revision+CASE WHEN p_reset_cursor THEN 1 ELSE 0 END WHERE integration_id=p_id AND mode=a.lease_kind;
  UPDATE private.email_automation SET consecutive_failures=consecutive_failures+1,
    last_error_code=p_code,
    reconciliation_progress=CASE WHEN a.lease_kind='RECONCILIATION' THEN jsonb_set(reconciliation_progress,'{errors}',to_jsonb(coalesce((reconciliation_progress->>'errors')::integer,0)+1)) ELSE reconciliation_progress END WHERE integration_id=p_id;
 END IF;
 INSERT INTO private.email_operational_events(integration_id,event,error_class) VALUES(p_id,
   CASE WHEN a.lease_kind='SUBSCRIPTION' THEN 'EMAIL_SUBSCRIPTION_FAILED' ELSE 'EMAIL_DELTA_FAILED' END,p_code);
 UPDATE private.email_automation SET lease_token=NULL,lease_expires_at=NULL,lease_kind=NULL,
   blocked_modes=CASE WHEN NOT p_retryable THEN array_append(blocked_modes,a.lease_kind) ELSE blocked_modes END WHERE integration_id=p_id;
END; $$;

CREATE FUNCTION public.email_automation_prepare_subscription(p_id uuid,p_token uuid,p_ciphertext text,p_key_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token AND lease_kind='SUBSCRIPTION'
   AND lease_expires_at>clock_timestamp() AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 UPDATE private.email_integrations SET client_state_ciphertext=p_ciphertext,client_state_key_version=p_key_version
   WHERE id=p_id AND client_state_ciphertext IS NULL;
END; $$;

CREATE FUNCTION public.email_automation_complete_subscription(p_id uuid,p_token uuid,p_subscription_id text,p_expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_automation; previous text;
BEGIN
 IF p_subscription_id IS NULL OR length(p_subscription_id)>256 OR p_expires_at<=clock_timestamp()+interval '1 hour' THEN RAISE EXCEPTION 'EMAIL_INVALID_SUBSCRIPTION'; END IF;
 SELECT * INTO a FROM private.email_automation WHERE integration_id=p_id AND lease_token=p_token AND lease_kind='SUBSCRIPTION'
   AND lease_expires_at>clock_timestamp() AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 SELECT subscription_id INTO previous FROM private.email_integrations WHERE id=p_id AND enabled;
 UPDATE private.email_integrations SET subscription_id=p_subscription_id,subscription_expires_at=p_expires_at WHERE id=p_id AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
 UPDATE private.email_automation SET subscription_status='ACTIVE',subscription_next_at=CASE WHEN a.claimed_signal_version=a.signal_version THEN p_expires_at-interval '1 day' ELSE clock_timestamp() END,
   subscription_failures=0,subscription_error=NULL,last_connection_success=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,lease_kind=NULL WHERE integration_id=p_id;
 DELETE FROM private.email_wakeups WHERE integration_id=p_id AND kind IN ('RENEW','RECREATE') AND a.claimed_signal_version=a.signal_version;
 INSERT INTO private.email_operational_events(integration_id,event) VALUES(p_id,
   CASE WHEN previous=p_subscription_id THEN 'EMAIL_SUBSCRIPTION_RENEWED' ELSE 'EMAIL_SUBSCRIPTION_CREATED' END);
END; $$;

DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'email_automation_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f); END LOOP;
END $$;
COMMIT;
