-- Estabilizacao tecnica: atomicidade para solicitacao/aprovacao de operacao
-- e base de idempotencia para evitar duplicidade por retry.

ALTER TABLE public.operacoes
  ADD COLUMN IF NOT EXISTS solicitacao_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS operacoes_solicitacao_idempotency_key_unique
  ON public.operacoes(solicitacao_idempotency_key)
  WHERE solicitacao_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
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
  p_valor_bruto_total numeric,
  p_taxa_desconto numeric,
  p_prazo_dias integer,
  p_valor_liquido_desembolso numeric,
  p_data_vencimento date,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  cedente_row record;
  vinculo_row record;
  escrow_row record;
  existing_op record;
  expected_count integer;
  matched_count integer;
  already_linked_count integer;
  inserted_op_id uuid;
  now_ts timestamptz := now();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF actor_role <> 'cedente' THEN
    RAISE EXCEPTION 'Somente cedente pode solicitar antecipacao';
  END IF;

  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma NF';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN
    RAISE EXCEPTION 'Chave de idempotencia invalida';
  END IF;

  SELECT * INTO existing_op
  FROM public.operacoes
  WHERE solicitacao_idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'operacao_id', existing_op.id,
      'idempotent_replay', true,
      'status', existing_op.status
    );
  END IF;

  SELECT * INTO cedente_row
  FROM public.cedentes
  WHERE id = p_cedente_id
    AND user_id = actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastro de cedente nao encontrado para o usuario autenticado';
  END IF;

  IF cedente_row.status <> 'ativo' THEN
    RAISE EXCEPTION 'Cedente nao esta ativo';
  END IF;

  SELECT * INTO vinculo_row
  FROM public.cedente_fundos
  WHERE id = p_cedente_fundo_id
    AND cedente_id = p_cedente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado';
  END IF;

  IF vinculo_row.status <> 'ativo' THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.fundos f
    WHERE f.id = vinculo_row.fundo_id
      AND coalesce(f.ativo, true) = true
  ) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.politicas_operacionais p
    JOIN public.politica_operacional_versoes v
      ON v.id = p_politica_operacional_versao_id
     AND v.politica_operacional_id = p.id
     AND v.cedente_fundo_id = p.cedente_fundo_id
    WHERE p.id = p_politica_operacional_id
      AND p.cedente_fundo_id = p_cedente_fundo_id
      AND p.status = 'ativa'
      AND v.status = 'publicada'
      AND v.publicada_em IS NOT NULL
      AND v.versao = p_politica_versao
  ) THEN
    RAISE EXCEPTION 'Politica operacional vigente invalida para o vinculo';
  END IF;

  SELECT * INTO escrow_row
  FROM public.contas_escrow
  WHERE cedente_id = p_cedente_id
    AND status = 'ativa'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta escrow nao encontrada ou inativa';
  END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);

  WITH locked_nfs AS (
    SELECT nf.id
    FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
      AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count
  FROM locked_nfs;

  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas';
  END IF;

  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids);

  IF already_linked_count > 0 THEN
    RAISE EXCEPTION 'Uma ou mais NFs ja estao vinculadas a uma operacao';
  END IF;

  INSERT INTO public.operacoes (
    cedente_id,
    conta_escrow_id,
    valor_bruto_total,
    taxa_desconto,
    prazo_dias,
    valor_liquido_desembolso,
    data_vencimento,
    status,
    cedente_fundo_id,
    politica_operacional_id,
    politica_operacional_versao_id,
    politica_versao,
    politica_snapshot,
    politica_snapshot_hash,
    contexto_configuracao_status,
    contexto_capturado_em,
    aceite_sacado_exigido,
    aceite_sacado_status,
    aceite_sacado_em,
    cessao_efetivada_em,
    solicitacao_idempotency_key
  )
  VALUES (
    p_cedente_id,
    escrow_row.id,
    p_valor_bruto_total,
    p_taxa_desconto,
    p_prazo_dias,
    greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento,
    'solicitada',
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    'completo',
    now_ts,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END,
    NULL,
    p_idempotency_key
  )
  RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  UPDATE public.notas_fiscais
  SET status = 'em_antecipacao'
  WHERE id = ANY(p_nota_fiscal_ids)
    AND cedente_id = p_cedente_id
    AND cedente_fundo_id = p_cedente_fundo_id;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'Falha ao atualizar todas as NFs da operacao';
  END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_depois
  )
  VALUES (
    actor_id,
    'OPERACAO_SOLICITADA',
    'operacoes',
    inserted_op_id,
    jsonb_build_object(
      'valor_bruto_total', p_valor_bruto_total,
      'taxa_desconto', p_taxa_desconto,
      'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids,
      'cedente_fundo_id', p_cedente_fundo_id,
      'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', inserted_op_id,
    'idempotent_replay', false,
    'status', 'solicitada'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric,
  p_valor_liquido_desembolso numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  op record;
  nf record;
  prazo_dias_nf integer;
  fator numeric;
  base_nf numeric;
  valor_antecipado_nf numeric;
  soma_base numeric := 0;
  prazo_ponderado numeric := 0;
  prazo_medio integer := 0;
  nfs_count integer := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode aprovar operacao';
  END IF;

  IF p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa deve ser maior ou igual a zero';
  END IF;

  IF p_valor_liquido_desembolso <= 0 THEN
    RAISE EXCEPTION 'Valor liquido deve ser maior que zero';
  END IF;

  SELECT * INTO op
  FROM public.operacoes
  WHERE id = p_operacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;

  IF op.status = 'aprovada' THEN
    RETURN jsonb_build_object(
      'operacao_id', p_operacao_id,
      'idempotent_replay', true,
      'status', op.status,
      'prazo_dias', op.prazo_dias
    );
  END IF;

  IF op.status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status "%" nao pode ser aprovada', op.status;
  END IF;

  IF op.contexto_configuracao_status = 'completo'
     AND (
       op.cedente_fundo_id IS NULL
       OR op.politica_operacional_id IS NULL
       OR op.politica_operacional_versao_id IS NULL
       OR op.politica_snapshot IS NULL
     ) THEN
    RAISE EXCEPTION 'Operacao sem contexto operacional completo';
  END IF;

  FOR nf IN
    SELECT n.*
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
    FOR UPDATE OF n
  LOOP
    IF nf.cedente_id <> op.cedente_id THEN
      RAISE EXCEPTION 'NF fora do cedente da operacao';
    END IF;

    IF op.cedente_fundo_id IS NOT NULL AND nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id THEN
      RAISE EXCEPTION 'NF fora do vinculo cedente-fundo da operacao';
    END IF;

    IF nf.status NOT IN ('em_antecipacao', 'aceita') THEN
      RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf;
    END IF;

    prazo_dias_nf := greatest(1, ceil(extract(epoch FROM (nf.data_vencimento::timestamp - now()::timestamp)) / 86400.0)::integer);
    base_nf := coalesce(nf.valor_liquido, nf.valor_bruto);
    fator := power(1 + (p_taxa_desconto / 100), prazo_dias_nf::numeric / 30);
    valor_antecipado_nf := round((base_nf / fator)::numeric, 2);

    soma_base := soma_base + base_nf;
    prazo_ponderado := prazo_ponderado + (prazo_dias_nf * base_nf);
    nfs_count := nfs_count + 1;

    UPDATE public.notas_fiscais
    SET taxa_desagio = p_taxa_desconto,
        valor_antecipado = valor_antecipado_nf
    WHERE id = nf.id;
  END LOOP;

  IF nfs_count = 0 THEN
    RAISE EXCEPTION 'Operacao sem NFs vinculadas';
  END IF;

  IF soma_base > 0 THEN
    prazo_medio := round(prazo_ponderado / soma_base);
  END IF;

  UPDATE public.operacoes
  SET taxa_desconto = p_taxa_desconto,
      prazo_dias = prazo_medio,
      valor_liquido_desembolso = p_valor_liquido_desembolso,
      status = 'aprovada',
      aprovado_por = actor_id,
      aprovado_em = now()
  WHERE id = p_operacao_id;

  INSERT INTO public.logs_auditoria (
    usuario_id,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois
  )
  VALUES (
    actor_id,
    'OPERACAO_APROVADA',
    'operacoes',
    p_operacao_id,
    jsonb_build_object('status', op.status),
    jsonb_build_object(
      'status', 'aprovada',
      'taxa_desconto', p_taxa_desconto,
      'prazo_dias', prazo_medio,
      'valor_liquido_desembolso', p_valor_liquido_desembolso,
      'nfs', nfs_count
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'idempotent_replay', false,
    'status', 'aprovada',
    'prazo_dias', prazo_medio,
    'nfs', nfs_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[],
  numeric, numeric, integer, numeric, date, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[],
  numeric, numeric, integer, numeric, date, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric, numeric) TO authenticated;
