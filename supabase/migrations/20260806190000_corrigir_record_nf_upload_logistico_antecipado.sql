BEGIN;

-- Corrige a colisao entre a variavel PL/pgSQL `nf` e o alias SQL
-- de public.notas_fiscais na RPC de envio logistico antecipado.
-- A regra de negocio, autorizacao e persistencia permanecem inalteradas.

CREATE OR REPLACE FUNCTION public.registrar_documento_logistico_antecipado(
  p_nota_fiscal_ids uuid[],
  p_politica_requisito_id uuid,
  p_documento_tipo_codigo text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_dados_logisticos jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  req record;
  tipo record;
  contexto record;
  nf_item record;
  v_familia text;
  v_tipo_familia text;
  v_expected integer;
  v_count integer;
  v_doc_id uuid;
  v_version_id uuid;
  v_cte_id uuid;
  v_version_number integer;
  v_existing record;
  v_existing_cte record;
  v_replay boolean := false;
  v_evidencia_id uuid;
  v_resultado jsonb := coalesce(p_dados_logisticos->'resultado_validacao', '{}'::jsonb);
BEGIN
  IF actor_id IS NULL OR actor_role <> 'cedente' THEN
    RAISE EXCEPTION 'Somente o cedente autenticado pode enviar documento logistico antecipado';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma NF';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR lower(p_sha256) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Metadados do arquivo sao invalidos';
  END IF;

  SELECT pr.*
  INTO req
  FROM public.politica_requisitos_documentais pr
  WHERE pr.id = p_politica_requisito_id
    AND pr.ativo = true
    AND pr.escopo IN ('pos_cessao', 'entrega')
    AND pr.familia_documental IS NOT NULL;
  IF req.id IS NULL THEN
    RAISE EXCEPTION 'Requisito logistico oficial nao encontrado';
  END IF;
  v_familia := req.familia_documental;

  SELECT dt.* INTO tipo
  FROM public.documento_tipos dt
  WHERE dt.codigo = p_documento_tipo_codigo AND dt.ativo = true;
  IF tipo.id IS NULL THEN RAISE EXCEPTION 'Tipo documental nao catalogado'; END IF;
  v_tipo_familia := private.resolver_familia_documental_logistica(tipo.codigo);
  IF v_tipo_familia IS DISTINCT FROM v_familia THEN
    RAISE EXCEPTION 'Tipo de documento nao corresponde ao requisito logistico';
  END IF;
  IF lower(p_mime_type) <> ALL (SELECT lower(unnest(tipo.mime_types_aceitos)))
     OR p_tamanho_bytes > tipo.tamanho_max_bytes THEN
    RAISE EXCEPTION 'Arquivo fora dos formatos ou tamanho permitidos';
  END IF;

  SELECT count(DISTINCT item) INTO v_expected FROM unnest(p_nota_fiscal_ids) item;
  SELECT
    min(nf.fundo_id::text)::uuid AS fundo_id,
    min(nf.cedente_id::text)::uuid AS cedente_id,
    min(nf.cedente_fundo_id::text)::uuid AS cedente_fundo_id,
    count(DISTINCT nf.id) AS quantidade
  INTO contexto
  FROM public.notas_fiscais nf
  JOIN public.cedente_fundos cf
    ON cf.id = nf.cedente_fundo_id
   AND cf.cedente_id = nf.cedente_id
   AND cf.fundo_id = nf.fundo_id
   AND cf.status = 'ativo'
  JOIN public.cedentes c ON c.id = nf.cedente_id AND c.user_id = actor_id
  WHERE nf.id = ANY(p_nota_fiscal_ids)
    AND nf.fundo_id IS NOT NULL
    AND nf.cedente_fundo_id IS NOT NULL;

  IF contexto.quantidade IS DISTINCT FROM v_expected
     OR contexto.fundo_id IS NULL
     OR contexto.cedente_id IS NULL
     OR contexto.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'As NFs precisam pertencer ao mesmo cedente, fundo e vinculo ativo';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notas_fiscais nf
    LEFT JOIN public.nota_fiscal_entregas nfe
      ON nfe.nota_fiscal_id = nf.id
     AND nfe.status_entrega NOT IN ('nao_aplicavel', 'cancelada', 'devolvida')
    LEFT JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    LEFT JOIN public.operacoes o
      ON o.id = onf.operacao_id
     AND o.status::text NOT IN ('cancelada', 'reprovada')
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND (nfe.id IS NOT NULL OR o.cessao_efetivada_em IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'O envio antecipado nao esta disponivel depois da cessao; utilize o requisito logistico oficial';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notas_fiscais nf
  WHERE nf.id = ANY(p_nota_fiscal_ids)
    AND nf.fundo_id = contexto.fundo_id
    AND nf.cedente_id = contexto.cedente_id
    AND nf.cedente_fundo_id = contexto.cedente_fundo_id
    AND private.resolver_politica_versao_nf_logistica(nf.id) = req.politica_operacional_versao_id;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'O requisito informado nao pertence a politica aplicavel a todas as NFs';
  END IF;

  -- Serializa conjuntos sobrepostos por NF/familia. Assim, dois uploads
  -- concorrentes do mesmo arquivo convergem para o replay idempotente, e duas
  -- substituicoes concorrentes preservam uma ordem documental deterministica.
  FOR nf_item IN
    SELECT DISTINCT ids.nf_id AS id
    FROM unnest(p_nota_fiscal_ids) AS ids(nf_id)
    ORDER BY ids.nf_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        nf_item.id::text || ':' || req.politica_operacional_versao_id::text || ':' || v_familia,
        0
      )
    );
  END LOOP;

  -- Replay pelo mesmo hash e pelo mesmo conjunto ja vinculado.
  SELECT ela.documento_id, ela.documento_versao_atual_id, dv.path
  INTO v_existing
  FROM public.evidencias_logisticas_antecipadas ela
  JOIN public.documento_versoes dv ON dv.id = ela.documento_versao_atual_id
  WHERE ela.nota_fiscal_id = (p_nota_fiscal_ids)[1]
    AND ela.politica_operacional_versao_id = req.politica_operacional_versao_id
    AND ela.familia_documental = v_familia
    AND dv.sha256 = lower(p_sha256)
  LIMIT 1;

  IF v_existing.documento_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest(p_nota_fiscal_ids) ids(nf_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.evidencias_logisticas_antecipadas ela
      WHERE ela.nota_fiscal_id = ids.nf_id
        AND ela.politica_operacional_versao_id = req.politica_operacional_versao_id
        AND ela.familia_documental = v_familia
        AND ela.documento_id = v_existing.documento_id
        AND ela.documento_versao_atual_id = v_existing.documento_versao_atual_id
    )
  ) THEN
    RETURN jsonb_build_object(
      'documento_id', v_existing.documento_id,
      'versao_id', v_existing.documento_versao_atual_id,
      'familia_documental', v_familia,
      'idempotent_replay', true,
      'arquivo_utilizado', false,
      'path_persistido', v_existing.path
    );
  END IF;

  INSERT INTO public.documentos_repositorio(documento_tipo_id, status, criado_por)
  VALUES (tipo.id, 'enviado', actor_id)
  RETURNING id INTO v_doc_id;

  v_version_number := 1;
  INSERT INTO public.documento_versoes(
    documento_id, numero_versao, bucket, path, nome_original, mime_type,
    tamanho_bytes, sha256, status, enviado_por
  ) VALUES (
    v_doc_id, v_version_number, p_bucket, p_path, p_nome_original,
    lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', actor_id
  ) RETURNING id INTO v_version_id;

  INSERT INTO public.documento_vinculos(documento_id, nota_fiscal_id, cedente_id, principal)
  SELECT
    v_doc_id,
    ids.nf_id,
    contexto.cedente_id,
    row_number() OVER (ORDER BY ids.nf_id) = 1
  FROM (SELECT DISTINCT unnest(p_nota_fiscal_ids) AS nf_id) ids;

  IF v_familia = 'cte' THEN
    SELECT c.id, c.fundo_id, c.cedente_id, c.cedente_fundo_id
    INTO v_existing_cte
    FROM public.ctes c
    WHERE c.chave_cte = nullif(p_dados_logisticos->>'chave_cte', '')
    LIMIT 1;

    IF v_existing_cte.id IS NOT NULL THEN
      IF v_existing_cte.fundo_id IS DISTINCT FROM contexto.fundo_id
         OR v_existing_cte.cedente_id IS DISTINCT FROM contexto.cedente_id
         OR v_existing_cte.cedente_fundo_id IS DISTINCT FROM contexto.cedente_fundo_id THEN
        RAISE EXCEPTION 'Chave de CT-e ja pertence a outro contexto operacional';
      END IF;
      v_cte_id := v_existing_cte.id;
      UPDATE public.ctes
      SET numero = nullif(p_dados_logisticos->>'numero', ''),
          serie = nullif(p_dados_logisticos->>'serie', ''),
          data_emissao = nullif(p_dados_logisticos->>'data_emissao', '')::date,
          cnpj_transportadora = nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_transportadora', ''), '\D', '', 'g'), ''),
          cnpj_remetente = nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_remetente', ''), '\D', '', 'g'), ''),
          cnpj_destinatario = nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_destinatario', ''), '\D', '', 'g'), ''),
          valor_frete = nullif(p_dados_logisticos->>'valor_frete', '')::numeric,
          formato_origem = CASE WHEN tipo.codigo = 'cte_xml' THEN 'xml' ELSE 'pdf' END,
          nivel_validacao = CASE WHEN tipo.codigo = 'cte_xml' THEN 'estrutural' ELSE 'manual' END,
          status = 'em_analise',
          documento_id = v_doc_id,
          documento_versao_atual_id = v_version_id,
          documento_versao_aprovada_id = NULL,
          dados_extraidos = coalesce(p_dados_logisticos, '{}'::jsonb) - 'xml_original',
          hash_sha256 = lower(p_sha256),
          uploaded_by = actor_id,
          resultado_validacao = v_resultado,
          analisado_por = NULL,
          analisado_em = NULL,
          motivo_rejeicao = NULL
      WHERE id = v_cte_id;
    ELSE
      INSERT INTO public.ctes(
        fundo_id, cedente_id, cedente_fundo_id, chave_cte, numero, serie,
        data_emissao, cnpj_transportadora, cnpj_remetente, cnpj_destinatario,
        valor_frete, formato_origem, nivel_validacao, status, documento_id,
        documento_versao_atual_id, dados_extraidos, hash_sha256, uploaded_by,
        resultado_validacao
      ) VALUES (
        contexto.fundo_id, contexto.cedente_id, contexto.cedente_fundo_id,
        nullif(p_dados_logisticos->>'chave_cte', ''),
        nullif(p_dados_logisticos->>'numero', ''),
        nullif(p_dados_logisticos->>'serie', ''),
        nullif(p_dados_logisticos->>'data_emissao', '')::date,
        nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_transportadora', ''), '\D', '', 'g'), ''),
        nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_remetente', ''), '\D', '', 'g'), ''),
        nullif(regexp_replace(coalesce(p_dados_logisticos->>'cnpj_destinatario', ''), '\D', '', 'g'), ''),
        nullif(p_dados_logisticos->>'valor_frete', '')::numeric,
        CASE WHEN tipo.codigo = 'cte_xml' THEN 'xml' ELSE 'pdf' END,
        CASE WHEN tipo.codigo = 'cte_xml' THEN 'estrutural' ELSE 'manual' END,
        'em_analise', v_doc_id, v_version_id,
        coalesce(p_dados_logisticos, '{}'::jsonb) - 'xml_original',
        lower(p_sha256), actor_id, v_resultado
      ) RETURNING id INTO v_cte_id;
    END IF;

    INSERT INTO public.documento_vinculos(documento_id, cte_id, cedente_id, principal)
    VALUES (v_doc_id, v_cte_id, contexto.cedente_id, false);

    INSERT INTO public.cte_notas_fiscais(
      cte_id, nota_fiscal_id, chave_nfe_referenciada, status_validacao,
      resultado_validacao, divergencias, validado_em
    )
    SELECT
      v_cte_id, nf.id, nf.chave_acesso,
      coalesce(nullif(vnf.item->>'status', ''), nullif(v_resultado->>'status', ''), 'validacao_parcial'),
      coalesce(vnf.item, v_resultado),
      coalesce((vnf.item->'bloqueios') || (vnf.item->'alertas'), '[]'::jsonb),
      pg_catalog.now()
    FROM public.notas_fiscais nf
    LEFT JOIN LATERAL (
      SELECT item
      FROM jsonb_array_elements(coalesce(v_resultado->'validacoesPorNf', '[]'::jsonb)) item
      WHERE item->>'notaFiscalId' = nf.id::text
      LIMIT 1
    ) vnf ON true
    WHERE nf.id = ANY(p_nota_fiscal_ids)
    ON CONFLICT (cte_id, nota_fiscal_id) DO UPDATE SET
      chave_nfe_referenciada = EXCLUDED.chave_nfe_referenciada,
      status_validacao = EXCLUDED.status_validacao,
      resultado_validacao = EXCLUDED.resultado_validacao,
      divergencias = EXCLUDED.divergencias,
      validado_em = EXCLUDED.validado_em;
  END IF;

  FOR nf_item IN SELECT DISTINCT unnest(p_nota_fiscal_ids) AS id LOOP
    INSERT INTO public.evidencias_logisticas_antecipadas(
      nota_fiscal_id, fundo_id, cedente_id, cedente_fundo_id,
      politica_operacional_versao_id, politica_requisito_id,
      familia_documental, documento_id, documento_versao_atual_id, criado_por
    ) VALUES (
      nf_item.id, contexto.fundo_id, contexto.cedente_id, contexto.cedente_fundo_id,
      req.politica_operacional_versao_id, req.id, v_familia,
      v_doc_id, v_version_id, actor_id
    )
    ON CONFLICT (nota_fiscal_id, politica_operacional_versao_id, familia_documental)
    DO UPDATE SET
      politica_requisito_id = EXCLUDED.politica_requisito_id,
      documento_id = EXCLUDED.documento_id,
      documento_versao_atual_id = EXCLUDED.documento_versao_atual_id,
      ultimo_upload_em = pg_catalog.now()
    RETURNING id INTO v_evidencia_id;

    INSERT INTO public.evidencia_logistica_versoes(
      evidencia_logistica_id, documento_id, documento_versao_id
    ) VALUES (
      v_evidencia_id, v_doc_id, v_version_id
    )
    ON CONFLICT (evidencia_logistica_id, documento_versao_id) DO NOTHING;

    INSERT INTO public.eventos_dominio(
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    )
    SELECT
      contexto.fundo_id, contexto.fundo_id, contexto.cedente_id,
      contexto.cedente_fundo_id, nf_item.id,
      CASE v_familia WHEN 'cte' THEN 'documento_logistico_antecipado_cte_enviado' ELSE 'documento_logistico_antecipado_comprovante_enviado' END,
      'logistica', actor_id, coalesce(p.nome_completo, 'Cedente'),
      'cedente', 'app',
      CASE v_familia WHEN 'cte' THEN 'CT-e/DACTE enviado antecipadamente.' ELSE 'Comprovante de entrega enviado antecipadamente.' END,
      jsonb_build_object(
        'familia_documental', v_familia,
        'documento_id', v_doc_id,
        'documento_versao_id', v_version_id,
        'politica_requisito_id', req.id,
        'politica_operacional_versao_id', req.politica_operacional_versao_id
      ),
      'ambos', 'documento_versoes', v_version_id::text || ':' || nf_item.id::text
    FROM public.profiles p WHERE p.id = actor_id
    ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
    DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'documento_id', v_doc_id,
    'versao_id', v_version_id,
    'cte_id', v_cte_id,
    'familia_documental', v_familia,
    'politica_requisito_id', req.id,
    'politica_operacional_versao_id', req.politica_operacional_versao_id,
    'idempotent_replay', v_replay,
    'arquivo_utilizado', true,
    'path_persistido', p_path
  );
END;
$$;

COMMIT;
