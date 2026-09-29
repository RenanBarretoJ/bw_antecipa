-- P17: dias reais / 30 para o enum TRINTA_360. Sem DML de backfill.
-- Politicas/propostas/memorias historicas permanecem intactas.
-- Corpos canonicos preservados; somente day-count e metadados de versao alterados.
BEGIN;

CREATE OR REPLACE FUNCTION private.calcular_memoria_financeira_nf(
  p_nota_fiscal_id uuid,
  p_valor_nominal numeric,
  p_taxa_mensal numeric,
  p_data_base date,
  p_vencimento date,
  p_metodo text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  vencimento_calculo date := p_vencimento;
  cursor_data date;
  dias_corridos integer := p_vencimento - p_data_base;
  dias_uteis integer;
  dias_financeiros integer;
  dias_aplicados integer;
  base_calculo integer;
  expoente numeric;
  fator numeric;
  valor_presente numeric;
  desconto numeric;
  calendario text;
BEGIN
  IF dias_corridos < 0 THEN
    RAISE EXCEPTION 'A NF esta vencida e nao pode ser incluida na operacao';
  END IF;
  IF p_valor_nominal <= 0 OR p_taxa_mensal < 0 THEN
    RAISE EXCEPTION 'Parametros financeiros invalidos';
  END IF;
  IF p_metodo NOT IN (
    'LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365'
  ) THEN
    RAISE EXCEPTION 'Metodo de calculo financeiro invalido';
  END IF;

  IF p_metodo = 'DIAS_UTEIS_252' THEN
    WHILE NOT private.eh_dia_util_anbima(vencimento_calculo) LOOP
      vencimento_calculo := vencimento_calculo + 1;
    END LOOP;
    dias_uteis := 0;
    cursor_data := p_data_base + 1;
    WHILE cursor_data <= vencimento_calculo LOOP
      IF private.eh_dia_util_anbima(cursor_data) THEN
        dias_uteis := dias_uteis + 1;
      END IF;
      cursor_data := cursor_data + 1;
    END LOOP;
    dias_aplicados := dias_uteis;
    base_calculo := 252;
    expoente := dias_aplicados::numeric / 21;
    calendario := 'ANBIMA';
  ELSIF p_metodo = 'TRINTA_360' THEN
    -- P17 v2: taxa mensal, dias civis reais / 30 (nao ACT/360 anual).
    dias_aplicados := dias_corridos;
    base_calculo := 360;
    expoente := dias_aplicados::numeric / 30;
  ELSIF p_metodo = 'DIAS_CORRIDOS_365' THEN
    dias_aplicados := dias_corridos;
    base_calculo := 365;
    expoente := 12 * dias_aplicados::numeric / 365;
  ELSE
    dias_aplicados := dias_corridos;
    base_calculo := 30;
    expoente := dias_aplicados::numeric / 30;
  END IF;

  fator := power(1 + (p_taxa_mensal / 100), expoente);
  valor_presente := round(p_valor_nominal / fator, 2);
  desconto := round(p_valor_nominal - valor_presente, 2);

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'valor_nominal', p_valor_nominal,
    'taxa_mensal', p_taxa_mensal,
    'data_base', p_data_base,
    'vencimento_contratual', p_vencimento,
    'vencimento_calculo', vencimento_calculo,
    'metodo', p_metodo,
    'base', base_calculo,
    'calendario', calendario,
    'dias_corridos_reais', dias_corridos,
    'dias_uteis', dias_uteis,
    'dias_financeiros', dias_financeiros,
    'dias', dias_aplicados,
    'expoente', expoente,
    'fator', fator,
    'valor_presente', valor_presente,
    'desconto', desconto,
    'arredondamento', 'ROUND_HALF_UP_2_CASAS',
    'versao_motor', CASE WHEN p_metodo = 'TRINTA_360' THEN 2 ELSE 1 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preparar_contexto_calculo_nova_operacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  metodo_snapshot text := NEW.politica_snapshot #>> '{calculo_financeiro,metodo}';
  metodo_versao text;
BEGIN
  IF NEW.politica_operacional_versao_id IS NOT NULL THEN
    SELECT pov.metodo_calculo_financeiro
    INTO metodo_versao
    FROM public.politica_operacional_versoes pov
    WHERE pov.id = NEW.politica_operacional_versao_id;
  END IF;

  IF metodo_versao IS NOT NULL AND metodo_snapshot IS DISTINCT FROM metodo_versao THEN
    RAISE EXCEPTION 'Metodo financeiro do snapshot diverge da versao da politica';
  END IF;

  NEW.metodo_calculo_financeiro := coalesce(metodo_snapshot, 'LEGADO_MENSAL_DIAS_REAIS_30');
  NEW.calculo_data_base := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  NEW.calculo_versao_motor := CASE WHEN NEW.metodo_calculo_financeiro = 'TRINTA_360' THEN 2 ELSE 1 END;
  IF NEW.taxa_desconto IS NULL THEN
    NEW.valor_liquido_desembolso := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica_financeiro_v1(
  p_operacao_id uuid, p_taxa_desconto numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid(); actor_role text := public.get_user_role();
  op record; nf record; parcela record; memoria jsonb; metodo text;
  data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  fundo_id_operacao uuid; v_valor_bruto_total numeric := 0; valor_liquido_total numeric := 0;
  desconto_total numeric := 0; prazo_ponderado numeric := 0; prazo_medio integer := 0;
  prazo_referencia integer := 0; vencimento_maximo date; nfs_count integer := 0;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao'; END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN RAISE EXCEPTION 'Taxa mensal invalida'; END IF;

  SELECT o.*, cf.fundo_id INTO op FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id WHERE o.id = p_operacao_id FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  fundo_id_operacao := op.fundo_id;
  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao'; END IF;

  IF op.status = 'aprovada' THEN
    RETURN jsonb_build_object('operacao_id', op.id, 'idempotent_replay', true, 'status', op.status,
      'valor_liquido_desembolso', op.valor_liquido_desembolso,
      'metodo_calculo_financeiro', coalesce(op.metodo_calculo_financeiro, 'LEGADO_MENSAL_DIAS_REAIS_30'),
      'data_base', op.calculo_data_base);
  END IF;
  IF op.status NOT IN ('solicitada', 'em_analise') THEN RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', op.status; END IF;
  IF op.contexto_configuracao_status = 'completo' AND (
    op.cedente_fundo_id IS NULL OR op.politica_operacional_versao_id IS NULL OR op.politica_snapshot IS NULL
  ) THEN RAISE EXCEPTION 'Operacao sem contexto operacional completo'; END IF;

  metodo := coalesce(op.metodo_calculo_financeiro, op.politica_snapshot #>> '{calculo_financeiro,metodo}', 'LEGADO_MENSAL_DIAS_REAIS_30');
  IF metodo NOT IN ('LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365') THEN
    RAISE EXCEPTION 'Metodo financeiro congelado na operacao e invalido';
  END IF;

  DELETE FROM public.operacao_calculo_nfs WHERE operacao_id = p_operacao_id;

  -- NFs SEM parcelas vinculadas a esta operacao: comportamento legado
  -- inalterado -- 1 linha de memoria por NF, usando o valor/vencimento
  -- agregado da NF inteira.
  FOR nf IN
    SELECT n.* FROM public.operacoes_nfs onf JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
      AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = n.id)
    ORDER BY n.id FOR UPDATE OF n
  LOOP
    IF nf.cedente_id <> op.cedente_id OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id
       OR nf.fundo_id IS DISTINCT FROM fundo_id_operacao THEN RAISE EXCEPTION 'NF fora do contexto da operacao'; END IF;
    IF nf.status NOT IN ('em_antecipacao', 'aceita') THEN RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf; END IF;

    memoria := private.calcular_memoria_financeira_nf(nf.id, nf.valor_bruto, p_taxa_desconto, data_base, nf.data_vencimento, metodo);

    INSERT INTO public.operacao_calculo_nfs (
      operacao_id, nota_fiscal_id, parcela_id, fundo_id, cedente_id, metodo_calculo_financeiro, valor_nominal, taxa_mensal,
      data_base, vencimento_contratual, vencimento_calculo, base_calculo, calendario, dias_corridos_reais,
      dias_uteis, dias_financeiros, dias_aplicados, expoente, fator, valor_presente, desconto,
      regra_arredondamento, versao_motor
    ) VALUES (
      op.id, nf.id, NULL, fundo_id_operacao, op.cedente_id, metodo, (memoria->>'valor_nominal')::numeric, p_taxa_desconto,
      data_base, (memoria->>'vencimento_contratual')::date, (memoria->>'vencimento_calculo')::date,
      (memoria->>'base')::integer, memoria->>'calendario', (memoria->>'dias_corridos_reais')::integer,
      (memoria->>'dias_uteis')::integer, (memoria->>'dias_financeiros')::integer, (memoria->>'dias')::integer,
      (memoria->>'expoente')::numeric, (memoria->>'fator')::numeric, (memoria->>'valor_presente')::numeric,
      (memoria->>'desconto')::numeric, memoria->>'arredondamento', (memoria->>'versao_motor')::integer
    );

    v_valor_bruto_total := v_valor_bruto_total + (memoria->>'valor_nominal')::numeric;
    valor_liquido_total := valor_liquido_total + (memoria->>'valor_presente')::numeric;
    desconto_total := desconto_total + (memoria->>'desconto')::numeric;
    prazo_ponderado := prazo_ponderado + ((memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric);
    prazo_referencia := greatest(prazo_referencia, (memoria->>'dias')::integer);
    vencimento_maximo := greatest(vencimento_maximo, nf.data_vencimento);
    nfs_count := nfs_count + 1;
  END LOOP;

  -- NOVO: parcelas cedidas nesta operacao (NFs com parcelas) -- 1 linha de
  -- memoria POR PARCELA, usando o valor/vencimento proprio de cada uma
  -- (VP_total = soma do VP de cada parcela pelo seu vencimento -- nao usa
  -- o ultimo vencimento para todo o valor).
  FOR parcela IN
    SELECT p.*, onp.nota_fiscal_id AS nf_id
    FROM public.operacoes_nf_parcelas onp
    JOIN public.nota_fiscal_parcelas p ON p.id = onp.parcela_id
    WHERE onp.operacao_id = p_operacao_id
    ORDER BY p.nota_fiscal_id, p.numero_parcela FOR UPDATE OF p
  LOOP
    SELECT * INTO nf FROM public.notas_fiscais WHERE id = parcela.nf_id;
    IF nf.cedente_id <> op.cedente_id OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id
       OR nf.fundo_id IS DISTINCT FROM fundo_id_operacao THEN RAISE EXCEPTION 'NF fora do contexto da operacao'; END IF;
    IF nf.status NOT IN ('em_antecipacao', 'aceita', 'aprovada') THEN RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf; END IF;

    memoria := private.calcular_memoria_financeira_nf(nf.id, parcela.valor_nominal, p_taxa_desconto, data_base, parcela.data_vencimento, metodo);

    INSERT INTO public.operacao_calculo_nfs (
      operacao_id, nota_fiscal_id, parcela_id, fundo_id, cedente_id, metodo_calculo_financeiro, valor_nominal, taxa_mensal,
      data_base, vencimento_contratual, vencimento_calculo, base_calculo, calendario, dias_corridos_reais,
      dias_uteis, dias_financeiros, dias_aplicados, expoente, fator, valor_presente, desconto,
      regra_arredondamento, versao_motor
    ) VALUES (
      op.id, nf.id, parcela.id, fundo_id_operacao, op.cedente_id, metodo, (memoria->>'valor_nominal')::numeric, p_taxa_desconto,
      data_base, (memoria->>'vencimento_contratual')::date, (memoria->>'vencimento_calculo')::date,
      (memoria->>'base')::integer, memoria->>'calendario', (memoria->>'dias_corridos_reais')::integer,
      (memoria->>'dias_uteis')::integer, (memoria->>'dias_financeiros')::integer, (memoria->>'dias')::integer,
      (memoria->>'expoente')::numeric, (memoria->>'fator')::numeric, (memoria->>'valor_presente')::numeric,
      (memoria->>'desconto')::numeric, memoria->>'arredondamento', (memoria->>'versao_motor')::integer
    );

    v_valor_bruto_total := v_valor_bruto_total + (memoria->>'valor_nominal')::numeric;
    valor_liquido_total := valor_liquido_total + (memoria->>'valor_presente')::numeric;
    desconto_total := desconto_total + (memoria->>'desconto')::numeric;
    prazo_ponderado := prazo_ponderado + ((memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric);
    prazo_referencia := greatest(prazo_referencia, (memoria->>'dias')::integer);
    vencimento_maximo := greatest(vencimento_maximo, parcela.data_vencimento);
    nfs_count := nfs_count + 1;
  END LOOP;

  IF nfs_count = 0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;
  IF op.taxa_proposta_consultor IS DISTINCT FROM p_taxa_desconto
     AND NOT EXISTS (
       SELECT 1
       FROM public.taxas_cedente tc
       WHERE tc.cedente_id = op.cedente_id
         AND tc.taxa_percentual = p_taxa_desconto
         AND prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max
     ) THEN
    RAISE EXCEPTION 'A taxa selecionada nao esta configurada para o prazo da operacao';
  END IF;

  prazo_medio := round(prazo_ponderado / v_valor_bruto_total);
  PERFORM pg_catalog.set_config('app.calculo_aprovacao', 'true', true);

  -- NOVO: agrega por NF (soma de valor_presente das linhas de memoria
  -- desta operacao -- 1 linha se legado, N se por parcela) para gravar
  -- valor_antecipado/taxa_desagio corretamente mesmo quando so parte das
  -- parcelas da NF estao nesta operacao.
  UPDATE public.notas_fiscais n
  SET taxa_desagio = p_taxa_desconto, valor_antecipado = agg.total_vp
  FROM (
    SELECT nota_fiscal_id, sum(valor_presente) AS total_vp
    FROM public.operacao_calculo_nfs
    WHERE operacao_id = p_operacao_id
    GROUP BY nota_fiscal_id
  ) agg
  WHERE n.id = agg.nota_fiscal_id;

  UPDATE public.operacoes SET
    taxa_desconto = p_taxa_desconto, prazo_dias = prazo_medio, valor_bruto_total = round(v_valor_bruto_total, 2),
    valor_liquido_desembolso = round(valor_liquido_total, 2), data_vencimento = vencimento_maximo,
    metodo_calculo_financeiro = metodo, calculo_data_base = data_base, calculo_versao_motor = (memoria->>'versao_motor')::integer,
    calculo_memoria = jsonb_build_object(
      'metodo', metodo, 'taxa_mensal', p_taxa_desconto, 'data_base', data_base,
      'valor_bruto_total', round(v_valor_bruto_total, 2), 'valor_liquido_total', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'prazo_medio', prazo_medio,
      'prazo_unidade', CASE metodo WHEN 'DIAS_UTEIS_252' THEN 'dias_uteis' ELSE 'dias_corridos' END,
      'vencimento_maximo', vencimento_maximo, 'quantidade_nfs', nfs_count,
      'previa_valor_liquido_solicitacao', op.valor_liquido_desembolso,
      'diferenca_previa_aprovacao', CASE WHEN op.valor_liquido_desembolso IS NULL THEN NULL ELSE round(valor_liquido_total - op.valor_liquido_desembolso, 2) END,
      'versao_motor', (memoria->>'versao_motor')::integer, 'arredondamento', 'ROUND_HALF_UP_2_CASAS'
    ),
    status = 'aprovada', aprovado_por = actor_id, aprovado_em = now()
  WHERE id = p_operacao_id AND status IN ('solicitada', 'em_analise');
  IF NOT FOUND THEN RAISE EXCEPTION 'A operacao foi alterada concorrentemente'; END IF;

  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois)
  VALUES (actor_id, 'OPERACAO_APROVADA', 'operacoes', p_operacao_id, jsonb_build_object('status', op.status),
    jsonb_build_object('status', 'aprovada', 'taxa_desconto', p_taxa_desconto, 'metodo_calculo_financeiro', metodo,
      'data_base', data_base, 'prazo_dias', prazo_medio, 'valor_liquido_desembolso', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'nfs', nfs_count));

  RETURN jsonb_build_object('operacao_id', p_operacao_id, 'idempotent_replay', false, 'status', 'aprovada',
    'prazo_dias', prazo_medio, 'valor_liquido_desembolso', round(valor_liquido_total, 2),
    'desconto_total', round(desconto_total, 2), 'metodo_calculo_financeiro', metodo, 'data_base', data_base, 'nfs', nfs_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  p_cedente_id uuid,
  p_cedente_fundo_id uuid,
  p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid,
  p_politica_versao integer,
  p_politica_snapshot jsonb,
  p_politica_snapshot_hash text,
  p_aceite_sacado_exigido boolean,
  p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[],
  p_taxa_proposta_consultor numeric,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_consultor_id uuid;
  v_metodo text;
  v_data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  v_item record;
  v_memoria jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_valor_bruto_total numeric := 0;
  v_valor_liquido_total numeric := 0;
  v_desconto_total numeric := 0;
  v_prazo_ponderado numeric := 0;
  v_prazo_medio integer := 0;
  v_prazo_referencia integer := 0;
  v_data_vencimento date;
  v_quantidade_itens integer := 0;
  v_quantidade_nfs integer := 0;
  v_snapshot jsonb;
  v_resultado jsonb;
  v_operacao_id uuid;
  v_operacao record;
  v_actor_nome text;
BEGIN
  IF v_actor_id IS NULL OR public.get_user_role()::text <> 'consultor' THEN
    RAISE EXCEPTION 'Somente Consultor autenticado pode propor taxa';
  END IF;
  IF p_taxa_proposta_consultor IS NULL OR p_taxa_proposta_consultor < 0 THEN
    RAISE EXCEPTION 'Taxa proposta invalida';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma NF';
  END IF;

  v_consultor_id := private.consultor_organizacao_ativa_do_usuario(v_actor_id);
  IF v_consultor_id IS NULL
     OR NOT private.consultor_usuario_pode_operar_cedente(v_actor_id, p_cedente_id) THEN
    RAISE EXCEPTION 'Consultor sem vinculo organizacional ativo com o Cedente informado';
  END IF;

  SELECT pov.metodo_calculo_financeiro
  INTO v_metodo
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundos cf
    ON cf.id = p_cedente_fundo_id
   AND cf.cedente_id = p_cedente_id
   AND cf.fundo_id = po.fundo_id
  WHERE pov.id = p_politica_operacional_versao_id
    AND po.id = p_politica_operacional_id
    AND pov.versao = p_politica_versao
  LIMIT 1;

  IF v_metodo IS NULL THEN
    RAISE EXCEPTION 'Versao da politica financeira nao pertence ao contexto informado';
  END IF;

  FOR v_item IN
    SELECT
      nf.id AS nota_fiscal_id,
      NULL::uuid AS parcela_id,
      nf.valor_bruto AS valor_nominal,
      nf.data_vencimento AS vencimento
    FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.nota_fiscal_parcelas p
        WHERE p.nota_fiscal_id = nf.id
      )

    UNION ALL

    SELECT
      nf.id AS nota_fiscal_id,
      p.id AS parcela_id,
      p.valor_nominal,
      p.data_vencimento AS vencimento
    FROM public.nota_fiscal_parcelas p
    JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
    WHERE p_parcela_ids IS NOT NULL
      AND p.id = ANY(p_parcela_ids)
      AND nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
    ORDER BY nota_fiscal_id, parcela_id NULLS FIRST
  LOOP
    v_memoria := private.calcular_memoria_financeira_nf(
      v_item.nota_fiscal_id,
      v_item.valor_nominal,
      p_taxa_proposta_consultor,
      v_data_base,
      v_item.vencimento,
      v_metodo
    );

    v_itens := v_itens || pg_catalog.jsonb_build_array(
      v_memoria || pg_catalog.jsonb_build_object('parcela_id', v_item.parcela_id)
    );
    v_valor_bruto_total := v_valor_bruto_total + (v_memoria->>'valor_nominal')::numeric;
    v_valor_liquido_total := v_valor_liquido_total + (v_memoria->>'valor_presente')::numeric;
    v_desconto_total := v_desconto_total + (v_memoria->>'desconto')::numeric;
    v_prazo_ponderado := v_prazo_ponderado
      + ((v_memoria->>'dias')::integer * (v_memoria->>'valor_nominal')::numeric);
    v_prazo_referencia := greatest(v_prazo_referencia, (v_memoria->>'dias')::integer);
    v_data_vencimento := greatest(v_data_vencimento, v_item.vencimento);
    v_quantidade_itens := v_quantidade_itens + 1;
  END LOOP;

  IF v_quantidade_itens = 0 OR v_valor_bruto_total <= 0 THEN
    RAISE EXCEPTION 'A selecao nao possui itens financeiros validos';
  END IF;

  SELECT count(DISTINCT item.nf_id)
  INTO v_quantidade_nfs
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);


  v_prazo_medio := pg_catalog.round(v_prazo_ponderado / v_valor_bruto_total);
  v_snapshot := pg_catalog.jsonb_build_object(
    'tipo', 'proposta_consultor',
    'taxa_mensal', p_taxa_proposta_consultor,
    'metodo', v_metodo,
    'data_base', v_data_base,
    'valor_nominal', pg_catalog.round(v_valor_bruto_total, 2),
    'desagio_estimado', pg_catalog.round(v_desconto_total, 2),
    'valor_liquido_estimado', pg_catalog.round(v_valor_liquido_total, 2),
    'prazo_medio', v_prazo_medio,
    'prazo_referencia', v_prazo_referencia,
    'quantidade_nfs', v_quantidade_nfs,
    'quantidade_itens', v_quantidade_itens,
    'itens', v_itens,
    'versao_motor', (v_memoria->>'versao_motor')::integer,
    'arredondamento', 'ROUND_HALF_UP_2_CASAS'
  );

  v_resultado := public.solicitar_operacao_antecipacao_atomica(
    p_cedente_id,
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    p_nota_fiscal_ids,
    pg_catalog.round(v_valor_bruto_total, 2),
    p_taxa_proposta_consultor,
    v_prazo_medio,
    pg_catalog.round(v_valor_liquido_total, 2),
    v_data_vencimento,
    p_idempotency_key,
    p_parcela_ids
  );

  v_operacao_id := (v_resultado->>'operacao_id')::uuid;
  IF coalesce((v_resultado->>'idempotent_replay')::boolean, false) THEN
    SELECT * INTO v_operacao
    FROM public.operacoes
    WHERE id = v_operacao_id;

    IF v_operacao.taxa_proposta_consultor IS DISTINCT FROM p_taxa_proposta_consultor
       OR v_operacao.taxa_proposta_por IS DISTINCT FROM v_actor_id
       OR v_operacao.taxa_proposta_consultor_id IS DISTINCT FROM v_consultor_id THEN
      RAISE EXCEPTION 'Replay idempotente diverge da proposta original';
    END IF;

    RETURN v_resultado || pg_catalog.jsonb_build_object(
      'taxa_proposta_consultor', v_operacao.taxa_proposta_consultor
    );
  END IF;

  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'true', true);
  UPDATE public.operacoes
  SET taxa_proposta_consultor = p_taxa_proposta_consultor,
      taxa_proposta_por = v_actor_id,
      taxa_proposta_consultor_id = v_consultor_id,
      taxa_proposta_em = pg_catalog.now(),
      calculo_proposta_memoria = v_snapshot
  WHERE id = v_operacao_id
    AND taxa_proposta_consultor IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel preservar a proposta do Consultor';
  END IF;
  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'false', true);

  SELECT p.nome_completo INTO v_actor_nome
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id,
    'TAXA_PROPOSTA_CONSULTOR',
    'operacoes',
    v_operacao_id,
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor,
      'calculo_proposta_memoria', v_snapshot
    )
  );

  INSERT INTO public.eventos_dominio (
    fundo_id, cedente_id, cedente_fundo_id, operacao_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    correlation_id, origem_evento, origem_registro_id
  )
  SELECT
    cf.fundo_id,
    p_cedente_id,
    p_cedente_fundo_id,
    v_operacao_id,
    'taxa_proposta_consultor',
    'operacao',
    v_actor_id,
    coalesce(v_actor_nome, 'Consultor'),
    'consultor',
    'c2_1_r2',
    'Taxa proposta pelo Consultor na solicitacao da operacao.',
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor
    ),
    'interno',
    'operacao:' || v_operacao_id::text,
    'c2_1_r2',
    v_operacao_id::text || ':proposta'
  FROM public.cedente_fundos cf
  WHERE cf.id = p_cedente_fundo_id;

  RETURN v_resultado || pg_catalog.jsonb_build_object(
    'taxa_proposta_consultor', p_taxa_proposta_consultor
  );
END;
$$;

-- Fluxo administrativo explicito de reparo P17, nao exposto via PostgREST.
-- SECURITY INVOKER + ACL postgres-only: nao cria bypass operacional de RLS.
-- Nao aprova, nao altera NF/proposta/politica, nao muda a data-base congelada.
CREATE OR REPLACE FUNCTION private.recalcular_previa_operacao_p17(
  p_operacao_id uuid, p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  op record; item record; memoria jsonb; antes jsonb; depois jsonb;
  itens jsonb := '[]'::jsonb;
  bruto numeric := 0; liquido numeric := 0; ponderado numeric := 0;
  prazo integer; quantidade integer := 0;
BEGIN
  SELECT o.*, cf.fundo_id INTO op FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF op.status NOT IN ('solicitada', 'em_analise') OR op.aprovado_em IS NOT NULL THEN
    RAISE EXCEPTION 'P17: historico financeiro nao pode ser recalculado';
  END IF;
  IF p_expected_updated_at IS NULL OR op.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'P17: operacao alterada desde o precheck';
  END IF;
  IF op.metodo_calculo_financeiro IS DISTINCT FROM 'TRINTA_360'
     OR op.calculo_data_base IS NULL OR op.taxa_desconto IS NULL THEN
    RAISE EXCEPTION 'P17: contexto de calculo inelegivel';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operacoes_nfs own_nf
    JOIN public.operacoes_nfs other_nf ON other_nf.nota_fiscal_id = own_nf.nota_fiscal_id
      AND other_nf.operacao_id <> own_nf.operacao_id
    JOIN public.operacoes other_op ON other_op.id = other_nf.operacao_id
    WHERE own_nf.operacao_id = op.id AND private.operacao_status_reserva_nf(other_op.status)) THEN
    RAISE EXCEPTION 'P17: NF com reserva ativa concorrente';
  END IF;
  -- Mesmo lock de NF usado pela aprovacao; garante entrada estavel durante o reparo.
  PERFORM 1 FROM public.notas_fiscais n JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id=n.id
    WHERE onf.operacao_id=op.id ORDER BY n.id FOR UPDATE OF n;
  PERFORM 1 FROM public.nota_fiscal_parcelas p JOIN public.operacoes_nf_parcelas onp ON onp.parcela_id=p.id
    WHERE onp.operacao_id=op.id ORDER BY p.id FOR UPDATE OF p;
  FOR item IN
    SELECT n.id AS nf_id, NULL::uuid AS parcela_id, n.valor_bruto AS nominal, n.data_vencimento AS vencimento
    FROM public.operacoes_nfs onf JOIN public.notas_fiscais n ON n.id=onf.nota_fiscal_id
    WHERE onf.operacao_id=op.id AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id=n.id)
    UNION ALL
    SELECT onp.nota_fiscal_id, p.id, p.valor_nominal, p.data_vencimento
    FROM public.operacoes_nf_parcelas onp JOIN public.nota_fiscal_parcelas p ON p.id=onp.parcela_id
    WHERE onp.operacao_id=op.id
    ORDER BY nf_id, parcela_id NULLS FIRST
  LOOP
    memoria := private.calcular_memoria_financeira_nf(item.nf_id,item.nominal,op.taxa_desconto,
      op.calculo_data_base,item.vencimento,op.metodo_calculo_financeiro);
    itens := itens || jsonb_build_array(memoria || jsonb_build_object('parcela_id',item.parcela_id));
    bruto := bruto + (memoria->>'valor_nominal')::numeric;
    liquido := liquido + (memoria->>'valor_presente')::numeric;
    ponderado := ponderado + (memoria->>'valor_nominal')::numeric * (memoria->>'dias')::integer;
    quantidade := quantidade + 1;
  END LOOP;
  IF quantidade = 0 OR bruto <= 0 OR round(bruto,2) IS DISTINCT FROM op.valor_bruto_total THEN
    RAISE EXCEPTION 'P17: itens divergem do nominal da operacao';
  END IF;
  prazo := round(ponderado / bruto);
  antes := jsonb_build_object('status',op.status,'taxa_desconto',op.taxa_desconto,
    'metodo',op.metodo_calculo_financeiro,'data_base',op.calculo_data_base,
    'valor_bruto_total',op.valor_bruto_total,'valor_liquido_desembolso',op.valor_liquido_desembolso,
    'prazo_dias',op.prazo_dias,'calculo_versao_motor',op.calculo_versao_motor,'calculo_memoria',op.calculo_memoria);
  memoria := jsonb_build_object('tipo','previa_recalculada_p17','metodo',op.metodo_calculo_financeiro,
    'taxa_mensal',op.taxa_desconto,'data_base',op.calculo_data_base,'valor_bruto_total',round(bruto,2),
    'valor_liquido_total',round(liquido,2),'desconto_total',round(bruto-liquido,2),'prazo_medio',prazo,
    'prazo_unidade','dias_corridos','versao_motor',2,'arredondamento','ROUND_HALF_UP_2_CASAS','itens',itens);
  IF op.calculo_memoria = memoria AND op.prazo_dias = prazo AND op.valor_liquido_desembolso = round(liquido,2) THEN
    RETURN jsonb_build_object('operacao_id',op.id,'idempotent_replay',true,'memoria',memoria);
  END IF;
  UPDATE public.operacoes SET valor_liquido_desembolso=round(liquido,2),prazo_dias=prazo,
    calculo_versao_motor=2,calculo_memoria=memoria
  WHERE id=op.id AND status IN ('solicitada','em_analise');
  IF NOT FOUND THEN RAISE EXCEPTION 'P17: operacao alterada concorrentemente'; END IF;
  depois := antes || jsonb_build_object('valor_liquido_desembolso',round(liquido,2),'prazo_dias',prazo,
    'calculo_versao_motor',2,'calculo_memoria',memoria,'executor_db',session_user,'origem','P17_MANUTENCAO');
  INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
  VALUES(auth.uid(),'OPERACAO_PREVIA_RECALCULADA_P17','operacoes',op.id,antes,depois);
  RETURN jsonb_build_object('operacao_id',op.id,'idempotent_replay',false,'antes',antes,'depois',depois);
END;
$$;
REVOKE ALL ON FUNCTION private.recalcular_previa_operacao_p17(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION private.recalcular_previa_operacao_p17(uuid,timestamptz) IS
  'P17: reparo administrativo unitario, auditado e otimista de previa ainda editavel; nao aprova nem altera historico/NF/politica.';

COMMIT;
