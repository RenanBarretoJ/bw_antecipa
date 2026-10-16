BEGIN;

-- A NF inteira continua usando a RPC A5 existente. Esta RPC retira somente
-- um vínculo de parcela e preserva as demais parcelas, aceite e snapshots.
CREATE FUNCTION public.remover_parcela_operacao_gestor_atomica(
  p_operacao_id uuid, p_nota_fiscal_id uuid, p_parcela_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_op record;
  v_parcela record;
  v_item record;
  v_memoria jsonb;
  v_resultado jsonb;
  v_recebido jsonb;
  v_correlation text := pg_catalog.gen_random_uuid()::text;
  v_quantidade integer;
  v_removidas integer;
  v_base numeric := 0;
  v_liquido numeric := 0;
  v_ponderado numeric := 0;
  v_valor numeric;
  v_data_base date;
  v_metodo text;
  v_vencimento date;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR public.get_user_role() IS DISTINCT FROM 'gestor'
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.status::text = 'ativo')
     OR NOT EXISTS (SELECT 1 FROM public.obter_sessao_mfa_atual() m WHERE m.status = 'valid') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao de Gestor com MFA valido necessaria';
  END IF;
  SELECT o.*, cf.fundo_id INTO v_op FROM public.operacoes o
    JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
    WHERE o.id = p_operacao_id FOR UPDATE OF o;
  IF NOT FOUND OR NOT private.usuario_tem_acesso_fundo(v_op.fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Operacao indisponivel neste fundo';
  END IF;

  -- Mesmo lock da aprovação/remoção de NF: uma composição por vez.
  PERFORM 1 FROM public.operacoes_nfs onf JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id ORDER BY n.id FOR UPDATE OF onf, n;
  PERFORM 1 FROM public.operacoes_nf_parcelas onp JOIN public.nota_fiscal_parcelas p ON p.id = onp.parcela_id
    WHERE onp.operacao_id = p_operacao_id ORDER BY p.id FOR UPDATE OF onp, p;

  SELECT p.numero_parcela, p.valor_nominal, p.data_vencimento, n.numero_nf INTO v_parcela
    FROM public.operacoes_nf_parcelas onp
    JOIN public.nota_fiscal_parcelas p ON p.id = onp.parcela_id AND p.nota_fiscal_id = onp.nota_fiscal_id
    JOIN public.notas_fiscais n ON n.id = onp.nota_fiscal_id
    JOIN public.operacoes_nfs onf ON onf.operacao_id = onp.operacao_id AND onf.nota_fiscal_id = n.id
    WHERE onp.operacao_id = p_operacao_id AND onp.nota_fiscal_id = p_nota_fiscal_id AND onp.parcela_id = p_parcela_id;
  IF NOT FOUND THEN
    -- Uma resposta perdida não pode retirar outro item nem duplicar o histórico.
    SELECT l.dados_depois INTO v_recebido FROM public.logs_auditoria l
      WHERE l.entidade_id = p_operacao_id AND l.tipo_evento = 'PARCELA_REMOVIDA_OPERACAO'
        AND l.dados_depois->>'parcela_id' = p_parcela_id::text
        AND l.dados_depois->>'nota_fiscal_id' = p_nota_fiscal_id::text
      ORDER BY l.created_at DESC LIMIT 1;
    IF FOUND THEN RETURN v_recebido || pg_catalog.jsonb_build_object('idempotent_replay', true); END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Parcela nao vinculada a esta NF nesta operacao';
  END IF;
  IF v_op.status::text NOT IN ('solicitada', 'em_analise') OR v_op.aprovado_em IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Somente operacoes antes da aprovacao permitem retirar parcelas';
  END IF;
  SELECT count(*) INTO v_quantidade FROM public.operacoes_nf_parcelas
    WHERE operacao_id = p_operacao_id AND nota_fiscal_id = p_nota_fiscal_id;

  IF v_quantidade = 1 THEN
    -- Retirar a última parcela equivale a retirar a NF desta operação.
    v_resultado := public.remover_nf_operacao_gestor_atomica(p_operacao_id, p_nota_fiscal_id);
  ELSE
    DELETE FROM public.operacoes_nf_parcelas
      WHERE operacao_id = p_operacao_id AND nota_fiscal_id = p_nota_fiscal_id AND parcela_id = p_parcela_id;
    GET DIAGNOSTICS v_removidas = ROW_COUNT;
    IF v_removidas <> 1 THEN RAISE EXCEPTION 'Falha ao retirar a parcela'; END IF;
    UPDATE public.nota_fiscal_parcelas SET status = 'disponivel'
      WHERE id = p_parcela_id AND nota_fiscal_id = p_nota_fiscal_id;
    DELETE FROM public.operacao_calculo_nfs
      WHERE operacao_id = p_operacao_id AND nota_fiscal_id = p_nota_fiscal_id AND parcela_id = p_parcela_id;

    v_data_base := coalesce(v_op.calculo_data_base, (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date);
    v_metodo := coalesce(v_op.metodo_calculo_financeiro, v_op.politica_snapshot #>> '{calculo_financeiro,metodo}', 'LEGADO_MENSAL_DIAS_REAIS_30');
    IF EXISTS (
      SELECT 1 FROM public.operacoes_nfs onf WHERE onf.operacao_id = p_operacao_id
        AND EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = onf.nota_fiscal_id)
        AND NOT EXISTS (SELECT 1 FROM public.operacoes_nf_parcelas onp
          WHERE onp.operacao_id = onf.operacao_id AND onp.nota_fiscal_id = onf.nota_fiscal_id)
    ) THEN RAISE EXCEPTION 'Composicao de parcelas inconsistente'; END IF;
    FOR v_item IN
      SELECT n.id AS nf_id, p.id AS parcela_id, p.valor_nominal, p.data_vencimento
      FROM public.operacoes_nf_parcelas onp JOIN public.nota_fiscal_parcelas p ON p.id = onp.parcela_id
      JOIN public.notas_fiscais n ON n.id = onp.nota_fiscal_id
      WHERE onp.operacao_id = p_operacao_id
      UNION ALL
      SELECT n.id, NULL::uuid, n.valor_bruto, n.data_vencimento FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
      WHERE onf.operacao_id = p_operacao_id
        AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = n.id)
      ORDER BY nf_id, parcela_id NULLS FIRST
    LOOP
      v_valor := private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot, v_item.nf_id, v_item.parcela_id, v_item.valor_nominal);
      v_memoria := private.calcular_memoria_financeira_nf(v_item.nf_id, v_valor, coalesce(v_op.taxa_desconto, 0), v_data_base, v_item.data_vencimento, v_metodo);
      v_base := v_base + v_valor;
      v_liquido := v_liquido + (v_memoria->>'valor_presente')::numeric;
      v_ponderado := v_ponderado + v_valor * (v_memoria->>'dias')::integer;
      v_vencimento := greatest(v_vencimento, v_item.data_vencimento);
      v_itens := v_itens || pg_catalog.jsonb_build_array(v_memoria || pg_catalog.jsonb_build_object('parcela_id', v_item.parcela_id));
    END LOOP;
    IF v_base <= 0 THEN RAISE EXCEPTION 'Composicao financeira inconsistente'; END IF;
    UPDATE public.operacoes SET valor_bruto_total = round(v_base, 2),
      valor_liquido_desembolso = CASE WHEN v_op.taxa_desconto IS NULL THEN NULL ELSE round(v_liquido, 2) END,
      prazo_dias = round(v_ponderado / v_base), data_vencimento = v_vencimento,
      calculo_memoria = CASE WHEN v_op.taxa_desconto IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'tipo', 'previa_apos_remocao_parcela', 'metodo', v_metodo, 'data_base', v_data_base,
        'taxa_mensal', v_op.taxa_desconto, 'valor_bruto_total', round(v_base, 2),
        'valor_liquido_total', round(v_liquido, 2), 'itens', v_itens) END
      WHERE id = p_operacao_id;
    v_resultado := pg_catalog.jsonb_build_object('operacao_id', p_operacao_id, 'cedente_id', v_op.cedente_id,
      'numero_nf', v_parcela.numero_nf, 'operacao_cancelada', false, 'nf_retirada', false,
      'novo_valor_bruto', round(v_base, 2), 'novo_valor_liquido', CASE WHEN v_op.taxa_desconto IS NULL THEN NULL ELSE round(v_liquido, 2) END);
  END IF;

  v_resultado := v_resultado || pg_catalog.jsonb_build_object('parcela_id', p_parcela_id,
    'nota_fiscal_id', p_nota_fiscal_id, 'numero_parcela', v_parcela.numero_parcela,
    'nf_retirada', v_quantidade = 1, 'idempotent_replay', false, 'correlation_id', v_correlation);
  INSERT INTO public.logs_auditoria(usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois)
    VALUES(v_actor, 'usuario', 'rpc_gestor', 'PARCELA_REMOVIDA_OPERACAO', 'operacoes', p_operacao_id,
      pg_catalog.jsonb_build_object('valor_bruto_total', v_op.valor_bruto_total,
        'valor_liquido_desembolso', v_op.valor_liquido_desembolso, 'parcela_id', p_parcela_id), v_resultado);
  INSERT INTO public.eventos_dominio(tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id, operacao_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot, ator_perfil_snapshot, origem, descricao, metadata, visibilidade, correlation_id)
    VALUES(v_op.fundo_id, v_op.fundo_id, v_op.cedente_id, v_op.cedente_fundo_id, p_nota_fiscal_id, p_operacao_id,
      'parcela_removida_operacao', 'operacao', v_actor,
      coalesce((SELECT p.nome_completo FROM public.profiles p WHERE p.id = v_actor), 'Gestor'), 'gestor', 'rpc_gestor',
      pg_catalog.format('Parcela %s da NF %s retirada da operacao.%s', v_parcela.numero_parcela, v_parcela.numero_nf,
        CASE WHEN v_quantidade = 1 THEN ' A NF deixou de compor a operacao.' ELSE '' END),
      v_resultado, 'ambos', v_correlation);
  RETURN v_resultado;
END; $$;

REVOKE ALL ON FUNCTION public.remover_parcela_operacao_gestor_atomica(uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remover_parcela_operacao_gestor_atomica(uuid,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.remover_parcela_operacao_gestor_atomica(uuid,uuid,uuid) IS
  'Retira uma parcela pre-aprovacao: valida Gestor/MFA/fundo/vinculo, serializa composicao, libera apenas a parcela, preserva snapshots e registra auditoria/historico na transacao. Ultima parcela usa a remocao de NF existente.';

COMMIT;
