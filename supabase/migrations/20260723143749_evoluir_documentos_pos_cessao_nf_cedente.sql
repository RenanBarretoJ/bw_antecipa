-- Evolui requisitos documentais pós-cessão da NF no portal do cedente.
--
-- Diagnóstico que originou esta migration:
-- - requisitos pré-cessão são instanciados por public.instanciar_requisitos_nota
--   e ficam vinculados a documento_requisito_instancias.nota_fiscal_id;
-- - requisitos pós-cessão/logísticos são criados no desembolso e ficam
--   vinculados a documento_requisito_instancias.nota_fiscal_entrega_id;
-- - a tela do cedente consultava apenas nota_fiscal_id, por isso não enxergava
--   requisitos de entrega, como comprovante de entrega/canhoto.

INSERT INTO public.documento_tipos (
  codigo, nome, dominio, mime_types_aceitos, extensoes_aceitas,
  tamanho_max_bytes, permite_multiplas_versoes, ativo
)
VALUES
  (
    'comprovante_entrega',
    'Comprovante de entrega',
    'entrega',
    ARRAY['application/pdf', 'image/jpeg', 'image/png'],
    ARRAY['pdf', 'jpg', 'jpeg', 'png'],
    20971520,
    true,
    true
  )
ON CONFLICT (codigo) DO UPDATE
SET nome = EXCLUDED.nome,
    dominio = EXCLUDED.dominio,
    mime_types_aceitos = EXCLUDED.mime_types_aceitos,
    extensoes_aceitas = EXCLUDED.extensoes_aceitas,
    tamanho_max_bytes = EXCLUDED.tamanho_max_bytes,
    permite_multiplas_versoes = EXCLUDED.permite_multiplas_versoes,
    ativo = true;

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
  cte_prazo integer := 10;
  canhoto_prazo integer := 20;
  nf record;
  entrega_id uuid;
  inserted_deliveries integer := 0;
  req record;
  req_codigo text;
  req_tipo_codigo text;
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

  SELECT saldo_disponivel INTO escrow_saldo FROM public.contas_escrow WHERE id = op.conta_escrow_id FOR UPDATE;
  IF escrow_saldo IS NULL THEN RAISE EXCEPTION 'Conta escrow nao encontrada'; END IF;
  novo_saldo := escrow_saldo + op.valor_liquido_desembolso;

  cria_entrega := COALESCE((op.politica_snapshot->>'cria_acompanhamento_entrega')::boolean, false);
  cte_prazo := COALESCE((
    SELECT (item->>'prazo_dias_corridos')::integer
    FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
    WHERE item->>'codigo' = 'cte' AND item->>'ativo' = 'true'
    LIMIT 1
  ), 10);
  canhoto_prazo := COALESCE((
    SELECT (item->>'prazo_dias_corridos')::integer
    FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
    WHERE item->>'codigo' IN ('canhoto', 'comprovante_entrega') AND item->>'ativo' = 'true'
    ORDER BY CASE WHEN item->>'codigo' = 'comprovante_entrega' THEN 0 ELSE 1 END
    LIMIT 1
  ), 20);

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
      CASE WHEN cria_entrega THEN (now_ts::date + cte_prazo) ELSE NULL END,
      CASE WHEN cria_entrega THEN (now_ts::date + canhoto_prazo) ELSE NULL END
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
        SELECT pr.*, dt.id AS tipo_id
        FROM public.politica_requisitos_documentais pr
        LEFT JOIN public.documento_tipos dt
          ON dt.codigo = CASE
            WHEN COALESCE(pr.tipo_documento_codigo, pr.codigo) = 'cte' THEN 'cte_xml'
            ELSE COALESCE(pr.tipo_documento_codigo, pr.codigo)
          END
        WHERE pr.politica_operacional_versao_id = op.politica_operacional_versao_id
          AND pr.escopo IN ('pos_cessao', 'entrega')
          AND pr.ativo = true
      LOOP
        req_codigo := COALESCE(req.codigo, req.tipo_documento_codigo);
        req_tipo_codigo := COALESCE(req.tipo_documento_codigo, req.codigo);
        req_prazo_limite := CASE
          WHEN req.prazo_dias_corridos IS NOT NULL THEN now_ts::date + req.prazo_dias_corridos
          WHEN req_tipo_codigo = 'cte' THEN now_ts::date + cte_prazo
          WHEN req_tipo_codigo IN ('canhoto', 'comprovante_entrega') THEN now_ts::date + canhoto_prazo
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
          req.id, req.politica_operacional_id, req.politica_operacional_versao_id, op.politica_versao,
          req.tipo_id, req_tipo_codigo, req.escopo, entrega_id,
          op.cedente_id, 'pendente', req.obrigatorio, req_prazo_limite,
          req.formatos_aceitos, req.nivel_validacao, req.quantidade_minima,
          req.responsavel_upload, req.responsavel_aprovacao
        )
        ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id) DO UPDATE
          SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id),
              prazo_limite = COALESCE(documento_requisito_instancias.prazo_limite, EXCLUDED.prazo_limite);

        PERFORM public.registrar_evento_entrega(
          entrega_id,
          CASE
            WHEN req_tipo_codigo = 'cte' THEN 'cte_pendente'
            WHEN req_tipo_codigo IN ('canhoto', 'comprovante_entrega') THEN 'canhoto_pendente'
            ELSE 'canhoto_pendente'
          END,
          'em_transito',
          'em_transito',
          'sistema',
          jsonb_build_object('tipo_documento_codigo', req_tipo_codigo, 'prazo_limite', req_prazo_limite, 'codigo_requisito', req_codigo)
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

  RETURN jsonb_build_object('operacao_id', p_operacao_id, 'saldo_apos', novo_saldo, 'entregas', inserted_deliveries, 'cria_acompanhamento_entrega', cria_entrega);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_documento_entrega_upload(
  p_nota_fiscal_entrega_id uuid,
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
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  entrega record;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('gestor', 'cedente') OR p_enviado_por <> actor_id THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento de entrega';
  END IF;

  SELECT nfe.*, n.cedente_id, n.cedente_fundo_id, n.fundo_id
    INTO entrega
  FROM public.nota_fiscal_entregas nfe
  JOIN public.notas_fiscais n ON n.id = nfe.nota_fiscal_id
  WHERE nfe.id = p_nota_fiscal_entrega_id
  FOR UPDATE;

  IF entrega.id IS NULL THEN RAISE EXCEPTION 'Entrega documental nao encontrada'; END IF;
  IF entrega.status_entrega IN ('nao_aplicavel', 'cancelada', 'devolvida', 'entregue') THEN
    RAISE EXCEPTION 'Entrega nao esta aberta para upload documental';
  END IF;
  IF entrega.cedente_fundo_id IS NULL OR entrega.fundo_id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND entrega.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Entrega fora do cedente autenticado';
  END IF;

  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id
    AND nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental de entrega invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> entrega.cedente_id THEN RAISE EXCEPTION 'Requisito documental fora do cedente da entrega'; END IF;
  IF requirement.documento_tipo_id IS NULL OR requirement.documento_tipo_id <> p_documento_tipo_id THEN
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

    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_entrega_id, entrega.cedente_id);
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
  SET documento_id = doc_id, versao_aprovada_id = NULL, status = 'pendente', satisfeito_em = NULL
  WHERE id = p_requisito_id;

  IF entrega.status_entrega IN ('em_transito', 'entrega_com_pendencia') THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'aguardando_validacao',
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;
  END IF;

  PERFORM public.registrar_evento_entrega(
    p_nota_fiscal_entrega_id,
    'canhoto_enviado',
    entrega.status_entrega,
    'aguardando_validacao',
    'usuario',
    jsonb_build_object('requisito_id', p_requisito_id, 'versao_id', version_id, 'tipo_documento_codigo', requirement.tipo_documento_codigo_snapshot)
  );

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'nota_fiscal_entrega_id', p_nota_fiscal_entrega_id,
    'cedente_fundo_id', entrega.cedente_fundo_id,
    'fundo_id', entrega.fundo_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.analisar_documento_versao(
  p_documento_versao_id uuid,
  p_resultado text,
  p_observacoes text DEFAULT NULL,
  p_dados_estruturados jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  version_row record;
  analysis_id uuid;
  new_status text;
  entrega_id uuid;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN RAISE EXCEPTION 'Somente gestor pode analisar documentos'; END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado', 'pendente', 'requer_ajuste') THEN RAISE EXCEPTION 'Resultado de analise invalido'; END IF;
  IF p_resultado IN ('rejeitado', 'requer_ajuste') AND length(trim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Motivo obrigatorio para rejeicao ou ajuste';
  END IF;

  SELECT dv.*, dr.id AS repo_id
    INTO version_row
  FROM public.documento_versoes dv
  JOIN public.documentos_repositorio dr ON dr.id = dv.documento_id
  WHERE dv.id = p_documento_versao_id;

  IF version_row.id IS NULL THEN RAISE EXCEPTION 'Versao documental nao encontrada'; END IF;
  IF version_row.status = 'aprovado' AND p_resultado <> 'aprovado' THEN RAISE EXCEPTION 'Versao aprovada e imutavel'; END IF;

  INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes, dados_estruturados)
  VALUES (p_documento_versao_id, p_resultado, auth.uid(), p_observacoes, coalesce(p_dados_estruturados, '{}'::jsonb))
  RETURNING id INTO analysis_id;

  new_status := CASE WHEN p_resultado = 'aprovado' THEN 'aprovado' WHEN p_resultado = 'rejeitado' THEN 'rejeitado' ELSE 'em_analise' END;
  UPDATE public.documento_versoes SET status = new_status WHERE id = p_documento_versao_id;
  UPDATE public.documentos_repositorio SET status = new_status WHERE id = version_row.documento_id;

  IF p_resultado = 'aprovado' THEN
    UPDATE public.documento_requisito_instancias
    SET status = 'satisfeito', versao_aprovada_id = p_documento_versao_id, satisfeito_em = now()
    WHERE documento_id = version_row.documento_id;
  ELSE
    UPDATE public.documento_requisito_instancias
    SET status = 'pendente', versao_aprovada_id = NULL, satisfeito_em = NULL
    WHERE documento_id = version_row.documento_id;
  END IF;

  SELECT nota_fiscal_entrega_id
    INTO entrega_id
  FROM public.documento_vinculos
  WHERE documento_id = version_row.documento_id
    AND nota_fiscal_entrega_id IS NOT NULL
  LIMIT 1;

  IF entrega_id IS NOT NULL THEN
    PERFORM public.avaliar_conclusao_entrega(entrega_id);
  END IF;

  RETURN jsonb_build_object('analise_id', analysis_id, 'versao_id', p_documento_versao_id, 'status', new_status, 'nota_fiscal_entrega_id', entrega_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_documento_entrega_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_documento_entrega_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC;
