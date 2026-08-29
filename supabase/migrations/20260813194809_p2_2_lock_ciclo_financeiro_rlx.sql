BEGIN;

CREATE OR REPLACE FUNCTION public.iniciar_ciclo_importacao_financeira_rlx(
  p_fundo_id uuid,
  p_data_operacional date,
  p_origem text DEFAULT 'CRON',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ciclo_id uuid;
BEGIN
  IF NOT private.rlx_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ciclo financeiro permitido somente para service role';
  END IF;

  IF p_fundo_id IS NULL OR p_data_operacional IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'Fundo e data operacional sao obrigatorios';
  END IF;

  IF p_origem <> 'CRON' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Esta funcao aceita somente ciclos de origem CRON';
  END IF;

  INSERT INTO public.rlx_importacao_ciclos (
    fundo_id,
    data_operacional,
    origem,
    status,
    tentativas,
    processadas,
    falhas,
    detalhes,
    correlation_id,
    iniciada_em,
    concluida_em
  ) VALUES (
    p_fundo_id,
    p_data_operacional,
    p_origem,
    'INICIADO',
    1,
    0,
    0,
    '{}'::jsonb,
    COALESCE(p_correlation_id, gen_random_uuid()),
    clock_timestamp(),
    NULL
  )
  ON CONFLICT ON CONSTRAINT rlx_importacao_ciclos_lock_unique
  DO UPDATE SET
    status = 'INICIADO',
    tentativas = public.rlx_importacao_ciclos.tentativas + 1,
    processadas = 0,
    falhas = 0,
    detalhes = '{}'::jsonb,
    correlation_id = EXCLUDED.correlation_id,
    iniciada_em = EXCLUDED.iniciada_em,
    concluida_em = NULL
  WHERE public.rlx_importacao_ciclos.status <> 'INICIADO'
     OR public.rlx_importacao_ciclos.iniciada_em < clock_timestamp() - interval '30 minutes'
  RETURNING id INTO v_ciclo_id;

  RETURN v_ciclo_id;
END;
$$;

COMMENT ON FUNCTION public.iniciar_ciclo_importacao_financeira_rlx(uuid, date, text, uuid) IS
  'Reivindica atomicamente um ciclo CRON por fundo e data. Retorna NULL quando outro ciclo ainda esta ativo; permite retomada apos 30 minutos.';

REVOKE ALL ON FUNCTION public.iniciar_ciclo_importacao_financeira_rlx(uuid, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_ciclo_importacao_financeira_rlx(uuid, date, text, uuid)
  TO service_role;

COMMIT;
