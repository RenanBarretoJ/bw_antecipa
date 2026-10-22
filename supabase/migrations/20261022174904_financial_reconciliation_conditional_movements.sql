-- New rule only. No historical execution, source row, RLS policy or grant is rewritten.
ALTER TABLE public.conciliacao_execucoes DROP CONSTRAINT conciliacao_execucoes_regra_check;
ALTER TABLE public.conciliacao_execucoes ADD CONSTRAINT conciliacao_execucoes_regra_check
  CHECK(regra_versao IN ('RLX_RECON_V1','FIN_RECON_V2'));
-- Read-only/RLS invoker: comparison is performed on published native/legacy projections.
CREATE FUNCTION public.diagnosticar_variacao_estoques(
  p_fundo_id uuid, p_estoque_d2_id uuid, p_estoque_d1_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_d2 public.importacoes_financeiras%ROWTYPE;
  v_d1 public.importacoes_financeiras%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_d2 FROM public.importacoes_financeiras WHERE id=p_estoque_d2_id AND fundo_id=p_fundo_id;
  SELECT * INTO v_d1 FROM public.importacoes_financeiras WHERE id=p_estoque_d1_id AND fundo_id=p_fundo_id;
  IF v_d2.id IS NULL OR v_d1.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Estoques nao disponiveis no Fundo autorizado';
  END IF;
  IF v_d2.tipo_base<>'ESTOQUE' OR v_d1.tipo_base<>'ESTOQUE'
    OR v_d2.status<>'PUBLICADA' OR v_d1.status<>'PUBLICADA'
    OR v_d2.completude NOT IN ('COMPLETO_COM_DADOS','COMPLETO_VAZIO')
    OR v_d1.completude NOT IN ('COMPLETO_COM_DADOS','COMPLETO_VAZIO')
    OR v_d2.data_referencia>=v_d1.data_referencia
    OR v_d2.provedor IS DISTINCT FROM v_d1.provedor
    OR v_d2.fonte_ambiente IS DISTINCT FROM v_d1.fonte_ambiente
    OR v_d2.fonte_carteira IS DISTINCT FROM v_d1.fonte_carteira THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Estoques completos, datas e fonte compativeis sao obrigatorios';
  END IF;
  WITH raw AS (
    SELECT s.*, pg_catalog.jsonb_build_array(s.provedor,
      pg_catalog.regexp_replace(COALESCE(s.cedente_documento,''),'[^0-9]','','g'),
      COALESCE(NULLIF(s.external_title_key,''),NULLIF(s.id_recebivel,''),NULLIF(s.seu_numero,'')))::text AS chave
    FROM public.estoque_fontes_leitura s
    WHERE s.fundo_id=p_fundo_id AND s.importacao_id IN (p_estoque_d2_id,p_estoque_d1_id)
  ), rows AS (
    SELECT r.*, count(*) OVER (PARTITION BY r.importacao_id,r.chave) AS repeticoes FROM raw r
  ), d2 AS (SELECT * FROM rows WHERE importacao_id=p_estoque_d2_id),
  d1 AS (SELECT * FROM rows WHERE importacao_id=p_estoque_d1_id),
  delta AS (
    SELECT a.id AS id_d2,b.id AS id_d1,a.valor_nominal AS principal_d2,b.valor_nominal AS principal_d1
    FROM d2 a FULL JOIN d1 b ON a.chave=b.chave
  ), stats AS (
    SELECT count(*) FILTER(WHERE id_d2 IS NULL) AS entradas,
      count(*) FILTER(WHERE id_d1 IS NULL) AS saidas,
      count(*) FILTER(WHERE principal_d1<principal_d2) AS reducoes,
      count(*) FILTER(WHERE principal_d1>principal_d2) AS aumentos
    FROM delta
  ), invalid AS (
    SELECT count(*) AS n FROM rows WHERE repeticoes<>1 OR valor_nominal IS NULL
      OR valor_nominal<0 OR valor_nominal::text IN ('NaN','Infinity','-Infinity')
      OR COALESCE(cedente_documento,'')='' OR provedor IS DISTINCT FROM v_d1.provedor
      OR COALESCE(NULLIF(external_title_key,''),NULLIF(id_recebivel,''),NULLIF(seu_numero,'')) IS NULL
  )
  SELECT pg_catalog.jsonb_build_object(
    'regraVersao','FIN_RECON_V2', 'estoqueD2ImportacaoId',p_estoque_d2_id,'estoqueD1ImportacaoId',p_estoque_d1_id,
    'entradas',s.entradas,'saidas',s.saidas,'reducoes',s.reducoes,'aumentos',s.aumentos,
    'invalidas',i.n + CASE WHEN (SELECT count(*) FROM d2)<>v_d2.linhas_publicadas
      OR (SELECT count(*) FROM d1)<>v_d1.linhas_publicadas THEN 1 ELSE 0 END,
    'exigeAquisicoes',s.entradas>0 OR s.aumentos>0,
    'exigeLiquidacoes',s.saidas>0 OR s.reducoes>0,
    'estoquesEquivalentes',s.entradas=0 AND s.saidas=0 AND s.reducoes=0 AND s.aumentos=0
  ) INTO v_result FROM stats s CROSS JOIN invalid i;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.diagnosticar_variacao_estoques(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnosticar_variacao_estoques(uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.persistir_conciliacao_execucao(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_status text := p_payload ->> 'status';
  v_bootstrap boolean := coalesce((p_payload ->> 'bootstrap')::boolean, false);
  v_diagnostico jsonb;
  v_d2_date date;
  v_d1 public.importacoes_financeiras%ROWTYPE;
  v_declared uuid[];
  v_movement public.importacoes_financeiras%ROWTYPE;
  v_id uuid;
  v_tipo text;
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

  IF p_payload->>'regra_versao'='FIN_RECON_V2' AND NOT v_bootstrap AND v_status<>'BASE_INCOMPLETA' THEN
    -- Stable lock ordering: source headers cannot be retified while the proof is persisted.
    PERFORM 1 FROM public.importacoes_financeiras WHERE id=ANY(v_inputs) ORDER BY id FOR SHARE;
    v_declared:=ARRAY(SELECT x FROM unnest(ARRAY[
      NULLIF(p_payload->>'estoque_d2_importacao_id','')::uuid,
      NULLIF(p_payload->>'estoque_d1_importacao_id','')::uuid,
      NULLIF(p_payload->>'aquisicoes_d1_importacao_id','')::uuid,
      NULLIF(p_payload->>'liquidacoes_d1_importacao_id','')::uuid
    ]) x WHERE x IS NOT NULL ORDER BY x);
    IF cardinality(v_declared)<>cardinality(v_inputs)
      OR v_declared IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_inputs) x ORDER BY x) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Inputs da conciliacao devem coincidir com as bases declaradas';
    END IF;
    v_diagnostico:=public.diagnosticar_variacao_estoques(v_fundo_id,
      NULLIF(p_payload->>'estoque_d2_importacao_id','')::uuid,
      NULLIF(p_payload->>'estoque_d1_importacao_id','')::uuid);
    IF (v_diagnostico->>'invalidas')::integer<>0 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Chaves, saldos ou cobertura do estoque invalidos';
    END IF;
    SELECT * INTO v_d1 FROM public.importacoes_financeiras WHERE id=(p_payload->>'estoque_d1_importacao_id')::uuid;
    IF v_d1.data_referencia IS DISTINCT FROM (p_payload->>'data_referencia')::date THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Estoque D-1 fora da data de conciliacao';
    END IF;
    v_d2_date:=v_d1.data_referencia-1;
    WHILE NOT private.eh_dia_util_anbima(v_d2_date) LOOP v_d2_date:=v_d2_date-1; END LOOP;
    IF NOT EXISTS(SELECT 1 FROM public.importacoes_financeiras WHERE id=(p_payload->>'estoque_d2_importacao_id')::uuid AND data_referencia=v_d2_date) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Estoque D-2 fora do dia util anterior';
    END IF;
    IF ((v_diagnostico->>'exigeAquisicoes')::boolean AND NULLIF(p_payload->>'aquisicoes_d1_importacao_id','') IS NULL)
      OR ((v_diagnostico->>'exigeLiquidacoes')::boolean AND NULLIF(p_payload->>'liquidacoes_d1_importacao_id','') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Movimentacao no estoque exige relatorio compativel';
    END IF;
    FOR v_id,v_tipo IN SELECT * FROM (VALUES
      (NULLIF(p_payload->>'aquisicoes_d1_importacao_id','')::uuid,'AQUISICOES'),
      (NULLIF(p_payload->>'liquidacoes_d1_importacao_id','')::uuid,'LIQUIDACOES')) q(id,tipo) WHERE id IS NOT NULL
    LOOP
      SELECT * INTO v_movement FROM public.importacoes_financeiras WHERE id=v_id;
      IF v_movement.id IS NULL OR v_movement.fundo_id<>v_fundo_id OR v_movement.tipo_base<>v_tipo
        OR v_movement.status<>'PUBLICADA' OR v_movement.completude NOT IN ('COMPLETO_COM_DADOS','COMPLETO_VAZIO')
        OR v_movement.data_referencia<>v_d1.data_referencia OR v_movement.provedor IS DISTINCT FROM v_d1.provedor
        OR v_movement.fonte_ambiente IS DISTINCT FROM v_d1.fonte_ambiente
        OR v_movement.fonte_carteira IS DISTINCT FROM v_d1.fonte_carteira THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Relatorio de movimentacao fora do Fundo, fonte, data ou completude';
      END IF;
    END LOOP;
    IF EXISTS(
      SELECT jsonb_build_array(s.provedor,regexp_replace(COALESCE(s.cedente_documento,''),'[^0-9]','','g'),
        COALESCE(NULLIF(s.external_title_key,''),NULLIF(s.id_recebivel,''),NULLIF(s.seu_numero,'')))
      FROM public.estoque_fontes_leitura s WHERE s.fundo_id=v_fundo_id AND s.importacao_id=ANY(v_declared)
      EXCEPT SELECT (r->>'identidade_externa')::jsonb FROM jsonb_array_elements(COALESCE(p_payload->'resultados','[]'::jsonb)) r
    ) OR (SELECT count(*)<>count(DISTINCT r->>'identidade_externa')
      FROM jsonb_array_elements(COALESCE(p_payload->'resultados','[]'::jsonb)) r) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resultados nao cobrem as chaves de estoque ou contem duplicidade';
    END IF;
    IF NULLIF(p_payload->>'aquisicoes_d1_importacao_id','') IS NULL AND NULLIF(p_payload->>'liquidacoes_d1_importacao_id','') IS NULL
      AND EXISTS(
        SELECT (r->>'identidade_externa')::jsonb FROM jsonb_array_elements(COALESCE(p_payload->'resultados','[]'::jsonb)) r
        EXCEPT SELECT jsonb_build_array(s.provedor,regexp_replace(COALESCE(s.cedente_documento,''),'[^0-9]','','g'),
          COALESCE(NULLIF(s.external_title_key,''),NULLIF(s.id_recebivel,''),NULLIF(s.seu_numero,'')))
        FROM public.estoque_fontes_leitura s WHERE s.fundo_id=v_fundo_id AND s.importacao_id=ANY(v_declared)
      ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resultado sem origem nos estoques comparados'; END IF;
    p_payload:=jsonb_set(p_payload,'{contagens}',COALESCE((SELECT jsonb_object_agg(status,n) FROM (
      SELECT r->>'status' status,count(*) n FROM jsonb_array_elements(COALESCE(p_payload->'resultados','[]'::jsonb)) r GROUP BY r->>'status'
    ) c),'{}'::jsonb));
    -- Never trust a client-side waiver or fabricate import IDs/zero movement declarations.
    p_payload:=jsonb_set(p_payload,'{detalhes}',COALESCE(p_payload->'detalhes','{}'::jsonb)||
      jsonb_build_object('diagnostico_estoques',v_diagnostico,'dispensa_por_comparacao_estoques',
        NULLIF(p_payload->>'aquisicoes_d1_importacao_id','') IS NULL OR NULLIF(p_payload->>'liquidacoes_d1_importacao_id','') IS NULL,
        'integral',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'resultados','[]'::jsonb)) r
          WHERE r->>'status' NOT IN ('MANTIDO_CORRETO','ENTRADA_INCORPORADA','SAIDA_REFLETIDA','LIQUIDACAO_PARCIAL_SALDO'))));
  ELSE
  IF v_status <> 'BASE_INCOMPLETA' AND NOT v_bootstrap AND (
    SELECT count(*) FROM public.importacoes_financeiras i
    WHERE i.id = ANY(v_inputs) AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
      AND i.completude IN ('COMPLETO_COM_DADOS', 'COMPLETO_VAZIO')
  ) <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs publicados/completos da conciliacao sao invalidos';
  END IF;
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
$function$;
