-- S1 / SERPRO NF-e: ledger privado, assíncrono e isolado por Fundo.
-- A migration não ativa o provedor, não agenda jobs e não altera gates de aprovação.
BEGIN;

DO $preconditions$
BEGIN
  IF to_regclass('public.notas_fiscais') IS NULL
     OR to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.usuario_e_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'S1 depende de notas_fiscais e dos helpers canônicos de Gestor/Super Admin';
  END IF;
END
$preconditions$;

CREATE TABLE public.nfe_fiscal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  document_ref text NOT NULL CHECK (length(document_ref) BETWEEN 1 AND 128),
  idempotency_ref text NOT NULL CHECK (idempotency_ref ~ '^[0-9a-f]{64}$'),
  chave_acesso text,
  modelo text,
  numero_nf text,
  serie text,
  cnpj_emitente text,
  cnpj_destinatario text,
  data_emissao date,
  valor_total numeric,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfe_fiscal_snapshots_idempotency_unique UNIQUE (idempotency_ref),
  CONSTRAINT nfe_fiscal_snapshots_document_unique UNIQUE (fundo_id, nota_fiscal_id, document_ref)
);

COMMENT ON TABLE public.nfe_fiscal_snapshots IS
  'Snapshot fiscal mínimo e imutável capturado na submissão. Sem texto livre, dados clínicos ou documento original.';

CREATE TABLE public.nfe_fiscal_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL UNIQUE REFERENCES public.nfe_fiscal_snapshots(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'NAO_APLICAVEL','AGUARDANDO_CHAVE','PENDENTE','EM_CONSULTA','CONSULTADO',
    'DIVERGENTE','INCONCLUSIVO','INDISPONIVEL','ERRO','NAO_SUPORTADO'
  )),
  provider text NOT NULL DEFAULT 'SERPRO' CHECK (provider = 'SERPRO'),
  capability_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (capability_state IN ('UNVERIFIED','VERIFIED_DISABLED','ENABLED')),
  contract_version text NOT NULL DEFAULT 'SERPRO_NFE_PUBLIC_DOC_2026-10',
  mapper_version text NOT NULL DEFAULT 'S1_MAPPER_V1',
  event_coverage text NOT NULL DEFAULT 'PARTIAL'
    CHECK (event_coverage IN ('FULL','PARTIAL','UNSUPPORTED','NOT_PROVEN')),
  severidade text NOT NULL DEFAULT 'NEUTRO'
    CHECK (severidade IN ('NEUTRO','VERDE','AMARELO','VERMELHO')),
  resumo text NOT NULL DEFAULT 'Consulta fiscal ainda não executada.',
  checked_at timestamptz,
  http_status smallint CHECK (http_status BETWEEN 100 AND 599),
  response_fingerprint text CHECK (response_fingerprint IS NULL OR response_fingerprint ~ '^[0-9a-f]{64}$'),
  resultado_minimo jsonb NOT NULL DEFAULT '{}'::jsonb,
  divergencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(divergencias) = 'array'),
  ultimo_erro_codigo text,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_tentativa_em timestamptz,
  lease_token uuid,
  lease_ate timestamptz,
  ultima_chamada_em timestamptz,
  ultima_reconsulta_solicitada_em timestamptz,
  reconsultas_solicitadas integer NOT NULL DEFAULT 0 CHECK (reconsultas_solicitadas >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfe_fiscal_consultas_contexto_unique UNIQUE (fundo_id, nota_fiscal_id, snapshot_id),
  CONSTRAINT nfe_fiscal_consultas_resultado_minimo_objeto CHECK (jsonb_typeof(resultado_minimo) = 'object'),
  CONSTRAINT nfe_fiscal_consultas_lease_coerente CHECK (
    (lease_token IS NULL AND lease_ate IS NULL) OR (lease_token IS NOT NULL AND lease_ate IS NOT NULL)
  )
);

COMMENT ON TABLE public.nfe_fiscal_consultas IS
  'Fila e visão minimizada da consulta fiscal. O payload bruto do provedor não é persistido nesta tabela.';

CREATE TABLE public.nfe_fiscal_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES public.nfe_fiscal_consultas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{6}$'),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 160),
  protocolo text,
  fato_em timestamptz,
  observado_em timestamptz NOT NULL,
  registrado boolean NOT NULL DEFAULT false,
  severidade text NOT NULL CHECK (severidade IN ('AMARELO','VERMELHO')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfe_fiscal_eventos_fingerprint_unique UNIQUE (consulta_id, fingerprint)
);

CREATE TABLE public.nfe_fiscal_provider_state (
  provider text PRIMARY KEY CHECK (provider = 'SERPRO'),
  capability_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (capability_state IN ('UNVERIFIED','VERIFIED_DISABLED','ENABLED')),
  circuit_state text NOT NULL DEFAULT 'OPEN'
    CHECK (circuit_state IN ('OPEN','HALF_OPEN','CLOSED')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  circuit_open_until timestamptz,
  daily_budget integer NOT NULL DEFAULT 0 CHECK (daily_budget >= 0),
  budget_date date NOT NULL DEFAULT CURRENT_DATE,
  calls_today integer NOT NULL DEFAULT 0 CHECK (calls_today >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.nfe_fiscal_provider_state (
  provider, capability_state, circuit_state, daily_budget, calls_today
) VALUES ('SERPRO', 'UNVERIFIED', 'OPEN', 0, 0)
ON CONFLICT (provider) DO NOTHING;

CREATE INDEX nfe_fiscal_consultas_queue_idx
  ON public.nfe_fiscal_consultas (status, proxima_tentativa_em, criado_em)
  WHERE status IN ('PENDENTE','INDISPONIVEL','ERRO');
CREATE INDEX nfe_fiscal_consultas_fundo_nf_idx
  ON public.nfe_fiscal_consultas (fundo_id, nota_fiscal_id, atualizado_em DESC);
CREATE INDEX nfe_fiscal_eventos_consulta_idx
  ON public.nfe_fiscal_eventos (consulta_id, fato_em DESC NULLS LAST, observado_em DESC);

ALTER TABLE public.nfe_fiscal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_consultas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_eventos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_provider_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_fiscal_provider_state FORCE ROW LEVEL SECURITY;

CREATE POLICY nfe_fiscal_snapshots_gestor_admin_select
  ON public.nfe_fiscal_snapshots FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(fundo_id))
  );
CREATE POLICY nfe_fiscal_consultas_gestor_admin_select
  ON public.nfe_fiscal_consultas FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(fundo_id))
  );
CREATE POLICY nfe_fiscal_eventos_gestor_admin_select
  ON public.nfe_fiscal_eventos FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(fundo_id))
  );

REVOKE ALL ON TABLE public.nfe_fiscal_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nfe_fiscal_consultas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nfe_fiscal_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nfe_fiscal_provider_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nfe_fiscal_snapshots TO authenticated;
GRANT SELECT ON TABLE public.nfe_fiscal_consultas TO authenticated;
GRANT SELECT ON TABLE public.nfe_fiscal_eventos TO authenticated;
GRANT ALL ON TABLE public.nfe_fiscal_snapshots TO service_role;
GRANT ALL ON TABLE public.nfe_fiscal_consultas TO service_role;
GRANT ALL ON TABLE public.nfe_fiscal_eventos TO service_role;
GRANT ALL ON TABLE public.nfe_fiscal_provider_state TO service_role;

CREATE OR REPLACE FUNCTION private.nfe_chave_valida_v1(p_chave text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_sum integer := 0;
  v_weight integer := 2;
  v_pos integer;
  v_digit integer;
BEGIN
  IF p_chave !~ '^[0-9]{44}$' OR substring(p_chave FROM 21 FOR 2) <> '55' THEN
    RETURN false;
  END IF;
  FOR v_pos IN REVERSE 43..1 LOOP
    v_sum := v_sum + substring(p_chave FROM v_pos FOR 1)::integer * v_weight;
    v_weight := CASE WHEN v_weight = 9 THEN 2 ELSE v_weight + 1 END;
  END LOOP;
  v_digit := 11 - (v_sum % 11);
  IF v_digit >= 10 THEN v_digit := 0; END IF;
  RETURN v_digit = right(p_chave, 1)::integer;
END
$function$;

CREATE OR REPLACE FUNCTION private.nfe_snapshot_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Snapshot fiscal é imutável' USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER nfe_fiscal_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.nfe_fiscal_snapshots
FOR EACH ROW EXECUTE FUNCTION private.nfe_snapshot_imutavel();

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
  v_initial_status text;
BEGIN
  IF NEW.status::text <> 'submetida'
     OR (TG_OP = 'UPDATE' AND OLD.status::text = 'submetida')
     OR COALESCE(NEW.tipo_documento_fiscal, '') <> 'NFE'
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
    concat_ws('|', 'S1_NFE_V1', NEW.fundo_id::text, NEW.id::text, v_key, v_document_ref),
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
  )
  ON CONFLICT (idempotency_ref) DO NOTHING
  RETURNING id INTO v_snapshot_id;

  IF v_snapshot_id IS NULL THEN
    SELECT id INTO v_snapshot_id
      FROM public.nfe_fiscal_snapshots
     WHERE idempotency_ref = v_idempotency;
  END IF;

  v_initial_status := CASE
    WHEN v_key = '' THEN 'AGUARDANDO_CHAVE'
    WHEN NOT v_key_valid THEN 'NAO_SUPORTADO'
    WHEN NOT v_identity_valid THEN 'INCONCLUSIVO'
    ELSE 'PENDENTE'
  END;

  INSERT INTO public.nfe_fiscal_consultas (
    snapshot_id, fundo_id, nota_fiscal_id, status, capability_state,
    event_coverage, severidade, resumo
  ) VALUES (
    v_snapshot_id, NEW.fundo_id, NEW.id, v_initial_status, 'UNVERIFIED',
    'PARTIAL', 'NEUTRO',
    CASE v_initial_status
      WHEN 'PENDENTE' THEN 'Consulta aguardando capacidade contratual e worker habilitados.'
      WHEN 'AGUARDANDO_CHAVE' THEN 'NF-e submetida sem chave fiscal principal segura.'
      WHEN 'INCONCLUSIVO' THEN 'A chave não coincide com a identidade fiscal extraída.'
      ELSE 'Documento não suportado pela consulta SERPRO NF-e modelo 55.'
    END
  )
  ON CONFLICT (snapshot_id) DO NOTHING;

  RETURN NEW;
END
$function$;

CREATE TRIGGER nfe_enfileirar_apos_submissao_insert
AFTER INSERT ON public.notas_fiscais
FOR EACH ROW EXECUTE FUNCTION private.nfe_enfileirar_apos_submissao();
CREATE TRIGGER nfe_enfileirar_apos_submissao_update
AFTER UPDATE OF status ON public.notas_fiscais
FOR EACH ROW EXECUTE FUNCTION private.nfe_enfileirar_apos_submissao();

CREATE OR REPLACE FUNCTION public.nfe_fiscal_claim(p_limit integer DEFAULT 5)
RETURNS SETOF public.nfe_fiscal_consultas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_state public.nfe_fiscal_provider_state%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Worker não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'Lote inválido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state FROM public.nfe_fiscal_provider_state
    WHERE provider = 'SERPRO' FOR UPDATE;
  IF v_state.capability_state <> 'ENABLED'
     OR v_state.circuit_state = 'OPEN'
     OR v_state.daily_budget <= v_state.calls_today THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT c.id
    FROM public.nfe_fiscal_consultas c
    WHERE c.capability_state = 'ENABLED'
      AND c.status IN ('PENDENTE','INDISPONIVEL','ERRO')
      AND (c.proxima_tentativa_em IS NULL OR c.proxima_tentativa_em <= now())
      AND (c.lease_ate IS NULL OR c.lease_ate <= now())
    ORDER BY c.criado_em, c.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(p_limit, v_state.daily_budget - v_state.calls_today)
  )
  UPDATE public.nfe_fiscal_consultas c
     SET status = 'EM_CONSULTA', lease_token = gen_random_uuid(),
         lease_ate = now() + interval '45 seconds', tentativas = c.tentativas + 1,
         ultima_chamada_em = now(), atualizado_em = now()
    FROM candidates
   WHERE c.id = candidates.id
  RETURNING c.*;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_complete(
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
  v_row public.nfe_fiscal_consultas%ROWTYPE;
  v_event jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Worker não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('CONSULTADO','DIVERGENTE','INCONCLUSIVO')
     OR p_severidade NOT IN ('VERDE','AMARELO','VERMELHO')
     OR jsonb_typeof(p_resultado_minimo) <> 'object'
     OR jsonb_typeof(p_divergencias) <> 'array'
     OR jsonb_typeof(p_eventos) <> 'array'
     OR octet_length(p_resultado_minimo::text) > 32768
     OR octet_length(p_eventos::text) > 32768 THEN
    RAISE EXCEPTION 'Resultado fiscal minimizado inválido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nfe_fiscal_consultas
     SET status = p_status, severidade = p_severidade, resumo = left(p_resumo, 500),
         checked_at = p_checked_at, http_status = p_http_status,
         response_fingerprint = p_response_fingerprint,
         resultado_minimo = p_resultado_minimo, divergencias = p_divergencias,
         ultimo_erro_codigo = NULL, proxima_tentativa_em = NULL,
         lease_token = NULL, lease_ate = NULL, atualizado_em = now()
   WHERE id = p_consulta_id AND status = 'EM_CONSULTA'
     AND lease_token = p_lease_token AND lease_ate > now()
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

  UPDATE public.nfe_fiscal_provider_state
     SET calls_today = CASE WHEN budget_date = CURRENT_DATE THEN calls_today + 1 ELSE 1 END,
         budget_date = CURRENT_DATE, consecutive_failures = 0,
         circuit_state = 'CLOSED', circuit_open_until = NULL, atualizado_em = now()
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.nfe_fiscal_fail(
  p_consulta_id uuid,
  p_lease_token uuid,
  p_status text,
  p_error_code text,
  p_http_status integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempts integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Worker não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('INDISPONIVEL','ERRO','INCONCLUSIVO') THEN
    RAISE EXCEPTION 'Status de falha inválido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.nfe_fiscal_consultas
     SET status = p_status, severidade = 'NEUTRO',
         resumo = 'Consulta fiscal indisponível ou inconclusiva; não comprova regularidade.',
         http_status = p_http_status, ultimo_erro_codigo = left(p_error_code, 80),
         proxima_tentativa_em = CASE WHEN tentativas < 5
           THEN now() + make_interval(secs => LEAST(3600, 30 * power(2, tentativas)::integer)) END,
         lease_token = NULL, lease_ate = NULL, atualizado_em = now()
   WHERE id = p_consulta_id AND status = 'EM_CONSULTA'
     AND lease_token = p_lease_token AND lease_ate > now()
  RETURNING tentativas INTO v_attempts;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.nfe_fiscal_provider_state
     SET calls_today = CASE WHEN budget_date = CURRENT_DATE THEN calls_today + 1 ELSE 1 END,
         budget_date = CURRENT_DATE, consecutive_failures = consecutive_failures + 1,
         circuit_state = CASE WHEN consecutive_failures + 1 >= 5 THEN 'OPEN' ELSE circuit_state END,
         circuit_open_until = CASE WHEN consecutive_failures + 1 >= 5 THEN now() + interval '15 minutes' ELSE circuit_open_until END,
         atualizado_em = now()
   WHERE provider = 'SERPRO';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_reconsulta_nfe_fiscal(p_nota_fiscal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.nfe_fiscal_consultas%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.nfe_fiscal_consultas
   WHERE nota_fiscal_id = p_nota_fiscal_id
   ORDER BY criado_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(v_row.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Consulta fiscal não encontrada ou acesso negado' USING ERRCODE = '42501';
  END IF;
  IF v_row.capability_state <> 'ENABLED' THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'CAPABILITY_UNVERIFIED');
  END IF;
  IF v_row.status = 'EM_CONSULTA' THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'ALREADY_RUNNING');
  END IF;
  IF v_row.ultima_reconsulta_solicitada_em > now() - interval '15 minutes' THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'RATE_LIMITED');
  END IF;
  UPDATE public.nfe_fiscal_consultas
     SET status = 'PENDENTE', severidade = 'NEUTRO',
         resumo = 'Reconsulta solicitada; resultado anterior não comprova o estado atual.',
         proxima_tentativa_em = now(), ultima_reconsulta_solicitada_em = now(),
         reconsultas_solicitadas = reconsultas_solicitadas + 1, atualizado_em = now()
   WHERE id = v_row.id;
  RETURN jsonb_build_object('accepted', true, 'code', 'QUEUED');
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão autenticada obrigatória' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.nfe_fiscal_consultas
   WHERE nota_fiscal_id = p_nota_fiscal_id
   ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (
    (SELECT private.usuario_e_super_admin())
    OR (SELECT private.financeiro_gestor_tem_acesso_fundo(v_row.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Acesso fiscal negado' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'status', v_row.status,
    'provider', v_row.provider,
    'capabilityState', v_row.capability_state,
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
    ), '[]'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.obter_nfe_identidade_fiscal_admin(p_nota_fiscal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso fiscal administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', nf.id,
    'numeroNf', nf.numero_nf,
    'serie', nf.serie,
    'chaveAcesso', nf.chave_acesso,
    'dataEmissao', nf.data_emissao,
    'cnpjEmitente', nf.cnpj_emitente,
    'cnpjDestinatario', nf.cnpj_destinatario,
    'valorBruto', nf.valor_bruto,
    'status', nf.status
  )
  INTO v_result
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id
    AND nf.tipo_documento_fiscal = 'NFE';

  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION private.nfe_chave_valida_v1(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.nfe_snapshot_imutavel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.nfe_enfileirar_apos_submissao() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_fiscal_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nfe_fiscal_fail(uuid,uuid,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.solicitar_reconsulta_nfe_fiscal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obter_situacao_fiscal_nfe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obter_nfe_identidade_fiscal_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfe_fiscal_fail(uuid,uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.solicitar_reconsulta_nfe_fiscal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_situacao_fiscal_nfe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_nfe_identidade_fiscal_admin(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
