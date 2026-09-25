-- C4 - Consultor opera Notas Fiscais de um unico Cedente autorizado.
-- A autorizacao operacional reutiliza private.usuario_pode_operar_cedente,
-- certificada em C2/C3. Nenhuma policy concede acesso global por papel.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.usuario_pode_operar_cedente(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-condicoes C2/C3 ausentes para C4';
  END IF;
END;
$$;

DROP POLICY IF EXISTS notas_fiscais_consultor_select ON public.notas_fiscais;
CREATE POLICY notas_fiscais_consultor_select
  ON public.notas_fiscais FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id))
  );

DROP POLICY IF EXISTS notas_fiscais_consultor_insert ON public.notas_fiscais;
CREATE POLICY notas_fiscais_consultor_insert
  ON public.notas_fiscais FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id))
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
        AND cf.status = 'ativo'
        AND coalesce(f.ativo, true) = true
    )
  );

DROP POLICY IF EXISTS notas_fiscais_consultor_update ON public.notas_fiscais;
CREATE POLICY notas_fiscais_consultor_update
  ON public.notas_fiscais FOR UPDATE TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id))
  )
  WITH CHECK (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.cedente_fundos cf
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
        AND cf.status = 'ativo'
    )
  );

DROP POLICY IF EXISTS notas_fiscais_consultor_delete ON public.notas_fiscais;
CREATE POLICY notas_fiscais_consultor_delete
  ON public.notas_fiscais FOR DELETE TO authenticated
  USING (
    notas_fiscais.status::text = 'rascunho'
    AND (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id))
  );

DROP POLICY IF EXISTS storage_nfs_consultor_insert_c4 ON storage.objects;
CREATE POLICY storage_nfs_consultor_insert_c4
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    storage.objects.bucket_id = 'notas-fiscais'
    AND (SELECT public.get_user_role()) = 'consultor'
    AND (storage.foldername(storage.objects.name))[2] = 'nf'
    AND EXISTS (
      SELECT 1
      FROM public.cedentes c
      WHERE (SELECT private.usuario_pode_operar_cedente(c.id))
        AND (storage.foldername(storage.objects.name))[1]
          = regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g')
        AND EXISTS (
          SELECT 1
          FROM public.cedente_fundos cf
          WHERE cf.cedente_id = c.id
            AND cf.status = 'ativo'
            AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
        )
    )
  );

DROP POLICY IF EXISTS nota_fiscal_parcelas_cedente_select ON public.nota_fiscal_parcelas;
DROP POLICY IF EXISTS nota_fiscal_parcelas_consultor_select_c4 ON public.nota_fiscal_parcelas;
CREATE POLICY nota_fiscal_parcelas_cedente_select
  ON public.nota_fiscal_parcelas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = nota_fiscal_parcelas.nota_fiscal_id
        AND (
          (
            (SELECT public.get_user_role()) = 'cedente'
            AND nf.cedente_id = (SELECT public.get_user_cedente_id())
          )
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.usuario_pode_operar_cedente(nf.cedente_id))
            AND (SELECT private.consultor_tem_acesso_fundo(nf.fundo_id))
          )
        )
    )
  );

-- A RPC de parcelas permanece atomica, agora aceitando Consultor somente
-- quando a NF pertence a um Cedente operacionalmente autorizado.
CREATE OR REPLACE FUNCTION public.registrar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nf public.notas_fiscais%ROWTYPE;
  v_item jsonb;
  v_soma numeric(15,2) := 0;
  v_tolerancia numeric(15,2);
  v_inseridas integer := 0;
  v_role text := public.get_user_role();
BEGIN
  IF (SELECT auth.uid()) IS NULL OR v_role NOT IN ('gestor', 'cedente', 'consultor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar parcelas';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf.id IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF v_role = 'cedente' AND v_nf.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF v_role = 'consultor' AND (
    NOT (SELECT private.usuario_pode_operar_cedente(v_nf.cedente_id))
    OR NOT (SELECT private.consultor_tem_acesso_fundo(v_nf.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;
  IF v_role = 'gestor' AND NOT private.gestor_tem_acesso_cedente(v_nf.cedente_id) THEN
    RAISE EXCEPTION 'Gestor sem vinculo ativo com o fundo desta nota fiscal';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id = p_nota_fiscal_id) THEN
    RAISE EXCEPTION 'Nota fiscal ja possui parcelas registradas';
  END IF;
  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Lista de parcelas invalida';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NOT (v_item ? 'numero_parcela' AND v_item ? 'valor_nominal' AND v_item ? 'data_vencimento') THEN
      RAISE EXCEPTION 'Parcela com campos obrigatorios ausentes';
    END IF;
    INSERT INTO public.nota_fiscal_parcelas (nota_fiscal_id, numero_parcela, valor_nominal, data_vencimento, origem)
    VALUES (
      p_nota_fiscal_id,
      (v_item->>'numero_parcela')::integer,
      (v_item->>'valor_nominal')::numeric,
      (v_item->>'data_vencimento')::date,
      coalesce(v_item->>'origem', 'xml_nfe')
    );
    v_soma := v_soma + (v_item->>'valor_nominal')::numeric;
    v_inseridas := v_inseridas + 1;
  END LOOP;

  v_tolerancia := greatest(v_inseridas * 0.01, 0.01);
  IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN
    RAISE EXCEPTION 'Soma das parcelas (%) nao corresponde ao valor bruto da nota fiscal (%)', v_soma, v_nf.valor_bruto;
  END IF;

  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'parcelas_inseridas', v_inseridas, 'soma', v_soma);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_parcelas_nota_fiscal(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_parcelas_nota_fiscal(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_notas_fiscais_rascunho_operador(
  p_nota_fiscal_ids uuid[],
  p_cedente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := public.get_user_role();
  v_ids uuid[];
  v_documento_ids uuid[];
  v_evidencia_ids uuid[];
  v_total_encontrado integer := 0;
  v_total_invalido integer := 0;
  v_total_excluido integer := 0;
  v_storage_objects jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR v_role <> 'consultor' THEN
    RAISE EXCEPTION 'Somente Consultor autenticado pode usar esta operacao' USING ERRCODE = '42501';
  END IF;
  IF p_cedente_id IS NULL
     OR NOT (SELECT private.usuario_pode_operar_cedente(p_cedente_id)) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional ao Cedente informado' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT item.id ORDER BY item.id)
    INTO v_ids
  FROM unnest(coalesce(p_nota_fiscal_ids, ARRAY[]::uuid[])) AS item(id)
  WHERE item.id IS NOT NULL;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma nota fiscal para exclusao' USING ERRCODE = '22023';
  END IF;

  PERFORM nf.id
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids)
  FOR UPDATE;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE nf.cedente_id <> p_cedente_id
              OR nf.status::text <> 'rascunho'
              OR NOT (SELECT private.consultor_tem_acesso_fundo(nf.fundo_id))
         )::integer
    INTO v_total_encontrado, v_total_invalido
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  IF v_total_encontrado <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Uma ou mais notas fiscais nao foram encontradas para este cedente';
  END IF;
  IF v_total_invalido > 0 THEN
    RAISE EXCEPTION 'Somente notas fiscais em rascunho podem ser excluidas';
  END IF;

  IF EXISTS (SELECT 1 FROM public.operacoes_nfs opnf WHERE opnf.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.nota_fiscal_entregas nfe WHERE nfe.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.operacao_calculo_nfs ocn WHERE ocn.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (SELECT 1 FROM public.operacao_nf_logistica_memorias onlm WHERE onlm.nota_fiscal_id = ANY(v_ids))
     OR EXISTS (
       SELECT 1 FROM public.nota_fiscal_entrega_postergacoes_canhoto nfep
       WHERE nfep.nota_fiscal_id = ANY(v_ids)
     ) THEN
    RAISE EXCEPTION 'A nota fiscal ja possui movimentacao operacional e nao pode ser excluida';
  END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('bucket', 'notas-fiscais', 'path', nf.arquivo_url) ORDER BY nf.id)
      FILTER (WHERE nf.arquivo_url IS NOT NULL AND length(btrim(nf.arquivo_url)) > 0),
    '[]'::jsonb
  ) INTO v_storage_objects
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  SELECT array_agg(DISTINCT refs.documento_id)
  INTO v_documento_ids
  FROM (
    SELECT dv.documento_id FROM public.documento_vinculos dv WHERE dv.nota_fiscal_id = ANY(v_ids)
    UNION
    SELECT dri.documento_id FROM public.documento_requisito_instancias dri
      WHERE dri.nota_fiscal_id = ANY(v_ids) AND dri.documento_id IS NOT NULL
    UNION
    SELECT ela.documento_id FROM public.evidencias_logisticas_antecipadas ela
      WHERE ela.nota_fiscal_id = ANY(v_ids)
  ) refs;

  SELECT array_agg(ela.id) INTO v_evidencia_ids
  FROM public.evidencias_logisticas_antecipadas ela
  WHERE ela.nota_fiscal_id = ANY(v_ids);

  IF coalesce(cardinality(v_evidencia_ids), 0) > 0 THEN
    DELETE FROM public.evidencia_logistica_versoes WHERE evidencia_logistica_id = ANY(v_evidencia_ids);
    DELETE FROM public.evidencias_logisticas_antecipadas WHERE id = ANY(v_evidencia_ids);
  END IF;

  DELETE FROM public.documento_requisito_instancias WHERE nota_fiscal_id = ANY(v_ids);
  DELETE FROM public.documento_vinculos WHERE nota_fiscal_id = ANY(v_ids);

  IF coalesce(cardinality(v_documento_ids), 0) > 0 THEN
    UPDATE public.documentos_repositorio dr
       SET status = 'cancelado', deleted_at = coalesce(dr.deleted_at, now())
     WHERE dr.id = ANY(v_documento_ids)
       AND NOT EXISTS (SELECT 1 FROM public.documento_vinculos dv WHERE dv.documento_id = dr.id)
       AND NOT EXISTS (SELECT 1 FROM public.documento_requisito_instancias dri WHERE dri.documento_id = dr.id)
       AND NOT EXISTS (SELECT 1 FROM public.evidencias_logisticas_antecipadas ela WHERE ela.documento_id = dr.id)
       AND NOT EXISTS (SELECT 1 FROM public.ctes cte WHERE cte.documento_id = dr.id)
       AND NOT EXISTS (SELECT 1 FROM public.canhotos canhoto WHERE canhoto.documento_id = dr.id);
  END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  )
  SELECT v_user_id, 'usuario', 'rpc_excluir_nf_rascunho_consultor',
         'NF_RASCUNHO_EXCLUIDA', 'notas_fiscais', nf.id,
         jsonb_build_object('status', nf.status, 'numero_nf', nf.numero_nf, 'cedente_id', nf.cedente_id),
         jsonb_build_object('status', 'excluida', 'actor_role', v_role, 'cedente_id', p_cedente_id)
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids);

  DELETE FROM public.notas_fiscais nf
  WHERE nf.id = ANY(v_ids)
    AND nf.cedente_id = p_cedente_id
    AND nf.status::text = 'rascunho';

  GET DIAGNOSTICS v_total_excluido = ROW_COUNT;
  IF v_total_excluido <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Nao foi possivel concluir a exclusao dos rascunhos';
  END IF;

  RETURN jsonb_build_object(
    'ids_excluidos', to_jsonb(v_ids),
    'total_excluido', v_total_excluido,
    'storage_objects', v_storage_objects
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_notas_fiscais_rascunho_operador(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_notas_fiscais_rascunho_operador(uuid[], uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  version_number integer;
  affected_count integer;
  reconciliation jsonb;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente', 'consultor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;

  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF get_user_role() = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_cedente)
    OR NOT private.consultor_tem_acesso_fundo(nf_fundo)
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;

  SELECT pov.versao
    INTO version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundo_politicas cfp
    ON cfp.politica_operacional_id = po.id
   AND cfp.cedente_fundo_id = nf_cedente_fundo
   AND cfp.status = 'ativa'
   AND cfp.vigente_desde <= now()
   AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND po.fundo_id = nf_fundo
    AND po.status = 'ativa'
    AND pov.fundo_id = nf_fundo
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_ate IS NULL
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF version_number IS NULL THEN
    RAISE EXCEPTION 'Politica operacional publicada nao vinculada ao contexto da NF';
  END IF;

  WITH candidatos AS (
    SELECT r.*, dt.id AS resolved_documento_tipo_id, coalesce(dt.cardinalidade, 'por_nf') AS cardinalidade
    FROM public.politica_requisitos_documentais r
    LEFT JOIN public.documento_tipos dt ON dt.codigo = r.tipo_documento_codigo
    WHERE r.politica_operacional_versao_id = p_politica_versao_id
      AND r.escopo = 'nf_pre_cessao'
      AND r.ativo
  ),
  por_nf AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      NULL::uuid AS parcela_id
    FROM candidatos c
    WHERE c.cardinalidade = 'por_nf'
  ),
  por_parcela AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      p.id AS parcela_id
    FROM candidatos c
    JOIN public.nota_fiscal_parcelas p ON p.nota_fiscal_id = p_nota_fiscal_id
    WHERE c.cardinalidade = 'por_parcela'
  ),
  todos AS (
    SELECT * FROM por_nf UNION ALL SELECT * FROM por_parcela
  )
  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, parcela_id, cedente_id,
    status, obrigatorio, prazo_limite, formatos_aceitos_snapshot, nivel_validacao_snapshot,
    quantidade_minima_snapshot, responsavel_upload_snapshot, responsavel_aprovacao_snapshot
  )
  SELECT t.id, t.politica_operacional_id, t.politica_operacional_versao_id, version_number,
    t.documento_tipo_id, t.tipo_documento_codigo, t.escopo, p_nota_fiscal_id, t.parcela_id, nf_cedente,
    'pendente', t.obrigatorio,
    CASE WHEN t.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + t.prazo_dias_corridos) END,
    t.formatos_aceitos, t.nivel_validacao, t.quantidade_minima, t.responsavel_upload, t.responsavel_aprovacao
  FROM todos t
  ON CONFLICT (politica_requisito_id, nota_fiscal_id, parcela_id) DO UPDATE
    SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id);

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  UPDATE public.documento_requisito_instancias dri
  SET documento_tipo_id = dt.id
  FROM public.documento_tipos dt
  WHERE dri.nota_fiscal_id = p_nota_fiscal_id
    AND dt.codigo = dri.tipo_documento_codigo_snapshot
    AND dri.documento_tipo_id IS DISTINCT FROM dt.id;

  reconciliation := public.reconciliar_documentos_base_nf(p_nota_fiscal_id);

  PERFORM private.reconciliar_requisito_nf_remessa(p_nota_fiscal_id);

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'inseridos_ou_atualizados', affected_count,
    'documentos_base_reconciliados', COALESCE((reconciliation->>'reconciliados')::integer, 0),
    'politica_versao', version_number,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_documento_upload(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  actor_role := get_user_role();
  IF auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor') OR p_enviado_por <> auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN RAISE EXCEPTION 'NF fora do cedente autenticado'; END IF;
  IF actor_role = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_cedente)
    OR NOT private.consultor_tem_acesso_fundo(nf_fundo)
  ) THEN RAISE EXCEPTION 'Consultor sem acesso operacional a NF'; END IF;

  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id
    AND nota_fiscal_id = p_nota_fiscal_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> nf_cedente THEN RAISE EXCEPTION 'Requisito documental fora do cedente da NF'; END IF;
  IF NOT public.documento_tipo_compativel_com_requisito(requirement.tipo_documento_codigo_snapshot, p_documento_tipo_id) THEN
    RAISE EXCEPTION 'Tipo de documento nao corresponde ao requisito';
  END IF;
  IF p_bucket <> 'documentos-v2' OR length(p_path) = 0 OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;

  doc_id := requirement.documento_id;
  IF doc_id IS NULL THEN
    INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
    VALUES (p_documento_tipo_id, 'pendente', p_enviado_por)
    RETURNING id INTO doc_id;

    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_id, nf_cedente);
  ELSE
    UPDATE public.documentos_repositorio
    SET documento_tipo_id = p_documento_tipo_id
    WHERE id = doc_id
      AND documento_tipo_id IS DISTINCT FROM p_documento_tipo_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    'em_analise', p_substitui_versao_id, p_enviado_por
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'em_analise', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id,
      documento_tipo_id = p_documento_tipo_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
  WHERE id = p_requisito_id;

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.editar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nf public.notas_fiscais%ROWTYPE;
  v_item jsonb;
  v_parcela_id uuid;
  v_existente public.nota_fiscal_parcelas%ROWTYPE;
  v_soma numeric(15,2);
  v_tolerancia numeric(15,2);
  v_count_existentes integer;
  v_max_vencimento date;
  v_atualizadas integer := 0;
  v_ids_vistos uuid[] := ARRAY[]::uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT public.get_user_role()) NOT IN ('cedente', 'consultor') THEN
    RAISE EXCEPTION 'Somente Cedente ou Consultor autorizado pode editar parcelas';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf.id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;
  IF (SELECT public.get_user_role()) = 'cedente'
     AND v_nf.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF (SELECT public.get_user_role()) = 'consultor' AND (
    NOT (SELECT private.usuario_pode_operar_cedente(v_nf.cedente_id))
    OR NOT (SELECT private.consultor_tem_acesso_fundo(v_nf.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;
  IF v_nf.status::text <> 'rascunho' THEN
    RAISE EXCEPTION 'Parcelas so podem ser editadas enquanto a NF esta em rascunho';
  END IF;

  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Lista de parcelas invalida';
  END IF;

  SELECT count(*) INTO v_count_existentes
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  IF v_count_existentes = 0 THEN
    RAISE EXCEPTION 'Nota fiscal nao possui parcelas registradas';
  END IF;
  IF jsonb_array_length(p_parcelas) <> v_count_existentes THEN
    RAISE EXCEPTION 'A edicao deve informar todas as % parcelas existentes, sem adicionar ou remover', v_count_existentes;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NOT (v_item ? 'id' AND v_item ? 'valor_nominal' AND v_item ? 'data_vencimento') THEN
      RAISE EXCEPTION 'Parcela com campos obrigatorios ausentes';
    END IF;
    v_parcela_id := (v_item->>'id')::uuid;
    IF v_parcela_id = ANY(v_ids_vistos) THEN
      RAISE EXCEPTION 'Parcela duplicada na edicao: %', v_parcela_id;
    END IF;
    v_ids_vistos := v_ids_vistos || v_parcela_id;

    SELECT * INTO v_existente
    FROM public.nota_fiscal_parcelas
    WHERE id = v_parcela_id AND nota_fiscal_id = p_nota_fiscal_id
    FOR UPDATE;
    IF v_existente.id IS NULL THEN
      RAISE EXCEPTION 'Parcela nao pertence a esta nota fiscal';
    END IF;
    IF v_existente.status <> 'disponivel' THEN
      RAISE EXCEPTION 'Parcela numero % nao pode ser editada (status atual: %)', v_existente.numero_parcela, v_existente.status;
    END IF;

    -- Guarda D: nao permitir que uma parcela com boleto ja aprovado fique
    -- inconsistente (valor/vencimento do boleto x valor/vencimento da
    -- parcela) apos a edicao. So bloqueia quando o valor/vencimento desta
    -- parcela especifica esta de fato mudando -- a RPC exige o payload
    -- completo (todas as parcelas existentes) a cada chamada, entao uma
    -- parcela com boleto aprovado, passada sem alteracao apenas para
    -- completar o payload, nao pode travar a edicao das DEMAIS parcelas.
    IF (
      (v_item->>'valor_nominal')::numeric IS DISTINCT FROM v_existente.valor_nominal
      OR (v_item->>'data_vencimento')::date IS DISTINCT FROM v_existente.data_vencimento
    ) AND EXISTS (
      SELECT 1 FROM public.documento_requisito_instancias
      WHERE parcela_id = v_parcela_id
        AND tipo_documento_codigo_snapshot = 'boleto'
        AND status = 'satisfeito'
    ) THEN
      RAISE EXCEPTION 'Parcela numero % ja tem boleto aprovado; nao e possivel editar valor/vencimento', v_existente.numero_parcela;
    END IF;

    IF (v_item->>'valor_nominal')::numeric <= 0 THEN
      RAISE EXCEPTION 'Valor nominal invalido para a parcela numero %', v_existente.numero_parcela;
    END IF;

    UPDATE public.nota_fiscal_parcelas
    SET valor_nominal = (v_item->>'valor_nominal')::numeric,
        data_vencimento = (v_item->>'data_vencimento')::date
    WHERE id = v_parcela_id;
    v_atualizadas := v_atualizadas + 1;
  END LOOP;

  SELECT sum(valor_nominal) INTO v_soma
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  v_tolerancia := greatest(v_count_existentes * 0.01, 0.01);
  IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN
    RAISE EXCEPTION 'Soma das parcelas (%) nao corresponde ao valor bruto da nota fiscal (%)', v_soma, v_nf.valor_bruto;
  END IF;

  SELECT max(data_vencimento) INTO v_max_vencimento
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  UPDATE public.notas_fiscais SET data_vencimento = v_max_vencimento WHERE id = p_nota_fiscal_id;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'parcelas_atualizadas', v_atualizadas,
    'soma', v_soma,
    'vencimento_agregado', v_max_vencimento
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editar_parcelas_nota_fiscal(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_parcelas_nota_fiscal(uuid, jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.registrar_duplicata_versao(
  p_nota_fiscal_id uuid,
  p_duplicata_id uuid,
  p_numero text,
  p_numero_fatura text,
  p_parcela text,
  p_data_emissao date,
  p_data_vencimento date,
  p_valor_nominal numeric,
  p_nome_cedente text,
  p_cnpj_cedente text,
  p_nome_sacado text,
  p_cnpj_sacado text,
  p_local_pagamento text,
  p_aceite_textual text,
  p_aceite_detectado text,
  p_status text,
  p_metodo_extracao text,
  p_resultado_confronto text,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_texto_extraido text,
  p_campos_extraidos jsonb,
  p_evidencias jsonb,
  p_resultado_validacao jsonb,
  p_confianca numeric
)
RETURNS TABLE (duplicata_id uuid, duplicata_versao_id uuid, numero_versao integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_nf public.notas_fiscais%ROWTYPE;
  v_duplicata public.duplicatas%ROWTYPE;
  v_versao_id uuid;
  v_numero_versao integer;
  v_actor_name text;
  v_nova_duplicata boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF p_bucket <> 'documentos-v2' OR p_mime_type <> 'application/pdf' THEN
    RAISE EXCEPTION 'Documento de duplicata invalido';
  END IF;
  IF p_status NOT IN ('RASCUNHO', 'EXTRAIDA', 'REVISAR')
     OR p_metodo_extracao NOT IN ('AUTOMATICA', 'MANUAL')
     OR p_resultado_confronto NOT IN ('COERENTE', 'DIVERGENTE', 'INCOMPLETO')
     OR p_aceite_detectado NOT IN ('SIM', 'NAO', 'INDETERMINADO') THEN
    RAISE EXCEPTION 'Estado inicial da duplicata invalido';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais nf WHERE nf.id = p_nota_fiscal_id FOR SHARE;
  IF NOT FOUND OR v_nf.fundo_id IS NULL OR v_nf.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto operacional valido';
  END IF;
  IF p_path NOT LIKE v_nf.cedente_id::text || '/duplicatas/' || v_nf.id::text || '/%'
     OR position('..' in p_path) > 0 THEN
    RAISE EXCEPTION 'Caminho documental fora do contexto autorizado';
  END IF;
  IF NOT (
    (v_role = 'cedente' AND v_nf.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (
      v_role = 'consultor'
      AND (SELECT private.usuario_pode_operar_cedente(v_nf.cedente_id))
      AND (SELECT private.consultor_tem_acesso_fundo(v_nf.fundo_id))
    )
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_nf.fundo_id)))
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar duplicata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cedente_fundo_politicas cfp
    JOIN public.politicas_operacionais po ON po.id = cfp.politica_operacional_id
    JOIN public.politica_operacional_versoes pov ON pov.politica_operacional_id = po.id
    WHERE cfp.cedente_fundo_id = v_nf.cedente_fundo_id
      AND cfp.status = 'ativa'
      AND cfp.vigente_desde <= now()
      AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      AND po.fundo_id = v_nf.fundo_id
      AND po.status = 'ativa'
      AND pov.fundo_id = v_nf.fundo_id
      AND pov.status = 'publicada'
      AND pov.publicada_em IS NOT NULL
      AND pov.vigente_desde <= now()
      AND (pov.vigente_ate IS NULL OR pov.vigente_ate > now())
      AND pov.tipo_ativo_financeiro = 'DUPLICATA_MERCANTIL'
  ) THEN
    RAISE EXCEPTION 'A politica vigente nao utiliza Duplicata Mercantil';
  END IF;

  IF p_duplicata_id IS NOT NULL THEN
    SELECT * INTO v_duplicata FROM public.duplicatas d
    WHERE d.id = p_duplicata_id AND d.nota_fiscal_id = p_nota_fiscal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada no contexto da nota fiscal'; END IF;
  ELSIF nullif(btrim(p_numero), '') IS NOT NULL THEN
    SELECT * INTO v_duplicata FROM public.duplicatas d
    WHERE d.cedente_fundo_id = v_nf.cedente_fundo_id
      AND d.nota_fiscal_id = p_nota_fiscal_id
      AND d.numero = btrim(p_numero)
      AND d.parcela = coalesce(btrim(p_parcela), '')
    FOR UPDATE;
  END IF;

  IF v_duplicata.id IS NULL THEN
    v_nova_duplicata := true;
    INSERT INTO public.duplicatas (
      fundo_id, cedente_fundo_id, cedente_id, nota_fiscal_id, sacado_id,
      numero, numero_fatura, parcela, data_emissao, data_vencimento,
      valor_nominal, nome_cedente_documento, cnpj_cedente_documento,
      nome_sacado_documento, cnpj_sacado_documento, local_pagamento,
      aceite_textual, aceite_detectado_textualmente, status_validacao, metodo_extracao,
      resultado_confronto, criado_por
    ) VALUES (
      v_nf.fundo_id, v_nf.cedente_fundo_id, v_nf.cedente_id, v_nf.id,
      (SELECT s.id FROM public.sacados s WHERE regexp_replace(s.cnpj, '[^0-9]', '', 'g') = p_cnpj_sacado LIMIT 1),
      nullif(btrim(p_numero), ''), nullif(btrim(p_numero_fatura), ''), coalesce(btrim(p_parcela), ''),
      p_data_emissao, p_data_vencimento, p_valor_nominal,
      nullif(btrim(p_nome_cedente), ''), p_cnpj_cedente,
      nullif(btrim(p_nome_sacado), ''), p_cnpj_sacado,
      nullif(btrim(p_local_pagamento), ''), nullif(btrim(p_aceite_textual), ''),
      p_aceite_detectado, p_status, p_metodo_extracao, p_resultado_confronto, v_user_id
    ) RETURNING * INTO v_duplicata;
  ELSE
    UPDATE public.duplicatas SET
      numero = nullif(btrim(p_numero), ''),
      numero_fatura = nullif(btrim(p_numero_fatura), ''),
      parcela = coalesce(btrim(p_parcela), ''),
      data_emissao = p_data_emissao,
      data_vencimento = p_data_vencimento,
      valor_nominal = p_valor_nominal,
      nome_cedente_documento = nullif(btrim(p_nome_cedente), ''),
      cnpj_cedente_documento = p_cnpj_cedente,
      nome_sacado_documento = nullif(btrim(p_nome_sacado), ''),
      cnpj_sacado_documento = p_cnpj_sacado,
      local_pagamento = nullif(btrim(p_local_pagamento), ''),
      aceite_textual = nullif(btrim(p_aceite_textual), ''),
      aceite_detectado_textualmente = p_aceite_detectado,
      status_validacao = p_status,
      metodo_extracao = p_metodo_extracao,
      resultado_confronto = p_resultado_confronto,
      validado_por = NULL,
      validado_em = NULL,
      motivo_rejeicao = NULL
    WHERE id = v_duplicata.id RETURNING * INTO v_duplicata;
  END IF;

  SELECT coalesce(max(dv.numero_versao), 0) + 1 INTO v_numero_versao
  FROM public.duplicata_versoes dv WHERE dv.duplicata_id = v_duplicata.id;

  INSERT INTO public.duplicata_versoes (
    duplicata_id, nota_fiscal_id, numero_versao, bucket, path, nome_original,
    mime_type, tamanho_bytes, sha256, metodo_extracao, texto_extraido,
    campos_extraidos, evidencias, resultado_validacao, confianca_geral, enviado_por
  ) VALUES (
    v_duplicata.id, v_nf.id, v_numero_versao, p_bucket, p_path, p_nome_original,
    p_mime_type, p_tamanho_bytes, lower(p_sha256), p_metodo_extracao,
    left(p_texto_extraido, 50000), coalesce(p_campos_extraidos, '{}'::jsonb),
    coalesce(p_evidencias, '{}'::jsonb), coalesce(p_resultado_validacao, '{}'::jsonb),
    p_confianca, v_user_id
  ) RETURNING id INTO v_versao_id;

  UPDATE public.duplicatas SET versao_atual_id = v_versao_id WHERE id = v_duplicata.id;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name
  FROM public.profiles p WHERE p.id = v_user_id;
  IF v_nova_duplicata THEN
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    ) VALUES (
      v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
      'duplicata_criada', 'documento', v_user_id, v_actor_name, v_role,
      'app', 'Duplicata Mercantil criada como ativo financeiro vinculado a NF.',
      jsonb_build_object('duplicata_id', v_duplicata.id, 'numero', v_duplicata.numero, 'parcela', v_duplicata.parcela),
      'ambos', 'duplicatas', v_duplicata.id::text
    ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;
  END IF;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
    'duplicata_pdf_enviado', 'documento', v_user_id, v_actor_name, v_role,
    'app', 'Versao de duplicata enviada para extracao e conferencia.',
    jsonb_build_object('duplicata_id', v_duplicata.id, 'versao', v_numero_versao, 'status', p_status),
    'ambos', 'duplicata_versoes', v_versao_id::text
  ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
    WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;

  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
    CASE WHEN p_status = 'EXTRAIDA' THEN 'duplicata_extraida' ELSE 'duplicata_requer_revisao' END,
    'analise', v_user_id, v_actor_name, v_role, 'app',
    CASE WHEN p_status = 'EXTRAIDA'
      THEN 'Campos da duplicata extraidos automaticamente e encaminhados para validacao.'
      ELSE 'Duplicata encaminhada para revisao humana.'
    END,
    jsonb_build_object('duplicata_id', v_duplicata.id, 'versao', v_numero_versao, 'metodo', p_metodo_extracao, 'confianca', p_confianca),
    'ambos', 'duplicata_extracao', v_versao_id::text
  ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
    WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT v_duplicata.id, v_versao_id, v_numero_versao;
END;
$$;

CREATE OR REPLACE FUNCTION public.corrigir_duplicata(
  p_duplicata_id uuid,
  p_campos jsonb,
  p_motivo text,
  p_resultado_confronto text
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_old public.duplicatas%ROWTYPE;
  v_new public.duplicatas%ROWTYPE;
  v_version uuid;
  v_key text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo da correcao'; END IF;
  SELECT * INTO v_old FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (
    (v_role = 'cedente' AND v_old.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_old.fundo_id)))
  ) THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'; END IF;
  IF v_old.status_validacao IN ('VALIDADA', 'REJEITADA') THEN
    RAISE EXCEPTION 'Duplicata finalizada nao pode ser alterada';
  END IF;
  IF v_role = 'cedente' AND NOT EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = v_old.nota_fiscal_id
      AND nf.status IN ('rascunho', 'requer_ajuste')
  ) THEN
    RAISE EXCEPTION 'A correcao pelo cedente deve ocorrer antes da submissao da NF';
  END IF;
  v_version := v_old.versao_atual_id;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental atual'; END IF;

  FOREACH v_key IN ARRAY ARRAY['numero','numero_fatura','parcela','data_emissao','data_vencimento','valor_nominal','nome_cedente_documento','cnpj_cedente_documento','nome_sacado_documento','cnpj_sacado_documento','local_pagamento','aceite_textual'] LOOP
    IF p_campos ? v_key THEN
      v_old_value := to_jsonb(v_old)->v_key;
      v_new_value := p_campos->v_key;
      IF v_old_value IS DISTINCT FROM v_new_value THEN
        INSERT INTO public.duplicata_correcoes (
          duplicata_id, duplicata_versao_id, campo, valor_original, valor_corrigido,
          motivo, corrigido_por
        ) VALUES (v_old.id, v_version, v_key, v_old_value, v_new_value, btrim(p_motivo), v_user_id);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.duplicatas SET
    numero = CASE WHEN p_campos ? 'numero' THEN nullif(btrim(p_campos->>'numero'), '') ELSE numero END,
    numero_fatura = CASE WHEN p_campos ? 'numero_fatura' THEN nullif(btrim(p_campos->>'numero_fatura'), '') ELSE numero_fatura END,
    parcela = CASE WHEN p_campos ? 'parcela' THEN coalesce(btrim(p_campos->>'parcela'), '') ELSE parcela END,
    data_emissao = CASE WHEN p_campos ? 'data_emissao' THEN nullif(p_campos->>'data_emissao', '')::date ELSE data_emissao END,
    data_vencimento = CASE WHEN p_campos ? 'data_vencimento' THEN nullif(p_campos->>'data_vencimento', '')::date ELSE data_vencimento END,
    valor_nominal = CASE WHEN p_campos ? 'valor_nominal' THEN nullif(p_campos->>'valor_nominal', '')::numeric ELSE valor_nominal END,
    nome_cedente_documento = CASE WHEN p_campos ? 'nome_cedente_documento' THEN nullif(btrim(p_campos->>'nome_cedente_documento'), '') ELSE nome_cedente_documento END,
    cnpj_cedente_documento = CASE WHEN p_campos ? 'cnpj_cedente_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_cedente_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_cedente_documento END,
    nome_sacado_documento = CASE WHEN p_campos ? 'nome_sacado_documento' THEN nullif(btrim(p_campos->>'nome_sacado_documento'), '') ELSE nome_sacado_documento END,
    cnpj_sacado_documento = CASE WHEN p_campos ? 'cnpj_sacado_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_sacado_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_sacado_documento END,
    local_pagamento = CASE WHEN p_campos ? 'local_pagamento' THEN nullif(btrim(p_campos->>'local_pagamento'), '') ELSE local_pagamento END,
    aceite_textual = CASE WHEN p_campos ? 'aceite_textual' THEN nullif(btrim(p_campos->>'aceite_textual'), '') ELSE aceite_textual END,
    aceite_detectado_textualmente = CASE
      WHEN NOT (p_campos ? 'aceite_textual') THEN aceite_detectado_textualmente
      WHEN nullif(btrim(p_campos->>'aceite_textual'), '') IS NULL THEN 'INDETERMINADO'
      WHEN lower(p_campos->>'aceite_textual') LIKE '%nao%'
        OR lower(p_campos->>'aceite_textual') LIKE '%nÃ£o%'
        OR lower(p_campos->>'aceite_textual') LIKE '%sem %' THEN 'NAO'
      ELSE 'SIM'
    END,
    status_validacao = 'REVISAR',
    metodo_extracao = 'MANUAL',
    resultado_confronto = p_resultado_confronto,
    validado_por = NULL,
    validado_em = NULL,
    motivo_rejeicao = NULL
  WHERE id = v_old.id RETURNING * INTO v_new;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_new.fundo_id, v_new.fundo_id, v_new.cedente_id, v_new.cedente_fundo_id, v_new.nota_fiscal_id,
    'duplicata_corrigida', 'analise', v_user_id, v_actor_name, v_role,
    'app', 'Campos da duplicata foram corrigidos manualmente.',
    jsonb_build_object('duplicata_id', v_new.id, 'campos', (SELECT jsonb_agg(key) FROM jsonb_each(p_campos))),
    'ambos', 'duplicatas', v_new.id::text || ':' || extract(epoch FROM clock_timestamp())::text
  );
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_duplicata(
  p_duplicata_id uuid,
  p_resultado text,
  p_observacoes text,
  p_resultado_confronto jsonb
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_row public.duplicatas%ROWTYPE;
  v_actor_name text;
  v_validation_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_role <> 'gestor' THEN RAISE EXCEPTION 'Apenas gestor pode concluir a validacao'; END IF;
  IF p_resultado NOT IN ('VALIDADA', 'REJEITADA') THEN RAISE EXCEPTION 'Resultado de validacao invalido'; END IF;
  IF p_resultado = 'REJEITADA' AND length(btrim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeicao';
  END IF;
  SELECT * INTO v_row FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (SELECT private.usuario_tem_acesso_fundo(v_row.fundo_id)) THEN RAISE EXCEPTION 'Gestor sem acesso ao fundo'; END IF;
  IF v_row.versao_atual_id IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental'; END IF;
  IF p_resultado = 'VALIDADA' AND (
    v_row.numero IS NULL
    OR v_row.data_vencimento IS NULL
    OR v_row.valor_nominal IS NULL
    OR v_row.cnpj_cedente_documento IS NULL
    OR v_row.cnpj_sacado_documento IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = v_row.nota_fiscal_id
        AND regexp_replace(nf.cnpj_emitente, '[^0-9]', '', 'g') = v_row.cnpj_cedente_documento
        AND regexp_replace(nf.cnpj_destinatario, '[^0-9]', '', 'g') = v_row.cnpj_sacado_documento
    )
  ) THEN
    RAISE EXCEPTION 'Duplicata possui campos criticos ausentes ou partes divergentes da NF';
  END IF;

  INSERT INTO public.duplicata_validacoes (
    duplicata_id, duplicata_versao_id, resultado, observacoes,
    resultado_confronto, validado_por
  ) VALUES (
    v_row.id, v_row.versao_atual_id, p_resultado, nullif(btrim(p_observacoes), ''),
    coalesce(p_resultado_confronto, '{}'::jsonb), v_user_id
  ) RETURNING id INTO v_validation_id;

  UPDATE public.duplicatas SET
    status_validacao = p_resultado,
    validado_por = v_user_id,
    validado_em = now(),
    motivo_rejeicao = CASE WHEN p_resultado = 'REJEITADA' THEN btrim(p_observacoes) ELSE NULL END
  WHERE id = v_row.id RETURNING * INTO v_row;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_row.fundo_id, v_row.fundo_id, v_row.cedente_id, v_row.cedente_fundo_id, v_row.nota_fiscal_id,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'duplicata_validada' ELSE 'duplicata_rejeitada' END,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'aprovacao' ELSE 'reprovacao' END,
    v_user_id, v_actor_name, v_role, 'app',
    CASE WHEN p_resultado = 'VALIDADA' THEN 'Duplicata validada pelo gestor.' ELSE 'Duplicata rejeitada pelo gestor.' END,
    jsonb_build_object('duplicata_id', v_row.id, 'resultado', p_resultado),
    'ambos', 'duplicata_validacoes', v_validation_id::text
  );
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.corrigir_duplicata(
  p_duplicata_id uuid,
  p_campos jsonb,
  p_motivo text,
  p_resultado_confronto text
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_old public.duplicatas%ROWTYPE;
  v_new public.duplicatas%ROWTYPE;
  v_version uuid;
  v_key text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo da correcao'; END IF;
  SELECT * INTO v_old FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (
    (v_role = 'cedente' AND v_old.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (
      v_role = 'consultor'
      AND (SELECT private.usuario_pode_operar_cedente(v_old.cedente_id))
      AND (SELECT private.consultor_tem_acesso_fundo(v_old.fundo_id))
    )
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_old.fundo_id)))
  ) THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'; END IF;
  IF v_old.status_validacao IN ('VALIDADA', 'REJEITADA') THEN
    RAISE EXCEPTION 'Duplicata finalizada nao pode ser alterada';
  END IF;
  IF v_role IN ('cedente', 'consultor') AND NOT EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = v_old.nota_fiscal_id
      AND nf.status IN ('rascunho', 'requer_ajuste')
  ) THEN
    RAISE EXCEPTION 'A correcao pelo cedente deve ocorrer antes da submissao da NF';
  END IF;
  v_version := v_old.versao_atual_id;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental atual'; END IF;

  FOREACH v_key IN ARRAY ARRAY['numero','numero_fatura','parcela','data_emissao','data_vencimento','valor_nominal','nome_cedente_documento','cnpj_cedente_documento','nome_sacado_documento','cnpj_sacado_documento','local_pagamento','aceite_textual'] LOOP
    IF p_campos ? v_key THEN
      v_old_value := to_jsonb(v_old)->v_key;
      v_new_value := p_campos->v_key;
      IF v_old_value IS DISTINCT FROM v_new_value THEN
        INSERT INTO public.duplicata_correcoes (
          duplicata_id, duplicata_versao_id, campo, valor_original, valor_corrigido,
          motivo, corrigido_por
        ) VALUES (v_old.id, v_version, v_key, v_old_value, v_new_value, btrim(p_motivo), v_user_id);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.duplicatas SET
    numero = CASE WHEN p_campos ? 'numero' THEN nullif(btrim(p_campos->>'numero'), '') ELSE numero END,
    numero_fatura = CASE WHEN p_campos ? 'numero_fatura' THEN nullif(btrim(p_campos->>'numero_fatura'), '') ELSE numero_fatura END,
    parcela = CASE WHEN p_campos ? 'parcela' THEN coalesce(btrim(p_campos->>'parcela'), '') ELSE parcela END,
    data_emissao = CASE WHEN p_campos ? 'data_emissao' THEN nullif(p_campos->>'data_emissao', '')::date ELSE data_emissao END,
    data_vencimento = CASE WHEN p_campos ? 'data_vencimento' THEN nullif(p_campos->>'data_vencimento', '')::date ELSE data_vencimento END,
    valor_nominal = CASE WHEN p_campos ? 'valor_nominal' THEN nullif(p_campos->>'valor_nominal', '')::numeric ELSE valor_nominal END,
    nome_cedente_documento = CASE WHEN p_campos ? 'nome_cedente_documento' THEN nullif(btrim(p_campos->>'nome_cedente_documento'), '') ELSE nome_cedente_documento END,
    cnpj_cedente_documento = CASE WHEN p_campos ? 'cnpj_cedente_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_cedente_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_cedente_documento END,
    nome_sacado_documento = CASE WHEN p_campos ? 'nome_sacado_documento' THEN nullif(btrim(p_campos->>'nome_sacado_documento'), '') ELSE nome_sacado_documento END,
    cnpj_sacado_documento = CASE WHEN p_campos ? 'cnpj_sacado_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_sacado_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_sacado_documento END,
    local_pagamento = CASE WHEN p_campos ? 'local_pagamento' THEN nullif(btrim(p_campos->>'local_pagamento'), '') ELSE local_pagamento END,
    aceite_textual = CASE WHEN p_campos ? 'aceite_textual' THEN nullif(btrim(p_campos->>'aceite_textual'), '') ELSE aceite_textual END,
    aceite_detectado_textualmente = CASE
      WHEN NOT (p_campos ? 'aceite_textual') THEN aceite_detectado_textualmente
      WHEN nullif(btrim(p_campos->>'aceite_textual'), '') IS NULL THEN 'INDETERMINADO'
      WHEN lower(p_campos->>'aceite_textual') LIKE '%nao%'
        OR lower(p_campos->>'aceite_textual') LIKE '%nÃ£o%'
        OR lower(p_campos->>'aceite_textual') LIKE '%sem %' THEN 'NAO'
      ELSE 'SIM'
    END,
    status_validacao = 'REVISAR',
    metodo_extracao = 'MANUAL',
    resultado_confronto = p_resultado_confronto,
    validado_por = NULL,
    validado_em = NULL,
    motivo_rejeicao = NULL
  WHERE id = v_old.id RETURNING * INTO v_new;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_new.fundo_id, v_new.fundo_id, v_new.cedente_id, v_new.cedente_fundo_id, v_new.nota_fiscal_id,
    'duplicata_corrigida', 'analise', v_user_id, v_actor_name, v_role,
    'app', 'Campos da duplicata foram corrigidos manualmente.',
    jsonb_build_object('duplicata_id', v_new.id, 'campos', (SELECT jsonb_agg(key) FROM jsonb_each(p_campos))),
    'ambos', 'duplicatas', v_new.id::text || ':' || extract(epoch FROM clock_timestamp())::text
  );
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_duplicata(
  p_duplicata_id uuid,
  p_resultado text,
  p_observacoes text,
  p_resultado_confronto jsonb
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_row public.duplicatas%ROWTYPE;
  v_actor_name text;
  v_validation_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_role <> 'gestor' THEN RAISE EXCEPTION 'Apenas gestor pode concluir a validacao'; END IF;
  IF p_resultado NOT IN ('VALIDADA', 'REJEITADA') THEN RAISE EXCEPTION 'Resultado de validacao invalido'; END IF;
  IF p_resultado = 'REJEITADA' AND length(btrim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeicao';
  END IF;
  SELECT * INTO v_row FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (SELECT private.usuario_tem_acesso_fundo(v_row.fundo_id)) THEN RAISE EXCEPTION 'Gestor sem acesso ao fundo'; END IF;
  IF v_row.versao_atual_id IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental'; END IF;
  IF p_resultado = 'VALIDADA' AND (
    v_row.numero IS NULL
    OR v_row.data_vencimento IS NULL
    OR v_row.valor_nominal IS NULL
    OR v_row.cnpj_cedente_documento IS NULL
    OR v_row.cnpj_sacado_documento IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = v_row.nota_fiscal_id
        AND regexp_replace(nf.cnpj_emitente, '[^0-9]', '', 'g') = v_row.cnpj_cedente_documento
        AND regexp_replace(nf.cnpj_destinatario, '[^0-9]', '', 'g') = v_row.cnpj_sacado_documento
    )
  ) THEN
    RAISE EXCEPTION 'Duplicata possui campos criticos ausentes ou partes divergentes da NF';
  END IF;

  INSERT INTO public.duplicata_validacoes (
    duplicata_id, duplicata_versao_id, resultado, observacoes,
    resultado_confronto, validado_por
  ) VALUES (
    v_row.id, v_row.versao_atual_id, p_resultado, nullif(btrim(p_observacoes), ''),
    coalesce(p_resultado_confronto, '{}'::jsonb), v_user_id
  ) RETURNING id INTO v_validation_id;

  UPDATE public.duplicatas SET
    status_validacao = p_resultado,
    validado_por = v_user_id,
    validado_em = now(),
    motivo_rejeicao = CASE WHEN p_resultado = 'REJEITADA' THEN btrim(p_observacoes) ELSE NULL END
  WHERE id = v_row.id RETURNING * INTO v_row;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_row.fundo_id, v_row.fundo_id, v_row.cedente_id, v_row.cedente_fundo_id, v_row.nota_fiscal_id,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'duplicata_validada' ELSE 'duplicata_rejeitada' END,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'aprovacao' ELSE 'reprovacao' END,
    v_user_id, v_actor_name, v_role, 'app',
    CASE WHEN p_resultado = 'VALIDADA' THEN 'Duplicata validada pelo gestor.' ELSE 'Duplicata rejeitada pelo gestor.' END,
    jsonb_build_object('duplicata_id', v_row.id, 'resultado', p_resultado),
    'ambos', 'duplicata_validacoes', v_validation_id::text
  );
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_duplicata_versao(uuid, uuid, text, text, text, date, date, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text, text, jsonb, jsonb, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_duplicata_versao(uuid, uuid, text, text, text, date, date, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text, text, jsonb, jsonb, jsonb, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.corrigir_duplicata(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_duplicata(uuid, jsonb, text, text) TO authenticated;


COMMIT;
