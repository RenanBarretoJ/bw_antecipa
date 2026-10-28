-- S2.2R: a claim is NOT an HTTP call. Serialize outbound by credential in the
-- database, retain uncertain effects, and never automatically repeat a GET.
BEGIN;

ALTER TABLE public.nfe_fiscal_provider_state
  ADD COLUMN outbound_token uuid,
  ADD COLUMN outbound_until timestamptz,
  ADD COLUMN next_http_at timestamptz,
  ADD COLUMN oauth_dispatch_count bigint NOT NULL DEFAULT 0 CHECK (oauth_dispatch_count >= 0),
  ADD COLUMN get_dispatch_count bigint NOT NULL DEFAULT 0 CHECK (get_dispatch_count >= 0),
  ADD COLUMN http_response_count bigint NOT NULL DEFAULT 0 CHECK (http_response_count >= 0);

CREATE TABLE private.nfe_fiscal_http_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.nfe_fiscal_execucoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('OAUTH','GET_NFE')),
  execution_attempt integer NOT NULL CHECK (execution_attempt BETWEEN 1 AND 3),
  lease_token uuid NOT NULL,
  state text NOT NULL DEFAULT 'AUTHORIZED_MAY_HAVE_SENT'
    CHECK (state IN ('AUTHORIZED_MAY_HAVE_SENT','RESPONSE_OBSERVED','OUTCOME_UNKNOWN')),
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observed_at timestamptz,
  http_status smallint CHECK (http_status BETWEEN 100 AND 599),
  UNIQUE(execution_id,execution_attempt,phase)
);
ALTER TABLE private.nfe_fiscal_http_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.nfe_fiscal_http_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.nfe_fiscal_http_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX nfe_fiscal_http_attempts_execution ON private.nfe_fiscal_http_attempts(execution_id,authorized_at);
CREATE INDEX nfe_fiscal_http_attempts_fund ON private.nfe_fiscal_http_attempts(fundo_id,authorized_at);
COMMENT ON TABLE private.nfe_fiscal_http_attempts IS
  'Durable authorization immediately before fetch; crash between commit and fetch is explicitly uncertain, not proof of a transmitted request or invoice.';

CREATE FUNCTION private.nfe_fiscal_http_history_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.state<>'AUTHORIZED_MAY_HAVE_SENT'
     OR ROW(NEW.id,NEW.execution_id,NEW.fundo_id,NEW.phase,NEW.execution_attempt,NEW.lease_token,NEW.authorized_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.execution_id,OLD.fundo_id,OLD.phase,OLD.execution_attempt,OLD.lease_token,OLD.authorized_at)
     OR NEW.state NOT IN ('RESPONSE_OBSERVED','OUTCOME_UNKNOWN') THEN
    RAISE EXCEPTION 'HTTP fiscal history immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nfe_fiscal_http_history_guard BEFORE UPDATE OR DELETE ON private.nfe_fiscal_http_attempts
FOR EACH ROW EXECUTE FUNCTION private.nfe_fiscal_http_history_guard();

CREATE FUNCTION public.nfe_fiscal_operational_http_begin(p_execution_id uuid,p_lease_token uuid,p_phase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.nfe_fiscal_provider_state; e public.nfe_fiscal_execucoes;
  t timestamptz; ticket uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
  IF p_phase IS NULL OR p_phase NOT IN ('OAUTH','GET_NFE') THEN RAISE EXCEPTION 'Invalid HTTP phase' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  t:=clock_timestamp();
  IF p.consumption_mode<>'UNLIMITED_WITH_METERING' OR p.capability_state<>'ENABLED'
     OR p.circuit_state='OPEN' OR p.cutover_at IS NULL THEN
    RETURN jsonb_build_object('code','OFF');
  END IF;
  SELECT * INTO e FROM public.nfe_fiscal_execucoes WHERE id=p_execution_id FOR UPDATE;
  IF e.id IS NULL OR e.status<>'EM_PROCESSAMENTO' OR e.lease_token IS DISTINCT FROM p_lease_token
     OR e.lease_until<=t OR NOT e.eligible_post_cutover OR e.requested_at<p.cutover_at THEN
    RETURN jsonb_build_object('code','LEASE_LOST');
  END IF;
  IF NOT private.nfe_fiscal_execution_identity_valid(e.id) THEN
    RETURN jsonb_build_object('code','IDENTITY_MISMATCH'); END IF;
  IF EXISTS(SELECT 1 FROM private.nfe_fiscal_http_attempts h WHERE h.execution_id=e.id
    AND h.execution_attempt=e.attempt_count AND h.phase=p_phase) THEN
    RETURN jsonb_build_object('code','ALREADY_AUTHORIZED');
  END IF;
  IF p_phase='GET_NFE' AND NOT EXISTS (
    SELECT 1 FROM private.nfe_fiscal_http_attempts h WHERE h.execution_id=e.id
      AND h.execution_attempt=e.attempt_count AND h.phase='OAUTH'
      AND h.state='RESPONSE_OBSERVED' AND h.http_status BETWEEN 200 AND 299
  ) THEN RETURN jsonb_build_object('code','OAUTH_NOT_CONFIRMED'); END IF;
  IF p.outbound_token IS NOT NULL THEN
    IF p.outbound_until<=t THEN
      UPDATE public.nfe_fiscal_provider_state SET circuit_state='OPEN',circuit_open_until=NULL WHERE provider='SERPRO';
      RETURN jsonb_build_object('code','OUTCOME_UNKNOWN');
    END IF;
    RETURN jsonb_build_object('code','WAIT','retryAfterMs',100);
  END IF;
  IF p.next_http_at>t THEN RETURN jsonb_build_object('code','WAIT','retryAfterMs',100); END IF;
  INSERT INTO private.nfe_fiscal_http_attempts(execution_id,fundo_id,phase,execution_attempt,lease_token)
    VALUES(e.id,e.fundo_id,p_phase,e.attempt_count,p_lease_token) RETURNING id INTO ticket;
  UPDATE public.nfe_fiscal_provider_state
    SET outbound_token=ticket,outbound_until=t+interval '40 seconds',
        oauth_dispatch_count=oauth_dispatch_count+CASE WHEN p_phase='OAUTH' THEN 1 ELSE 0 END,
        get_dispatch_count=get_dispatch_count+CASE WHEN p_phase='GET_NFE' THEN 1 ELSE 0 END,
        calls_today=calls_today+CASE WHEN p_phase='GET_NFE' THEN 1 ELSE 0 END,
        total_calls=total_calls+CASE WHEN p_phase='GET_NFE' THEN 1 ELSE 0 END
    WHERE provider='SERPRO';
  IF p_phase='GET_NFE' THEN
    UPDATE public.nfe_fiscal_execucoes SET provider_call_count=provider_call_count+1,
      estimated_cost=CASE WHEN p.estimated_unit_cost IS NULL THEN NULL ELSE (provider_call_count+1)*p.estimated_unit_cost END,
      updated_at=t WHERE id=e.id;
  END IF;
  RETURN jsonb_build_object('code','AUTHORIZED','ticket',ticket);
END $$;

CREATE FUNCTION public.nfe_fiscal_operational_http_observed(p_ticket uuid,p_lease_token uuid,p_http_status integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h private.nfe_fiscal_http_attempts; t timestamptz;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
  IF p_http_status IS NULL OR p_http_status NOT BETWEEN 100 AND 599 THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  SELECT * INTO h FROM private.nfe_fiscal_http_attempts WHERE id=p_ticket FOR UPDATE;
  IF h.id IS NULL OR h.lease_token IS DISTINCT FROM p_lease_token OR h.state<>'AUTHORIZED_MAY_HAVE_SENT' THEN RETURN false; END IF;
  t:=clock_timestamp();
  UPDATE private.nfe_fiscal_http_attempts SET state='RESPONSE_OBSERVED',observed_at=t,http_status=p_http_status WHERE id=h.id;
  -- One credential-wide HTTP request in flight; >=100 ms after its response
  -- before the next dispatch. Conservative <=10 RPS includes OAuth AND GET,
  -- independent of worker/node clocks. No fixed-window burst at a boundary.
  UPDATE public.nfe_fiscal_provider_state
    SET outbound_token=CASE WHEN outbound_token=h.id THEN NULL ELSE outbound_token END,
        outbound_until=CASE WHEN outbound_token=h.id THEN NULL ELSE outbound_until END,
        next_http_at=t+interval '100 milliseconds',http_response_count=http_response_count+1,
        circuit_state=CASE WHEN p_http_status IN (401,403) THEN 'OPEN' ELSE circuit_state END,
        circuit_open_until=CASE WHEN p_http_status IN (401,403) THEN NULL ELSE circuit_open_until END
    WHERE provider='SERPRO';
  RETURN true;
END $$;

CREATE FUNCTION public.nfe_fiscal_operational_record_failure(p_execution_id uuid,p_lease_token uuid,
  p_error_code text,p_http_status integer DEFAULT NULL,p_retryable boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE risky boolean; uncertain boolean; result boolean;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM private.nfe_fiscal_http_attempts h WHERE h.execution_id=p_execution_id
      AND (h.phase='GET_NFE' OR h.state IN ('AUTHORIZED_MAY_HAVE_SENT','OUTCOME_UNKNOWN'))),
    EXISTS(SELECT 1 FROM private.nfe_fiscal_http_attempts h WHERE h.execution_id=p_execution_id
      AND h.state IN ('AUTHORIZED_MAY_HAVE_SENT','OUTCOME_UNKNOWN')) INTO risky,uncertain;
  result:=public.nfe_fiscal_operational_fail(p_execution_id,p_lease_token,
    CASE WHEN uncertain THEN 'HTTP_OUTCOME_UNKNOWN' ELSE p_error_code END,p_http_status,
    p_retryable AND NOT risky);
  IF result AND uncertain THEN
    UPDATE private.nfe_fiscal_http_attempts SET state='OUTCOME_UNKNOWN',observed_at=clock_timestamp()
      WHERE execution_id=p_execution_id AND state='AUTHORIZED_MAY_HAVE_SENT';
    UPDATE public.nfe_fiscal_provider_state SET circuit_state='OPEN',circuit_open_until=NULL WHERE provider='SERPRO';
    -- Leave the outbound fence in place. Clearing an uncertain external effect
    -- is a separate manual reconciliation decision, never expiry-based retry.
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.nfe_fiscal_operational_recover()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.nfe_fiscal_execucoes; affected integer:=0;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  FOR e IN SELECT * FROM public.nfe_fiscal_execucoes
    WHERE status='EM_PROCESSAMENTO' AND lease_until<=clock_timestamp()
    ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100
  LOOP
    PERFORM public.nfe_fiscal_operational_record_failure(e.id,e.lease_token,'LEASE_EXPIRED_BEFORE_HTTP',NULL,true);
    affected:=affected+1;
  END LOOP;
  RETURN affected;
END $$;

CREATE FUNCTION private.nfe_fiscal_execution_terminal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('CONCLUIDA','FALHOU','BLOQUEADA_OFF')
    OR ROW(NEW.id,NEW.consulta_id,NEW.snapshot_id,NEW.fundo_id,NEW.nota_fiscal_id,NEW.source,
      NEW.idempotency_key,NEW.request_reference,NEW.requested_by_user_id,NEW.requested_at,NEW.eligible_post_cutover)
      IS DISTINCT FROM ROW(OLD.id,OLD.consulta_id,OLD.snapshot_id,OLD.fundo_id,OLD.nota_fiscal_id,OLD.source,
      OLD.idempotency_key,OLD.request_reference,OLD.requested_by_user_id,OLD.requested_at,OLD.eligible_post_cutover)
  THEN RAISE EXCEPTION 'Execution evidence immutable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nfe_fiscal_execution_terminal_guard BEFORE UPDATE OR DELETE ON public.nfe_fiscal_execucoes
FOR EACH ROW EXECUTE FUNCTION private.nfe_fiscal_execution_terminal_guard();

-- Fiscal history keeps the immutable original UUID as a tombstone, not a live
-- FK that would make every newly imported draft undeletable. Creation is still
-- restricted to fenced functions/triggers; all relational snapshot/consulta/
-- execution/Fund constraints remain. No existing audit row is rewritten.
DO $$ DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass relation,conname FROM pg_constraint
    WHERE contype='f' AND confrelid='public.notas_fiscais'::regclass
      AND conrelid IN ('public.nfe_fiscal_snapshots'::regclass,'public.nfe_fiscal_consultas'::regclass,
        'public.nfe_fiscal_eventos'::regclass,'public.nfe_fiscal_execucoes'::regclass,'public.nfe_fiscal_execucao_eventos'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.relation,c.conname); END LOOP;
END $$;
CREATE FUNCTION private.nfe_fiscal_note_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.nfe_fiscal_execucoes;
BEGIN
  FOR e IN SELECT * FROM public.nfe_fiscal_execucoes WHERE nota_fiscal_id=OLD.id
    AND status IN ('SOLICITADA','INDISPONIVEL','EM_PROCESSAMENTO') FOR UPDATE
  LOOP
    IF e.status='EM_PROCESSAMENTO' THEN
      RAISE EXCEPTION 'NFE_FISCAL_EXECUTION_ACTIVE' USING ERRCODE='55000';
    END IF;
    UPDATE public.nfe_fiscal_execucoes SET status='FALHOU',error_code='NOTE_DELETED',
      completed_at=clock_timestamp(),updated_at=clock_timestamp(),next_attempt_at=NULL WHERE id=e.id;
    PERFORM private.nfe_fiscal_record_execution_event(e.id,'FALHOU','SISTEMA',NULL,'NOTE_DELETED','{}');
  END LOOP;
  RETURN OLD;
END $$;
CREATE TRIGGER nfe_fiscal_note_deleted BEFORE DELETE ON public.notas_fiscais
FOR EACH ROW EXECUTE FUNCTION private.nfe_fiscal_note_deleted();
REVOKE ALL ON FUNCTION private.nfe_fiscal_note_deleted() FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.nfe_fiscal_claim(integer) FROM service_role;

REVOKE ALL ON FUNCTION private.nfe_fiscal_http_history_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.nfe_fiscal_execution_terminal_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_http_begin(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_http_observed(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_record_failure(uuid,uuid,text,integer,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_recover() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.nfe_fiscal_operational_fail(uuid,uuid,text,integer,boolean) FROM service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_http_begin(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_http_observed(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_record_failure(uuid,uuid,text,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_recover() TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.nfe_fiscal_execucoes,public.nfe_fiscal_execucao_eventos FROM service_role;

COMMIT;
