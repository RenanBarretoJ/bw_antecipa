-- S2.1A.1 / SERPRO NF-e: autorizacao e claim seletivo para um piloto manual.
-- Esta migration nao ativa o provedor, nao cria cron, nao provisiona segredo e
-- nao altera a semantica do worker generico nfe_fiscal_claim(integer).
BEGIN;

DO $preconditions$
BEGIN
  IF to_regclass('public.nfe_fiscal_consultas') IS NULL
     OR to_regclass('public.nfe_fiscal_snapshots') IS NULL
     OR to_regclass('public.nfe_fiscal_provider_state') IS NULL
     OR to_regclass('public.sessoes_elevadas') IS NULL
     OR to_regclass('public.usuario_fundos') IS NULL
     OR to_regclass('public.usuario_papeis') IS NULL
     OR to_regprocedure('private.nfe_chave_valida_v1(text)') IS NULL THEN
    RAISE EXCEPTION 'S2.1A.1 depende do ledger S1, MFA e autorizacao canonica por Fundo';
  END IF;
END
$preconditions$;

CREATE TABLE private.nfe_fiscal_pilot_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES public.nfe_fiscal_consultas(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.nfe_fiscal_snapshots(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  chave_fingerprint text NOT NULL CHECK (chave_fingerprint ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  operador_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operador_session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'AUTORIZADA' CHECK (status IN (
    'AUTORIZADA','CONSUMIDA','CONCLUIDA','INCONCLUSIVA','EXPIRADA','REVOGADA'
  )),
  autorizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  consumida_em timestamptz,
  lease_token uuid,
  finalizada_em timestamptz,
  resultado_status text,
  erro_codigo text CHECK (erro_codigo IS NULL OR length(erro_codigo) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nfe_fiscal_pilot_nonce_unique UNIQUE (nonce_hash),
  CONSTRAINT nfe_fiscal_pilot_expiracao_check CHECK (
    expira_em > autorizada_em AND expira_em <= autorizada_em + interval '5 minutes'
  ),
  CONSTRAINT nfe_fiscal_pilot_estado_check CHECK (
    (status = 'AUTORIZADA' AND consumida_em IS NULL AND lease_token IS NULL AND finalizada_em IS NULL)
    OR (status = 'CONSUMIDA' AND consumida_em IS NOT NULL AND lease_token IS NOT NULL AND finalizada_em IS NULL)
    OR (status IN ('CONCLUIDA','INCONCLUSIVA') AND consumida_em IS NOT NULL AND lease_token IS NOT NULL AND finalizada_em IS NOT NULL)
    OR (status IN ('EXPIRADA','REVOGADA') AND consumida_em IS NULL AND lease_token IS NULL AND finalizada_em IS NOT NULL)
  )
);

COMMENT ON TABLE private.nfe_fiscal_pilot_authorizations IS
  'Autorizacao server-side, de uso unico, para uma consulta SERPRO NF-e explicitamente identificada. Nao armazena chave fiscal completa nem segredo do provedor.';

CREATE UNIQUE INDEX nfe_fiscal_pilot_one_active_per_consulta_idx
  ON private.nfe_fiscal_pilot_authorizations (consulta_id)
  WHERE status = 'AUTORIZADA';

CREATE UNIQUE INDEX nfe_fiscal_pilot_one_consumption_per_consulta_idx
  ON private.nfe_fiscal_pilot_authorizations (consulta_id)
  WHERE consumida_em IS NOT NULL;

CREATE INDEX nfe_fiscal_pilot_operator_idx
  ON private.nfe_fiscal_pilot_authorizations (operador_id, autorizada_em DESC);

ALTER TABLE private.nfe_fiscal_pilot_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.nfe_fiscal_pilot_authorizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.nfe_fiscal_pilot_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.nfe_fiscal_pilot_operator_valid(
  p_operador_id uuid,
  p_operador_session_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN auth.sessions s
        ON s.id = p_operador_session_id
       AND s.user_id = p.id
       AND s.aal = 'aal2'
       AND (s.not_after IS NULL OR clock_timestamp() < s.not_after)
      JOIN public.sessoes_elevadas se
        ON se.user_id = p.id
       AND se.session_id = s.id
       AND se.aal = 'aal2'
       AND se.metodo = 'totp'
       AND se.revogada_em IS NULL
       AND clock_timestamp() < se.expira_em
      JOIN auth.mfa_factors mf
        ON mf.id::text = se.factor_id
       AND mf.user_id = p.id
       AND mf.status = 'verified'
     WHERE p.id = p_operador_id
       AND p.status::text = 'ativo'
       AND (
         EXISTS (
           SELECT 1
             FROM public.usuario_papeis up
            WHERE up.usuario_id = p.id
              AND up.papel::text = 'super_admin'
              AND up.ativo = true
              AND up.revogado_em IS NULL
         )
         OR (
           p.role::text = 'gestor'
           AND EXISTS (
             SELECT 1
               FROM public.usuario_fundos uf
              WHERE uf.usuario_id = p.id
                AND uf.fundo_id = p_fundo_id
                AND uf.status = 'ativo'
                AND uf.perfil_no_fundo IN ('gestor','administrador','operador')
           )
         )
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_authorize(
  p_consulta_id uuid,
  p_fundo_id uuid,
  p_nota_fiscal_id uuid,
  p_chave_acesso text,
  p_nonce_hash text,
  p_operador_id uuid,
  p_operador_session_id uuid,
  p_expira_em timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_provider public.nfe_fiscal_provider_state%ROWTYPE;
  v_consulta public.nfe_fiscal_consultas%ROWTYPE;
  v_snapshot public.nfe_fiscal_snapshots%ROWTYPE;
  v_authorization_id uuid;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Autorizacao piloto restrita ao backend' USING ERRCODE = '42501';
  END IF;
  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Nonce piloto invalido' USING ERRCODE = '22023';
  END IF;
  IF p_chave_acesso IS NULL OR NOT private.nfe_chave_valida_v1(p_chave_acesso) THEN
    RAISE EXCEPTION 'Chave NF-e modelo 55 invalida' USING ERRCODE = '22023';
  END IF;
  IF p_expira_em <= v_now OR p_expira_em > v_now + interval '5 minutes' THEN
    RAISE EXCEPTION 'Validade piloto invalida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_provider
    FROM public.nfe_fiscal_provider_state
   WHERE provider = 'SERPRO'
   FOR UPDATE;
  IF NOT FOUND
     OR v_provider.capability_state <> 'ENABLED'
     OR v_provider.circuit_state = 'OPEN'
     OR v_provider.daily_budget <= v_provider.calls_today THEN
    RAISE EXCEPTION 'Gates contratuais ou financeiros indisponiveis' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_consulta
    FROM public.nfe_fiscal_consultas
   WHERE id = p_consulta_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_consulta.fundo_id <> p_fundo_id
     OR v_consulta.nota_fiscal_id <> p_nota_fiscal_id
     OR v_consulta.status <> 'PENDENTE'
     OR v_consulta.capability_state <> 'ENABLED'
     OR v_consulta.lease_token IS NOT NULL
     OR v_consulta.lease_ate IS NOT NULL THEN
    RAISE EXCEPTION 'Consulta piloto nao elegivel ou identidade divergente' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_snapshot
    FROM public.nfe_fiscal_snapshots s
   WHERE s.id = v_consulta.snapshot_id
     AND s.fundo_id = p_fundo_id
     AND s.nota_fiscal_id = p_nota_fiscal_id;
  IF NOT FOUND
     OR v_snapshot.modelo IS DISTINCT FROM '55'
     OR v_snapshot.chave_acesso IS DISTINCT FROM p_chave_acesso THEN
    RAISE EXCEPTION 'Snapshot piloto divergente' USING ERRCODE = '22023';
  END IF;

  IF NOT private.nfe_fiscal_pilot_operator_valid(
    p_operador_id, p_operador_session_id, p_fundo_id
  ) THEN
    RAISE EXCEPTION 'Operador ou MFA piloto invalidos' USING ERRCODE = '42501';
  END IF;

  UPDATE private.nfe_fiscal_pilot_authorizations
     SET status = 'EXPIRADA', finalizada_em = v_now, updated_at = v_now
   WHERE consulta_id = p_consulta_id
     AND status = 'AUTORIZADA'
     AND expira_em <= v_now;

  INSERT INTO private.nfe_fiscal_pilot_authorizations (
    consulta_id, snapshot_id, fundo_id, nota_fiscal_id, chave_fingerprint,
    nonce_hash, operador_id, operador_session_id, autorizada_em, expira_em
  ) VALUES (
    v_consulta.id, v_snapshot.id, p_fundo_id, p_nota_fiscal_id,
    encode(extensions.digest(p_chave_acesso, 'sha256'), 'hex'),
    p_nonce_hash, p_operador_id, p_operador_session_id, v_now, p_expira_em
  ) RETURNING id INTO v_authorization_id;

  RETURN v_authorization_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_claim(
  p_authorization_id uuid,
  p_consulta_id uuid,
  p_fundo_id uuid,
  p_nota_fiscal_id uuid,
  p_chave_acesso text,
  p_nonce_hash text,
  p_operador_id uuid
)
RETURNS TABLE (
  authorization_id uuid,
  consulta_id uuid,
  snapshot_id uuid,
  fundo_id uuid,
  nota_fiscal_id uuid,
  lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_provider public.nfe_fiscal_provider_state%ROWTYPE;
  v_authorization private.nfe_fiscal_pilot_authorizations%ROWTYPE;
  v_consulta public.nfe_fiscal_consultas%ROWTYPE;
  v_snapshot public.nfe_fiscal_snapshots%ROWTYPE;
  v_lease uuid := gen_random_uuid();
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Claim piloto restrito ao backend' USING ERRCODE = '42501';
  END IF;
  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$'
     OR p_chave_acesso IS NULL
     OR NOT private.nfe_chave_valida_v1(p_chave_acesso) THEN
    RETURN;
  END IF;

  SELECT * INTO v_provider
    FROM public.nfe_fiscal_provider_state
   WHERE provider = 'SERPRO'
   FOR UPDATE;
  IF NOT FOUND
     OR v_provider.capability_state <> 'ENABLED'
     OR v_provider.circuit_state = 'OPEN'
     OR v_provider.daily_budget <= v_provider.calls_today THEN
    RETURN;
  END IF;

  SELECT * INTO v_authorization
    FROM private.nfe_fiscal_pilot_authorizations
   WHERE id = p_authorization_id
   FOR UPDATE;
  IF NOT FOUND OR v_authorization.status <> 'AUTORIZADA' THEN
    RETURN;
  END IF;
  IF v_now >= v_authorization.expira_em THEN
    UPDATE private.nfe_fiscal_pilot_authorizations
       SET status = 'EXPIRADA', finalizada_em = v_now, updated_at = v_now
     WHERE id = v_authorization.id;
    RETURN;
  END IF;
  IF v_authorization.consulta_id <> p_consulta_id
     OR v_authorization.fundo_id <> p_fundo_id
     OR v_authorization.nota_fiscal_id <> p_nota_fiscal_id
     OR v_authorization.operador_id <> p_operador_id
     OR v_authorization.nonce_hash <> p_nonce_hash
     OR v_authorization.chave_fingerprint <> encode(extensions.digest(p_chave_acesso, 'sha256'), 'hex') THEN
    RETURN;
  END IF;
  IF NOT private.nfe_fiscal_pilot_operator_valid(
    v_authorization.operador_id, v_authorization.operador_session_id, p_fundo_id
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_consulta
    FROM public.nfe_fiscal_consultas
   WHERE id = p_consulta_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_consulta.snapshot_id <> v_authorization.snapshot_id
     OR v_consulta.fundo_id <> p_fundo_id
     OR v_consulta.nota_fiscal_id <> p_nota_fiscal_id
     OR v_consulta.status <> 'PENDENTE'
     OR v_consulta.capability_state <> 'ENABLED'
     OR v_consulta.lease_token IS NOT NULL
     OR v_consulta.lease_ate IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT s.* INTO v_snapshot
    FROM public.nfe_fiscal_snapshots s
   WHERE s.id = v_consulta.snapshot_id
     AND s.fundo_id = p_fundo_id
     AND s.nota_fiscal_id = p_nota_fiscal_id;
  IF NOT FOUND
     OR v_snapshot.modelo IS DISTINCT FROM '55'
     OR v_snapshot.chave_acesso IS DISTINCT FROM p_chave_acesso THEN
    RETURN;
  END IF;

  UPDATE private.nfe_fiscal_pilot_authorizations
     SET status = 'CONSUMIDA', consumida_em = v_now,
         lease_token = v_lease, updated_at = v_now
   WHERE id = v_authorization.id AND status = 'AUTORIZADA';
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.nfe_fiscal_consultas AS c
     SET status = 'EM_CONSULTA', lease_token = v_lease,
         lease_ate = v_now + interval '45 seconds',
         tentativas = c.tentativas + 1, ultima_chamada_em = v_now,
         proxima_tentativa_em = NULL, atualizado_em = v_now
   WHERE c.id = v_consulta.id
     AND c.status = 'PENDENTE'
     AND c.capability_state = 'ENABLED'
     AND c.lease_token IS NULL
     AND c.lease_ate IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falha atomica ao reservar consulta piloto' USING ERRCODE = '40001';
  END IF;

  UPDATE public.nfe_fiscal_provider_state
     SET calls_today = CASE WHEN budget_date = CURRENT_DATE THEN calls_today + 1 ELSE 1 END,
         budget_date = CURRENT_DATE, atualizado_em = v_now
   WHERE provider = 'SERPRO';

  RETURN QUERY SELECT
    v_authorization.id, v_consulta.id, v_consulta.snapshot_id,
    v_consulta.fundo_id, v_consulta.nota_fiscal_id, v_lease;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_complete(
  p_authorization_id uuid,
  p_consulta_id uuid,
  p_lease_token uuid,
  p_status text,
  p_severidade text,
  p_resumo text,
  p_checked_at timestamptz,
  p_http_status integer,
  p_response_fingerprint text,
  p_resultado_minimo jsonb,
  p_divergencias jsonb,
  p_eventos jsonb DEFAULT '[]'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_authorization private.nfe_fiscal_pilot_authorizations%ROWTYPE;
  v_row public.nfe_fiscal_consultas%ROWTYPE;
  v_event jsonb;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Finalizacao piloto restrita ao backend' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('CONSULTADO','DIVERGENTE','INCONCLUSIVO')
     OR p_severidade NOT IN ('VERDE','AMARELO','VERMELHO')
     OR jsonb_typeof(p_resultado_minimo) <> 'object'
     OR jsonb_typeof(p_divergencias) <> 'array'
     OR jsonb_typeof(p_eventos) <> 'array'
     OR octet_length(p_resultado_minimo::text) > 32768
     OR octet_length(p_eventos::text) > 32768 THEN
    RAISE EXCEPTION 'Resultado fiscal piloto minimizado invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_authorization
    FROM private.nfe_fiscal_pilot_authorizations
   WHERE id = p_authorization_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_authorization.status <> 'CONSUMIDA'
     OR v_authorization.consulta_id <> p_consulta_id
     OR v_authorization.lease_token <> p_lease_token THEN
    RETURN false;
  END IF;

  UPDATE public.nfe_fiscal_consultas
     SET status = p_status, severidade = p_severidade, resumo = left(p_resumo, 500),
         checked_at = p_checked_at, http_status = p_http_status,
         response_fingerprint = p_response_fingerprint,
         resultado_minimo = p_resultado_minimo, divergencias = p_divergencias,
         ultimo_erro_codigo = NULL, proxima_tentativa_em = NULL,
         lease_token = NULL, lease_ate = NULL, atualizado_em = v_now
   WHERE id = p_consulta_id
     AND status = 'EM_CONSULTA'
     AND lease_token = p_lease_token
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN false; END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_eventos)
  LOOP
    INSERT INTO public.nfe_fiscal_eventos (
      consulta_id, fundo_id, nota_fiscal_id, codigo, descricao, protocolo,
      fato_em, observado_em, registrado, severidade, fingerprint
    ) VALUES (
      v_row.id, v_row.fundo_id, v_row.nota_fiscal_id,
      v_event->>'codigo', left(v_event->>'descricao', 160), NULLIF(v_event->>'protocolo', ''),
      NULLIF(v_event->>'fato_em', '')::timestamptz, p_checked_at,
      COALESCE((v_event->>'registrado')::boolean, false), v_event->>'severidade',
      v_event->>'fingerprint'
    ) ON CONFLICT (consulta_id, fingerprint) DO NOTHING;
  END LOOP;

  UPDATE private.nfe_fiscal_pilot_authorizations
     SET status = 'CONCLUIDA', finalizada_em = v_now,
         resultado_status = p_status, erro_codigo = NULL, updated_at = v_now
   WHERE id = v_authorization.id;

  UPDATE public.nfe_fiscal_provider_state
     SET consecutive_failures = 0, circuit_state = 'CLOSED',
         circuit_open_until = NULL, atualizado_em = v_now
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_fail(
  p_authorization_id uuid,
  p_consulta_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_http_status integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_authorization private.nfe_fiscal_pilot_authorizations%ROWTYPE;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Falha piloto restrita ao backend' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_error_code), '') = '' OR length(p_error_code) > 80 THEN
    RAISE EXCEPTION 'Codigo de falha piloto invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_authorization
    FROM private.nfe_fiscal_pilot_authorizations
   WHERE id = p_authorization_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_authorization.status <> 'CONSUMIDA'
     OR v_authorization.consulta_id <> p_consulta_id
     OR v_authorization.lease_token <> p_lease_token THEN
    RETURN false;
  END IF;

  UPDATE public.nfe_fiscal_consultas
     SET status = 'INCONCLUSIVO', severidade = 'NEUTRO',
         resumo = 'Consulta piloto inconclusiva; nova chamada exige reconciliacao manual e nova fase autorizada.',
         http_status = p_http_status, ultimo_erro_codigo = left(p_error_code, 80),
         proxima_tentativa_em = NULL, lease_token = NULL, lease_ate = NULL,
         atualizado_em = v_now
   WHERE id = p_consulta_id
     AND status = 'EM_CONSULTA'
     AND lease_token = p_lease_token;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE private.nfe_fiscal_pilot_authorizations
     SET status = 'INCONCLUSIVA', finalizada_em = v_now,
         resultado_status = 'INCONCLUSIVO', erro_codigo = left(p_error_code, 80),
         updated_at = v_now
   WHERE id = v_authorization.id;

  UPDATE public.nfe_fiscal_provider_state
     SET consecutive_failures = consecutive_failures + 1,
         circuit_state = 'OPEN', circuit_open_until = NULL, atualizado_em = v_now
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION private.nfe_fiscal_pilot_prevent_requeue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN ('PENDENTE','INDISPONIVEL','ERRO')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND EXISTS (
       SELECT 1
         FROM private.nfe_fiscal_pilot_authorizations a
        WHERE a.consulta_id = OLD.id
          AND a.consumida_em IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Consulta piloto consumida exige reconciliacao manual; requeue bloqueado'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER nfe_fiscal_pilot_prevent_requeue
BEFORE UPDATE OF status ON public.nfe_fiscal_consultas
FOR EACH ROW EXECUTE FUNCTION private.nfe_fiscal_pilot_prevent_requeue();

REVOKE ALL ON FUNCTION private.nfe_fiscal_pilot_operator_valid(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.nfe_fiscal_pilot_prevent_requeue()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_pilot_authorize(uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_pilot_claim(uuid,uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_pilot_complete(uuid,uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_pilot_fail(uuid,uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.nfe_fiscal_pilot_authorize(uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_pilot_claim(uuid,uuid,uuid,uuid,text,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_pilot_complete(uuid,uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_pilot_fail(uuid,uuid,uuid,text,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
