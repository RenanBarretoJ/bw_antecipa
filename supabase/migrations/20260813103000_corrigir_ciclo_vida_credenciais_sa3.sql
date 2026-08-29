-- SA3: restringe a ativacao ao estado rascunho e preserva estados historicos.
-- A funcao continua serializada por integracao/ambiente e o indice parcial
-- uq_credenciais_integracao_ativa_por_ambiente permanece como ultima barreira.

CREATE OR REPLACE FUNCTION public.admin_ativar_credencial_integracao(
  p_fundo_id uuid,
  p_credencial_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cred public.credenciais_integracao%ROWTYPE;
  v_anterior_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_cred
    FROM public.credenciais_integracao c
   WHERE c.id = p_credencial_id
     AND c.fundo_id = p_fundo_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credencial nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_cred.status = 'ativa' THEN
    RETURN jsonb_build_object('id', v_cred.id, 'status', 'ativa', 'idempotente', true);
  END IF;

  IF v_cred.status NOT IN ('rascunho', 'ativa') THEN
    RAISE EXCEPTION 'Somente credencial em rascunho pode ser ativada' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_cred.integracao_fundo_id::text),
    pg_catalog.hashtext(v_cred.ambiente)
  );

  SELECT c.id
    INTO v_anterior_id
    FROM public.credenciais_integracao c
   WHERE c.integracao_fundo_id = v_cred.integracao_fundo_id
     AND c.ambiente = v_cred.ambiente
     AND c.status = 'ativa'
   FOR UPDATE;

  UPDATE public.credenciais_integracao
     SET status = 'substituida',
         substituida_por = p_credencial_id,
         updated_at = v_agora
   WHERE id = v_anterior_id;

  UPDATE public.credenciais_integracao
     SET status = 'ativa',
         ativada_em = v_agora,
         revogada_em = NULL,
         updated_at = v_agora
   WHERE id = p_credencial_id;

  PERFORM private.sa3_auditar(
    CASE WHEN v_anterior_id IS NULL THEN 'CREDENCIAL_ATIVADA' ELSE 'CREDENCIAL_ROTACIONADA' END,
    p_fundo_id,
    'credenciais_integracao',
    p_credencial_id,
    jsonb_build_object('status', v_cred.status, 'ambiente', v_cred.ambiente),
    jsonb_build_object(
      'status', 'ativa',
      'ambiente', v_cred.ambiente,
      'credencial_anterior_id', v_anterior_id
    ),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'id', p_credencial_id,
    'status', 'ativa',
    'anterior_id', v_anterior_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_ativar_credencial_integracao(uuid, uuid, uuid)
  IS 'Ativa somente credencial SA3 em rascunho, substituindo atomicamente a ativa do mesmo ambiente.';
