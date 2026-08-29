-- Exclui NFs em rascunho sem deixar dependencias documentais orfas.
-- A remocao dos objetos do Storage ocorre na aplicacao somente apos o commit.

BEGIN;

CREATE OR REPLACE FUNCTION public.excluir_notas_fiscais_rascunho_cedente(
  p_nota_fiscal_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_cedente_id uuid;
  v_ids uuid[];
  v_documento_ids uuid[];
  v_evidencia_ids uuid[];
  v_total_encontrado integer := 0;
  v_total_invalido integer := 0;
  v_total_excluido integer := 0;
  v_storage_objects jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR public.get_user_role() <> 'cedente' THEN
    RAISE EXCEPTION 'Somente o cedente autenticado pode excluir notas fiscais em rascunho'
      USING ERRCODE = '42501';
  END IF;

  v_cedente_id := public.get_user_cedente_id();
  IF v_cedente_id IS NULL THEN
    RAISE EXCEPTION 'Cadastro de cedente nao encontrado'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT item.id ORDER BY item.id)
    INTO v_ids
  FROM unnest(coalesce(p_nota_fiscal_ids, ARRAY[]::uuid[])) AS item(id)
  WHERE item.id IS NOT NULL;

  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma nota fiscal para exclusao'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa exclusao e mudancas de status concorrentes.
  PERFORM nf.id
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids)
  FOR UPDATE;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE nf.cedente_id <> v_cedente_id
         OR nf.status::text <> 'rascunho'
    )::integer
  INTO v_total_encontrado, v_total_invalido
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  IF v_total_encontrado <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Uma ou mais notas fiscais nao foram encontradas para este cedente'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total_invalido > 0 THEN
    RAISE EXCEPTION 'Somente notas fiscais em rascunho podem ser excluidas'
      USING ERRCODE = 'P0001';
  END IF;

  -- Um rascunho que ja entrou no fluxo operacional nao pode perder historico.
  IF EXISTS (SELECT 1 FROM public.operacoes_nfs opnf WHERE opnf.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.nota_fiscal_entregas nfe WHERE nfe.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.operacao_calculo_nfs ocn WHERE ocn.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.operacao_nf_logistica_memorias onlm WHERE onlm.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (
       SELECT 1
       FROM public.nota_fiscal_entrega_postergacoes_canhoto nfep
       WHERE nfep.nota_fiscal_id = ANY(v_ids)
     )
  THEN
    RAISE EXCEPTION 'A nota fiscal ja possui movimentacao operacional e nao pode ser excluida'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('bucket', 'notas-fiscais', 'path', nf.arquivo_url)
      ORDER BY nf.id
    ) FILTER (WHERE nf.arquivo_url IS NOT NULL AND length(btrim(nf.arquivo_url)) > 0),
    '[]'::jsonb
  )
  INTO v_storage_objects
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  SELECT array_agg(DISTINCT refs.documento_id)
  INTO v_documento_ids
  FROM (
    SELECT dv.documento_id
    FROM public.documento_vinculos dv
    WHERE dv.nota_fiscal_id = ANY(v_ids)
    UNION
    SELECT dri.documento_id
    FROM public.documento_requisito_instancias dri
    WHERE dri.nota_fiscal_id = ANY(v_ids)
      AND dri.documento_id IS NOT NULL
    UNION
    SELECT ela.documento_id
    FROM public.evidencias_logisticas_antecipadas ela
    WHERE ela.nota_fiscal_id = ANY(v_ids)
  ) refs;

  SELECT array_agg(ela.id)
  INTO v_evidencia_ids
  FROM public.evidencias_logisticas_antecipadas ela
  WHERE ela.nota_fiscal_id = ANY(v_ids);

  IF coalesce(cardinality(v_evidencia_ids), 0) > 0 THEN
    DELETE FROM public.evidencia_logistica_versoes elv
    WHERE elv.evidencia_logistica_id = ANY(v_evidencia_ids);

    DELETE FROM public.evidencias_logisticas_antecipadas ela
    WHERE ela.id = ANY(v_evidencia_ids);
  END IF;

  DELETE FROM public.documento_requisito_instancias dri
  WHERE dri.nota_fiscal_id = ANY(v_ids);

  DELETE FROM public.documento_vinculos dv
  WHERE dv.nota_fiscal_id = ANY(v_ids);

  -- Preserva versoes e analises documentais. Documentos sem outro uso ficam
  -- cancelados e logicamente excluidos, em vez de perderem a trilha existente.
  IF coalesce(cardinality(v_documento_ids), 0) > 0 THEN
    UPDATE public.documentos_repositorio dr
       SET status = 'cancelado',
           deleted_at = coalesce(dr.deleted_at, now())
     WHERE dr.id = ANY(v_documento_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.documento_vinculos dv
         WHERE dv.documento_id = dr.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.documento_requisito_instancias dri
         WHERE dri.documento_id = dr.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.evidencias_logisticas_antecipadas ela
         WHERE ela.documento_id = dr.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.ctes cte
         WHERE cte.documento_id = dr.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.canhotos canhoto
         WHERE canhoto.documento_id = dr.id
       );
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
  )
  SELECT
    v_user_id,
    'usuario',
    'rpc_excluir_nf_rascunho_cedente',
    'NF_RASCUNHO_EXCLUIDA',
    'notas_fiscais',
    nf.id,
    jsonb_build_object(
      'status', nf.status,
      'numero_nf', nf.numero_nf,
      'cedente_id', nf.cedente_id
    ),
    jsonb_build_object('status', 'excluida')
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  DELETE FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids)
    AND nf.cedente_id = v_cedente_id
    AND nf.status::text = 'rascunho';

  GET DIAGNOSTICS v_total_excluido = ROW_COUNT;
  IF v_total_excluido <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Nao foi possivel concluir a exclusao dos rascunhos'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ids_excluidos', to_jsonb(v_ids),
    'total_excluido', v_total_excluido,
    'storage_objects', v_storage_objects
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_notas_fiscais_rascunho_cedente(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.excluir_notas_fiscais_rascunho_cedente(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.excluir_notas_fiscais_rascunho_cedente(uuid[]) TO authenticated;

COMMIT;
