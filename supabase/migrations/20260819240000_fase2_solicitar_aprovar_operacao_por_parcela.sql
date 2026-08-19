-- Fase 2 (Parcelas de NF): solicitar_operacao_antecipacao_atomica e
-- aprovar_operacao_atomica_financeiro_v1 passam a aceitar selecao por
-- parcela. Corpo baseado na versao REAL e vigente de cada funcao (lida
-- integralmente antes de editar, apos o erro da Fase 1 -- ver relatorio):
--   solicitar_operacao_antecipacao_atomica: 20260727151731_politicas_catalogo_fundo.sql:598
--   aprovar_operacao_atomica_financeiro_v1: 20260817150505_p2_6_4_canonicalizar_schema_funcional.sql:80
-- Nenhuma logica pre-existente foi removida; apenas os blocos marcados
-- "NOVO" abaixo foram adicionados, condicionados a `p_parcela_ids` estar
-- presente. Chamadas existentes com o parametro omitido (NULL, default)
-- reproduzem o comportamento legado byte a byte.

BEGIN;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
  p_cedente_id uuid, p_cedente_fundo_id uuid, p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid, p_politica_versao integer, p_politica_snapshot jsonb,
  p_politica_snapshot_hash text, p_aceite_sacado_exigido boolean, p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[], p_valor_bruto_total numeric, p_taxa_desconto numeric,
  p_prazo_dias integer, p_valor_liquido_desembolso numeric, p_data_vencimento date,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_id uuid := auth.uid(); actor_role text := public.get_user_role();
  cedente_row record; vinculo_row record; escrow_row record; existing_op record;
  expected_count integer; matched_count integer; already_linked_count integer;
  parcelas_expected_count integer; parcelas_matched_count integer;
  inserted_op_id uuid; now_ts timestamptz := now(); politica_atribuicao_row record;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF actor_role <> 'cedente' THEN RAISE EXCEPTION 'Somente cedente pode solicitar antecipacao'; END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma NF'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN RAISE EXCEPTION 'Chave de idempotencia invalida'; END IF;

  SELECT * INTO existing_op FROM public.operacoes WHERE solicitacao_idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('operacao_id', existing_op.id, 'idempotent_replay', true, 'status', existing_op.status); END IF;

  SELECT * INTO cedente_row FROM public.cedentes WHERE id = p_cedente_id AND user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de cedente nao encontrado para o usuario autenticado'; END IF;
  IF cedente_row.status <> 'ativo' THEN RAISE EXCEPTION 'Cedente nao esta ativo'; END IF;

  SELECT * INTO vinculo_row FROM public.cedente_fundos WHERE id = p_cedente_fundo_id AND cedente_id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado'; END IF;
  IF vinculo_row.status <> 'ativo' THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = vinculo_row.fundo_id AND coalesce(f.ativo, true) = true) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;

  SELECT cfp.* INTO politica_atribuicao_row
  FROM public.cedente_fundo_politicas cfp
  JOIN public.politicas_operacionais p ON p.id = cfp.politica_operacional_id
  JOIN public.politica_operacional_versoes v ON v.id = p_politica_operacional_versao_id AND v.politica_operacional_id = p.id
  WHERE cfp.cedente_fundo_id = p_cedente_fundo_id AND cfp.politica_operacional_id = p_politica_operacional_id
    AND cfp.status = 'ativa' AND cfp.vigente_desde <= now_ts AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now_ts)
    AND p.fundo_id = vinculo_row.fundo_id AND p.status = 'ativa'
    AND v.fundo_id = vinculo_row.fundo_id AND v.publicada_em IS NOT NULL AND v.publicada_por IS NOT NULL
    AND v.vigente_ate IS NULL AND v.versao = p_politica_versao
  ORDER BY cfp.vigente_desde DESC LIMIT 1;
  IF politica_atribuicao_row.id IS NULL THEN RAISE EXCEPTION 'Politica operacional vigente nao vinculada ao cedente-fundo'; END IF;

  SELECT * INTO escrow_row FROM public.contas_escrow WHERE cedente_id = p_cedente_id AND status = 'ativa'
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta escrow nao encontrada ou inativa'; END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count FROM unnest(p_nota_fiscal_ids) AS item(nf_id);

  WITH locked_nfs AS (
    SELECT nf.id FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count FROM locked_nfs;
  IF matched_count <> expected_count THEN RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas'; END IF;

  -- NFs SEM parcelas (legado): trava exatamente como antes, por presenca
  -- em operacoes_nfs (nunca removida ao rejeitar/cancelar operacao).
  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = onf.nota_fiscal_id);
  IF already_linked_count > 0 THEN RAISE EXCEPTION 'Uma ou mais NFs ja estao vinculadas a uma operacao'; END IF;

  -- NOVO: NFs COM parcelas -- a trava passa a ser por parcela
  -- (nota_fiscal_parcelas.status='disponivel'), nao mais por presenca da
  -- NF inteira em operacoes_nfs (que agora pode legitimamente repetir a
  -- mesma NF em operacoes diferentes, uma por parcela cedida).
  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    SELECT count(DISTINCT id) INTO parcelas_expected_count FROM unnest(p_parcela_ids) AS item(id);

    WITH locked_parcelas AS (
      SELECT p.id FROM public.nota_fiscal_parcelas p
      JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
      WHERE p.id = ANY(p_parcela_ids) AND p.status = 'disponivel'
        AND nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
        AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      FOR UPDATE OF p
    )
    SELECT count(DISTINCT id) INTO parcelas_matched_count FROM locked_parcelas;
    IF parcelas_matched_count <> parcelas_expected_count THEN
      RAISE EXCEPTION 'Uma ou mais parcelas nao estao disponiveis ou nao pertencem ao contexto ativo';
    END IF;

    IF EXISTS (
      SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
      WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.nota_fiscal_parcelas p
          WHERE p.nota_fiscal_id = item.nf_id AND p.id = ANY(p_parcela_ids)
        )
    ) THEN
      RAISE EXCEPTION 'Toda NF com parcelas precisa ter ao menos uma parcela selecionada';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
    WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
  ) THEN
    RAISE EXCEPTION 'NF com parcelas precisa informar quais parcelas foram selecionadas';
  END IF;

  INSERT INTO public.operacoes (
    cedente_id, conta_escrow_id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso,
    data_vencimento, status, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id,
    politica_atribuicao_id, politica_versao, politica_snapshot, politica_snapshot_hash,
    contexto_configuracao_status, contexto_capturado_em, aceite_sacado_exigido, aceite_sacado_status,
    aceite_sacado_em, cessao_efetivada_em, solicitacao_idempotency_key
  ) VALUES (
    p_cedente_id, escrow_row.id, p_valor_bruto_total, p_taxa_desconto, p_prazo_dias, greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento, 'solicitada', p_cedente_fundo_id, p_politica_operacional_id, p_politica_operacional_versao_id,
    politica_atribuicao_row.id, p_politica_versao, p_politica_snapshot, p_politica_snapshot_hash,
    'completo', now_ts, p_aceite_sacado_exigido, p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END, NULL, p_idempotency_key
  ) RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  -- NOVO: registra e trava exatamente as parcelas cedidas nesta operacao.
  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    INSERT INTO public.operacoes_nf_parcelas (operacao_id, nota_fiscal_id, parcela_id)
    SELECT inserted_op_id, p.nota_fiscal_id, p.id
    FROM public.nota_fiscal_parcelas p
    WHERE p.id = ANY(p_parcela_ids);

    UPDATE public.nota_fiscal_parcelas SET status = 'em_operacao' WHERE id = ANY(p_parcela_ids);
  END IF;

  -- NF sem parcelas: vira em_antecipacao sempre (legado). NF com parcelas:
  -- so vira em_antecipacao quando nenhuma parcela 'disponivel' restar --
  -- senao permanece 'aprovada' para as parcelas restantes continuarem
  -- selecionaveis numa operacao futura e diferente.
  UPDATE public.notas_fiscais nf
  SET status = 'em_antecipacao'
  WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id AND nf.cedente_fundo_id = p_cedente_fundo_id
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = nf.id AND p.status = 'disponivel');

  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (actor_id, 'OPERACAO_SOLICITADA', 'operacoes', inserted_op_id, jsonb_build_object(
      'valor_bruto_total', p_valor_bruto_total, 'taxa_desconto', p_taxa_desconto, 'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids, 'parcela_ids', p_parcela_ids, 'cedente_fundo_id', p_cedente_fundo_id,
      'politica_atribuicao_id', politica_atribuicao_row.id, 'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
  ));

  RETURN jsonb_build_object('operacao_id', inserted_op_id, 'idempotent_replay', false, 'status', 'solicitada',
    'politica_atribuicao_id', politica_atribuicao_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) TO authenticated;

-- ============================================================
-- aprovar_operacao_atomica_financeiro_v1: mesma memoria de calculo
-- (private.calcular_memoria_financeira_nf, formula intocada), agora
-- aplicada por parcela quando a NF tiver parcelas, em vez de sempre pelo
-- valor/vencimento agregado da NF inteira.
-- ============================================================

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
  IF NOT EXISTS (SELECT 1 FROM public.taxas_cedente tc WHERE tc.cedente_id = op.cedente_id
      AND tc.taxa_percentual = p_taxa_desconto AND prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max) THEN
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
    metodo_calculo_financeiro = metodo, calculo_data_base = data_base, calculo_versao_motor = 1,
    calculo_memoria = jsonb_build_object(
      'metodo', metodo, 'taxa_mensal', p_taxa_desconto, 'data_base', data_base,
      'valor_bruto_total', round(v_valor_bruto_total, 2), 'valor_liquido_total', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'prazo_medio', prazo_medio,
      'prazo_unidade', CASE metodo WHEN 'DIAS_UTEIS_252' THEN 'dias_uteis' WHEN 'TRINTA_360' THEN 'dias_financeiros' ELSE 'dias_corridos' END,
      'vencimento_maximo', vencimento_maximo, 'quantidade_nfs', nfs_count,
      'previa_valor_liquido_solicitacao', op.valor_liquido_desembolso,
      'diferenca_previa_aprovacao', CASE WHEN op.valor_liquido_desembolso IS NULL THEN NULL ELSE round(valor_liquido_total - op.valor_liquido_desembolso, 2) END,
      'versao_motor', 1, 'arredondamento', 'ROUND_HALF_UP_2_CASAS'
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

COMMIT;
