-- GUIBOR A5: fiscal selection and immutable per-operation/per-NF inputs.
-- No backfill or financial DML. NULL snapshot explicitly identifies pre-A5 operations.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('private.operacao_status_reserva_nf(public.operacao_status)') IS NULL THEN
    RAISE EXCEPTION 'GUIBOR A5 requer baseline P14/P16 completo';
  END IF;
  IF private.operacao_status_reserva_nf('cancelada'::public.operacao_status) THEN
    RAISE EXCEPTION 'GUIBOR A5 requer P16: operacao cancelada nao pode reservar NF';
  END IF;
END $$;

ALTER TABLE public.cedente_fundos ADD COLUMN base_valor_antecipacao text NOT NULL DEFAULT 'BRUTO'
  CHECK (base_valor_antecipacao IN ('BRUTO', 'LIQUIDO'));
ALTER TABLE public.operacoes ADD COLUMN base_antecipacao_snapshot jsonb;

CREATE OR REPLACE FUNCTION private.autorizar_configuracao_financeira_fundo(p_fundo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.usuario_possui_mfa_elevado()
    OR NOT (private.usuario_e_super_admin() OR private.gestor_tem_acesso_fundo_operacional(p_fundo_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Acesso nao autorizado a configuracao do fundo';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.autorizar_configuracao_financeira_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER is limited to the scoped, audited configuration mutation.
CREATE OR REPLACE FUNCTION public.configurar_base_antecipacao(p_cedente_fundo_id uuid, p_base text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.cedente_fundos;
BEGIN
  SELECT * INTO v_link FROM public.cedente_fundos WHERE id = p_cedente_fundo_id FOR UPDATE;
  PERFORM private.autorizar_configuracao_financeira_fundo(v_link.fundo_id);
  IF v_link.id IS NULL OR p_base IS NULL OR p_base NOT IN ('BRUTO', 'LIQUIDO') THEN
    RAISE EXCEPTION 'Configuracao de base invalida';
  END IF;
  UPDATE public.cedente_fundos SET base_valor_antecipacao = p_base WHERE id = v_link.id;
END;
$$;
REVOKE ALL ON FUNCTION public.configurar_base_antecipacao(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configurar_base_antecipacao(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.proteger_base_antecipacao_vinculo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.base_valor_antecipacao <> 'BRUTO')
    OR (TG_OP = 'UPDATE' AND (
      NEW.base_valor_antecipacao IS DISTINCT FROM OLD.base_valor_antecipacao
      OR (NEW.base_valor_antecipacao = 'LIQUIDO' AND (
        NEW.fundo_id IS DISTINCT FROM OLD.fundo_id OR NEW.cedente_id IS DISTINCT FROM OLD.cedente_id
      ))
    )) THEN
    PERFORM private.autorizar_configuracao_financeira_fundo(NEW.fundo_id);
    IF TG_OP = 'UPDATE' THEN
      PERFORM private.autorizar_configuracao_financeira_fundo(OLD.fundo_id);
    END IF;
    INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
    VALUES(auth.uid(),'BASE_ANTECIPACAO_ALTERADA','cedente_fundos',NEW.id,
      CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('base_valor_antecipacao',OLD.base_valor_antecipacao) ELSE NULL END,
      jsonb_build_object('base_valor_antecipacao',NEW.base_valor_antecipacao,'cedente_id',NEW.cedente_id,'fundo_id',NEW.fundo_id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.proteger_base_antecipacao_vinculo() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER cedente_fundos_proteger_base BEFORE INSERT OR UPDATE ON public.cedente_fundos
  FOR EACH ROW EXECUTE FUNCTION private.proteger_base_antecipacao_vinculo();

CREATE OR REPLACE FUNCTION private.resolver_valor_base_antecipacao(
  p_base text, p_bruto numeric, p_liquido numeric, p_origem text, p_parcelada boolean
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_base IS NULL OR p_base NOT IN ('BRUTO','LIQUIDO') OR p_bruto IS NULL
    OR p_bruto <= 0 OR p_bruto::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Base de antecipacao invalida';
  END IF;
  IF p_base = 'BRUTO' THEN RETURN p_bruto; END IF;
  IF p_parcelada IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Antecipacao pelo valor liquido indisponivel para notas parceladas';
  END IF;
  IF p_origem IS DISTINCT FROM 'DOCUMENTO_EXPLICITO' OR p_liquido IS NULL OR p_liquido <= 0
    OR p_liquido > p_bruto OR p_liquido::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Antecipacao pelo liquido exige valor positivo explicitamente informado no documento';
  END IF;
  RETURN p_liquido;
END;
$$;
REVOKE ALL ON FUNCTION private.resolver_valor_base_antecipacao(text,numeric,numeric,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Called only inside the canonical RPC after locks and authorization, never from a client payload.
CREATE OR REPLACE FUNCTION private.capturar_base_antecipacao(
  p_cedente_fundo_id uuid, p_versao_id uuid, p_nota_ids uuid[], p_parcela_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_link public.cedente_fundos; v_nf public.notas_fiscais; v_p public.nota_fiscal_parcelas;
  v_base numeric; v_nf_total numeric; v_parcelada boolean;
  v_notas jsonb := '[]'; v_itens jsonb := '[]';
BEGIN
  SELECT * INTO STRICT v_link FROM public.cedente_fundos WHERE id=p_cedente_fundo_id;
  FOR v_nf IN SELECT * FROM public.notas_fiscais WHERE id=ANY(p_nota_ids) ORDER BY id LOOP
    IF v_nf.cedente_fundo_id IS DISTINCT FROM v_link.id OR v_nf.cedente_id IS DISTINCT FROM v_link.cedente_id
      OR v_nf.fundo_id IS DISTINCT FROM v_link.fundo_id THEN RAISE EXCEPTION 'NF fora do contexto da base'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id=v_nf.id) INTO v_parcelada;
    v_base := private.resolver_valor_base_antecipacao(v_link.base_valor_antecipacao, v_nf.valor_bruto,
      v_nf.valor_liquido, v_nf.valor_liquido_origem, v_parcelada);
    v_nf_total := 0;
    IF v_parcelada THEN
      FOR v_p IN SELECT * FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id=v_nf.id AND id=ANY(p_parcela_ids) ORDER BY id LOOP
        v_itens := v_itens || jsonb_build_array(jsonb_build_object('nota_fiscal_id',v_nf.id,'parcela_id',v_p.id,
          'valor_base',v_p.valor_nominal,'vencimento',v_p.data_vencimento));
        v_nf_total := v_nf_total + v_p.valor_nominal;
      END LOOP;
      IF v_nf_total <= 0 THEN RAISE EXCEPTION 'NF parcelada sem parcelas selecionadas'; END IF;
    ELSE
      v_nf_total := v_base;
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('nota_fiscal_id',v_nf.id,'parcela_id',NULL,
        'valor_base',v_base,'vencimento',v_nf.data_vencimento));
    END IF;
    v_notas := v_notas || jsonb_build_array(jsonb_build_object('nota_fiscal_id',v_nf.id,
      'valor_bruto_fiscal',v_nf.valor_bruto,'valor_liquido_fiscal',v_nf.valor_liquido,
      'valor_liquido_origem',v_nf.valor_liquido_origem,'valor_base',v_nf_total));
  END LOOP;
  IF jsonb_array_length(v_notas) <> cardinality(p_nota_ids) THEN RAISE EXCEPTION 'Snapshot de base incompleto'; END IF;
  RETURN jsonb_build_object('schema','bw-antecipa.base-antecipacao.v1','base',v_link.base_valor_antecipacao,
    'cedente_id',v_link.cedente_id,'fundo_id',v_link.fundo_id,'cedente_fundo_id',v_link.id,
    'politica_operacional_versao_id',p_versao_id,'capturado_em',now(),'notas',v_notas,'itens',v_itens);
END;
$$;
REVOKE ALL ON FUNCTION private.capturar_base_antecipacao(uuid,uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.valor_base_antecipacao_snapshot(
  p_snapshot jsonb, p_nf_id uuid, p_parcela_id uuid, p_valor_legado numeric
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_valor numeric;
BEGIN
  -- Explicit compatibility for operations created before A5; no live policy lookup.
  IF p_snapshot IS NULL THEN RETURN p_valor_legado; END IF;
  SELECT (item->>'valor_base')::numeric INTO STRICT v_valor
  FROM jsonb_array_elements(p_snapshot->'itens') item
  WHERE (item->>'nota_fiscal_id')::uuid=p_nf_id AND (item->>'parcela_id')::uuid IS NOT DISTINCT FROM p_parcela_id;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Base congelada invalida';
  END IF;
  RETURN v_valor;
END;
$$;
REVOKE ALL ON FUNCTION private.valor_base_antecipacao_snapshot(jsonb,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.proteger_base_antecipacao_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.base_antecipacao_snapshot IS DISTINCT FROM OLD.base_antecipacao_snapshot THEN
    RAISE EXCEPTION 'Base de antecipacao da operacao e imutavel';
  END IF;
  IF TG_OP='INSERT' AND CURRENT_USER <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Snapshot de base restrito a RPC canonica';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.proteger_base_antecipacao_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operacoes_proteger_base_antecipacao BEFORE INSERT OR UPDATE ON public.operacoes
  FOR EACH ROW EXECUTE FUNCTION private.proteger_base_antecipacao_snapshot();

COMMENT ON COLUMN public.operacoes.base_antecipacao_snapshot IS
  'GUIBOR A5: entrada fiscal imutavel por operacao/NF/parcela, separada da memoria financeira recalculavel. NULL apenas legado pre-A5.';


-- Canonical flows below preserve P17 math and C2.1/P14/P16 gates; only the nominal source changes.
-- Retired pre-C2.1 API must not bypass the supported Cedente/Consultor wrappers.
-- Keep the function object for historical dependencies, revoke direct API execution.
REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,numeric,integer,numeric,date,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
  p_cedente_id uuid, p_cedente_fundo_id uuid, p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid, p_politica_versao integer, p_politica_snapshot jsonb,
  p_politica_snapshot_hash text, p_aceite_sacado_exigido boolean, p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[], p_valor_bruto_total numeric, p_taxa_desconto numeric,
  p_prazo_dias integer, p_valor_liquido_desembolso numeric, p_data_vencimento date,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid(); actor_role text := public.get_user_role();
  cedente_row record; vinculo_row record; escrow_row record; existing_op record;
  expected_count integer; matched_count integer; already_linked_count integer;
  parcelas_expected_count integer; parcelas_matched_count integer;
  base_snapshot jsonb; item jsonb; memoria jsonb; metodo text;
  bruto numeric := 0; liquido numeric := 0; ponderado numeric := 0;
  inserted_op_id uuid; now_ts timestamptz := now(); politica_atribuicao_row record;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF actor_role NOT IN ('cedente', 'consultor') THEN RAISE EXCEPTION 'Somente Cedente ou Consultor pode solicitar antecipacao'; END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma NF'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN RAISE EXCEPTION 'Chave de idempotencia invalida'; END IF;

  SELECT * INTO cedente_row FROM public.cedentes WHERE id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de Cedente nao encontrado'; END IF;
  IF cedente_row.status <> 'ativo' THEN RAISE EXCEPTION 'Cedente nao esta aprovado e ativo'; END IF;

  IF actor_role = 'cedente' THEN
    IF public.get_user_cedente_id() IS DISTINCT FROM p_cedente_id THEN
      RAISE EXCEPTION 'Cedente sem acesso ao cadastro informado';
    END IF;
  ELSIF NOT private.consultor_usuario_pode_operar_cedente(actor_id, p_cedente_id) THEN
    RAISE EXCEPTION 'Consultor sem vinculo organizacional ativo com o Cedente informado';
  END IF;

  SELECT * INTO existing_op FROM public.operacoes WHERE solicitacao_idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF existing_op.cedente_id IS DISTINCT FROM p_cedente_id
       OR existing_op.cedente_fundo_id IS DISTINCT FROM p_cedente_fundo_id THEN
      RAISE EXCEPTION 'Chave de idempotencia pertence a outro contexto operacional';
    END IF;
    RETURN jsonb_build_object('operacao_id', existing_op.id, 'idempotent_replay', true, 'status', existing_op.status);
  END IF;

  SELECT * INTO vinculo_row FROM public.cedente_fundos WHERE id = p_cedente_fundo_id AND cedente_id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado'; END IF;
  IF vinculo_row.status <> 'ativo' THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = vinculo_row.fundo_id AND coalesce(f.ativo, true) = true) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;
  IF actor_role = 'consultor'
     AND NOT private.consultor_usuario_tem_acesso_fundo(actor_id, vinculo_row.fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para esta Consultoria';
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
  IF expected_count <> cardinality(p_nota_fiscal_ids) THEN RAISE EXCEPTION 'A selecao contem NFs repetidas'; END IF;

  WITH locked_nfs AS (
    SELECT nf.id FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count FROM locked_nfs;
  IF matched_count <> expected_count THEN RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas'; END IF;

  -- P14: operacoes_nfs preserva historico. Somente operacoes em status que
  -- reservam a NF bloqueiam o novo pedido; reprovada permanece reutilizavel.
  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  JOIN public.operacoes op ON op.id = onf.operacao_id
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = onf.nota_fiscal_id)
    AND private.operacao_status_reserva_nf(op.status);
  IF already_linked_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1401',
      MESSAGE = 'NF_ALREADY_LINKED_TO_ACTIVE_OPERATION';
  END IF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    SELECT count(DISTINCT id) INTO parcelas_expected_count FROM unnest(p_parcela_ids) AS item(id);
    IF parcelas_expected_count <> cardinality(p_parcela_ids) THEN RAISE EXCEPTION 'A selecao contem parcelas repetidas'; END IF;

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

  -- A5: trusted fiscal inputs captured after all context, NF and parcel checks/locks.
  base_snapshot := private.capturar_base_antecipacao(p_cedente_fundo_id,p_politica_operacional_versao_id,p_nota_fiscal_ids,p_parcela_ids);
  SELECT metodo_calculo_financeiro INTO STRICT metodo FROM public.politica_operacional_versoes WHERE id=p_politica_operacional_versao_id;
  p_data_vencimento := NULL;
  FOR item IN SELECT value FROM jsonb_array_elements(base_snapshot->'itens') LOOP
    memoria := private.calcular_memoria_financeira_nf((item->>'nota_fiscal_id')::uuid,(item->>'valor_base')::numeric,
      coalesce(p_taxa_desconto,0),(timezone('America/Sao_Paulo',now_ts))::date,(item->>'vencimento')::date,metodo);
    bruto := bruto + (memoria->>'valor_nominal')::numeric;
    liquido := liquido + (memoria->>'valor_presente')::numeric;
    ponderado := ponderado + (memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric;
    p_data_vencimento := greatest(p_data_vencimento,(item->>'vencimento')::date);
  END LOOP;
  IF bruto <= 0 THEN RAISE EXCEPTION 'Selecao sem base financeira valida'; END IF;
  p_valor_bruto_total := round(bruto,2);
  p_valor_liquido_desembolso := CASE WHEN p_taxa_desconto IS NULL THEN NULL ELSE round(liquido,2) END;
  p_prazo_dias := round(ponderado/bruto);
  base_snapshot := base_snapshot || jsonb_build_object('metodo_calculo',metodo,'versao_motor',(memoria->>'versao_motor')::integer);

  INSERT INTO public.operacoes (
    cedente_id, conta_escrow_id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso,
    data_vencimento, status, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id,
    politica_atribuicao_id, politica_versao, politica_snapshot, politica_snapshot_hash,
    contexto_configuracao_status, contexto_capturado_em, aceite_sacado_exigido, aceite_sacado_status,
    aceite_sacado_em, cessao_efetivada_em, solicitacao_idempotency_key, base_antecipacao_snapshot
  ) VALUES (
    p_cedente_id, escrow_row.id, p_valor_bruto_total, p_taxa_desconto, p_prazo_dias, greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento, 'solicitada', p_cedente_fundo_id, p_politica_operacional_id, p_politica_operacional_versao_id,
    politica_atribuicao_row.id, p_politica_versao, p_politica_snapshot, p_politica_snapshot_hash,
    'completo', now_ts, p_aceite_sacado_exigido, p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END, NULL, p_idempotency_key, base_snapshot
  ) RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    INSERT INTO public.operacoes_nf_parcelas (operacao_id, nota_fiscal_id, parcela_id)
    SELECT inserted_op_id, p.nota_fiscal_id, p.id
    FROM public.nota_fiscal_parcelas p
    WHERE p.id = ANY(p_parcela_ids);

    UPDATE public.nota_fiscal_parcelas SET status = 'em_operacao' WHERE id = ANY(p_parcela_ids);
  END IF;

  UPDATE public.notas_fiscais nf
  SET status = 'em_antecipacao'
  WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id AND nf.cedente_fundo_id = p_cedente_fundo_id
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = nf.id AND p.status = 'disponivel');

  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (actor_id, 'OPERACAO_SOLICITADA', 'operacoes', inserted_op_id, jsonb_build_object(
      'solicitado_por_role', actor_role,
      'consultor_id', CASE WHEN actor_role = 'consultor' THEN private.consultor_organizacao_ativa_do_usuario(actor_id) ELSE NULL END,
      'cedente_id', p_cedente_id,
      'valor_bruto_total', p_valor_bruto_total, 'taxa_desconto', p_taxa_desconto, 'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids, 'parcela_ids', p_parcela_ids, 'cedente_fundo_id', p_cedente_fundo_id,
      'politica_atribuicao_id', politica_atribuicao_row.id, 'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
  ));

  RETURN jsonb_build_object('operacao_id', inserted_op_id, 'idempotent_replay', false, 'status', 'solicitada',
    'politica_atribuicao_id', politica_atribuicao_row.id);
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
  v_base_inputs jsonb;
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

  -- Same lock ordering as the canonical creation RPC. Serialize policy/input changes.
  PERFORM 1 FROM public.cedentes WHERE id=p_cedente_id FOR UPDATE;
  PERFORM 1 FROM public.cedente_fundos WHERE id=p_cedente_fundo_id FOR UPDATE;
  PERFORM 1 FROM public.notas_fiscais WHERE id=ANY(p_nota_fiscal_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.nota_fiscal_parcelas WHERE id=ANY(p_parcela_ids) ORDER BY id FOR UPDATE;
  v_base_inputs := private.capturar_base_antecipacao(p_cedente_fundo_id,p_politica_operacional_versao_id,p_nota_fiscal_ids,p_parcela_ids);

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
      private.valor_base_antecipacao_snapshot(v_base_inputs,v_item.nota_fiscal_id,v_item.parcela_id,v_item.valor_nominal),
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

    memoria := private.calcular_memoria_financeira_nf(nf.id, private.valor_base_antecipacao_snapshot(op.base_antecipacao_snapshot,nf.id,NULL,nf.valor_bruto), p_taxa_desconto, data_base, nf.data_vencimento, metodo);

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

    memoria := private.calcular_memoria_financeira_nf(nf.id, private.valor_base_antecipacao_snapshot(op.base_antecipacao_snapshot,nf.id,parcela.id,parcela.valor_nominal), p_taxa_desconto, data_base, parcela.data_vencimento, metodo);

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
        v_memoria := private.calcular_memoria_financeira_nf(v_nf.id,private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf.id,v_parcela.id,v_parcela.valor_nominal),p_taxa_desconto,v_data_base,v_parcela.data_vencimento,v_metodo);
        IF nullif(v_memoria->>'valor_presente','') IS NULL THEN v_ausentes:=v_ausentes+1; ELSE v_total:=v_total+(v_memoria->>'valor_presente')::numeric; END IF;
        v_itens:=v_itens||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('nota_fiscal_id',v_nf.id,'parcela_id',v_parcela.id,'valor_aquisicao',v_memoria->>'valor_presente'));
        v_count:=v_count+1;
      END LOOP;
    ELSE
      v_memoria := private.calcular_memoria_financeira_nf(v_nf.id,private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf.id,NULL,v_nf.valor_bruto),p_taxa_desconto,v_data_base,v_nf.data_vencimento,v_metodo);
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

-- Removal retains the original snapshot; only currently linked items enter totals.
CREATE OR REPLACE FUNCTION public.remover_nf_operacao_gestor_atomica(
  p_operacao_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.get_user_role();
  v_op record;
  v_nf record;
  v_nf_restante record;
  v_parcela record;
  v_memoria jsonb;
  v_metodo text;
  v_data_base date;
  v_tem_parcelas boolean;
  v_quantidade_restante integer := 0;
  v_aceitas integer := 0;
  v_contestadas integer := 0;
  v_vinculos_removidos integer := 0;
  v_parcelas_liberadas integer := 0;
  v_valor_bruto numeric(18,2) := 0;
  v_valor_liquido numeric(18,2) := 0;
  v_aceite_status text;
  v_aceite_em timestamptz;
  v_operacao_cancelada boolean := false;
BEGIN
  IF v_actor_id IS NULL OR v_actor_role IS DISTINCT FROM 'gestor' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Apenas gestores autenticados podem remover NFs da operacao';
  END IF;

  SELECT o.*, cf.fundo_id
    INTO v_op
    FROM public.operacoes o
    JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
   WHERE o.id = p_operacao_id
   FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;
  IF NOT private.usuario_tem_acesso_fundo(v_op.fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem acesso ao fundo desta operacao';
  END IF;
  IF v_op.status::text NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Nao e possivel remover NFs de uma operacao com status "%"', v_op.status;
  END IF;

  SELECT nf.id, nf.numero_nf, nf.status, nf.valor_bruto
    INTO v_nf
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
   WHERE onf.operacao_id = p_operacao_id
     AND onf.nota_fiscal_id = p_nota_fiscal_id
   FOR UPDATE OF onf, nf;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF nao encontrada nesta operacao';
  END IF;

  WITH parcelas_da_nf AS (
    SELECT parcela_id
      FROM public.operacoes_nf_parcelas
     WHERE operacao_id = p_operacao_id
       AND nota_fiscal_id = p_nota_fiscal_id
  )
  UPDATE public.nota_fiscal_parcelas parcela
     SET status = 'disponivel'
   WHERE parcela.id IN (SELECT parcela_id FROM parcelas_da_nf);
  GET DIAGNOSTICS v_parcelas_liberadas = ROW_COUNT;

  DELETE FROM public.operacoes_nf_parcelas
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;

  DELETE FROM public.operacao_calculo_nfs
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;

  DELETE FROM public.operacoes_nfs
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;
  GET DIAGNOSTICS v_vinculos_removidos = ROW_COUNT;

  IF v_vinculos_removidos <> 1 THEN
    RAISE EXCEPTION 'Falha ao remover o vinculo da NF da operacao';
  END IF;

  UPDATE public.notas_fiscais
     SET status = 'aprovada',
         aprovacao_sacado_em = NULL,
         valor_antecipado = NULL
   WHERE id = p_nota_fiscal_id;

  SELECT count(*),
         count(*) FILTER (WHERE nf.status::text = 'aceita'),
         count(*) FILTER (WHERE nf.status::text = 'contestada'),
         max(nf.aprovacao_sacado_em)
    INTO v_quantidade_restante, v_aceitas, v_contestadas, v_aceite_em
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
   WHERE onf.operacao_id = p_operacao_id;

  IF v_quantidade_restante = 0 THEN
    UPDATE public.operacoes
       SET status = 'cancelada'
     WHERE id = p_operacao_id;
    v_operacao_cancelada := true;
  ELSE
    v_metodo := coalesce(
      v_op.metodo_calculo_financeiro,
      v_op.politica_snapshot #>> '{calculo_financeiro,metodo}',
      'LEGADO_MENSAL_DIAS_REAIS_30'
    );
    v_data_base := coalesce(
      v_op.calculo_data_base,
      (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date
    );

    FOR v_nf_restante IN
      SELECT nf.*
        FROM public.operacoes_nfs onf
        JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
       WHERE onf.operacao_id = p_operacao_id
       ORDER BY nf.id
    LOOP
      SELECT EXISTS (
        SELECT 1
          FROM public.operacoes_nf_parcelas onp
         WHERE onp.operacao_id = p_operacao_id
           AND onp.nota_fiscal_id = v_nf_restante.id
      ) INTO v_tem_parcelas;

      IF v_tem_parcelas THEN
        FOR v_parcela IN
          SELECT parcela.id, parcela.valor_nominal, parcela.data_vencimento
            FROM public.operacoes_nf_parcelas onp
            JOIN public.nota_fiscal_parcelas parcela ON parcela.id = onp.parcela_id
           WHERE onp.operacao_id = p_operacao_id
             AND onp.nota_fiscal_id = v_nf_restante.id
           ORDER BY parcela.numero_parcela
        LOOP
          v_valor_bruto := v_valor_bruto + private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf_restante.id,v_parcela.id,v_parcela.valor_nominal);
          IF v_op.taxa_desconto IS NOT NULL THEN
            v_memoria := private.calcular_memoria_financeira_nf(
              v_nf_restante.id,
              private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf_restante.id,v_parcela.id,v_parcela.valor_nominal),
              v_op.taxa_desconto,
              v_data_base,
              v_parcela.data_vencimento,
              v_metodo
            );
            v_valor_liquido := v_valor_liquido + (v_memoria->>'valor_presente')::numeric;
          END IF;
        END LOOP;
      ELSE
        v_valor_bruto := v_valor_bruto + private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf_restante.id,NULL,v_nf_restante.valor_bruto);
        IF v_op.taxa_desconto IS NOT NULL THEN
          v_memoria := private.calcular_memoria_financeira_nf(
            v_nf_restante.id,
            private.valor_base_antecipacao_snapshot(v_op.base_antecipacao_snapshot,v_nf_restante.id,NULL,v_nf_restante.valor_bruto),
            v_op.taxa_desconto,
            v_data_base,
            v_nf_restante.data_vencimento,
            v_metodo
          );
          v_valor_liquido := v_valor_liquido + (v_memoria->>'valor_presente')::numeric;
        END IF;
      END IF;
    END LOOP;

    IF v_op.aceite_sacado_exigido IS FALSE OR v_op.aceite_sacado_status = 'dispensado' THEN
      v_aceite_status := 'dispensado';
      v_aceite_em := NULL;
    ELSIF v_contestadas > 0 THEN
      v_aceite_status := 'contestado';
      v_aceite_em := NULL;
    ELSIF v_aceitas = v_quantidade_restante THEN
      v_aceite_status := 'aceito';
    ELSE
      v_aceite_status := 'pendente';
      v_aceite_em := NULL;
    END IF;

    UPDATE public.operacoes
       SET valor_bruto_total = round(v_valor_bruto, 2),
           valor_liquido_desembolso = CASE
             WHEN v_op.taxa_desconto IS NULL THEN NULL
             ELSE round(v_valor_liquido, 2)
           END,
           aceite_sacado_status = v_aceite_status,
           aceite_sacado_em = v_aceite_em
     WHERE id = p_operacao_id;
  END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id,
    ator_tipo,
    origem,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois
  ) VALUES (
    v_actor_id,
    'usuario',
    'rpc_gestor',
    'NF_REMOVIDA_OPERACAO',
    'operacoes',
    p_operacao_id,
    pg_catalog.jsonb_build_object(
      'nf_removida', v_nf.numero_nf,
      'valor_bruto_total', v_op.valor_bruto_total,
      'valor_liquido_desembolso', v_op.valor_liquido_desembolso,
      'aceite_sacado_status', v_op.aceite_sacado_status
    ),
    pg_catalog.jsonb_build_object(
      'nf_removida', v_nf.numero_nf,
      'operacao_cancelada', v_operacao_cancelada,
      'quantidade_nfs', v_quantidade_restante,
      'novo_valor_bruto', CASE WHEN v_operacao_cancelada THEN 0 ELSE round(v_valor_bruto, 2) END,
      'novo_valor_liquido', CASE
        WHEN v_operacao_cancelada OR v_op.taxa_desconto IS NULL THEN NULL
        ELSE round(v_valor_liquido, 2)
      END,
      'parcelas_liberadas', v_parcelas_liberadas,
      'aceite_sacado_status', CASE WHEN v_operacao_cancelada THEN v_op.aceite_sacado_status ELSE v_aceite_status END
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'operacao_id', p_operacao_id,
    'cedente_id', v_op.cedente_id,
    'nota_fiscal_id', p_nota_fiscal_id,
    'numero_nf', v_nf.numero_nf,
    'operacao_cancelada', v_operacao_cancelada,
    'quantidade_nfs', v_quantidade_restante,
    'novo_valor_bruto', CASE WHEN v_operacao_cancelada THEN 0 ELSE round(v_valor_bruto, 2) END,
    'novo_valor_liquido', CASE
      WHEN v_operacao_cancelada OR v_op.taxa_desconto IS NULL THEN NULL
      ELSE round(v_valor_liquido, 2)
    END,
    'parcelas_liberadas', v_parcelas_liberadas,
    'aceite_sacado_status', CASE WHEN v_operacao_cancelada THEN v_op.aceite_sacado_status ELSE v_aceite_status END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) IS
  'Remove uma NF de operacao pre-aprovacao de forma atomica, libera parcelas, limpa memoria, recalcula totais e recompõe o aceite agregado. Valida gestor e acesso ao fundo internamente.';

NOTIFY pgrst, 'reload schema';
COMMIT;
