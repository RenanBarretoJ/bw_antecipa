-- P2.4 - snapshot historico da posicao financeira por situacao logistica.
-- A classificacao e calculada pela aplicacao com RLX_LOGISTICA_V1 e persistida
-- por uma unica RPC service-role. Matching e reconciliacao P2.3 permanecem intactos.

CREATE TABLE public.rlx_posicao_logistica_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  data_referencia date NOT NULL,
  estoque_importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id),
  matching_execucao_id uuid NOT NULL REFERENCES public.rlx_matching_execucoes(id),
  regra_versao text NOT NULL DEFAULT 'RLX_LOGISTICA_V1'
    CHECK (regra_versao = 'RLX_LOGISTICA_V1'),
  logistica_as_of timestamptz NOT NULL,
  fingerprint_logistico text NOT NULL CHECK (length(fingerprint_logistico) = 64),
  assinatura_execucao text NOT NULL CHECK (length(assinatura_execucao) = 64),
  status text NOT NULL DEFAULT 'PROCESSANDO'
    CHECK (status IN ('PROCESSANDO', 'CONCLUIDA', 'BASE_INCOMPLETA', 'FALHA')),
  total_posicoes integer NOT NULL DEFAULT 0 CHECK (total_posicoes >= 0),
  posicoes_matched integer NOT NULL DEFAULT 0 CHECK (posicoes_matched >= 0),
  posicoes_sem_match integer NOT NULL DEFAULT 0 CHECK (posicoes_sem_match >= 0),
  posicoes_entregues integer NOT NULL DEFAULT 0 CHECK (posicoes_entregues >= 0),
  posicoes_em_transito integer NOT NULL DEFAULT 0 CHECK (posicoes_em_transito >= 0),
  posicoes_indeterminadas integer NOT NULL DEFAULT 0 CHECK (posicoes_indeterminadas >= 0),
  posicoes_valor_ausente integer NOT NULL DEFAULT 0 CHECK (posicoes_valor_ausente >= 0),
  valor_total_aquisicao numeric(24,2),
  valor_matched numeric(24,2),
  valor_sem_match numeric(24,2),
  valor_entregue numeric(24,2),
  valor_em_transito numeric(24,2),
  valor_indeterminado numeric(24,2),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_por uuid REFERENCES public.profiles(id),
  iniciado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_posicao_logistica_execucoes_assinatura_unique
    UNIQUE (fundo_id, assinatura_execucao)
);

CREATE TABLE public.rlx_posicao_logistica_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.rlx_posicao_logistica_execucoes(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  estoque_importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id),
  estoque_posicao_id uuid NOT NULL REFERENCES public.rlx_estoque_posicoes(id),
  matching_resultado_id uuid NOT NULL REFERENCES public.rlx_matching_resultados(id),
  matching_status text NOT NULL
    CHECK (matching_status IN ('MATCH_FORTE', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO')),
  matching_metodo text NOT NULL,
  status_vinculo text NOT NULL
    CHECK (status_vinculo IN ('MATCHED_FINANCEIRO_NF', 'SEM_MATCH_FINANCEIRO_NF')),
  vinculo_id uuid REFERENCES public.rlx_titulo_nf_vinculos(id),
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id),
  status_logistico text
    CHECK (status_logistico IN ('ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA')),
  id_recebivel text,
  seu_numero text,
  numero_documento text,
  cedente_nome text,
  cedente_documento text,
  sacado_nome text,
  sacado_documento text,
  data_vencimento date,
  valor_nominal numeric(24,2),
  valor_aquisicao numeric(24,2),
  valor_aquisicao_qualidade text NOT NULL
    CHECK (valor_aquisicao_qualidade IN ('PRESENTE', 'AUSENTE')),
  nf_compartilhada_entre_posicoes boolean NOT NULL DEFAULT false,
  evidencia_familia text CHECK (evidencia_familia IN ('cte', 'comprovante_entrega')),
  documento_id uuid REFERENCES public.documentos_repositorio(id),
  documento_versao_id uuid REFERENCES public.documento_versoes(id),
  documento_analise_id uuid REFERENCES public.documento_analises(id),
  fundamento text NOT NULL,
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_posicao_logistica_resultados_posicao_unique UNIQUE (execucao_id, estoque_posicao_id),
  CONSTRAINT rlx_posicao_logistica_resultados_coerencia CHECK (
    (status_vinculo = 'SEM_MATCH_FINANCEIRO_NF' AND nota_fiscal_id IS NULL AND status_logistico IS NULL)
    OR
    (status_vinculo = 'MATCHED_FINANCEIRO_NF' AND nota_fiscal_id IS NOT NULL AND status_logistico IS NOT NULL)
  )
);

CREATE INDEX rlx_posicao_logistica_execucoes_lista_idx
  ON public.rlx_posicao_logistica_execucoes (fundo_id, data_referencia DESC, created_at DESC);
CREATE INDEX rlx_posicao_logistica_execucoes_fontes_idx
  ON public.rlx_posicao_logistica_execucoes (fundo_id, estoque_importacao_id, matching_execucao_id);
CREATE INDEX rlx_posicao_logistica_resultados_lista_idx
  ON public.rlx_posicao_logistica_resultados (fundo_id, execucao_id, status_logistico, criado_em DESC);
CREATE INDEX rlx_posicao_logistica_resultados_matching_idx
  ON public.rlx_posicao_logistica_resultados (fundo_id, execucao_id, matching_status);
CREATE INDEX rlx_posicao_logistica_resultados_nf_idx
  ON public.rlx_posicao_logistica_resultados (fundo_id, nota_fiscal_id);
CREATE INDEX rlx_posicao_logistica_resultados_filtros_idx
  ON public.rlx_posicao_logistica_resultados (fundo_id, execucao_id, data_vencimento, cedente_documento, sacado_documento);

CREATE OR REPLACE FUNCTION private.rlx_p2_4_finalizar_execucao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Execucoes historicas P2.4 nao podem ser excluidas';
  END IF;
  IF OLD.status <> 'PROCESSANDO' OR NEW.status = 'PROCESSANDO'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
     OR NEW.data_referencia IS DISTINCT FROM OLD.data_referencia
     OR NEW.estoque_importacao_id IS DISTINCT FROM OLD.estoque_importacao_id
     OR NEW.matching_execucao_id IS DISTINCT FROM OLD.matching_execucao_id
     OR NEW.regra_versao IS DISTINCT FROM OLD.regra_versao
     OR NEW.logistica_as_of IS DISTINCT FROM OLD.logistica_as_of
     OR NEW.fingerprint_logistico IS DISTINCT FROM OLD.fingerprint_logistico
     OR NEW.assinatura_execucao IS DISTINCT FROM OLD.assinatura_execucao
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Execucao P2.4 finalizada e imutavel';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rlx_posicao_logistica_execucoes_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_posicao_logistica_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_4_finalizar_execucao();
CREATE TRIGGER rlx_posicao_logistica_resultados_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_posicao_logistica_resultados
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_bloquear_mutacao_historica();

ALTER TABLE public.rlx_posicao_logistica_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_posicao_logistica_resultados ENABLE ROW LEVEL SECURITY;

CREATE POLICY rlx_posicao_logistica_execucoes_gestor_select
  ON public.rlx_posicao_logistica_execucoes FOR SELECT TO authenticated
  USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_posicao_logistica_resultados_gestor_select
  ON public.rlx_posicao_logistica_resultados FOR SELECT TO authenticated
  USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));

REVOKE ALL ON TABLE public.rlx_posicao_logistica_execucoes, public.rlx_posicao_logistica_resultados
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rlx_posicao_logistica_execucoes, public.rlx_posicao_logistica_resultados
  TO authenticated;
GRANT ALL ON TABLE public.rlx_posicao_logistica_execucoes, public.rlx_posicao_logistica_resultados
  TO service_role;

CREATE OR REPLACE FUNCTION public.rlx_persistir_posicao_logistica_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_estoque_id uuid := (p_payload ->> 'estoque_importacao_id')::uuid;
  v_matching_id uuid := (p_payload ->> 'matching_execucao_id')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_data_referencia date;
  v_total_estoque integer;
  v_total_payload integer;
  v_reprocessamento boolean;
BEGIN
  IF NOT private.rlx_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia logistica restrita ao processador interno';
  END IF;
  IF v_fundo_id IS NULL OR v_estoque_id IS NULL OR v_matching_id IS NULL
     OR p_payload ->> 'regra_versao' <> 'RLX_LOGISTICA_V1'
     OR coalesce(p_payload ->> 'assinatura_execucao', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 invalido';
  END IF;

  SELECT i.data_referencia INTO v_data_referencia
  FROM public.rlx_importacoes_financeiras i
  WHERE i.id = v_estoque_id AND i.fundo_id = v_fundo_id
    AND i.tipo_base = 'ESTOQUE' AND i.status = 'PUBLICADA';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Estoque publicado incompativel com o fundo';
  END IF;
  IF v_data_referencia IS DISTINCT FROM (p_payload ->> 'data_referencia')::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Data de referencia incompativel com o Estoque publicado';
  END IF;

  SELECT count(*)::integer INTO v_total_estoque
  FROM public.rlx_estoque_posicoes p
  WHERE p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id;
  v_total_payload := jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb));
  IF v_total_payload <> v_total_estoque THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 nao cobre integralmente o Estoque publicado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'rlx-logistica:' || v_fundo_id::text || ':' || v_estoque_id::text, 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.rlx_posicao_logistica_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rlx_matching_execucoes m
    WHERE m.id = v_matching_id AND m.fundo_id = v_fundo_id
      AND m.status = 'CONCLUIDA' AND v_estoque_id = ANY(m.input_import_ids)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Matching incompativel com o estoque publicado';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rlx_posicao_logistica_execucoes e
    WHERE e.fundo_id = v_fundo_id
      AND e.estoque_importacao_id = v_estoque_id
      AND e.matching_execucao_id = v_matching_id
  ) INTO v_reprocessamento;

  INSERT INTO public.rlx_posicao_logistica_execucoes (
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
      SELECT 1 FROM public.rlx_estoque_posicoes p
      WHERE p.id = (v_item ->> 'estoque_posicao_id')::uuid
        AND p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Posicao de estoque fora da base P2.4';
    END IF;
    IF nullif(v_item ->> 'matching_resultado_id', '') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.rlx_matching_resultados r
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

    INSERT INTO public.rlx_posicao_logistica_resultados (
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

  UPDATE public.rlx_posicao_logistica_execucoes e SET
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
    FROM public.rlx_posicao_logistica_resultados WHERE execucao_id = v_execucao_id
  ) a WHERE e.id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador, created_at
  ) VALUES (
    CASE
      WHEN coalesce(p_payload ->> 'status', 'CONCLUIDA') = 'BASE_INCOMPLETA'
        THEN 'RLX_POSICAO_LOGISTICA_BASE_INCOMPLETA'
      WHEN v_reprocessamento THEN 'RLX_POSICAO_LOGISTICA_REPROCESSADA'
      ELSE 'RLX_POSICAO_LOGISTICA_EXECUTADA'
    END,
    'rlx_posicao_logistica_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'regra_versao', 'RLX_LOGISTICA_V1', 'correlation_id', p_payload ->> 'correlation_id'),
    'sistema', 'rlx_p2_4', p_payload ->> 'criado_por', clock_timestamp()
  );

  RETURN v_execucao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rlx_persistir_posicao_logistica_execucao(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlx_persistir_posicao_logistica_execucao(jsonb) TO service_role;
