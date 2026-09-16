BEGIN;

-- A RPC opera com search_path vazio; pgcrypto fica no schema extensions.
-- Nao alterar hash, regras de idempotencia, autorizacao ou auditoria.
CREATE OR REPLACE FUNCTION public.registrar_importacao_financeira_sem_movimento(
  p_fundo_id uuid,
  p_tipo_base text,
  p_data_referencia date,
  p_provedor text,
  p_layout_nome text,
  p_versao_layout text,
  p_origem text DEFAULT 'MANUAL',
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_hash text;
  v_correlation uuid := COALESCE(p_correlation_id, gen_random_uuid());
BEGIN
  PERFORM private.financeiro_autorizar_tecnico();

  IF p_tipo_base NOT IN ('AQUISICOES', 'LIQUIDACOES') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Somente aquisicoes e liquidacoes permitem declaracao sem movimento';
  END IF;
  IF p_origem NOT IN ('MANUAL', 'CRON', 'GOLDEN_DATASET') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Origem de importacao invalida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Fundo nao encontrado';
  END IF;

  v_hash := encode(extensions.digest(concat_ws('|', 'SEM_MOVIMENTO_V1', p_fundo_id::text, p_tipo_base, p_data_referencia::text, lower(trim(p_provedor)), p_layout_nome, p_versao_layout), 'sha256'), 'hex');

  SELECT i.id INTO v_id
  FROM public.importacoes_financeiras i
  WHERE i.fundo_id = p_fundo_id
    AND i.tipo_base = p_tipo_base
    AND i.data_referencia = p_data_referencia
    AND i.hash_conteudo = v_hash;

  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'duplicada', true, 'status', (SELECT status FROM public.importacoes_financeiras WHERE id = v_id));
  END IF;

  INSERT INTO public.importacoes_financeiras (
    fundo_id, provedor, tipo_base, data_referencia, layout_nome, versao_layout,
    status, completude, origem, hash_conteudo, nome_arquivo, mime_type,
    tamanho_bytes, storage_bucket, storage_path, encoding_detectado,
    linhas_total, linhas_validas, linhas_invalidas, linhas_warning, valor_total,
    declaracao_sem_movimento, correlation_id, criado_por,
    validacao_iniciada_em, validacao_concluida_em, finalizada_em,
    metadados
  ) VALUES (
    p_fundo_id, lower(trim(p_provedor)), p_tipo_base, p_data_referencia,
    p_layout_nome, p_versao_layout, 'VALIDA', 'COMPLETO_VAZIO', p_origem,
    v_hash, NULL, NULL, 0, NULL, NULL, 'nao_aplicavel',
    0, 0, 0, 0, 0, true, v_correlation, auth.uid(),
    clock_timestamp(), clock_timestamp(), clock_timestamp(),
    jsonb_build_object('declaracao', 'SEM_MOVIMENTO', 'contrato', 'SEM_MOVIMENTO_V1')
  ) RETURNING id INTO v_id;

  PERFORM private.financeiro_auditar(
    'IMPORTACAO_FINANCEIRA_SEM_MOVIMENTO_REGISTRADA', v_id, p_fundo_id,
    v_correlation, jsonb_build_object('tipo_base', p_tipo_base, 'data_referencia', p_data_referencia)
  );

  RETURN jsonb_build_object('id', v_id, 'duplicada', false, 'status', 'VALIDA');
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_importacao_financeira_sem_movimento(uuid, text, date, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_importacao_financeira_sem_movimento(uuid, text, date, text, text, text, text, uuid) TO authenticated, service_role;

COMMIT;
