-- P2.2 - complemento incremental de linhagem, retificacao e sem movimento.
-- A migration 20260813191143 ja foi aplicada em homologacao e permanece imutavel.

BEGIN;

ALTER TABLE public.rlx_importacoes_financeiras
  ADD COLUMN layout_nome text,
  ADD COLUMN encoding_detectado text,
  ADD COLUMN linhas_publicadas integer NOT NULL DEFAULT 0 CHECK (linhas_publicadas >= 0),
  ADD COLUMN substitui_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  ADD COLUMN finalizada_em timestamptz,
  ADD COLUMN erro_sanitizado text,
  ADD COLUMN declaracao_sem_movimento boolean NOT NULL DEFAULT false;

UPDATE public.rlx_importacoes_financeiras
SET layout_nome = tipo_base || '_GOLDEN_V1',
    encoding_detectado = COALESCE(metadados->>'encoding', 'nao_informado'),
    linhas_publicadas = CASE WHEN status IN ('PUBLICADA', 'RETIFICADA') THEN linhas_validas ELSE 0 END,
    finalizada_em = COALESCE(publicada_em, validacao_concluida_em, cancelada_em),
    erro_sanitizado = CASE WHEN jsonb_array_length(erros) > 0 THEN erros->>0 ELSE NULL END
WHERE layout_nome IS NULL;

ALTER TABLE public.rlx_importacoes_financeiras
  ALTER COLUMN layout_nome SET NOT NULL,
  ALTER COLUMN encoding_detectado SET NOT NULL,
  ALTER COLUMN nome_arquivo DROP NOT NULL,
  ALTER COLUMN mime_type DROP NOT NULL,
  ALTER COLUMN storage_bucket DROP NOT NULL,
  ALTER COLUMN storage_path DROP NOT NULL;

ALTER TABLE public.rlx_importacoes_financeiras
  ADD CONSTRAINT rlx_importacoes_declaracao_vazia_check CHECK (
    (declaracao_sem_movimento = false
      AND nome_arquivo IS NOT NULL
      AND mime_type IS NOT NULL
      AND storage_bucket IS NOT NULL
      AND storage_path IS NOT NULL)
    OR
    (declaracao_sem_movimento = true
      AND tipo_base IN ('AQUISICOES', 'LIQUIDACOES')
      AND completude = 'COMPLETO_VAZIO'
      AND linhas_total = 0
      AND nome_arquivo IS NULL
      AND mime_type IS NULL
      AND storage_bucket IS NULL
      AND storage_path IS NULL)
  );

CREATE UNIQUE INDEX rlx_importacoes_publicada_unica_idx
  ON public.rlx_importacoes_financeiras (fundo_id, tipo_base, data_referencia)
  WHERE status = 'PUBLICADA';

CREATE INDEX rlx_importacoes_substitui_idx
  ON public.rlx_importacoes_financeiras (substitui_importacao_id)
  WHERE substitui_importacao_id IS NOT NULL;

ALTER TABLE public.rlx_estoque_posicoes
  ADD COLUMN external_title_key text,
  ADD COLUMN payload_origem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_origem) = 'object');

ALTER TABLE public.rlx_aquisicao_movimentos
  ADD COLUMN fingerprint_linha text,
  ADD COLUMN fingerprint_versao text NOT NULL DEFAULT 'RLX_FP_V1',
  ADD COLUMN payload_origem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_origem) = 'object');

ALTER TABLE public.rlx_liquidacao_movimentos
  ADD COLUMN id_movimento_externo text,
  ADD COLUMN fingerprint_linha text,
  ADD COLUMN fingerprint_versao text NOT NULL DEFAULT 'RLX_FP_V1',
  ADD COLUMN payload_origem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_origem) = 'object');

ALTER TABLE public.rlx_carteira_snapshots
  ADD COLUMN payload_origem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_origem) = 'object');

UPDATE public.rlx_estoque_posicoes p
SET payload_origem = l.dados_brutos,
    external_title_key = COALESCE(
      NULLIF(l.dados_normalizados->>'external_title_key', ''),
      encode(digest(concat_ws('|', p.fundo_id::text, p.provedor, p.id_recebivel, COALESCE(p.seu_numero, ''), COALESCE(p.numero_documento, '')), 'sha256'), 'hex')
    )
FROM public.rlx_importacao_linhas l
WHERE l.id = p.linha_id;

UPDATE public.rlx_aquisicao_movimentos p
SET payload_origem = l.dados_brutos,
    fingerprint_linha = COALESCE(
      NULLIF(l.dados_normalizados->>'fingerprint_linha', ''),
      encode(digest(concat_ws('|', p.fundo_id::text, p.provedor, p.id_recebivel, p.data_movimento::text, p.valor_compra::text, l.numero_linha::text), 'sha256'), 'hex')
    )
FROM public.rlx_importacao_linhas l
WHERE l.id = p.linha_id;

UPDATE public.rlx_liquidacao_movimentos p
SET payload_origem = l.dados_brutos,
    id_movimento_externo = NULLIF(l.dados_normalizados->>'id_movimento_externo', ''),
    fingerprint_linha = COALESCE(
      NULLIF(l.dados_normalizados->>'fingerprint_linha', ''),
      encode(digest(concat_ws('|', p.fundo_id::text, p.provedor, p.id_recebivel, p.data_movimento::text, p.valor_pago::text, COALESCE(p.id_tipo_movimento, ''), l.numero_linha::text), 'sha256'), 'hex')
    )
FROM public.rlx_importacao_linhas l
WHERE l.id = p.linha_id;

UPDATE public.rlx_carteira_snapshots p
SET payload_origem = l.dados_brutos
FROM public.rlx_importacao_linhas l
WHERE l.id = p.linha_id;

ALTER TABLE public.rlx_estoque_posicoes ALTER COLUMN external_title_key SET NOT NULL;
ALTER TABLE public.rlx_aquisicao_movimentos ALTER COLUMN fingerprint_linha SET NOT NULL;
ALTER TABLE public.rlx_liquidacao_movimentos ALTER COLUMN fingerprint_linha SET NOT NULL;

CREATE INDEX rlx_estoque_external_key_idx
  ON public.rlx_estoque_posicoes (fundo_id, provedor, external_title_key, data_referencia DESC);
CREATE INDEX rlx_aquisicao_fingerprint_idx
  ON public.rlx_aquisicao_movimentos (fundo_id, provedor, fingerprint_linha, data_referencia DESC);
CREATE INDEX rlx_liquidacao_fingerprint_idx
  ON public.rlx_liquidacao_movimentos (fundo_id, provedor, fingerprint_linha, data_referencia DESC);

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
  PERFORM private.rlx_autorizar_tecnico();

  IF p_tipo_base NOT IN ('AQUISICOES', 'LIQUIDACOES') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Somente aquisicoes e liquidacoes permitem declaracao sem movimento';
  END IF;
  IF p_origem NOT IN ('MANUAL', 'CRON', 'GOLDEN_DATASET') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Origem de importacao invalida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Fundo nao encontrado';
  END IF;

  v_hash := encode(digest(concat_ws('|', 'SEM_MOVIMENTO_V1', p_fundo_id::text, p_tipo_base, p_data_referencia::text, lower(trim(p_provedor)), p_layout_nome, p_versao_layout), 'sha256'), 'hex');

  SELECT i.id INTO v_id
  FROM public.rlx_importacoes_financeiras i
  WHERE i.fundo_id = p_fundo_id
    AND i.tipo_base = p_tipo_base
    AND i.data_referencia = p_data_referencia
    AND i.hash_conteudo = v_hash;

  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'duplicada', true, 'status', (SELECT status FROM public.rlx_importacoes_financeiras WHERE id = v_id));
  END IF;

  INSERT INTO public.rlx_importacoes_financeiras (
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

  PERFORM private.rlx_auditar(
    'RLX_IMPORTACAO_FINANCEIRA_SEM_MOVIMENTO_REGISTRADA', v_id, p_fundo_id,
    v_correlation, jsonb_build_object('tipo_base', p_tipo_base, 'data_referencia', p_data_referencia)
  );

  RETURN jsonb_build_object('id', v_id, 'duplicada', false, 'status', 'VALIDA');
END;
$$;

CREATE OR REPLACE FUNCTION public.publicar_importacao_financeira(
  p_importacao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_importacao public.rlx_importacoes_financeiras%ROWTYPE;
  v_anterior_ids uuid[];
  v_anterior_id uuid;
  v_inseridas integer := 0;
  v_agora timestamptz := clock_timestamp();
BEGIN
  PERFORM private.rlx_autorizar_tecnico();
  SELECT * INTO v_importacao FROM public.rlx_importacoes_financeiras WHERE id = p_importacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Importacao financeira nao encontrada'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_importacao.fundo_id::text || ':' || v_importacao.tipo_base || ':' || v_importacao.data_referencia::text, 0));
  IF v_importacao.status = 'PUBLICADA' THEN
    RETURN jsonb_build_object('id', v_importacao.id, 'status', 'PUBLICADA', 'idempotente', true);
  END IF;
  IF v_importacao.status <> 'VALIDA' OR v_importacao.completude = 'INCOMPLETO' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Somente importacao valida e completa pode ser publicada';
  END IF;
  IF v_importacao.completude = 'COMPLETO_VAZIO' AND v_importacao.tipo_base NOT IN ('AQUISICOES', 'LIQUIDACOES') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Esta familia financeira nao permite publicacao vazia';
  END IF;
  IF v_importacao.linhas_invalidas > 0 OR EXISTS (SELECT 1 FROM public.rlx_importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status = 'INVALIDA') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Importacao possui linhas invalidas';
  END IF;

  SELECT COALESCE(array_agg(i.id ORDER BY i.publicada_em DESC), ARRAY[]::uuid[]),
         (array_agg(i.id ORDER BY i.publicada_em DESC))[1]
    INTO v_anterior_ids, v_anterior_id
  FROM public.rlx_importacoes_financeiras i
  WHERE i.fundo_id = v_importacao.fundo_id
    AND i.tipo_base = v_importacao.tipo_base
    AND i.data_referencia = v_importacao.data_referencia
    AND i.status = 'PUBLICADA'
    AND i.id <> v_importacao.id;

  IF cardinality(v_anterior_ids) > 0 THEN
    UPDATE public.rlx_importacoes_financeiras SET status = 'RETIFICADA', substituida_em = v_agora, finalizada_em = COALESCE(finalizada_em, v_agora) WHERE id = ANY(v_anterior_ids);
    UPDATE public.rlx_estoque_posicoes SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_aquisicao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_liquidacao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_carteira_snapshots SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
  END IF;

  IF v_importacao.completude = 'COMPLETO_COM_DADOS' THEN
    IF v_importacao.tipo_base = 'ESTOQUE' THEN
      INSERT INTO public.rlx_estoque_posicoes (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, external_title_key,
        id_recebivel, seu_numero, numero_documento, tipo_recebivel, chave_nfe,
        cedente_nome, cedente_documento, sacado_nome, sacado_documento,
        valor_nominal, valor_presente, valor_aquisicao, valor_pdd, data_emissao,
        data_vencimento_original, data_aquisicao, situacao_recebivel, payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'external_title_key', l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        l.dados_normalizados->>'cedente_nome', l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_nome', l.dados_normalizados->>'sacado_documento',
        (l.dados_normalizados->>'valor_nominal')::numeric, nullif(l.dados_normalizados->>'valor_presente', '')::numeric,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric, nullif(l.dados_normalizados->>'valor_pdd', '')::numeric,
        nullif(l.dados_normalizados->>'data_emissao', '')::date, nullif(l.dados_normalizados->>'data_vencimento_original', '')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date, l.dados_normalizados->>'situacao_recebivel', l.dados_brutos, v_agora
      FROM public.rlx_importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'AQUISICOES' THEN
      INSERT INTO public.rlx_aquisicao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, fingerprint_linha, fingerprint_versao,
        id_recebivel, seu_numero, numero_documento, cedente_documento, sacado_documento,
        tipo_recebivel, chave_nfe, valor_compra, valor_vencimento, data_movimento,
        data_vencimento, codigo_movimento, payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'fingerprint_linha', COALESCE(NULLIF(l.dados_normalizados->>'fingerprint_versao', ''), 'RLX_FP_V1'),
        l.dados_normalizados->>'id_recebivel', l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento',
        l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        (l.dados_normalizados->>'valor_compra')::numeric, nullif(l.dados_normalizados->>'valor_vencimento', '')::numeric,
        (l.dados_normalizados->>'data_movimento')::date, nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        l.dados_normalizados->>'codigo_movimento', l.dados_brutos, v_agora
      FROM public.rlx_importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'LIQUIDACOES' THEN
      INSERT INTO public.rlx_liquidacao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, id_movimento_externo,
        fingerprint_linha, fingerprint_versao, id_recebivel, seu_numero, numero_documento,
        cedente_documento, sacado_documento, tipo_recebivel, id_tipo_movimento,
        tipo_movimento, status_recebivel, data_movimento, data_aquisicao,
        data_vencimento, valor_aquisicao, valor_pago, valor_nominal, juros,
        payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        nullif(l.dados_normalizados->>'id_movimento_externo', ''), l.dados_normalizados->>'fingerprint_linha',
        COALESCE(NULLIF(l.dados_normalizados->>'fingerprint_versao', ''), 'RLX_FP_V1'), l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento', l.dados_normalizados->>'cedente_documento',
        l.dados_normalizados->>'sacado_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'id_tipo_movimento',
        l.dados_normalizados->>'tipo_movimento', l.dados_normalizados->>'status_recebivel', (l.dados_normalizados->>'data_movimento')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date, nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric, (l.dados_normalizados->>'valor_pago')::numeric,
        nullif(l.dados_normalizados->>'valor_nominal', '')::numeric, nullif(l.dados_normalizados->>'juros', '')::numeric,
        l.dados_brutos, v_agora
      FROM public.rlx_importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSE
      INSERT INTO public.rlx_carteira_snapshots (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, fundo_externo,
        documento_fundo, versao_externa, patrimonio_liquido, publicada_externamente_em,
        payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'fundo_externo', l.dados_normalizados->>'documento_fundo', l.dados_normalizados->>'versao_externa',
        (l.dados_normalizados->>'patrimonio_liquido')::numeric, nullif(l.dados_normalizados->>'publicada_externamente_em', '')::timestamptz,
        l.dados_brutos, v_agora
      FROM public.rlx_importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    END IF;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
  END IF;

  UPDATE public.rlx_importacoes_financeiras
  SET status = 'PUBLICADA', publicada_em = v_agora, substituida_em = NULL,
      linhas_publicadas = v_inseridas, substitui_importacao_id = v_anterior_id,
      finalizada_em = v_agora, erro_sanitizado = NULL
  WHERE id = v_importacao.id;

  IF cardinality(v_anterior_ids) > 0 THEN
    PERFORM private.rlx_auditar('RLX_IMPORTACAO_FINANCEIRA_RETIFICADA', v_importacao.id, v_importacao.fundo_id,
      COALESCE(p_correlation_id, v_importacao.correlation_id),
      jsonb_build_object('tipo_base', v_importacao.tipo_base, 'data_referencia', v_importacao.data_referencia, 'substituiu_importacoes', to_jsonb(v_anterior_ids)));
  END IF;
  PERFORM private.rlx_auditar('RLX_IMPORTACAO_FINANCEIRA_PUBLICADA', v_importacao.id, v_importacao.fundo_id,
    COALESCE(p_correlation_id, v_importacao.correlation_id),
    jsonb_build_object('tipo_base', v_importacao.tipo_base, 'data_referencia', v_importacao.data_referencia, 'completude', v_importacao.completude, 'linhas_publicadas', v_inseridas));

  RETURN jsonb_build_object('id', v_importacao.id, 'status', 'PUBLICADA', 'linhas_publicadas', v_inseridas, 'retificou', cardinality(v_anterior_ids) > 0, 'substitui_importacao_id', v_anterior_id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_importacao_financeira_sem_movimento(uuid, text, date, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_importacao_financeira_sem_movimento(uuid, text, date, text, text, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.publicar_importacao_financeira(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publicar_importacao_financeira(uuid, uuid) TO authenticated, service_role;

COMMIT;
