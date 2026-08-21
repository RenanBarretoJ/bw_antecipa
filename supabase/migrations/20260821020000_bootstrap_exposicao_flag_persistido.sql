BEGIN;

-- P0/P1 (bootstrap fundo virgem): a coluna exposicao_execucoes.bootstrap
-- (criada na mesma entrega, 20260821000000) nunca era de fato gravada pelo
-- persistir_exposicao_execucao -- confirmado ao vivo em homologacao (fundo
-- QA BOOTSTRAP FUNDO VIRGEM FIDC, execucao CALCULADA via bootstrap ficou com
-- bootstrap=false, apesar de status/patrimonio_liquido_d2 corretos). Corpo
-- integralmente reproduzido da versao vigente; unica alteracao e ler
-- p_payload->>'bootstrap' e grava-lo na insercao.

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
