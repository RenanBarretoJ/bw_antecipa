-- Email is transport only. These private tables never replace fiscal documents.
-- No schedules/subscriptions are activated by this migration.
BEGIN;

CREATE TABLE private.email_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  provider text NOT NULL CHECK (provider IN ('OUTLOOK_GRAPH', 'IMAP')),
  mailbox_address text NOT NULL CHECK (length(mailbox_address) BETWEEN 3 AND 320),
  folder_id text NOT NULL DEFAULT 'inbox',
  routing_mode text NOT NULL DEFAULT 'ALLOWLIST' CHECK (routing_mode IN ('ALLOWLIST', 'ALL_ACTIVE_CEDENTES')),
  enabled boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL,
  scope_verified_at timestamptz,
  scope_evidence_hash text CHECK (scope_evidence_hash ~ '^[a-f0-9]{64}$'),
  credential_ciphertext text,
  credential_key_version text,
  credential_env_ref text CHECK (credential_env_ref ~ '^EMAIL_INTAKE_QA_[A-Z0-9_]{1,48}$'),
  subscription_id text,
  subscription_expires_at timestamptz,
  client_state_ciphertext text,
  client_state_key_version text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((credential_ciphertext IS NULL) = (credential_key_version IS NULL)),
  CHECK ((client_state_ciphertext IS NULL) = (client_state_key_version IS NULL)),
  CHECK (credential_ciphertext IS NULL OR credential_env_ref IS NULL),
  CHECK (NOT enabled OR (provider = 'OUTLOOK_GRAPH' AND scope_verified_at IS NOT NULL
    AND scope_evidence_hash IS NOT NULL AND (credential_ciphertext IS NOT NULL OR credential_env_ref IS NOT NULL)))
);
CREATE INDEX email_integrations_fundo_idx ON private.email_integrations(fundo_id, created_at DESC);
CREATE UNIQUE INDEX email_integrations_subscription_idx ON private.email_integrations(subscription_id) WHERE subscription_id IS NOT NULL;

CREATE TABLE private.email_integration_cedentes (
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, cedente_id)
);

CREATE TABLE private.email_sync_state (
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  mode text NOT NULL CHECK (mode IN ('DELTA', 'RECONCILIATION')),
  cursor_ciphertext text,
  cursor_key_version text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, mode),
  CHECK ((cursor_ciphertext IS NULL) = (cursor_key_version IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX email_sync_due_idx ON private.email_sync_state(next_run_at);

CREATE TABLE private.email_intake_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 2048),
  received_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, external_id)
);
CREATE INDEX email_messages_received_idx ON private.email_intake_messages(integration_id, received_at DESC, id);

CREATE TABLE private.email_intake_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES private.email_intake_messages(id),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 2048),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 1024),
  content_type text NOT NULL CHECK (length(content_type) <= 256),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  inline boolean NOT NULL DEFAULT false,
  kind text NOT NULL CHECK (kind IN ('FILE', 'UNSUPPORTED')),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  queue text NOT NULL DEFAULT 'TEXT' CHECK (queue IN ('TEXT', 'VISUAL', 'REVIEW')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PROCESSING', 'RETRY', 'IMPORTED', 'DUPLICATE', 'REQUIRES_REVIEW',
    'QUARANTINED', 'REJECTED', 'IGNORED', 'FAILED', 'CLEANUP_PENDING')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id),
  last_error_code text CHECK (last_error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (message_id, external_id),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'PROCESSING') = (lease_token IS NOT NULL)),
  CHECK (status NOT IN ('IMPORTED', 'DUPLICATE') OR nota_fiscal_id IS NOT NULL)
);
CREATE INDEX email_attachments_due_idx ON private.email_intake_attachments(queue, available_at, id)
  WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');
CREATE INDEX email_attachments_nf_idx ON private.email_intake_attachments(nota_fiscal_id) WHERE nota_fiscal_id IS NOT NULL;

CREATE TABLE private.email_wakeups (
  integration_id uuid NOT NULL REFERENCES private.email_integrations(id),
  kind text NOT NULL CHECK (kind IN ('DELTA', 'RENEW', 'RECREATE')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, kind)
);

-- Private schema + RLS + no browser grants: privileged jobs use narrowly granted RPCs.
ALTER TABLE private.email_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_integration_cedentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_intake_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_intake_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_wakeups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.email_integrations, private.email_integration_cedentes,
  private.email_sync_state, private.email_intake_messages, private.email_intake_attachments,
  private.email_wakeups FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER is limited to transport data; RPC execution is service_role only.
CREATE FUNCTION public.email_intake_claim_discovery(p_integration_id uuid, p_mode text)
RETURNS TABLE(token uuid, revision bigint, cursor_ciphertext text, cursor_key_version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_mode NOT IN ('DELTA', 'RECONCILIATION') THEN RAISE EXCEPTION 'EMAIL_INVALID_MODE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.email_integrations i JOIN public.fundos f ON f.id = i.fundo_id
    WHERE i.id = p_integration_id AND i.enabled AND f.ativo) THEN RETURN; END IF;
  INSERT INTO private.email_sync_state(integration_id, mode) VALUES (p_integration_id, p_mode) ON CONFLICT DO NOTHING;
  RETURN QUERY UPDATE private.email_sync_state s SET lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + interval '5 minutes'
  WHERE s.integration_id = p_integration_id AND s.mode = p_mode
    AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= clock_timestamp())
  RETURNING s.lease_token, s.revision, s.cursor_ciphertext, s.cursor_key_version;
END;
$$;

CREATE FUNCTION public.email_intake_commit_page(
  p_integration_id uuid, p_mode text, p_token uuid, p_revision bigint, p_messages jsonb,
  p_cursor_ciphertext text, p_cursor_key_version text, p_complete boolean
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m jsonb; a jsonb; v_message_id uuid; new_revision bigint;
BEGIN
  IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_messages) > 1000
    OR pg_column_size(p_messages) > 4194304 OR p_complete IS NULL
    OR (p_cursor_ciphertext IS NULL) <> (p_cursor_key_version IS NULL)
    OR (p_mode = 'DELTA' AND p_cursor_ciphertext IS NULL) THEN RAISE EXCEPTION 'EMAIL_INVALID_PAGE'; END IF;
  PERFORM 1 FROM private.email_sync_state s JOIN private.email_integrations i ON i.id = s.integration_id
    JOIN public.fundos f ON f.id = i.fundo_id
    WHERE s.integration_id = p_integration_id AND s.mode = p_mode AND s.lease_token = p_token
      AND s.revision = p_revision AND s.lease_expires_at > clock_timestamp() AND i.enabled AND f.ativo
    FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
    INSERT INTO private.email_intake_messages(integration_id, external_id, received_at)
    VALUES (p_integration_id, m->>'externalId', (m->>'receivedAt')::timestamptz)
    ON CONFLICT (integration_id, external_id) DO UPDATE SET external_id = EXCLUDED.external_id
    RETURNING id INTO v_message_id;
    IF jsonb_typeof(m->'attachments') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'attachments') > 2000
      THEN RAISE EXCEPTION 'EMAIL_INVALID_ATTACHMENTS'; END IF;
    FOR a IN SELECT value FROM jsonb_array_elements(m->'attachments') LOOP
      INSERT INTO private.email_intake_attachments(message_id, external_id, file_name, content_type, size_bytes, inline, kind, status)
      VALUES (v_message_id, a->>'externalId', a->>'name', a->>'contentType', (a->>'size')::bigint,
        (a->>'inline')::boolean, a->>'kind', CASE WHEN (a->>'inline')::boolean THEN 'IGNORED'
          WHEN a->>'kind' <> 'FILE' OR (a->>'size')::bigint > 20971520 THEN 'REJECTED' ELSE 'PENDING' END)
      ON CONFLICT (message_id, external_id) DO NOTHING;
    END LOOP;
  END LOOP;
  UPDATE private.email_sync_state s SET cursor_ciphertext = p_cursor_ciphertext, cursor_key_version = p_cursor_key_version,
    revision = s.revision + 1, last_success_at = clock_timestamp(), last_error_code = NULL,
    lease_token = CASE WHEN p_complete THEN NULL ELSE s.lease_token END,
    lease_expires_at = CASE WHEN p_complete THEN NULL ELSE clock_timestamp() + interval '5 minutes' END,
    next_run_at = clock_timestamp() + CASE WHEN NOT p_complete THEN interval '0 seconds'
      WHEN p_mode = 'DELTA' THEN interval '5 minutes' ELSE interval '1 day' END
  WHERE s.integration_id = p_integration_id AND s.mode = p_mode RETURNING s.revision INTO new_revision;
  RETURN new_revision;
END;
$$;

CREATE FUNCTION public.email_intake_claim_attachment(p_queue text)
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
    WHERE a.queue = p_queue AND i.enabled AND f.ativo AND a.attempts < a.max_attempts
      AND a.available_at <= clock_timestamp() AND (a.status IN ('PENDING', 'RETRY')
        OR (a.status = 'PROCESSING' AND a.lease_expires_at <= clock_timestamp()))
    ORDER BY a.available_at, a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1
  ) UPDATE private.email_intake_attachments a SET status = 'PROCESSING', attempts = a.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes'
    FROM candidate c WHERE a.id = c.id RETURNING a.id, a.lease_token, a.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.email_intake_claim_discovery(uuid, text),
  public.email_intake_commit_page(uuid, text, uuid, bigint, jsonb, text, text, boolean),
  public.email_intake_claim_attachment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_intake_claim_discovery(uuid, text),
  public.email_intake_commit_page(uuid, text, uuid, bigint, jsonb, text, text, boolean),
  public.email_intake_claim_attachment(text) TO service_role;

COMMIT;
