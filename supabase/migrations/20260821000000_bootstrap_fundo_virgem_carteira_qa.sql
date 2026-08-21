BEGIN;

-- P0/P1 (fundo virgem / BOOTSTRAP + Carteira QA homolog-only): permite que um
-- fundo recem-criado, sem historico financeiro, aprove sua primeira operacao
-- usando a PRIMEIRA Carteira oficial pos-aporte como ponto zero financeiro,
-- sem fabricar ESTOQUE/AQUISICOES/LIQUIDACOES/PL em nenhum ambiente.
--
-- Estado "fundo virgem" e inteiramente DERIVADO (nunca uma flag manual
-- permanente), calculado a partir de dois fatos historicos irreversiveis:
--   (a) nenhuma operacao do fundo alcancou status 'em_andamento' /
--       'inadimplente' / 'liquidada' com cessao_efetivada_em preenchido
--       (a mesma condicao que resolveOverlay ja usa para "operacao
--       economicamente viva" em src/lib/financeiro/exposicao/
--       processor.server.ts);
--   (b) nenhuma importacoes_financeiras PUBLICADA de tipo_base IN
--       ('ESTOQUE','AQUISICOES','LIQUIDACOES') jamais existiu para o fundo.
-- Uma vez falso, (a) e um fato historico que nunca reverte -- garante que
-- nao ha reentrada em bootstrap. "Bootstrap" propriamente (habilitado a
-- calcular exposicao) exige ADICIONALMENTE uma primeira Carteira oficial
-- publicada com PL>0; sem ela, o fundo e virgem mas ainda nao tem PL
-- oficial disponivel -- motivo canonico dedicado PL_OFICIAL_INDISPONIVEL,
-- nunca o generico AVALIACAO_RISCO_INDISPONIVEL.

CREATE OR REPLACE FUNCTION private.financeiro_fundo_virgem(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT NOT (
    EXISTS (
      SELECT 1 FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
      WHERE cf.fundo_id = p_fundo_id
        AND o.status IN ('em_andamento', 'inadimplente', 'liquidada')
        AND o.cessao_efetivada_em IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.importacoes_financeiras i
      WHERE i.fundo_id = p_fundo_id AND i.status = 'PUBLICADA'
        AND i.tipo_base IN ('ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')
    )
  );
$$;
REVOKE ALL ON FUNCTION private.financeiro_fundo_virgem(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.financeiro_fundo_virgem(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolver_bootstrap_financeiro(p_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_fundo_virgem boolean;
  v_carteira record;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Resolucao de bootstrap restrita ao processador interno';
  END IF;

  v_fundo_virgem := private.financeiro_fundo_virgem(p_fundo_id);
  IF NOT v_fundo_virgem THEN
    RETURN jsonb_build_object('fundo_virgem', false, 'carteira_oficial', null);
  END IF;

  SELECT i.id importacao_id, i.data_referencia, s.id snapshot_id, s.patrimonio_liquido
    INTO v_carteira
  FROM public.importacoes_financeiras i
  JOIN public.carteira_snapshots s ON s.importacao_id = i.id AND s.fundo_id = i.fundo_id AND s.vigente = true
  WHERE i.fundo_id = p_fundo_id AND i.tipo_base = 'CARTEIRA' AND i.status = 'PUBLICADA'
    AND i.completude = 'COMPLETO_COM_DADOS' AND s.patrimonio_liquido > 0
  ORDER BY i.data_referencia ASC, i.publicada_em ASC
  LIMIT 1;

  IF v_carteira.importacao_id IS NULL THEN
    RETURN jsonb_build_object('fundo_virgem', true, 'carteira_oficial', null);
  END IF;

  RETURN jsonb_build_object(
    'fundo_virgem', true,
    'carteira_oficial', jsonb_build_object(
      'importacao_id', v_carteira.importacao_id,
      'data_referencia', v_carteira.data_referencia,
      'snapshot_id', v_carteira.snapshot_id,
      'patrimonio_liquido', v_carteira.patrimonio_liquido
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolver_bootstrap_financeiro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_bootstrap_financeiro(uuid) TO service_role;

-- Schema: colunas de rastreio + relaxamento minimo das constraints que hoje
-- pressupoem sempre haver ao menos uma base real publicada.

ALTER TABLE public.matching_execucoes ADD COLUMN IF NOT EXISTS bootstrap boolean NOT NULL DEFAULT false;
ALTER TABLE public.matching_execucoes DROP CONSTRAINT IF EXISTS rlx_matching_execucoes_inputs_check;
ALTER TABLE public.matching_execucoes DROP CONSTRAINT IF EXISTS matching_execucoes_inputs_check;
ALTER TABLE public.matching_execucoes ADD CONSTRAINT matching_execucoes_inputs_check
  CHECK (bootstrap OR cardinality(input_import_ids) > 0);

ALTER TABLE public.conciliacao_execucoes ADD COLUMN IF NOT EXISTS bootstrap boolean NOT NULL DEFAULT false;

ALTER TABLE public.posicao_logistica_execucoes ALTER COLUMN estoque_importacao_id DROP NOT NULL;
ALTER TABLE public.posicao_logistica_execucoes ALTER COLUMN matching_execucao_id DROP NOT NULL;
ALTER TABLE public.posicao_logistica_execucoes ADD COLUMN IF NOT EXISTS bootstrap boolean NOT NULL DEFAULT false;
ALTER TABLE public.posicao_logistica_execucoes DROP CONSTRAINT IF EXISTS posicao_logistica_execucoes_bootstrap_check;
ALTER TABLE public.posicao_logistica_execucoes ADD CONSTRAINT posicao_logistica_execucoes_bootstrap_check
  CHECK (bootstrap OR (estoque_importacao_id IS NOT NULL AND matching_execucao_id IS NOT NULL));

ALTER TABLE public.exposicao_execucoes ADD COLUMN IF NOT EXISTS bootstrap boolean NOT NULL DEFAULT false;
ALTER TABLE public.exposicao_execucoes DROP CONSTRAINT IF EXISTS exposicao_execucoes_status_check;
ALTER TABLE public.exposicao_execucoes ADD CONSTRAINT exposicao_execucoes_status_check
  CHECK (status = ANY (ARRAY[
    'CALCULADA', 'NAO_APLICAVEL', 'PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO',
    'POSICAO_LOGISTICA_INDISPONIVEL', 'BASE_INCOMPATIVEL', 'PL_OFICIAL_INDISPONIVEL'
  ]));

-- persistir_matching_execucao: corpo integralmente reproduzido da versao
-- vigente (20260820180000_persistir_matching_execucao_universo_vazio.sql),
-- unica alteracao e o ramo de bootstrap (guarda + re-verificacao server-side
-- do predicado, nunca confiando cegamente no flag do chamador; e a coluna
-- bootstrap na insercao).

CREATE OR REPLACE FUNCTION public.persistir_matching_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_bootstrap boolean := coalesce((p_payload ->> 'bootstrap')::boolean, false);
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
  IF v_fundo_id IS NULL OR (NOT v_bootstrap AND jsonb_array_length(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb)) = 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload de matching invalido';
  END IF;
  IF v_bootstrap AND NOT private.financeiro_fundo_virgem(v_fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bootstrap invalido: fundo possui historico financeiro';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-matching:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.matching_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF NOT v_bootstrap AND (
    SELECT count(*)
    FROM public.importacoes_financeiras i
    WHERE i.id = ANY(ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'input_import_ids')::uuid))
      AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
  ) <> jsonb_array_length(p_payload -> 'input_import_ids') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs de matching nao estao publicados no fundo informado';
  END IF;

  INSERT INTO public.matching_execucoes (
    fundo_id, data_referencia, regra_versao, input_import_ids, assinatura_execucao,
    correlation_id, criado_por, detalhes, bootstrap
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, p_payload ->> 'regra_versao',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb))::uuid),
    p_payload ->> 'assinatura_execucao', (p_payload ->> 'correlation_id')::uuid,
    nullif(p_payload ->> 'criado_por', '')::uuid,
    jsonb_build_object('processamento', 'RPC_TRANSACIONAL', 'imutavel', true),
    v_bootstrap
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
    nullif(p_payload ->> 'criado_por', '')::uuid,
    CASE WHEN v_bootstrap THEN 'MATCHING_BOOTSTRAP' ELSE 'MATCHING_EXECUTADO' END,
    'matching_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'total', v_total, 'matched', v_matched, 'ambiguos', v_ambiguos,
      'nao_conciliados', v_nao_conciliados, 'conflitos', v_conflitos,
      'bootstrap', v_bootstrap, 'correlation_id', p_payload ->> 'correlation_id'),
    'usuario', 'gestor_conciliacao', p_payload ->> 'criado_por'
  );
  RETURN v_execucao_id;
END;
$$;

-- persistir_conciliacao_execucao: corpo integralmente reproduzido da versao
-- vigente (20260814141629_p2_3_matching_conciliacao_rlx.sql, ja rewritten
-- para os nomes canonicos); unica alteracao e o ramo bootstrap (permite
-- status='CONCLUIDA' com os 4 inputs nulos quando o fundo e comprovadamente
-- virgem, re-verificado server-side) e a coluna bootstrap na insercao.

CREATE OR REPLACE FUNCTION public.persistir_conciliacao_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_status text := p_payload ->> 'status';
  v_bootstrap boolean := coalesce((p_payload ->> 'bootstrap')::boolean, false);
  v_inputs uuid[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb))::uuid);
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia de conciliacao restrita ao processador interno';
  END IF;
  IF v_bootstrap AND NOT private.financeiro_fundo_virgem(v_fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bootstrap invalido: fundo possui historico financeiro';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-conciliacao:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
  ));
  SELECT id INTO v_execucao_id FROM public.conciliacao_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF v_status <> 'BASE_INCOMPLETA' AND NOT v_bootstrap AND (
    SELECT count(*) FROM public.importacoes_financeiras i
    WHERE i.id = ANY(v_inputs) AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
      AND i.completude IN ('COMPLETO_COM_DADOS', 'COMPLETO_VAZIO')
  ) <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs publicados/completos da conciliacao sao invalidos';
  END IF;

  INSERT INTO public.conciliacao_execucoes (
    fundo_id, data_referencia, regra_versao, estoque_d2_importacao_id,
    estoque_d1_importacao_id, aquisicoes_d1_importacao_id, liquidacoes_d1_importacao_id,
    matching_execucao_id, assinatura_execucao, correlation_id, criado_por, detalhes, bootstrap
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, p_payload ->> 'regra_versao',
    nullif(p_payload ->> 'estoque_d2_importacao_id', '')::uuid,
    nullif(p_payload ->> 'estoque_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'aquisicoes_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'liquidacoes_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'matching_execucao_id', '')::uuid,
    p_payload ->> 'assinatura_execucao', (p_payload ->> 'correlation_id')::uuid,
    nullif(p_payload ->> 'criado_por', '')::uuid, coalesce(p_payload -> 'detalhes', '{}'::jsonb), v_bootstrap
  ) RETURNING id INTO v_execucao_id;

  IF v_status <> 'BASE_INCOMPLETA' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb))
    LOOP
      INSERT INTO public.conciliacao_resultados (
        execucao_id, fundo_id, identidade_externa, provedor, vinculo_id, nota_fiscal_id,
        presente_d2, presente_d1, valor_aquisicao_d2, valor_aquisicao_d1,
        aquisicoes_count, aquisicoes_valor, liquidacoes_count, liquidacoes_valor_pago,
        status, detalhes
      ) VALUES (
        v_execucao_id, v_fundo_id, v_item ->> 'identidade_externa', v_item ->> 'provedor',
        nullif(v_item ->> 'vinculo_id', '')::uuid, nullif(v_item ->> 'nota_fiscal_id', '')::uuid,
        coalesce((v_item ->> 'presente_d2')::boolean, false),
        coalesce((v_item ->> 'presente_d1')::boolean, false),
        nullif(v_item ->> 'valor_aquisicao_d2', '')::numeric,
        nullif(v_item ->> 'valor_aquisicao_d1', '')::numeric,
        coalesce((v_item ->> 'aquisicoes_count')::integer, 0),
        coalesce((v_item ->> 'aquisicoes_valor')::numeric, 0),
        coalesce((v_item ->> 'liquidacoes_count')::integer, 0),
        coalesce((v_item ->> 'liquidacoes_valor_pago')::numeric, 0),
        v_item ->> 'status', coalesce(v_item -> 'detalhes', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  UPDATE public.conciliacao_execucoes SET
    status = v_status, contagens = coalesce(p_payload -> 'contagens', '{}'::jsonb),
    valores_agregados = coalesce(p_payload -> 'valores_agregados', '{}'::jsonb),
    finalizado_em = clock_timestamp()
  WHERE id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    nullif(p_payload ->> 'criado_por', '')::uuid,
    CASE WHEN v_bootstrap THEN 'CONCILIACAO_BOOTSTRAP'
         WHEN v_status = 'BASE_INCOMPLETA' THEN 'CONCILIACAO_BASE_INCOMPLETA' ELSE 'CONCILIACAO_EXECUTADA' END,
    'conciliacao_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'status', v_status, 'bootstrap', v_bootstrap, 'contagens', p_payload -> 'contagens',
      'correlation_id', p_payload ->> 'correlation_id'),
    'usuario', 'gestor_conciliacao', p_payload ->> 'criado_por'
  );
  RETURN v_execucao_id;
END;
$$;

-- persistir_posicao_logistica_execucao: corpo integralmente reproduzido da
-- versao vigente; a unica alteracao e um ramo bootstrap totalmente separado
-- no topo da funcao, que nunca toca a validacao do caminho real (Estoque
-- publicado / matching / cobertura integral) e insere diretamente uma
-- execucao CONCLUIDA com zero posicoes, apos re-verificar server-side que o
-- fundo e comprovadamente virgem.

CREATE OR REPLACE FUNCTION public.persistir_posicao_logistica_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_bootstrap boolean := coalesce((p_payload ->> 'bootstrap')::boolean, false);
  v_estoque_id uuid := nullif(p_payload ->> 'estoque_importacao_id', '')::uuid;
  v_matching_id uuid := nullif(p_payload ->> 'matching_execucao_id', '')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_data_referencia date;
  v_total_estoque integer;
  v_total_payload integer;
  v_reprocessamento boolean;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia logistica restrita ao processador interno';
  END IF;

  IF v_bootstrap THEN
    IF v_fundo_id IS NULL OR p_payload ->> 'regra_versao' <> 'RLX_LOGISTICA_V1'
       OR coalesce(p_payload ->> 'assinatura_execucao', '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 invalido';
    END IF;
    IF NOT private.financeiro_fundo_virgem(v_fundo_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bootstrap invalido: fundo possui historico financeiro';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'financeiro-logistica-bootstrap:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
    ));

    SELECT id INTO v_execucao_id
    FROM public.posicao_logistica_execucoes
    WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
    IF FOUND THEN RETURN v_execucao_id; END IF;

    INSERT INTO public.posicao_logistica_execucoes (
      fundo_id, data_referencia, estoque_importacao_id, matching_execucao_id, bootstrap,
      regra_versao, logistica_as_of, fingerprint_logistico, assinatura_execucao, status,
      valor_total_aquisicao, valor_matched, valor_sem_match, valor_entregue, valor_em_transito, valor_indeterminado,
      correlation_id, criado_por, detalhes, finalizado_em
    ) VALUES (
      v_fundo_id, (p_payload ->> 'data_referencia')::date, NULL, NULL, true,
      'RLX_LOGISTICA_V1', (p_payload ->> 'logistica_as_of')::timestamptz,
      p_payload ->> 'fingerprint_logistico', p_payload ->> 'assinatura_execucao', 'CONCLUIDA',
      0, 0, 0, 0, 0, 0,
      (p_payload ->> 'correlation_id')::uuid, nullif(p_payload ->> 'criado_por', '')::uuid,
      coalesce(p_payload -> 'detalhes', '{}'::jsonb), clock_timestamp()
    ) RETURNING id INTO v_execucao_id;

    INSERT INTO public.logs_auditoria (
      tipo_evento, entidade_tipo, entidade_id, dados_depois,
      ator_tipo, origem, ator_identificador, created_at
    ) VALUES (
      'POSICAO_LOGISTICA_BOOTSTRAP', 'posicao_logistica_execucoes', v_execucao_id,
      jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
        'regra_versao', 'RLX_LOGISTICA_V1', 'correlation_id', p_payload ->> 'correlation_id'),
      'sistema', 'financeiro_logistica', p_payload ->> 'criado_por', clock_timestamp()
    );
    RETURN v_execucao_id;
  END IF;

  IF v_fundo_id IS NULL OR v_estoque_id IS NULL OR v_matching_id IS NULL
     OR p_payload ->> 'regra_versao' <> 'RLX_LOGISTICA_V1'
     OR coalesce(p_payload ->> 'assinatura_execucao', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 invalido';
  END IF;

  SELECT i.data_referencia INTO v_data_referencia
  FROM public.importacoes_financeiras i
  WHERE i.id = v_estoque_id AND i.fundo_id = v_fundo_id
    AND i.tipo_base = 'ESTOQUE' AND i.status = 'PUBLICADA';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Estoque publicado incompativel com o fundo';
  END IF;
  IF v_data_referencia IS DISTINCT FROM (p_payload ->> 'data_referencia')::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Data de referencia incompativel com o Estoque publicado';
  END IF;

  SELECT count(*)::integer INTO v_total_estoque
  FROM public.estoque_posicoes p
  WHERE p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id;
  v_total_payload := jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb));
  IF v_total_payload <> v_total_estoque THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 nao cobre integralmente o Estoque publicado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-logistica:' || v_fundo_id::text || ':' || v_estoque_id::text, 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.posicao_logistica_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matching_execucoes m
    WHERE m.id = v_matching_id AND m.fundo_id = v_fundo_id
      AND m.status = 'CONCLUIDA' AND v_estoque_id = ANY(m.input_import_ids)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Matching incompativel com o estoque publicado';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.posicao_logistica_execucoes e
    WHERE e.fundo_id = v_fundo_id
      AND e.estoque_importacao_id = v_estoque_id
      AND e.matching_execucao_id = v_matching_id
  ) INTO v_reprocessamento;

  INSERT INTO public.posicao_logistica_execucoes (
    fundo_id, data_referencia, estoque_importacao_id, matching_execucao_id,
    regra_versao, logistica_as_of, fingerprint_logistico, assinatura_execucao,
    correlation_id, criado_por, detalhes
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, v_estoque_id, v_matching_id,
    'RLX_LOGISTICA_V1', (p_payload ->> 'logistica_as_of')::timestamptz,
    p_payload ->> 'fingerprint_logistico', p_payload ->> 'assinatura_execucao',
    (p_payload ->> 'correlation_id')::uuid, (p_payload ->> 'criado_por')::uuid,
    coalesce(p_payload -> 'detalhes', '{}'::jsonb)
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.estoque_posicoes p
      WHERE p.id = (v_item ->> 'estoque_posicao_id')::uuid
        AND p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Posicao de estoque fora da base P2.4';
    END IF;
    IF nullif(v_item ->> 'matching_resultado_id', '') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.matching_resultados r
      WHERE r.id = (v_item ->> 'matching_resultado_id')::uuid
        AND r.execucao_id = v_matching_id AND r.fundo_id = v_fundo_id
        AND r.origem_registro = 'ESTOQUE'
        AND r.origem_registro_id = (v_item ->> 'estoque_posicao_id')::uuid
        AND r.status = v_item ->> 'matching_status'
        AND r.metodo = v_item ->> 'matching_metodo'
        AND r.nota_fiscal_id IS NOT DISTINCT FROM nullif(v_item ->> 'nota_fiscal_id', '')::uuid
        AND r.vinculo_id IS NOT DISTINCT FROM nullif(v_item ->> 'vinculo_id', '')::uuid
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Resultado de matching incompativel com a posicao';
    END IF;
    IF nullif(v_item ->> 'nota_fiscal_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = (v_item ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nota fiscal fora do fundo da posicao P2.4';
    END IF;

    INSERT INTO public.posicao_logistica_resultados (
      execucao_id, fundo_id, estoque_importacao_id, estoque_posicao_id,
      matching_resultado_id, matching_status, matching_metodo, status_vinculo,
      vinculo_id, nota_fiscal_id, status_logistico, id_recebivel, seu_numero,
      numero_documento, cedente_nome, cedente_documento, sacado_nome, sacado_documento,
      data_vencimento, valor_nominal, valor_aquisicao, valor_aquisicao_qualidade,
      nf_compartilhada_entre_posicoes, evidencia_familia, documento_id,
      documento_versao_id, documento_analise_id, fundamento, evidencias, detalhes
    ) VALUES (
      v_execucao_id, v_fundo_id, v_estoque_id, (v_item ->> 'estoque_posicao_id')::uuid,
      nullif(v_item ->> 'matching_resultado_id', '')::uuid, v_item ->> 'matching_status',
      v_item ->> 'matching_metodo', v_item ->> 'status_vinculo',
      nullif(v_item ->> 'vinculo_id', '')::uuid, nullif(v_item ->> 'nota_fiscal_id', '')::uuid,
      nullif(v_item ->> 'status_logistico', ''), v_item ->> 'id_recebivel',
      v_item ->> 'seu_numero', v_item ->> 'numero_documento', v_item ->> 'cedente_nome',
      v_item ->> 'cedente_documento', v_item ->> 'sacado_nome', v_item ->> 'sacado_documento',
      nullif(v_item ->> 'data_vencimento', '')::date,
      nullif(v_item ->> 'valor_nominal', '')::numeric,
      nullif(v_item ->> 'valor_aquisicao', '')::numeric,
      v_item ->> 'valor_aquisicao_qualidade',
      coalesce((v_item ->> 'nf_compartilhada_entre_posicoes')::boolean, false),
      nullif(v_item ->> 'evidencia_familia', ''), nullif(v_item ->> 'documento_id', '')::uuid,
      nullif(v_item ->> 'documento_versao_id', '')::uuid,
      nullif(v_item ->> 'documento_analise_id', '')::uuid,
      coalesce(v_item ->> 'fundamento', 'sem_match_financeiro_nf'),
      coalesce(v_item -> 'evidencias', '{}'::jsonb), coalesce(v_item -> 'detalhes', '{}'::jsonb)
    );
  END LOOP;

  UPDATE public.posicao_logistica_execucoes e SET
    status = coalesce(p_payload ->> 'status', 'CONCLUIDA'),
    total_posicoes = a.total,
    posicoes_matched = a.matched,
    posicoes_sem_match = a.sem_match,
    posicoes_entregues = a.entregues,
    posicoes_em_transito = a.em_transito,
    posicoes_indeterminadas = a.indeterminadas,
    posicoes_valor_ausente = a.valor_ausente,
    valor_total_aquisicao = a.valor_total,
    valor_matched = a.valor_matched,
    valor_sem_match = a.valor_sem_match,
    valor_entregue = a.valor_entregue,
    valor_em_transito = a.valor_em_transito,
    valor_indeterminado = a.valor_indeterminado,
    finalizado_em = clock_timestamp()
  FROM (
    SELECT count(*)::int total,
      count(*) FILTER (WHERE status_vinculo = 'MATCHED_FINANCEIRO_NF')::int matched,
      count(*) FILTER (WHERE status_vinculo = 'SEM_MATCH_FINANCEIRO_NF')::int sem_match,
      count(*) FILTER (WHERE status_logistico = 'ENTREGUE')::int entregues,
      count(*) FILTER (WHERE status_logistico = 'EM_TRANSITO')::int em_transito,
      count(*) FILTER (WHERE status_logistico = 'INDETERMINADA')::int indeterminadas,
      count(*) FILTER (WHERE valor_aquisicao IS NULL)::int valor_ausente,
      sum(valor_aquisicao) valor_total,
      sum(valor_aquisicao) FILTER (WHERE status_vinculo = 'MATCHED_FINANCEIRO_NF') valor_matched,
      sum(valor_aquisicao) FILTER (WHERE status_vinculo = 'SEM_MATCH_FINANCEIRO_NF') valor_sem_match,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'ENTREGUE') valor_entregue,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'EM_TRANSITO') valor_em_transito,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'INDETERMINADA') valor_indeterminado
    FROM public.posicao_logistica_resultados WHERE execucao_id = v_execucao_id
  ) a WHERE e.id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador, created_at
  ) VALUES (
    CASE
      WHEN coalesce(p_payload ->> 'status', 'CONCLUIDA') = 'BASE_INCOMPLETA'
        THEN 'POSICAO_LOGISTICA_BASE_INCOMPLETA'
      WHEN v_reprocessamento THEN 'POSICAO_LOGISTICA_REPROCESSADA'
      ELSE 'POSICAO_LOGISTICA_EXECUTADA'
    END,
    'posicao_logistica_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'regra_versao', 'RLX_LOGISTICA_V1', 'correlation_id', p_payload ->> 'correlation_id'),
    'sistema', 'financeiro_logistica', p_payload ->> 'criado_por', clock_timestamp()
  );

  RETURN v_execucao_id;
END;
$$;

-- persistir_exposicao_execucao: corpo integralmente reproduzido da versao
-- vigente; unica alteracao e permitir o novo status PL_OFICIAL_INDISPONIVEL
-- (fundo virgem sem nenhuma Carteira oficial publicada ainda) na lista de
-- status aceitos -- o caminho CALCULADA/demais status ja funciona sem
-- alteracao para bootstrap, pois o chamador simplesmente informa a Carteira/
-- PL da primeira publicacao oficial em vez da data D-2 temporal.

CREATE OR REPLACE FUNCTION public.persistir_exposicao_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_status text := p_payload ->> 'status';
  v_posicao_id uuid := nullif(p_payload ->> 'posicao_logistica_execucao_id', '')::uuid;
  v_carteira_importacao_id uuid := nullif(p_payload ->> 'carteira_importacao_id', '')::uuid;
  v_carteira_snapshot_id uuid := nullif(p_payload ->> 'carteira_snapshot_id', '')::uuid;
  v_reprocessamento boolean;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia P2.5 restrita ao processador interno';
  END IF;
  IF v_fundo_id IS NULL OR p_payload ->> 'regra_versao' <> 'RLX_EXPOSICAO_V1'
     OR coalesce(p_payload ->> 'assinatura_execucao', '') !~ '^[0-9a-f]{64}$'
     OR v_status NOT IN ('CALCULADA','NAO_APLICAVEL','PL_D2_INDISPONIVEL','PL_D2_INVALIDO','POSICAO_LOGISTICA_INDISPONIVEL','BASE_INCOMPATIVEL','PL_OFICIAL_INDISPONIVEL') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.5 invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-exposicao:' || v_fundo_id::text || ':' || (p_payload ->> 'data_operacional') || ':RLX_EXPOSICAO_V1', 0
  ));
  SELECT id INTO v_execucao_id FROM public.exposicao_execucoes
   WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF v_posicao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.posicao_logistica_execucoes e
     WHERE e.id=v_posicao_id AND e.fundo_id=v_fundo_id AND e.status='CONCLUIDA'
       AND e.data_referencia=(p_payload->>'data_referencia_estoque')::date
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Snapshot P2.4 incompativel'; END IF;
  IF v_carteira_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.carteira_snapshots c JOIN public.importacoes_financeiras i ON i.id=c.importacao_id
     WHERE c.id=v_carteira_snapshot_id AND c.importacao_id=v_carteira_importacao_id AND c.fundo_id=v_fundo_id
       AND c.data_referencia=(p_payload->>'data_referencia_pl')::date AND c.vigente
       AND i.status='PUBLICADA' AND i.tipo_base='CARTEIRA' AND i.completude='COMPLETO_COM_DADOS'
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PL D-2 incompativel'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.exposicao_execucoes e WHERE e.fundo_id=v_fundo_id AND e.data_operacional=(p_payload->>'data_operacional')::date)
    INTO v_reprocessamento;
  INSERT INTO public.exposicao_execucoes (
    fundo_id,data_operacional,data_referencia_estoque,data_referencia_pl,posicao_logistica_execucao_id,
    carteira_importacao_id,carteira_snapshot_id,politica_operacional_versao_id,logistica_as_of,overlay_as_of,
    regra_versao,limite_referencia_pct,assinatura_execucao,status,
    quantidade_posicao,quantidade_entregue,quantidade_em_transito_estoque,quantidade_indeterminada,
    quantidade_sem_match,quantidade_valor_aquisicao_ausente,quantidade_overlay,quantidade_ja_incorporada,
    quantidade_nao_incorporada,valor_posicao_total,valor_entregue,valor_em_transito_estoque,
    valor_indeterminado,valor_sem_match,overlay_total,overlay_em_transito,overlay_entregue,
    overlay_indeterminado,operacoes_ja_incorporadas_valor,operacoes_nao_incorporadas_valor,
    exposicao_em_transito_total,patrimonio_liquido_d2,percentual_exposicao,classificacao_limite,
    flags_qualidade,detalhes,correlation_id,criado_por,bootstrap
  ) VALUES (
    v_fundo_id,(p_payload->>'data_operacional')::date,(p_payload->>'data_referencia_estoque')::date,
    (p_payload->>'data_referencia_pl')::date,v_posicao_id,v_carteira_importacao_id,v_carteira_snapshot_id,
    nullif(p_payload->>'politica_operacional_versao_id','')::uuid,nullif(p_payload->>'logistica_as_of','')::timestamptz,
    (p_payload->>'overlay_as_of')::timestamptz,'RLX_EXPOSICAO_V1',nullif(p_payload->>'limite_referencia_pct','')::numeric,
    p_payload->>'assinatura_execucao',v_status,coalesce((p_payload->>'quantidade_posicao')::int,0),
    coalesce((p_payload->>'quantidade_entregue')::int,0),coalesce((p_payload->>'quantidade_em_transito_estoque')::int,0),
    coalesce((p_payload->>'quantidade_indeterminada')::int,0),coalesce((p_payload->>'quantidade_sem_match')::int,0),
    coalesce((p_payload->>'quantidade_valor_aquisicao_ausente')::int,0),coalesce((p_payload->>'quantidade_overlay')::int,0),
    coalesce((p_payload->>'quantidade_ja_incorporada')::int,0),coalesce((p_payload->>'quantidade_nao_incorporada')::int,0),
    nullif(p_payload->>'valor_posicao_total','')::numeric,nullif(p_payload->>'valor_entregue','')::numeric,
    nullif(p_payload->>'valor_em_transito_estoque','')::numeric,nullif(p_payload->>'valor_indeterminado','')::numeric,
    nullif(p_payload->>'valor_sem_match','')::numeric,nullif(p_payload->>'overlay_total','')::numeric,
    nullif(p_payload->>'overlay_em_transito','')::numeric,nullif(p_payload->>'overlay_entregue','')::numeric,
    nullif(p_payload->>'overlay_indeterminado','')::numeric,nullif(p_payload->>'operacoes_ja_incorporadas_valor','')::numeric,
    nullif(p_payload->>'operacoes_nao_incorporadas_valor','')::numeric,nullif(p_payload->>'exposicao_em_transito_total','')::numeric,
    nullif(p_payload->>'patrimonio_liquido_d2','')::numeric,nullif(p_payload->>'percentual_exposicao','')::numeric,
    nullif(p_payload->>'classificacao_limite',''),ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'flags_qualidade','[]'::jsonb))),
    coalesce(p_payload->'detalhes','{}'::jsonb),(p_payload->>'correlation_id')::uuid,nullif(p_payload->>'criado_por','')::uuid,
    coalesce((p_payload->>'bootstrap')::boolean,false)
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'overlay_itens','[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.operacoes_nfs onf
      JOIN public.operacoes o ON o.id=onf.operacao_id
      JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id
      WHERE onf.operacao_id=(v_item->>'operacao_id')::uuid AND onf.nota_fiscal_id=(v_item->>'nota_fiscal_id')::uuid
        AND cf.fundo_id=v_fundo_id
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Operacao/NF fora do fundo P2.5'; END IF;
    IF nullif(v_item->>'valor_aquisicao','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.operacao_calculo_nfs c WHERE c.operacao_id=(v_item->>'operacao_id')::uuid
       AND c.nota_fiscal_id=(v_item->>'nota_fiscal_id')::uuid AND c.fundo_id=v_fundo_id
       AND c.valor_presente=(v_item->>'valor_aquisicao')::numeric
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Valor de aquisicao overlay nao canonico'; END IF;
    INSERT INTO public.exposicao_overlay_itens (
      execucao_id,fundo_id,operacao_id,nota_fiscal_id,operacao_economica_em,valor_aquisicao,status_logistico,
      ja_incorporado_estoque,incluido_no_numerador,motivo,evidencias
    ) VALUES (
      v_execucao_id,v_fundo_id,(v_item->>'operacao_id')::uuid,(v_item->>'nota_fiscal_id')::uuid,
      (v_item->>'operacao_economica_em')::timestamptz,nullif(v_item->>'valor_aquisicao','')::numeric,
      v_item->>'status_logistico',coalesce((v_item->>'ja_incorporado_estoque')::boolean,false),
      coalesce((v_item->>'incluido_no_numerador')::boolean,false),v_item->>'motivo',coalesce(v_item->'evidencias','{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.logs_auditoria (tipo_evento,entidade_tipo,entidade_id,dados_depois,ator_tipo,origem,ator_identificador,created_at)
  VALUES (
    CASE WHEN v_status='PL_D2_INDISPONIVEL' THEN 'EXPOSICAO_PL_INDISPONIVEL'
         WHEN v_status='PL_OFICIAL_INDISPONIVEL' THEN 'EXPOSICAO_PL_OFICIAL_INDISPONIVEL'
         WHEN v_reprocessamento THEN 'EXPOSICAO_RECALCULADA' ELSE 'EXPOSICAO_CALCULADA' END,
    'exposicao_execucoes',v_execucao_id,
    jsonb_build_object('fundo_id',v_fundo_id,'data_operacional',p_payload->>'data_operacional','status',v_status,
      'regra_versao','RLX_EXPOSICAO_V1','correlation_id',p_payload->>'correlation_id'),
    'sistema','financeiro_exposicao',p_payload->>'criado_por',clock_timestamp()
  );
  RETURN v_execucao_id;
END;
$$;

COMMIT;
