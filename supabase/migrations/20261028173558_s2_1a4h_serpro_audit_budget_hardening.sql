-- S2.1A.4H: fecha a janela entre autorizacao piloto e auditoria CREATED.
-- A migration historica S2.1A.1 permanece imutavel; esta substituicao e
-- forward-only e preserva assinatura, ACL e search_path da RPC existente.

BEGIN;

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
  v_calls_today_effective integer;
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

  -- calls_today pertence exclusivamente a budget_date. Um contador de dia
  -- anterior nao pode bloquear a primeira autorizacao do dia corrente.
  v_calls_today_effective := CASE
    WHEN v_provider.budget_date = CURRENT_DATE THEN v_provider.calls_today
    ELSE 0
  END;

  IF v_provider.provider IS NULL
     OR v_provider.capability_state <> 'ENABLED'
     OR v_provider.circuit_state = 'OPEN'
     OR v_provider.daily_budget <= v_calls_today_effective THEN
    RAISE EXCEPTION 'Gates contratuais ou financeiros indisponiveis' USING ERRCODE = '55000';
  END IF;

  -- O claim historico revalida o contador persistido. Normalize a virada do
  -- dia ainda sob o mesmo lock para que authorize e claim usem a mesma base.
  -- Se a autorizacao ou sua auditoria falhar, esta atualizacao tambem reverte.
  IF v_provider.budget_date IS DISTINCT FROM CURRENT_DATE THEN
    UPDATE public.nfe_fiscal_provider_state
       SET calls_today = 0,
           budget_date = CURRENT_DATE,
           atualizado_em = v_now
     WHERE provider = 'SERPRO';
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

  -- A autorizacao e seu CREATED sao uma unica unidade transacional. Qualquer
  -- falha desta insercao desfaz tambem a linha privada de autorizacao.
  INSERT INTO public.logs_auditoria (
    usuario_id,
    ator_tipo,
    origem,
    ator_identificador,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois
  ) VALUES (
    p_operador_id,
    'usuario',
    'serpro_pilot_manual_local',
    p_operador_id::text,
    'SERPRO_PILOT_AUTHORIZATION_CREATED',
    'nfe_fiscal_consultas',
    p_consulta_id,
    NULL,
    jsonb_build_object(
      'fundo_id', p_fundo_id,
      'nota_fiscal_id', p_nota_fiscal_id,
      'authorization_id', v_authorization_id,
      'idempotency_fingerprint', encode(
        extensions.digest(
          concat(
            p_operador_id::text, ':',
            p_fundo_id::text, ':',
            p_nota_fiscal_id::text, ':',
            p_consulta_id::text
          ),
          'sha256'
        ),
        'hex'
      ),
      'custeio', 'SIMULADO_LOCAL',
      'consulta_paga', true,
      'resultado', 'CREATED',
      'motivo', NULL
    )
  );

  RETURN v_authorization_id;
END
$function$;

REVOKE ALL ON FUNCTION public.nfe_fiscal_pilot_authorize(
  uuid,uuid,uuid,text,text,uuid,uuid,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.nfe_fiscal_pilot_authorize(
  uuid,uuid,uuid,text,text,uuid,uuid,timestamptz
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
