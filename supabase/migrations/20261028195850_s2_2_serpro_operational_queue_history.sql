-- S2.2 / SERPRO NF-e: fila operacional pos-importacao e reconsulta auditada.
--
-- Esta migration e deliberadamente dormant: nao cria cron, nao altera secrets,
-- nao habilita capability/circuito e preserva OFF_ZERO_BUDGET por padrao.
-- A fila historica S1 permanece fora do claim operacional por nao possuir uma
-- execucao S2.2 elegivel e posterior ao cutover.

BEGIN;

DO $preconditions$
BEGIN
  IF to_regclass('public.nfe_fiscal_snapshots') IS NULL
     OR to_regclass('public.nfe_fiscal_consultas') IS NULL
     OR to_regclass('public.nfe_fiscal_eventos') IS NULL
     OR to_regclass('public.nfe_fiscal_provider_state') IS NULL
     OR to_regclass('private.fiscal_identity_reservations') IS NULL
     OR to_regprocedure('private.nfe_chave_valida_v1(text)') IS NULL
     OR to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.usuario_e_super_admin()') IS NULL
     OR to_regprocedure('private.c1_1_usuario_e_super_admin_rls()') IS NULL
     OR to_regprocedure('public.obter_sessao_mfa_atual()') IS NULL THEN
    RAISE EXCEPTION 'S2.2 depende do ledger S1, fiscal intake e autorizacao canonica por Fundo';
  END IF;
END
$preconditions$;

ALTER TABLE public.nfe_fiscal_provider_state
  ADD COLUMN consumption_mode text NOT NULL DEFAULT 'OFF_ZERO_BUDGET'
    CHECK (consumption_mode IN ('OFF_ZERO_BUDGET','UNLIMITED_WITH_METERING','LIMITED')),
  ADD COLUMN cutover_at timestamptz,
  ADD COLUMN max_requests_per_second smallint NOT NULL DEFAULT 15
    CHECK (max_requests_per_second BETWEEN 1 AND 15),
  ADD COLUMN total_calls bigint NOT NULL DEFAULT 0 CHECK (total_calls >= 0),
  ADD COLUMN estimated_unit_cost numeric(14,6) CHECK (estimated_unit_cost IS NULL OR estimated_unit_cost >= 0),
  ADD COLUMN cost_currency text NOT NULL DEFAULT 'BRL' CHECK (cost_currency = 'BRL'),
  ADD COLUMN rate_window_started_at timestamptz,
  ADD COLUMN rate_window_calls smallint NOT NULL DEFAULT 0 CHECK (rate_window_calls BETWEEN 0 AND 15);

COMMENT ON COLUMN public.nfe_fiscal_provider_state.consumption_mode IS
  'OFF explicito, consumo ilimitado com medicao, ou limite futuro. Zero nunca significa ilimitado.';
COMMENT ON COLUMN public.nfe_fiscal_provider_state.cutover_at IS
  'Marco transacional futuro. Somente execucoes criadas depois deste instante podem ser reclamadas.';

CREATE TABLE public.nfe_fiscal_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES public.nfe_fiscal_consultas(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES public.nfe_fiscal_snapshots(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('AUTOMATICA_IMPORTACAO','MANUAL_GESTOR')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  request_reference text NOT NULL CHECK (length(request_reference) BETWEEN 1 AND 128),
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_by_email_snapshot text CHECK (
    requested_by_email_snapshot IS NULL OR length(requested_by_email_snapshot) BETWEEN 3 AND 320
  ),
  executor_type text NOT NULL DEFAULT 'SISTEMA' CHECK (executor_type = 'SISTEMA'),
  chave_fingerprint text NOT NULL CHECK (chave_fingerprint ~ '^[0-9a-f]{64}$'),
  eligible_post_cutover boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN (
    'BLOQUEADA_OFF','SOLICITADA','EM_PROCESSAMENTO','CONCLUIDA','FALHOU','INDISPONIVEL'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  provider_call_count integer NOT NULL DEFAULT 0 CHECK (provider_call_count BETWEEN 0 AND 3),
  estimated_cost numeric(14,6) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  cost_currency text NOT NULL DEFAULT 'BRL' CHECK (cost_currency = 'BRL'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  result_status text CHECK (result_status IS NULL OR result_status IN ('CONSULTADO','DIVERGENTE','INCONCLUSIVO')),
  severity text CHECK (severity IS NULL OR severity IN ('VERDE','AMARELO','VERMELHO')),
  summary text CHECK (summary IS NULL OR length(summary) <= 500),
  checked_at timestamptz,
  http_status smallint CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  response_fingerprint text CHECK (response_fingerprint IS NULL OR response_fingerprint ~ '^[0-9a-f]{64}$'),
  result_minimum jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_minimum) = 'object'),
  differences jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(differences) = 'array'),
  error_code text CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nfe_fiscal_execucoes_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT nfe_fiscal_execucoes_context_check CHECK (
    (source = 'AUTOMATICA_IMPORTACAO')
    OR (source = 'MANUAL_GESTOR' AND requested_by_user_id IS NOT NULL)
  ),
  CONSTRAINT nfe_fiscal_execucoes_lease_check CHECK (
    (lease_token IS NULL AND lease_until IS NULL)
    OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND status = 'EM_PROCESSAMENTO')
  )
);

COMMENT ON TABLE public.nfe_fiscal_execucoes IS
  'Ledger operacional por consulta externa. Cada nova reconsulta terminal cria outra linha; payload bruto nunca e armazenado.';

CREATE UNIQUE INDEX nfe_fiscal_execucoes_one_active_idx
  ON public.nfe_fiscal_execucoes (consulta_id)
  WHERE status IN ('SOLICITADA','EM_PROCESSAMENTO','INDISPONIVEL');
CREATE INDEX nfe_fiscal_execucoes_claim_idx
  ON public.nfe_fiscal_execucoes (status, next_attempt_at, requested_at, id)
  WHERE eligible_post_cutover = true
    AND status IN ('SOLICITADA','INDISPONIVEL');
CREATE INDEX nfe_fiscal_execucoes_fundo_history_idx
  ON public.nfe_fiscal_execucoes (fundo_id, requested_at DESC, id DESC);
CREATE INDEX nfe_fiscal_execucoes_nota_history_idx
  ON public.nfe_fiscal_execucoes (nota_fiscal_id, requested_at DESC, id DESC);

CREATE TABLE public.nfe_fiscal_execucao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.nfe_fiscal_execucoes(id) ON DELETE RESTRICT,
  consulta_id uuid NOT NULL REFERENCES public.nfe_fiscal_consultas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'BLOQUEADA_OFF','SOLICITADA','EM_PROCESSAMENTO','CONCLUIDA','FALHOU','INDISPONIVEL'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('USUARIO','SISTEMA','WORKER')),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  error_code text CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nfe_fiscal_execucao_eventos_fingerprint_unique UNIQUE (execucao_id, fingerprint)
);

COMMENT ON TABLE public.nfe_fiscal_execucao_eventos IS
  'Trilha append-only de transicoes da execucao SERPRO, sem segredo, token ou payload bruto.';

ALTER TABLE public.nfe_fiscal_consultas
  ADD COLUMN latest_execution_id uuid REFERENCES public.nfe_fiscal_execucoes(id) ON DELETE RESTRICT;

ALTER TABLE public.nfe_fiscal_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_execucoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_execucao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_execucao_eventos FORCE ROW LEVEL SECURITY;

CREATE POLICY nfe_fiscal_execucoes_gestor_admin_select
  ON public.nfe_fiscal_execucoes FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(fundo_id))
  );
CREATE POLICY nfe_fiscal_execucao_eventos_gestor_admin_select
  ON public.nfe_fiscal_execucao_eventos FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(fundo_id))
  );

REVOKE ALL ON TABLE public.nfe_fiscal_execucoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nfe_fiscal_execucao_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nfe_fiscal_execucoes TO authenticated;
GRANT SELECT ON TABLE public.nfe_fiscal_execucao_eventos TO authenticated;
GRANT ALL ON TABLE public.nfe_fiscal_execucoes TO service_role;
GRANT ALL ON TABLE public.nfe_fiscal_execucao_eventos TO service_role;

CREATE OR REPLACE FUNCTION private.nfe_fiscal_execucao_eventos_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Historico de execucao fiscal e imutavel' USING ERRCODE = '42501';
END
$function$;

CREATE TRIGGER nfe_fiscal_execucao_eventos_immutable
BEFORE UPDATE OR DELETE ON public.nfe_fiscal_execucao_eventos
FOR EACH ROW EXECUTE FUNCTION private.nfe_fiscal_execucao_eventos_immutable();

CREATE OR REPLACE FUNCTION private.nfe_fiscal_record_execution_event(
  p_execucao_id uuid,
  p_status text,
  p_actor_type text,
  p_actor_user_id uuid DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_execution public.nfe_fiscal_execucoes%ROWTYPE;
  v_fingerprint text;
BEGIN
  SELECT * INTO v_execution
    FROM public.nfe_fiscal_execucoes
   WHERE id = p_execucao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao fiscal inexistente' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('BLOQUEADA_OFF','SOLICITADA','EM_PROCESSAMENTO','CONCLUIDA','FALHOU','INDISPONIVEL')
     OR p_actor_type NOT IN ('USUARIO','SISTEMA','WORKER')
     OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Evento de execucao fiscal invalido' USING ERRCODE = '22023';
  END IF;
  v_fingerprint := encode(extensions.digest(concat_ws('|',
    p_execucao_id::text, p_status, p_actor_type,
    COALESCE(p_actor_user_id::text, ''), COALESCE(p_error_code, ''),
    clock_timestamp()::text, gen_random_uuid()::text
  ), 'sha256'), 'hex');
  INSERT INTO public.nfe_fiscal_execucao_eventos (
    execucao_id, consulta_id, fundo_id, nota_fiscal_id, status,
    actor_type, actor_user_id, error_code, metadata, fingerprint
  ) VALUES (
    v_execution.id, v_execution.consulta_id, v_execution.fundo_id,
    v_execution.nota_fiscal_id, p_status, p_actor_type,
    p_actor_user_id, left(p_error_code, 80), COALESCE(p_metadata, '{}'::jsonb), v_fingerprint
  );
END
$function$;

-- Evolui o trigger S1 para a fronteira real de commit da importacao. O mesmo
-- hash impede que submissao posterior ou recovery idempotente gere nova cobranca.
CREATE OR REPLACE FUNCTION private.nfe_enfileirar_apos_submissao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_document_ref text;
  v_idempotency text;
  v_key text;
  v_key_valid boolean := false;
  v_identity_valid boolean := false;
  v_snapshot_id uuid;
  v_consulta_id uuid;
  v_initial_status text;
  v_actor_id uuid;
  v_actor_email text;
  v_request_ref text;
  v_exec_id uuid;
  v_provider public.nfe_fiscal_provider_state%ROWTYPE;
  v_eligible boolean := false;
BEGIN
  IF COALESCE(NEW.tipo_documento_fiscal, '') <> 'NFE'
     OR NEW.fundo_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_key := regexp_replace(COALESCE(NEW.chave_acesso, ''), '[^0-9]', '', 'g');
  v_key_valid := length(v_key) = 44 AND private.nfe_chave_valida_v1(v_key);
  v_identity_valid := v_key_valid
    AND regexp_replace(COALESCE(NEW.cnpj_emitente, ''), '[^0-9]', '', 'g') = substring(v_key FROM 7 FOR 14)
    AND ltrim(COALESCE(NEW.numero_nf, ''), '0') = ltrim(substring(v_key FROM 26 FOR 9), '0')
    AND ltrim(COALESCE(NEW.serie, ''), '0') = ltrim(substring(v_key FROM 23 FOR 3), '0');

  v_document_ref := COALESCE(
    NEW.fiscal_reservation_id::text,
    NULLIF(NEW.fiscal_proveniencia->>'sha256', ''),
    NEW.id::text
  );
  v_idempotency := encode(extensions.digest(
    concat_ws('|', 'S2_2_NFE_IMPORT_V1', NEW.fundo_id::text, NEW.id::text, v_key),
    'sha256'
  ), 'hex');

  INSERT INTO public.nfe_fiscal_snapshots (
    fundo_id, nota_fiscal_id, document_ref, idempotency_ref, chave_acesso,
    modelo, numero_nf, serie, cnpj_emitente, cnpj_destinatario, data_emissao, valor_total
  ) VALUES (
    NEW.fundo_id, NEW.id, v_document_ref, v_idempotency, NULLIF(v_key, ''),
    CASE WHEN length(v_key) = 44 THEN substring(v_key FROM 21 FOR 2) END,
    NEW.numero_nf, NEW.serie,
    regexp_replace(COALESCE(NEW.cnpj_emitente, ''), '[^0-9]', '', 'g'),
    regexp_replace(COALESCE(NEW.cnpj_destinatario, ''), '[^0-9]', '', 'g'),
    NEW.data_emissao, NEW.valor_bruto
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_snapshot_id;

  IF v_snapshot_id IS NULL THEN
    SELECT id INTO v_snapshot_id
      FROM public.nfe_fiscal_snapshots
     WHERE idempotency_ref = v_idempotency
        OR (fundo_id = NEW.fundo_id AND nota_fiscal_id = NEW.id AND document_ref = v_document_ref)
     ORDER BY (idempotency_ref = v_idempotency) DESC, criado_em DESC
     LIMIT 1;
  END IF;
  IF v_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel resolver snapshot fiscal idempotente' USING ERRCODE = '23505';
  END IF;

  v_initial_status := CASE
    WHEN v_key = '' THEN 'AGUARDANDO_CHAVE'
    WHEN NOT v_key_valid THEN 'NAO_SUPORTADO'
    WHEN NOT v_identity_valid THEN 'INCONCLUSIVO'
    ELSE 'PENDENTE'
  END;

  SELECT * INTO v_provider
    FROM public.nfe_fiscal_provider_state
   WHERE provider = 'SERPRO';

  INSERT INTO public.nfe_fiscal_consultas (
    snapshot_id, fundo_id, nota_fiscal_id, status, capability_state,
    event_coverage, severidade, resumo
  ) VALUES (
    v_snapshot_id, NEW.fundo_id, NEW.id, v_initial_status,
    COALESCE(v_provider.capability_state, 'UNVERIFIED'),
    'PARTIAL', 'NEUTRO',
    CASE v_initial_status
      WHEN 'PENDENTE' THEN 'Consulta automatica registrada; execucao depende de cutover e gates explicitos.'
      WHEN 'AGUARDANDO_CHAVE' THEN 'NF-e importada sem chave fiscal principal segura.'
      WHEN 'INCONCLUSIVO' THEN 'A chave nao coincide com a identidade fiscal extraida.'
      ELSE 'Documento nao suportado pela consulta SERPRO NF-e modelo 55.'
    END
  ) ON CONFLICT (snapshot_id) DO NOTHING
  RETURNING id INTO v_consulta_id;

  IF v_consulta_id IS NULL THEN
    SELECT id INTO v_consulta_id
      FROM public.nfe_fiscal_consultas
     WHERE snapshot_id = v_snapshot_id;
  END IF;

  -- Sem chave/identidade confiavel ha diagnostico, mas nenhuma execucao externa.
  IF NOT v_identity_valid THEN
    RETURN NEW;
  END IF;

  SELECT r.actor_user_id, r.id::text
    INTO v_actor_id, v_request_ref
    FROM private.fiscal_identity_reservations r
   WHERE r.id = NEW.fiscal_reservation_id;
  v_actor_id := COALESCE(v_actor_id, auth.uid());
  v_request_ref := COALESCE(v_request_ref, v_document_ref);
  SELECT p.email INTO v_actor_email FROM public.profiles p WHERE p.id = v_actor_id;

  v_eligible := v_provider.cutover_at IS NOT NULL
    AND NEW.created_at >= v_provider.cutover_at
    AND clock_timestamp() >= v_provider.cutover_at
    AND NOT EXISTS (
      SELECT 1 FROM public.nfe_fiscal_snapshots old_snapshot
       WHERE old_snapshot.chave_acesso = v_key
         AND old_snapshot.criado_em < v_provider.cutover_at
    );

  INSERT INTO public.nfe_fiscal_execucoes (
    consulta_id, snapshot_id, fundo_id, nota_fiscal_id, source,
    idempotency_key, request_reference, requested_by_user_id,
    requested_by_email_snapshot, chave_fingerprint, eligible_post_cutover,
    status, next_attempt_at
  ) VALUES (
    v_consulta_id, v_snapshot_id, NEW.fundo_id, NEW.id, 'AUTOMATICA_IMPORTACAO',
    encode(extensions.digest(concat_ws('|', 'AUTO_IMPORT_V1', NEW.fundo_id::text, NEW.id::text, v_key), 'sha256'), 'hex'),
    left(v_request_ref, 128), v_actor_id, left(v_actor_email, 320),
    encode(extensions.digest(v_key, 'sha256'), 'hex'), v_eligible,
    CASE WHEN v_eligible THEN 'SOLICITADA' ELSE 'BLOQUEADA_OFF' END,
    CASE WHEN v_eligible THEN clock_timestamp() ELSE NULL END
  ) ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_exec_id;

  IF v_exec_id IS NOT NULL THEN
    UPDATE public.nfe_fiscal_consultas
       SET latest_execution_id = v_exec_id, atualizado_em = clock_timestamp()
     WHERE id = v_consulta_id;
    PERFORM private.nfe_fiscal_record_execution_event(
      v_exec_id,
      CASE WHEN v_eligible THEN 'SOLICITADA' ELSE 'BLOQUEADA_OFF' END,
      CASE WHEN v_actor_id IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
      v_actor_id,
      NULL,
      jsonb_build_object('source','AUTOMATICA_IMPORTACAO','postCutover',v_eligible)
    );
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS nfe_enfileirar_apos_submissao_insert ON public.notas_fiscais;
DROP TRIGGER IF EXISTS nfe_enfileirar_apos_submissao_update ON public.notas_fiscais;
CREATE TRIGGER nfe_enfileirar_apos_importacao_insert
AFTER INSERT ON public.notas_fiscais
FOR EACH ROW EXECUTE FUNCTION private.nfe_enfileirar_apos_submissao();
-- Identity edits, parcel edits and later submission are deliberately not enqueue
-- events. In particular, an UPDATE of an old NF cannot cross the cutover.

CREATE OR REPLACE FUNCTION public.solicitar_reconsulta_nfe_fiscal_operacional(
  p_nota_fiscal_id uuid,
  p_request_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_row public.nfe_fiscal_consultas%ROWTYPE;
  v_snapshot public.nfe_fiscal_snapshots%ROWTYPE;
  v_provider public.nfe_fiscal_provider_state%ROWTYPE;
  v_exec public.nfe_fiscal_execucoes%ROWTYPE;
  v_idempotency text;
  v_status text;
  v_eligible boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;
  -- Nao ha challenge TOTP adicional. A RPC apenas revalida o MFA de login
  -- da sessao Auth corrente, inclusive vinculo da session_id e fator ativo.
  IF NOT EXISTS (
    SELECT 1
      FROM public.obter_sessao_mfa_atual() sessao
     WHERE sessao.status = 'valid'
  ) THEN
    RAISE EXCEPTION 'Sessao MFA de login invalida ou expirada' USING ERRCODE = '42501';
  END IF;
  IF p_request_reference IS NULL
     OR p_request_reference !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'Referencia idempotente invalida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.nfe_fiscal_consultas
   WHERE nota_fiscal_id = p_nota_fiscal_id
   ORDER BY criado_em DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND OR NOT (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(v_row.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Consulta fiscal nao encontrada ou acesso negado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_snapshot
    FROM public.nfe_fiscal_snapshots
   WHERE id = v_row.snapshot_id;
  IF NOT FOUND OR v_snapshot.modelo IS DISTINCT FROM '55'
     OR v_snapshot.chave_acesso IS NULL
     OR NOT private.nfe_chave_valida_v1(v_snapshot.chave_acesso)
     OR NOT EXISTS (
       SELECT 1 FROM public.notas_fiscais n
        WHERE n.id = v_row.nota_fiscal_id AND n.fundo_id = v_row.fundo_id
          AND n.tipo_documento_fiscal = 'NFE'
          AND v_snapshot.nota_fiscal_id = n.id AND v_snapshot.fundo_id = n.fundo_id
          AND regexp_replace(n.chave_acesso, '[^0-9]', '', 'g') = v_snapshot.chave_acesso
          AND regexp_replace(n.cnpj_emitente, '[^0-9]', '', 'g') = substring(v_snapshot.chave_acesso FROM 7 FOR 14)
          AND ltrim(n.numero_nf, '0') = ltrim(substring(v_snapshot.chave_acesso FROM 26 FOR 9), '0')
          AND ltrim(n.serie, '0') = ltrim(substring(v_snapshot.chave_acesso FROM 23 FOR 3), '0')
          AND n.valor_bruto IS NOT DISTINCT FROM v_snapshot.valor_total
          AND n.data_emissao IS NOT DISTINCT FROM v_snapshot.data_emissao
     ) THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'NOT_ELIGIBLE');
  END IF;

  SELECT * INTO v_provider
    FROM public.nfe_fiscal_provider_state
   WHERE provider = 'SERPRO';
  v_eligible := v_provider.cutover_at IS NOT NULL
    AND clock_timestamp() >= v_provider.cutover_at
    AND v_provider.consumption_mode = 'UNLIMITED_WITH_METERING'
    AND v_provider.capability_state = 'ENABLED';
  v_status := CASE WHEN v_eligible THEN 'SOLICITADA' ELSE 'BLOQUEADA_OFF' END;
  v_idempotency := encode(extensions.digest(concat_ws('|',
    'MANUAL_V1', v_row.fundo_id::text, v_row.nota_fiscal_id::text,
    v_user_id::text, p_request_reference
  ), 'sha256'), 'hex');

  SELECT * INTO v_exec
    FROM public.nfe_fiscal_execucoes
   WHERE idempotency_key = v_idempotency;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'accepted', v_exec.status <> 'BLOQUEADA_OFF',
      'code', 'IDEMPOTENT_REPLAY', 'requestId', v_exec.id, 'status', v_exec.status
    );
  END IF;

  SELECT * INTO v_exec
    FROM public.nfe_fiscal_execucoes
   WHERE consulta_id = v_row.id
     AND status IN ('SOLICITADA','EM_PROCESSAMENTO','INDISPONIVEL')
   ORDER BY requested_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'accepted', true, 'code', 'ALREADY_QUEUED', 'requestId', v_exec.id, 'status', v_exec.status
    );
  END IF;

  SELECT email INTO v_user_email FROM public.profiles WHERE id = v_user_id;
  INSERT INTO public.nfe_fiscal_execucoes (
    consulta_id, snapshot_id, fundo_id, nota_fiscal_id, source,
    idempotency_key, request_reference, requested_by_user_id,
    requested_by_email_snapshot, chave_fingerprint, eligible_post_cutover,
    status, next_attempt_at
  ) VALUES (
    v_row.id, v_row.snapshot_id, v_row.fundo_id, v_row.nota_fiscal_id, 'MANUAL_GESTOR',
    v_idempotency, p_request_reference, v_user_id, left(v_user_email, 320),
    encode(extensions.digest(v_snapshot.chave_acesso, 'sha256'), 'hex'),
    v_eligible, v_status, CASE WHEN v_eligible THEN clock_timestamp() ELSE NULL END
  ) RETURNING * INTO v_exec;

  UPDATE public.nfe_fiscal_consultas
     SET latest_execution_id = v_exec.id,
         ultima_reconsulta_solicitada_em = clock_timestamp(),
         reconsultas_solicitadas = reconsultas_solicitadas + 1,
         atualizado_em = clock_timestamp()
   WHERE id = v_row.id;
  PERFORM private.nfe_fiscal_record_execution_event(
    v_exec.id, v_status, 'USUARIO', v_user_id, NULL,
    jsonb_build_object('source','MANUAL_GESTOR','postCutover',v_eligible)
  );

  RETURN jsonb_build_object(
    'accepted', v_eligible,
    'code', CASE WHEN v_eligible THEN 'QUEUED' ELSE 'PROVIDER_OFF' END,
    'requestId', v_exec.id, 'status', v_exec.status
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_operational_claim(p_limit integer DEFAULT 1)
RETURNS TABLE (
  execution_id uuid,
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
  v_state public.nfe_fiscal_provider_state%ROWTYPE;
  v_available integer;
  v_ids uuid[];
  v_count integer;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Worker operacional nao autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 15 THEN
    RAISE EXCEPTION 'Lote operacional invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state
    FROM public.nfe_fiscal_provider_state
   WHERE provider = 'SERPRO'
   FOR UPDATE;
  IF NOT FOUND
     OR v_state.consumption_mode <> 'UNLIMITED_WITH_METERING'
     OR v_state.capability_state <> 'ENABLED'
     OR v_state.cutover_at IS NULL THEN
    RETURN;
  END IF;

  IF v_state.circuit_state = 'OPEN' THEN
    IF v_state.circuit_open_until IS NULL OR v_state.circuit_open_until > v_now THEN
      RETURN;
    END IF;
    UPDATE public.nfe_fiscal_provider_state
       SET circuit_state = 'HALF_OPEN', atualizado_em = v_now
     WHERE provider = 'SERPRO';
    v_state.circuit_state := 'HALF_OPEN';
  END IF;

  IF v_state.budget_date IS DISTINCT FROM CURRENT_DATE THEN
    UPDATE public.nfe_fiscal_provider_state
       SET calls_today = 0, budget_date = CURRENT_DATE, atualizado_em = v_now
     WHERE provider = 'SERPRO';
    v_state.calls_today := 0;
  END IF;
  IF v_state.rate_window_started_at IS NULL
     OR v_state.rate_window_started_at <= v_now - interval '1 second' THEN
    UPDATE public.nfe_fiscal_provider_state
       SET rate_window_started_at = v_now, rate_window_calls = 0, atualizado_em = v_now
     WHERE provider = 'SERPRO';
    v_state.rate_window_calls := 0;
  END IF;
  v_available := v_state.max_requests_per_second - v_state.rate_window_calls;
  IF v_state.circuit_state = 'HALF_OPEN' THEN v_available := LEAST(v_available, 1); END IF;
  v_available := LEAST(v_available, p_limit);
  IF v_available <= 0 THEN RETURN; END IF;

  WITH candidates AS (
    SELECT e.id
      FROM public.nfe_fiscal_execucoes e
     WHERE e.eligible_post_cutover = true
       AND e.requested_at >= v_state.cutover_at
       AND e.status IN ('SOLICITADA','INDISPONIVEL')
       AND e.attempt_count < e.max_attempts
       AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= v_now)
       AND (e.lease_until IS NULL OR e.lease_until <= v_now)
     ORDER BY e.requested_at, e.id
     FOR UPDATE SKIP LOCKED
     LIMIT v_available
  ), claimed AS (
    UPDATE public.nfe_fiscal_execucoes e
       SET status = 'EM_PROCESSAMENTO', lease_token = gen_random_uuid(),
           lease_until = v_now + interval '180 seconds',
           attempt_count = e.attempt_count + 1,
           started_at = COALESCE(e.started_at, v_now),
           next_attempt_at = NULL, updated_at = v_now
      FROM candidates c
     WHERE e.id = c.id
    RETURNING e.id
  ) SELECT array_agg(id) INTO v_ids FROM claimed;

  v_count := COALESCE(cardinality(v_ids), 0);
  IF v_count = 0 THEN RETURN; END IF;

  UPDATE public.nfe_fiscal_provider_state
     SET rate_window_calls = rate_window_calls + v_count,
         atualizado_em = v_now
   WHERE provider = 'SERPRO';

  UPDATE public.nfe_fiscal_consultas c
     SET status = CASE WHEN c.checked_at IS NULL THEN 'EM_CONSULTA' ELSE c.status END,
         lease_token = e.lease_token,
         lease_ate = e.lease_until, tentativas = c.tentativas + 1,
         ultima_chamada_em = v_now, latest_execution_id = e.id,
         atualizado_em = v_now
    FROM public.nfe_fiscal_execucoes e
   WHERE e.id = ANY(v_ids) AND c.id = e.consulta_id;

  PERFORM private.nfe_fiscal_record_execution_event(
    e.id, 'EM_PROCESSAMENTO', 'WORKER', NULL, NULL,
    jsonb_build_object('attempt',e.attempt_count,'providerCallCount',e.provider_call_count)
  ) FROM public.nfe_fiscal_execucoes e WHERE e.id = ANY(v_ids);

  RETURN QUERY
  SELECT e.id, e.consulta_id, e.snapshot_id, e.fundo_id, e.nota_fiscal_id, e.lease_token
    FROM public.nfe_fiscal_execucoes e
   WHERE e.id = ANY(v_ids)
   ORDER BY e.requested_at, e.id;
END
$function$;

CREATE FUNCTION private.nfe_fiscal_execution_identity_valid(p_execution_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nfe_fiscal_execucoes e
      JOIN public.nfe_fiscal_consultas c ON c.id=e.consulta_id AND c.snapshot_id=e.snapshot_id
        AND c.fundo_id=e.fundo_id AND c.nota_fiscal_id=e.nota_fiscal_id
      JOIN public.nfe_fiscal_snapshots s ON s.id=e.snapshot_id AND s.fundo_id=e.fundo_id AND s.nota_fiscal_id=e.nota_fiscal_id
      JOIN public.notas_fiscais n ON n.id=e.nota_fiscal_id AND n.fundo_id=e.fundo_id
    WHERE e.id=p_execution_id AND n.tipo_documento_fiscal='NFE' AND s.modelo='55'
      AND private.nfe_chave_valida_v1(s.chave_acesso)
      AND regexp_replace(n.chave_acesso,'[^0-9]','','g')=s.chave_acesso
      AND regexp_replace(n.cnpj_emitente,'[^0-9]','','g')=substring(s.chave_acesso FROM 7 FOR 14)
      AND regexp_replace(n.cnpj_destinatario,'[^0-9]','','g')=regexp_replace(s.cnpj_destinatario,'[^0-9]','','g')
      AND ltrim(n.numero_nf,'0')=ltrim(substring(s.chave_acesso FROM 26 FOR 9),'0')
      AND ltrim(n.serie,'0')=ltrim(substring(s.chave_acesso FROM 23 FOR 3),'0')
      AND n.valor_bruto IS NOT DISTINCT FROM s.valor_total AND n.data_emissao IS NOT DISTINCT FROM s.data_emissao
  );
$$;
REVOKE ALL ON FUNCTION private.nfe_fiscal_execution_identity_valid(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_operational_complete(
  p_execution_id uuid,
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
  v_exec public.nfe_fiscal_execucoes%ROWTYPE;
  v_event jsonb;
  v_critical_history boolean;
  v_effective_status text;
  v_effective_severity text;
  v_effective_summary text;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Finalizacao operacional restrita ao backend' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('CONSULTADO','DIVERGENTE','INCONCLUSIVO')
     OR p_severidade NOT IN ('VERDE','AMARELO','VERMELHO')
     OR jsonb_typeof(p_resultado_minimo) <> 'object'
     OR jsonb_typeof(p_divergencias) <> 'array'
     OR jsonb_typeof(p_eventos) <> 'array'
     OR octet_length(p_resultado_minimo::text) > 32768
     OR octet_length(p_eventos::text) > 32768 THEN
    RAISE EXCEPTION 'Resultado fiscal operacional minimizado invalido' USING ERRCODE = '22023';
  END IF;

  -- All worker transitions acquire the credential lock before an execution.
  PERFORM 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  v_now := clock_timestamp();
  SELECT * INTO v_exec
    FROM public.nfe_fiscal_execucoes
   WHERE id = p_execution_id
   FOR UPDATE;
  IF NOT FOUND OR v_exec.status <> 'EM_PROCESSAMENTO'
     OR v_exec.lease_token <> p_lease_token
     OR v_exec.lease_until <= v_now
     OR NOT private.nfe_fiscal_execution_identity_valid(v_exec.id) THEN
    RETURN false;
  END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_eventos)
  LOOP
    INSERT INTO public.nfe_fiscal_eventos (
      consulta_id, fundo_id, nota_fiscal_id, codigo, descricao, protocolo,
      fato_em, observado_em, registrado, severidade, fingerprint
    ) VALUES (
      v_exec.consulta_id, v_exec.fundo_id, v_exec.nota_fiscal_id,
      v_event->>'codigo', left(v_event->>'descricao', 160), NULLIF(v_event->>'protocolo', ''),
      NULLIF(v_event->>'fato_em', '')::timestamptz, p_checked_at,
      COALESCE((v_event->>'registrado')::boolean, false), v_event->>'severidade',
      v_event->>'fingerprint'
    ) ON CONFLICT (consulta_id, fingerprint) DO NOTHING;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public.nfe_fiscal_eventos e
     WHERE e.consulta_id = v_exec.consulta_id AND e.severidade = 'VERMELHO'
  ) OR EXISTS (
    SELECT 1 FROM public.nfe_fiscal_execucoes e
     WHERE e.consulta_id = v_exec.consulta_id AND e.status='CONCLUIDA' AND e.severity='VERMELHO'
  ) INTO v_critical_history;
  v_effective_status := CASE WHEN v_critical_history THEN 'DIVERGENTE' ELSE p_status END;
  v_effective_severity := CASE WHEN v_critical_history THEN 'VERMELHO' ELSE p_severidade END;
  v_effective_summary := CASE WHEN v_critical_history AND p_severidade <> 'VERMELHO'
    THEN left('Evento fiscal critico historico preservado. ' || p_resumo, 500)
    ELSE left(p_resumo, 500) END;

  UPDATE public.nfe_fiscal_execucoes
     SET status = 'CONCLUIDA', completed_at = v_now,
         result_status = v_effective_status, severity = v_effective_severity,
         summary = v_effective_summary, checked_at = p_checked_at,
         http_status = p_http_status, response_fingerprint = p_response_fingerprint,
         result_minimum = p_resultado_minimo, differences = p_divergencias,
         error_code = NULL, next_attempt_at = NULL,
         lease_token = NULL, lease_until = NULL, updated_at = v_now
   WHERE id = v_exec.id;

  UPDATE public.nfe_fiscal_consultas
     SET status = v_effective_status, severidade = v_effective_severity,
         resumo = v_effective_summary, checked_at = p_checked_at,
         http_status = p_http_status, response_fingerprint = p_response_fingerprint,
         resultado_minimo = p_resultado_minimo, divergencias = p_divergencias,
         ultimo_erro_codigo = NULL, proxima_tentativa_em = NULL,
         lease_token = NULL, lease_ate = NULL, latest_execution_id = v_exec.id,
         atualizado_em = v_now
   WHERE id = v_exec.consulta_id
     AND lease_token = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fencing da consulta fiscal perdido' USING ERRCODE = '40001'; END IF;

  PERFORM private.nfe_fiscal_record_execution_event(
    v_exec.id, 'CONCLUIDA', 'WORKER', NULL, NULL,
    jsonb_build_object('resultStatus',v_effective_status,'severity',v_effective_severity,
      'httpStatus',p_http_status,'providerCallCount',v_exec.provider_call_count)
  );
  UPDATE public.nfe_fiscal_provider_state
     SET consecutive_failures = CASE WHEN circuit_state='OPEN' AND circuit_open_until IS NULL THEN consecutive_failures ELSE 0 END,
         circuit_state = CASE WHEN circuit_state='OPEN' AND circuit_open_until IS NULL THEN 'OPEN' ELSE 'CLOSED' END,
         circuit_open_until = NULL, atualizado_em = v_now
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_operational_fail(
  p_execution_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_http_status integer DEFAULT NULL,
  p_retryable boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_exec public.nfe_fiscal_execucoes%ROWTYPE;
  v_terminal boolean;
  v_next timestamptz;
  v_status text;
  v_open_circuit boolean;
BEGIN
  IF COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Falha operacional restrita ao backend' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_error_code), '') = '' OR length(p_error_code) > 80 THEN
    RAISE EXCEPTION 'Codigo de falha operacional invalido' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO' FOR UPDATE;
  v_now := clock_timestamp();
  SELECT * INTO v_exec
    FROM public.nfe_fiscal_execucoes
   WHERE id = p_execution_id
   FOR UPDATE;
  IF NOT FOUND OR v_exec.status <> 'EM_PROCESSAMENTO'
     OR v_exec.lease_token <> p_lease_token THEN
    RETURN false;
  END IF;

  v_open_circuit := COALESCE(p_http_status IN (401,403), false)
    OR p_error_code LIKE 'TOKEN_HTTP_401%'
    OR p_error_code LIKE 'TOKEN_HTTP_403%';
  v_terminal := v_open_circuit OR NOT p_retryable OR v_exec.attempt_count >= v_exec.max_attempts;
  v_status := CASE WHEN v_terminal THEN 'FALHOU' ELSE 'INDISPONIVEL' END;
  v_next := CASE WHEN v_terminal THEN NULL
    ELSE v_now + make_interval(secs => CASE v_exec.attempt_count WHEN 1 THEN 30 ELSE 120 END)
  END;

  UPDATE public.nfe_fiscal_execucoes
     SET status = v_status, completed_at = CASE WHEN v_terminal THEN v_now ELSE NULL END,
         next_attempt_at = v_next, error_code = left(p_error_code,80),
         http_status = p_http_status, lease_token = NULL, lease_until = NULL,
         updated_at = v_now
   WHERE id = v_exec.id;

  -- Uma falha de atualizacao nunca apaga a ultima evidencia fiscal concluida.
  UPDATE public.nfe_fiscal_consultas
     SET status = CASE WHEN checked_at IS NULL THEN
           CASE WHEN v_terminal THEN 'ERRO' ELSE 'INDISPONIVEL' END
         ELSE status END,
         resumo = CASE WHEN checked_at IS NULL THEN
           CASE WHEN v_terminal
             THEN 'Consulta fiscal falhou sem resultado conclusivo.'
             ELSE 'Consulta fiscal temporariamente indisponivel; nova tentativa foi agendada.' END
         ELSE resumo END,
         ultimo_erro_codigo = left(p_error_code,80),
         proxima_tentativa_em = v_next,
         lease_token = NULL, lease_ate = NULL,
         latest_execution_id = v_exec.id, atualizado_em = v_now
   WHERE id = v_exec.consulta_id
     AND lease_token = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fencing da consulta fiscal perdido' USING ERRCODE = '40001'; END IF;

  PERFORM private.nfe_fiscal_record_execution_event(
    v_exec.id, v_status, 'WORKER', NULL, p_error_code,
    jsonb_build_object('retryable',NOT v_terminal,'nextAttemptAt',v_next,
      'httpStatus',p_http_status,'providerCallCount',v_exec.provider_call_count)
  );
  UPDATE public.nfe_fiscal_provider_state
     SET consecutive_failures = consecutive_failures + 1,
         circuit_state = CASE
           WHEN v_open_circuit OR consecutive_failures + 1 >= 5 THEN 'OPEN'
           ELSE circuit_state END,
         circuit_open_until = CASE
           WHEN v_open_circuit OR (circuit_state='OPEN' AND circuit_open_until IS NULL) THEN NULL
           WHEN consecutive_failures + 1 >= 5 THEN v_now + interval '5 minutes'
           ELSE circuit_open_until END,
         atualizado_em = v_now
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.obter_situacao_fiscal_nfe(p_nota_fiscal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.nfe_fiscal_consultas%ROWTYPE;
  v_provider public.nfe_fiscal_provider_state%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row
    FROM public.nfe_fiscal_consultas
   WHERE nota_fiscal_id = p_nota_fiscal_id
   ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(v_row.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Acesso fiscal negado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_provider FROM public.nfe_fiscal_provider_state WHERE provider = 'SERPRO';

  RETURN jsonb_build_object(
    'status', v_row.status,
    'provider', v_row.provider,
    'capabilityState', v_provider.capability_state,
    'consumptionMode', v_provider.consumption_mode,
    'eventCoverage', v_row.event_coverage,
    'severity', v_row.severidade,
    'summary', v_row.resumo,
    'checkedAt', v_row.checked_at,
    'lastCallAt', v_row.ultima_chamada_em,
    'mapperVersion', v_row.mapper_version,
    'result', v_row.resultado_minimo,
    'differences', v_row.divergencias,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', e.codigo, 'description', e.descricao, 'protocol', e.protocolo,
        'occurredAt', e.fato_em, 'observedAt', e.observado_em,
        'registered', e.registrado, 'severity', e.severidade
      ) ORDER BY e.fato_em DESC NULLS LAST, e.observado_em DESC)
      FROM public.nfe_fiscal_eventos e WHERE e.consulta_id = v_row.id
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'requestId', h.id, 'source', h.source, 'status', h.status,
        'requestedAt', h.requested_at, 'startedAt', h.started_at,
        'completedAt', h.completed_at, 'checkedAt', h.checked_at,
        'resultStatus', h.result_status, 'severity', h.severity,
        'summary', h.summary, 'errorCode', h.error_code,
        'providerCallCount', h.provider_call_count,
        'estimatedCost', h.estimated_cost, 'costCurrency', h.cost_currency
      ) ORDER BY h.requested_at DESC, h.id DESC)
      FROM (
        SELECT * FROM public.nfe_fiscal_execucoes e
         WHERE e.consulta_id = v_row.id
         ORDER BY e.requested_at DESC, e.id DESC
         LIMIT 20
      ) h
    ), '[]'::jsonb),
    'consumption', jsonb_build_object(
      'noteCalls', COALESCE((SELECT sum(e.provider_call_count) FROM public.nfe_fiscal_execucoes e WHERE e.consulta_id=v_row.id),0),
      'fundCalls', COALESCE((SELECT sum(e.provider_call_count) FROM public.nfe_fiscal_execucoes e WHERE e.fundo_id=v_row.fundo_id),0),
      'noteEstimatedCost', (SELECT sum(e.estimated_cost) FROM public.nfe_fiscal_execucoes e WHERE e.consulta_id=v_row.id),
      'fundEstimatedCost', (SELECT sum(e.estimated_cost) FROM public.nfe_fiscal_execucoes e WHERE e.fundo_id=v_row.fundo_id),
      'currency', v_provider.cost_currency,
      'estimateAvailable', v_provider.estimated_unit_cost IS NOT NULL
    )
  );
END
$function$;

-- O caminho legado tinha cooldown e requeue mutavel. O produto S2.2 usa apenas
-- a RPC operacional acima; remover EXECUTE evita que clientes antigos contornem
-- o ledger por execucao. A funcao historica permanece para proveniencia.
REVOKE EXECUTE ON FUNCTION public.solicitar_reconsulta_nfe_fiscal(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION private.nfe_fiscal_execucao_eventos_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.nfe_fiscal_record_execution_event(uuid,text,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.nfe_enfileirar_apos_submissao()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.solicitar_reconsulta_nfe_fiscal_operacional(uuid,text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_claim(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_operational_fail(uuid,uuid,text,integer,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.obter_situacao_fiscal_nfe(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.solicitar_reconsulta_nfe_fiscal_operacional(uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_claim(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_operational_fail(uuid,uuid,text,integer,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.obter_situacao_fiscal_nfe(uuid)
  TO authenticated;

COMMIT;
