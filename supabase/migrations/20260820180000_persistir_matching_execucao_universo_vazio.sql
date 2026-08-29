BEGIN;

-- P0 (P2.3 matching bloqueia universo vazio legitimo): persistir_matching_execucao
-- rejeitava QUALQUER execucao com resultados=[] como "Payload de matching
-- invalido", mesmo quando o universo pesquisado e legitimamente vazio (ex.:
-- unica base publicada e uma declaracao_sem_movimento em AQUISICOES/
-- LIQUIDACOES, ou uma base ESTOQUE publicada com zero linhas). A propria
-- funcao ja garante, antes deste ponto, que todo id em input_import_ids
-- corresponde a uma importacao PUBLICADA e pertencente ao fundo da execucao
-- -- ou seja, "resultados vazio + input_import_ids nao vazio e 100%
-- publicado" e prova suficiente de universo vazio genuino, nao de payload
-- forjado. A tabela persistir_conciliacao_execucao (P2.3 conciliacao, mesma
-- migration de origem) ja aceita resultados=[] sem nenhuma checagem
-- equivalente -- esta e a unica inconsistencia entre os dois RPCs irmaos.
--
-- Corpo reproduzido integralmente da definicao vigente (unica alteracao:
-- a guarda de payload invalido agora rejeita fundo_id ausente OU
-- input_import_ids vazio, em vez de rejeitar resultados vazio). Nenhuma
-- outra linha foi alterada.

CREATE OR REPLACE FUNCTION public.persistir_matching_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_resultado_id uuid;
  v_vinculo_id uuid;
  v_existente public.titulo_nf_vinculos%ROWTYPE;
  v_item jsonb;
  v_candidate jsonb;
  v_chave jsonb;
  v_status text;
  v_metodo text;
  v_total integer := 0;
  v_matched integer := 0;
  v_ambiguos integer := 0;
  v_nao_conciliados integer := 0;
  v_conflitos integer := 0;
  v_valor_total numeric(24,2) := 0;
  v_valor_matched numeric(24,2) := 0;
  v_valor_ambiguo numeric(24,2) := 0;
  v_valor_nao_conciliado numeric(24,2) := 0;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia de matching restrita ao processador interno';
  END IF;
  IF v_fundo_id IS NULL OR jsonb_array_length(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload de matching invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-matching:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.matching_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF (
    SELECT count(*)
    FROM public.importacoes_financeiras i
    WHERE i.id = ANY(ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'input_import_ids')::uuid))
      AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
  ) <> jsonb_array_length(p_payload -> 'input_import_ids') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs de matching nao estao publicados no fundo informado';
  END IF;

  INSERT INTO public.matching_execucoes (
    fundo_id, data_referencia, regra_versao, input_import_ids, assinatura_execucao,
    correlation_id, criado_por, detalhes
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, p_payload ->> 'regra_versao',
    ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'input_import_ids')::uuid),
    p_payload ->> 'assinatura_execucao', (p_payload ->> 'correlation_id')::uuid,
    nullif(p_payload ->> 'criado_por', '')::uuid,
    jsonb_build_object('processamento', 'RPC_TRANSACIONAL', 'imutavel', true)
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb))
  LOOP
    v_total := v_total + 1;
    v_status := v_item ->> 'status';
    v_metodo := v_item ->> 'metodo';
    v_vinculo_id := NULL;
    v_valor_total := v_valor_total + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);

    IF v_status = 'MATCH_FORTE' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.notas_fiscais nf
        WHERE nf.id = (v_item ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NF candidata fora do fundo da execucao';
      END IF;

      SELECT * INTO v_existente
      FROM public.titulo_nf_vinculos
      WHERE fundo_id = v_fundo_id AND provedor = v_item ->> 'provedor'
        AND identidade_externa = v_item ->> 'identidade_externa' AND status = 'ATIVO';

      IF FOUND AND v_existente.nota_fiscal_id <> (v_item ->> 'nota_fiscal_id')::uuid THEN
        v_status := 'CONFLITO';
        v_metodo := 'CONFLITO';
      ELSIF FOUND THEN
        v_vinculo_id := v_existente.id;
      ELSE
        INSERT INTO public.titulo_nf_vinculos (
          fundo_id, provedor, identidade_externa, nota_fiscal_id, origem, metodo,
          regra_versao, evidencias, candidate_count, criado_por, correlation_id
        ) VALUES (
          v_fundo_id, v_item ->> 'provedor', v_item ->> 'identidade_externa',
          (v_item ->> 'nota_fiscal_id')::uuid, 'AUTOMATICO', v_metodo,
          p_payload ->> 'regra_versao', coalesce(v_item -> 'evidencias', '{}'::jsonb), 1,
          nullif(p_payload ->> 'criado_por', '')::uuid, (p_payload ->> 'correlation_id')::uuid
        ) RETURNING id INTO v_vinculo_id;

        FOR v_chave IN SELECT value FROM jsonb_array_elements(coalesce(v_item -> 'chaves', '[]'::jsonb))
        LOOP
          INSERT INTO public.titulo_nf_vinculo_chaves (
            vinculo_id, fundo_id, provedor, tipo_chave, valor_normalizado, fonte
          ) VALUES (
            v_vinculo_id, v_fundo_id, v_item ->> 'provedor', v_chave ->> 'tipo',
            v_chave ->> 'valor', 'MATCH_AUTOMATICO'
          ) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END IF;

    IF v_status = 'MATCH_FORTE' THEN
      v_matched := v_matched + 1;
      v_valor_matched := v_valor_matched + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    ELSIF v_status = 'AMBIGUO' THEN
      v_ambiguos := v_ambiguos + 1;
      v_valor_ambiguo := v_valor_ambiguo + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    ELSIF v_status = 'CONFLITO' THEN
      v_conflitos := v_conflitos + 1;
    ELSE
      v_nao_conciliados := v_nao_conciliados + 1;
      v_valor_nao_conciliado := v_valor_nao_conciliado + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    END IF;

    INSERT INTO public.matching_resultados (
      execucao_id, fundo_id, provedor, origem_registro, origem_registro_id,
      identidade_externa, id_recebivel, seu_numero, chave_nfe, numero_documento,
      cedente_documento, cedente_nome, sacado_documento, sacado_nome,
      data_vencimento, valor_referencia, tipo_recebivel, status, metodo,
      nota_fiscal_id, vinculo_id, candidate_count, evidencias
    ) VALUES (
      v_execucao_id, v_fundo_id, v_item ->> 'provedor', v_item ->> 'origem_registro',
      (v_item ->> 'origem_registro_id')::uuid, v_item ->> 'identidade_externa',
      nullif(v_item ->> 'id_recebivel', ''), nullif(v_item ->> 'seu_numero', ''),
      nullif(v_item ->> 'chave_nfe', ''), nullif(v_item ->> 'numero_documento', ''),
      nullif(v_item ->> 'cedente_documento', ''), nullif(v_item ->> 'cedente_nome', ''),
      nullif(v_item ->> 'sacado_documento', ''), nullif(v_item ->> 'sacado_nome', ''),
      nullif(v_item ->> 'data_vencimento', '')::date,
      nullif(v_item ->> 'valor_referencia', '')::numeric, nullif(v_item ->> 'tipo_recebivel', ''),
      v_status, v_metodo,
      CASE WHEN v_status = 'MATCH_FORTE' THEN (v_item ->> 'nota_fiscal_id')::uuid ELSE NULL END,
      v_vinculo_id,
      CASE WHEN v_status = 'MATCH_FORTE' THEN 1 ELSE jsonb_array_length(coalesce(v_item -> 'candidatos', '[]'::jsonb)) END,
      coalesce(v_item -> 'evidencias', '{}'::jsonb) ||
        CASE WHEN v_status = 'CONFLITO' THEN jsonb_build_object('vinculo_ativo_conflitante', v_existente.id) ELSE '{}'::jsonb END
    ) RETURNING id INTO v_resultado_id;

    FOR v_candidate IN SELECT value FROM jsonb_array_elements(coalesce(v_item -> 'candidatos', '[]'::jsonb))
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notas_fiscais nf
        WHERE nf.id = (v_candidate ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
      ) THEN
        INSERT INTO public.matching_candidatos (
          matching_resultado_id, fundo_id, nota_fiscal_id, ordem, metodo, evidencias
        ) VALUES (
          v_resultado_id, v_fundo_id, (v_candidate ->> 'nota_fiscal_id')::uuid,
          coalesce((v_candidate ->> 'ordem')::integer, 1), v_candidate ->> 'metodo',
          coalesce(v_candidate -> 'evidencias', '{}'::jsonb)
        ) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.matching_execucoes SET
    status = 'CONCLUIDA', total_registros = v_total, matched = v_matched,
    ambiguos = v_ambiguos, nao_conciliados = v_nao_conciliados, conflitos = v_conflitos,
    valor_total = v_valor_total, valor_matched = v_valor_matched,
    valor_ambiguo = v_valor_ambiguo, valor_nao_conciliado = v_valor_nao_conciliado,
    finalizado_em = clock_timestamp()
  WHERE id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    nullif(p_payload ->> 'criado_por', '')::uuid, 'MATCHING_EXECUTADO',
    'matching_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'total', v_total, 'matched', v_matched, 'ambiguos', v_ambiguos,
      'nao_conciliados', v_nao_conciliados, 'conflitos', v_conflitos,
      'correlation_id', p_payload ->> 'correlation_id'),
    'usuario', 'gestor_conciliacao', p_payload ->> 'criado_por'
  );
  RETURN v_execucao_id;
END;
$$;

COMMIT;
