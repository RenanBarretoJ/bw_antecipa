-- Corrige a geração de requisitos documentais pós-cessão para usar a fonte de
-- verdade imutável da operação: operacoes.politica_snapshot.
--
-- Causa raiz:
-- - public.desembolsar_operacao_com_logistica criava requisitos de entrega
--   consultando public.politica_requisitos_documentais diretamente e ainda
--   continha fallbacks legados para CT-e/canhoto.
-- - "cria_acompanhamento_entrega" deve apenas abrir a logística; os documentos
--   exigidos vêm exclusivamente do snapshot da política aplicada à operação.

CREATE OR REPLACE FUNCTION public.desembolsar_operacao_com_logistica(p_operacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op record;
  escrow_saldo numeric;
  novo_saldo numeric;
  now_ts timestamptz := now();
  cria_entrega boolean;
  cte_prazo integer;
  comprovante_prazo integer;
  nf record;
  entrega_id uuid;
  inserted_deliveries integer := 0;
  inserted_requirements integer := 0;
  req record;
  req_prazo_limite date;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode desembolsar operacao';
  END IF;

  SELECT * INTO op FROM public.operacoes WHERE id = p_operacao_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF op.status <> 'aprovada' THEN RAISE EXCEPTION 'Operacao nao esta aprovada para desembolso'; END IF;
  IF op.termo_assinado_url IS NULL THEN RAISE EXCEPTION 'Termo de cessao assinado ausente'; END IF;
  IF op.comprovante_pagamento_url IS NULL THEN RAISE EXCEPTION 'Comprovante de desembolso ausente'; END IF;
  IF op.politica_snapshot IS NULL OR op.politica_operacional_versao_id IS NULL THEN
    RAISE EXCEPTION 'Operacao sem snapshot de politica operacional';
  END IF;

  SELECT saldo_disponivel INTO escrow_saldo FROM public.contas_escrow WHERE id = op.conta_escrow_id FOR UPDATE;
  IF escrow_saldo IS NULL THEN RAISE EXCEPTION 'Conta escrow nao encontrada'; END IF;
  novo_saldo := escrow_saldo + op.valor_liquido_desembolso;

  cria_entrega := COALESCE((op.politica_snapshot->>'cria_acompanhamento_entrega')::boolean, false);

  SELECT min(NULLIF(item->>'prazo_dias_corridos', '')::integer)
    INTO cte_prazo
  FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
  WHERE COALESCE((item->>'ativo')::boolean, false)
    AND item->>'escopo' IN ('pos_cessao', 'entrega')
    AND COALESCE(item->>'tipo_documento_codigo', item->>'codigo') = 'cte'
    AND NULLIF(item->>'prazo_dias_corridos', '') IS NOT NULL;

  SELECT min(NULLIF(item->>'prazo_dias_corridos', '')::integer)
    INTO comprovante_prazo
  FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
  WHERE COALESCE((item->>'ativo')::boolean, false)
    AND item->>'escopo' IN ('pos_cessao', 'entrega')
    AND COALESCE(item->>'tipo_documento_codigo', item->>'codigo') IN ('canhoto', 'comprovante_entrega')
    AND NULLIF(item->>'prazo_dias_corridos', '') IS NOT NULL;

  UPDATE public.operacoes
  SET status = 'em_andamento',
      cessao_efetivada_em = COALESCE(cessao_efetivada_em, now_ts)
  WHERE id = p_operacao_id;

  UPDATE public.contas_escrow SET saldo_disponivel = novo_saldo WHERE id = op.conta_escrow_id;

  INSERT INTO public.movimentos_escrow (
    conta_escrow_id, tipo, descricao, valor, saldo_apos, operacao_id
  )
  VALUES (
    op.conta_escrow_id, 'credito',
    'Desembolso antecipacao - Operacao ' || substring(p_operacao_id::text from 1 for 8),
    op.valor_liquido_desembolso, novo_saldo, p_operacao_id
  );

  FOR nf IN
    SELECT n.id, n.cedente_id
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
  LOOP
    INSERT INTO public.nota_fiscal_entregas (
      operacao_id, nota_fiscal_id, status_entrega, cessao_efetivada_em,
      data_limite_cte, data_limite_canhoto
    )
    VALUES (
      p_operacao_id, nf.id,
      CASE WHEN cria_entrega THEN 'em_transito' ELSE 'nao_aplicavel' END,
      now_ts,
      CASE WHEN cria_entrega AND cte_prazo IS NOT NULL THEN (now_ts::date + cte_prazo) ELSE NULL END,
      CASE WHEN cria_entrega AND comprovante_prazo IS NOT NULL THEN (now_ts::date + comprovante_prazo) ELSE NULL END
    )
    ON CONFLICT (operacao_id, nota_fiscal_id) DO UPDATE
      SET status_entrega = public.nota_fiscal_entregas.status_entrega
    RETURNING id INTO entrega_id;

    inserted_deliveries := inserted_deliveries + 1;
    PERFORM public.registrar_evento_entrega(
      entrega_id,
      'cessao_efetivada',
      NULL,
      CASE WHEN cria_entrega THEN 'em_transito' ELSE 'nao_aplicavel' END,
      'sistema',
      jsonb_build_object('operacao_id', p_operacao_id)
    );

    IF cria_entrega THEN
      FOR req IN
        SELECT
          COALESCE(NULLIF(item->>'id', '')::uuid, pr.id) AS politica_requisito_id,
          pr.politica_operacional_id,
          pr.politica_operacional_versao_id,
          COALESCE(NULLIF(item->>'documento_tipo_id', '')::uuid, pr.documento_tipo_id, dt.id) AS documento_tipo_id,
          item->>'codigo' AS codigo,
          COALESCE(item->>'tipo_documento_codigo', item->>'codigo') AS tipo_documento_codigo,
          item->>'escopo' AS escopo,
          COALESCE((item->>'obrigatorio')::boolean, pr.obrigatorio) AS obrigatorio,
          NULLIF(item->>'prazo_dias_corridos', '')::integer AS prazo_dias_corridos,
          COALESCE(
            CASE
              WHEN jsonb_typeof(item->'formatos_aceitos') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(item->'formatos_aceitos'))
              ELSE NULL
            END,
            pr.formatos_aceitos
          ) AS formatos_aceitos,
          COALESCE(NULLIF(item->>'nivel_validacao', ''), pr.nivel_validacao) AS nivel_validacao,
          COALESCE(NULLIF(item->>'quantidade_minima', '')::integer, pr.quantidade_minima) AS quantidade_minima,
          COALESCE(NULLIF(item->>'responsavel_upload', ''), pr.responsavel_upload) AS responsavel_upload,
          COALESCE(NULLIF(item->>'responsavel_aprovacao', ''), pr.responsavel_aprovacao) AS responsavel_aprovacao
        FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
        JOIN public.politica_requisitos_documentais pr
          ON pr.politica_operacional_versao_id = op.politica_operacional_versao_id
         AND (
           pr.id = NULLIF(item->>'id', '')::uuid
           OR pr.codigo = item->>'codigo'
           OR pr.tipo_documento_codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
         )
        LEFT JOIN public.documento_tipos dt
          ON dt.codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
         AND dt.ativo = true
        WHERE COALESCE((item->>'ativo')::boolean, false)
          AND item->>'escopo' IN ('pos_cessao', 'entrega')
      LOOP
        req_prazo_limite := CASE
          WHEN req.prazo_dias_corridos IS NOT NULL THEN now_ts::date + req.prazo_dias_corridos
          ELSE NULL
        END;

        INSERT INTO public.documento_requisito_instancias (
          politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
          documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_entrega_id,
          cedente_id, status, obrigatorio, prazo_limite, formatos_aceitos_snapshot,
          nivel_validacao_snapshot, quantidade_minima_snapshot, responsavel_upload_snapshot,
          responsavel_aprovacao_snapshot
        )
        VALUES (
          req.politica_requisito_id, req.politica_operacional_id, req.politica_operacional_versao_id, op.politica_versao,
          req.documento_tipo_id, req.tipo_documento_codigo, req.escopo, entrega_id,
          op.cedente_id, 'pendente', req.obrigatorio, req_prazo_limite,
          req.formatos_aceitos, req.nivel_validacao, req.quantidade_minima,
          req.responsavel_upload, req.responsavel_aprovacao
        )
        ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id) DO UPDATE
          SET documento_tipo_id = COALESCE(documento_requisito_instancias.documento_tipo_id, EXCLUDED.documento_tipo_id),
              prazo_limite = COALESCE(documento_requisito_instancias.prazo_limite, EXCLUDED.prazo_limite);

        inserted_requirements := inserted_requirements + 1;

        PERFORM public.registrar_evento_entrega(
          entrega_id,
          CASE WHEN req.tipo_documento_codigo = 'cte' THEN 'cte_pendente' ELSE 'canhoto_pendente' END,
          'em_transito',
          'em_transito',
          'sistema',
          jsonb_build_object(
            'tipo_documento_codigo', req.tipo_documento_codigo,
            'prazo_limite', req_prazo_limite,
            'codigo_requisito', req.codigo,
            'fonte', 'politica_snapshot'
          )
        );
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT c.user_id, 'Cessao efetivada',
         'A operacao ' || substring(p_operacao_id::text from 1 for 8) || ' foi desembolsada e a cessao foi efetivada.',
         'cessao_efetivada',
         'operacao:' || p_operacao_id::text || ':cessao_efetivada:' || c.user_id::text
  FROM public.cedentes c WHERE c.id = op.cedente_id
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'saldo_apos', novo_saldo,
    'entregas', inserted_deliveries,
    'requisitos_pos_cessao', inserted_requirements,
    'cria_acompanhamento_entrega', cria_entrega,
    'fonte_requisitos', 'politica_snapshot'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reparar_requisitos_pos_cessao_operacao(p_operacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  op record;
  entrega record;
  req record;
  removed_count integer := 0;
  inserted_count integer := 0;
  req_prazo_limite date;
  deleted_ids uuid[];
BEGIN
  IF actor_id IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode reparar requisitos pos-cessao';
  END IF;

  SELECT * INTO op FROM public.operacoes WHERE id = p_operacao_id;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF op.politica_snapshot IS NULL OR op.politica_operacional_versao_id IS NULL THEN
    RAISE EXCEPTION 'Operacao sem snapshot de politica operacional';
  END IF;

  FOR entrega IN
    SELECT nfe.*
    FROM public.nota_fiscal_entregas nfe
    WHERE nfe.operacao_id = p_operacao_id
      AND nfe.status_entrega <> 'nao_aplicavel'
  LOOP
    WITH removiveis AS (
      SELECT dri.id
      FROM public.documento_requisito_instancias dri
      WHERE dri.nota_fiscal_entrega_id = entrega.id
        AND dri.status = 'pendente'
        AND dri.documento_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
          WHERE COALESCE((item->>'ativo')::boolean, false)
            AND item->>'escopo' IN ('pos_cessao', 'entrega')
            AND (
              NULLIF(item->>'id', '')::uuid = dri.politica_requisito_id
              OR (
                NULLIF(item->>'id', '') IS NULL
                AND COALESCE(item->>'tipo_documento_codigo', item->>'codigo') = dri.tipo_documento_codigo_snapshot
                AND item->>'escopo' = dri.escopo_snapshot
              )
            )
        )
    ),
    deleted AS (
      DELETE FROM public.documento_requisito_instancias dri
      USING removiveis r
      WHERE dri.id = r.id
      RETURNING dri.id
    )
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO deleted_ids FROM deleted;

    removed_count := removed_count + coalesce(array_length(deleted_ids, 1), 0);

    FOR req IN
      SELECT
        COALESCE(NULLIF(item->>'id', '')::uuid, pr.id) AS politica_requisito_id,
        pr.politica_operacional_id,
        pr.politica_operacional_versao_id,
        COALESCE(NULLIF(item->>'documento_tipo_id', '')::uuid, pr.documento_tipo_id, dt.id) AS documento_tipo_id,
        item->>'codigo' AS codigo,
        COALESCE(item->>'tipo_documento_codigo', item->>'codigo') AS tipo_documento_codigo,
        item->>'escopo' AS escopo,
        COALESCE((item->>'obrigatorio')::boolean, pr.obrigatorio) AS obrigatorio,
        NULLIF(item->>'prazo_dias_corridos', '')::integer AS prazo_dias_corridos,
        COALESCE(
          CASE
            WHEN jsonb_typeof(item->'formatos_aceitos') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(item->'formatos_aceitos'))
            ELSE NULL
          END,
          pr.formatos_aceitos
        ) AS formatos_aceitos,
        COALESCE(NULLIF(item->>'nivel_validacao', ''), pr.nivel_validacao) AS nivel_validacao,
        COALESCE(NULLIF(item->>'quantidade_minima', '')::integer, pr.quantidade_minima) AS quantidade_minima,
        COALESCE(NULLIF(item->>'responsavel_upload', ''), pr.responsavel_upload) AS responsavel_upload,
        COALESCE(NULLIF(item->>'responsavel_aprovacao', ''), pr.responsavel_aprovacao) AS responsavel_aprovacao
      FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
      JOIN public.politica_requisitos_documentais pr
        ON pr.politica_operacional_versao_id = op.politica_operacional_versao_id
       AND (
         pr.id = NULLIF(item->>'id', '')::uuid
         OR pr.codigo = item->>'codigo'
         OR pr.tipo_documento_codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
       )
      LEFT JOIN public.documento_tipos dt
        ON dt.codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
       AND dt.ativo = true
      WHERE COALESCE((item->>'ativo')::boolean, false)
        AND item->>'escopo' IN ('pos_cessao', 'entrega')
        AND NOT EXISTS (
          SELECT 1
          FROM public.documento_requisito_instancias existing
          WHERE existing.nota_fiscal_entrega_id = entrega.id
            AND existing.politica_requisito_id = COALESCE(NULLIF(item->>'id', '')::uuid, pr.id)
        )
    LOOP
      req_prazo_limite := CASE
        WHEN req.prazo_dias_corridos IS NOT NULL THEN COALESCE(entrega.cessao_efetivada_em, now())::date + req.prazo_dias_corridos
        ELSE NULL
      END;

      INSERT INTO public.documento_requisito_instancias (
        politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
        documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_entrega_id,
        cedente_id, status, obrigatorio, prazo_limite, formatos_aceitos_snapshot,
        nivel_validacao_snapshot, quantidade_minima_snapshot, responsavel_upload_snapshot,
        responsavel_aprovacao_snapshot
      )
      VALUES (
        req.politica_requisito_id, req.politica_operacional_id, req.politica_operacional_versao_id, op.politica_versao,
        req.documento_tipo_id, req.tipo_documento_codigo, req.escopo, entrega.id,
        op.cedente_id, 'pendente', req.obrigatorio, req_prazo_limite,
        req.formatos_aceitos, req.nivel_validacao, req.quantidade_minima,
        req.responsavel_upload, req.responsavel_aprovacao
      )
      ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id) DO NOTHING;

      inserted_count := inserted_count + 1;
    END LOOP;
  END LOOP;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  )
  VALUES (
    actor_id,
    'usuario',
    'rpc',
    'REPARO_REQUISITOS_POS_CESSAO',
    'operacoes',
    p_operacao_id,
    jsonb_build_object('removidos', removed_count, 'criados', inserted_count, 'fonte', 'politica_snapshot')
  );

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'removidos', removed_count,
    'criados', inserted_count,
    'fonte', 'politica_snapshot'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.desembolsar_operacao_com_logistica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reparar_requisitos_pos_cessao_operacao(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.desembolsar_operacao_com_logistica(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reparar_requisitos_pos_cessao_operacao(uuid) FROM PUBLIC;
