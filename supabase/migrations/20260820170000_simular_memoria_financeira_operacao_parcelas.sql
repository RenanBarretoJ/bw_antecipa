BEGIN;

-- P0 (gate de risco bloqueado por AVALIACAO_RISCO_INDISPONIVEL): auditoria
-- obrigatoria da regressao causada por parcelas (Fase 1/2, migrations
-- 20260819210000..20260820120000) sobre o P2.6 (20260814230000), que e
-- ANTERIOR e nunca foi revisitado. simular_memoria_financeira_operacao
-- (usada pelo candidato de risco em src/lib/financeiro/risco/
-- processor.server.ts:candidateProjection, ANTES da aprovacao) ainda
-- itera so operacoes_nfs (1 linha por NF) e usa o valor_bruto/vencimento
-- AGREGADO da NF inteira -- exatamente a suposicao "1 NF = 1 item" que a
-- Fase 2 ja corrigiu na RPC de aprovacao real (aprovar_operacao_atomica_
-- financeiro_v1, 20260819240000), mas que ficou pendente aqui.
--
-- Efeito pratico: para uma NF com parcelas, o candidato de risco calcula
-- o VP usando o vencimento AGREGADO (a ultima parcela) para o valor
-- INTEGRAL da NF, em vez de somar o VP de cada parcela pelo seu proprio
-- vencimento -- podendo (a) lancar "A NF esta vencida" indevidamente
-- quando o agregado already passou mas a parcela cedida nao, ou (b)
-- sobrestimar o valor de aquisicao do candidato ao usar o valor integral
-- da NF quando so parte das parcelas foi cedida a esta operacao. Nao e a
-- causa do bloqueio observado nesta operacao especifica (confirmado ao
-- vivo: risco_execucoes.detalhes.technical_error = "Nenhuma base
-- financeira publicada..." -- P2.3 matching, ausencia de dado, nao bug de
-- codigo), mas e uma incompatibilidade real e determinada pelo escopo
-- explicito do ticket, que precisa ser corrigida antes de reabrir o gate.
--
-- Corpo reproduzido integralmente da versao vigente (unica definicao em
-- todas as migrations, lida por completo antes de editar). Mesmo padrao
-- ja validado em aprovar_operacao_atomica_financeiro_v1: NF SEM parcelas
-- cedidas a esta operacao = comportamento legado intacto (1 item, valor/
-- vencimento agregado da NF); NF COM parcelas cedidas = 1 item POR
-- parcela, usando o valor_nominal/data_vencimento de cada parcela.

CREATE OR REPLACE FUNCTION public.simular_memoria_financeira_operacao(p_operacao_id uuid,p_taxa_desconto numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_op record; v_nf record; v_parcela record; v_memoria jsonb; v_metodo text; v_data_base date := (pg_catalog.timezone('America/Sao_Paulo',pg_catalog.now()))::date;
  v_itens jsonb := '[]'::jsonb; v_total numeric := 0; v_ausentes integer := 0; v_count integer := 0; v_tem_parcelas boolean;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Simulacao financeira restrita ao processador interno'; END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto<0 THEN RAISE EXCEPTION 'Taxa mensal invalida'; END IF;
  SELECT o.*,cf.fundo_id INTO v_op FROM public.operacoes o JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id WHERE o.id=p_operacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF v_op.status NOT IN ('solicitada','em_analise') THEN RAISE EXCEPTION 'Operacao nao elegivel para simulacao de risco'; END IF;
  v_metodo := coalesce(v_op.metodo_calculo_financeiro,v_op.politica_snapshot #>> '{calculo_financeiro,metodo}','LEGADO_MENSAL_DIAS_REAIS_30');
  FOR v_nf IN SELECT n.* FROM public.operacoes_nfs onf JOIN public.notas_fiscais n ON n.id=onf.nota_fiscal_id WHERE onf.operacao_id=p_operacao_id ORDER BY n.id LOOP
    SELECT EXISTS(SELECT 1 FROM public.operacoes_nf_parcelas onp WHERE onp.operacao_id=p_operacao_id AND onp.nota_fiscal_id=v_nf.id) INTO v_tem_parcelas;
    IF v_tem_parcelas THEN
      FOR v_parcela IN
        SELECT p.* FROM public.operacoes_nf_parcelas onp
        JOIN public.nota_fiscal_parcelas p ON p.id=onp.parcela_id
        WHERE onp.operacao_id=p_operacao_id AND onp.nota_fiscal_id=v_nf.id
        ORDER BY p.numero_parcela
      LOOP
        v_memoria := private.calcular_memoria_financeira_nf(v_nf.id,v_parcela.valor_nominal,p_taxa_desconto,v_data_base,v_parcela.data_vencimento,v_metodo);
        IF nullif(v_memoria->>'valor_presente','') IS NULL THEN v_ausentes:=v_ausentes+1; ELSE v_total:=v_total+(v_memoria->>'valor_presente')::numeric; END IF;
        v_itens:=v_itens||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('nota_fiscal_id',v_nf.id,'parcela_id',v_parcela.id,'valor_aquisicao',v_memoria->>'valor_presente'));
        v_count:=v_count+1;
      END LOOP;
    ELSE
      v_memoria := private.calcular_memoria_financeira_nf(v_nf.id,v_nf.valor_bruto,p_taxa_desconto,v_data_base,v_nf.data_vencimento,v_metodo);
      IF nullif(v_memoria->>'valor_presente','') IS NULL THEN v_ausentes:=v_ausentes+1; ELSE v_total:=v_total+(v_memoria->>'valor_presente')::numeric; END IF;
      v_itens:=v_itens||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('nota_fiscal_id',v_nf.id,'valor_aquisicao',v_memoria->>'valor_presente'));
      v_count:=v_count+1;
    END IF;
  END LOOP;
  IF v_count=0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;
  RETURN pg_catalog.jsonb_build_object('operacao_id',v_op.id,'fundo_id',v_op.fundo_id,'operacao_updated_at',v_op.updated_at,'status',v_op.status,
    'taxa_desconto',p_taxa_desconto,'metodo',v_metodo,'data_base',v_data_base,'valor_aquisicao_total',v_total,
    'quantidade_valor_ausente',v_ausentes,'itens',v_itens);
END; $$;
REVOKE ALL ON FUNCTION public.simular_memoria_financeira_operacao(uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simular_memoria_financeira_operacao(uuid,numeric) TO service_role;

COMMIT;
