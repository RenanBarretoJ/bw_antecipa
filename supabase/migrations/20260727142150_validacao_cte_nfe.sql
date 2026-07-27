-- Validação estrutural, fiscal e logística entre CT-e e NF-e.
-- Evolui a modelagem existente da Fase 5 sem recriar tabelas já aplicadas.

DO $$
BEGIN
  IF to_regclass('public.ctes') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.ctes nao existe. Aplique a migration de logistica pos-cessao antes desta migration.';
  END IF;
  IF to_regclass('public.cte_notas_fiscais') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.cte_notas_fiscais nao existe. Aplique a migration de logistica pos-cessao antes desta migration.';
  END IF;
END;
$$;

ALTER TABLE public.ctes
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id),
  ADD COLUMN IF NOT EXISTS cedente_fundo_id uuid REFERENCES public.cedente_fundos(id),
  ADD COLUMN IF NOT EXISTS ambiente text,
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS tipo_cte text,
  ADD COLUMN IF NOT EXISTS tipo_servico text,
  ADD COLUMN IF NOT EXISTS modal text,
  ADD COLUMN IF NOT EXISTS cfop text,
  ADD COLUMN IF NOT EXISTS natureza_operacao text,
  ADD COLUMN IF NOT EXISTS protocolo text,
  ADD COLUMN IF NOT EXISTS status_autorizacao text,
  ADD COLUMN IF NOT EXISTS motivo_status text,
  ADD COLUMN IF NOT EXISTS data_autorizacao timestamptz,
  ADD COLUMN IF NOT EXISTS transportadora_razao_social text,
  ADD COLUMN IF NOT EXISTS transportadora_ie text,
  ADD COLUMN IF NOT EXISTS rntrc text,
  ADD COLUMN IF NOT EXISTS remetente_razao_social text,
  ADD COLUMN IF NOT EXISTS destinatario_razao_social text,
  ADD COLUMN IF NOT EXISTS municipio_origem_codigo text,
  ADD COLUMN IF NOT EXISTS municipio_origem_nome text,
  ADD COLUMN IF NOT EXISTS uf_origem text,
  ADD COLUMN IF NOT EXISTS municipio_destino_codigo text,
  ADD COLUMN IF NOT EXISTS municipio_destino_nome text,
  ADD COLUMN IF NOT EXISTS uf_destino text,
  ADD COLUMN IF NOT EXISTS valor_prestacao numeric,
  ADD COLUMN IF NOT EXISTS valor_receber numeric,
  ADD COLUMN IF NOT EXISTS valor_carga numeric,
  ADD COLUMN IF NOT EXISTS produto_predominante text,
  ADD COLUMN IF NOT EXISTS categoria_carga text,
  ADD COLUMN IF NOT EXISTS quantidade_carga numeric,
  ADD COLUMN IF NOT EXISTS unidade_carga text,
  ADD COLUMN IF NOT EXISTS peso_bruto numeric,
  ADD COLUMN IF NOT EXISTS peso_liquido numeric,
  ADD COLUMN IF NOT EXISTS volume_quantidade numeric,
  ADD COLUMN IF NOT EXISTS hash_sha256 text,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS resultado_validacao jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.cte_notas_fiscais
  ADD COLUMN IF NOT EXISTS chave_nfe_referenciada text,
  ADD COLUMN IF NOT EXISTS status_validacao text NOT NULL DEFAULT 'validacao_parcial',
  ADD COLUMN IF NOT EXISTS resultado_validacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS divergencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cte_notas_fiscais'::regclass
      AND conname = 'cte_notas_fiscais_status_validacao_check'
  ) THEN
    ALTER TABLE public.cte_notas_fiscais
      ADD CONSTRAINT cte_notas_fiscais_status_validacao_check
      CHECK (status_validacao IN ('aprovado', 'aprovado_com_alertas', 'rejeitado', 'validacao_parcial'));
  END IF;
END;
$$;

UPDATE public.ctes c
SET hash_sha256 = lower(dv.sha256)
FROM public.documento_versoes dv
WHERE c.documento_versao_atual_id = dv.id
  AND c.hash_sha256 IS NULL;

CREATE INDEX IF NOT EXISTS idx_ctes_fundo_status ON public.ctes(fundo_id, status);
CREATE INDEX IF NOT EXISTS idx_ctes_cedente_fundo ON public.ctes(cedente_fundo_id);
CREATE INDEX IF NOT EXISTS idx_ctes_hash_sha256 ON public.ctes(hash_sha256);
CREATE INDEX IF NOT EXISTS idx_cte_notas_status ON public.cte_notas_fiscais(status_validacao);

CREATE OR REPLACE FUNCTION public.registrar_cte_documento(
  p_nota_fiscal_ids uuid[],
  p_documento_tipo_codigo text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_chave_cte text DEFAULT NULL,
  p_numero text DEFAULT NULL,
  p_serie text DEFAULT NULL,
  p_data_emissao date DEFAULT NULL,
  p_cnpj_transportadora text DEFAULT NULL,
  p_cnpj_remetente text DEFAULT NULL,
  p_cnpj_destinatario text DEFAULT NULL,
  p_valor_frete numeric DEFAULT NULL,
  p_nivel_validacao text DEFAULT 'manual',
  p_dados_extraidos jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  tipo record;
  cedente uuid;
  fundo uuid;
  cedente_fundo uuid;
  nf_count integer;
  expected_count integer;
  delivery record;
  v_doc_id uuid;
  v_version_id uuid;
  v_cte_id uuid;
  formato text;
  resultado jsonb := coalesce(p_dados_extraidos->'resultado_validacao', '{}'::jsonb);
  status_validacao text := coalesce(nullif(resultado->>'status', ''), 'validacao_parcial');
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar CT-e';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma NF para o CT-e';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;

  SELECT * INTO tipo FROM public.documento_tipos WHERE codigo = p_documento_tipo_codigo AND ativo = true;
  IF tipo.id IS NULL OR p_documento_tipo_codigo NOT IN ('cte_xml', 'cte_pdf_dacte') THEN
    RAISE EXCEPTION 'Tipo documental de CT-e invalido';
  END IF;
  IF lower(p_mime_type) <> ALL (SELECT lower(unnest(tipo.mime_types_aceitos))) THEN
    RAISE EXCEPTION 'MIME type nao permitido para CT-e';
  END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);

  SELECT n.cedente_id, n.fundo_id, n.cedente_fundo_id, count(DISTINCT n.id)
    INTO cedente, fundo, cedente_fundo, nf_count
  FROM public.notas_fiscais n
  JOIN public.nota_fiscal_entregas nfe ON nfe.nota_fiscal_id = n.id
  WHERE n.id = ANY(p_nota_fiscal_ids)
    AND n.fundo_id IS NOT NULL
    AND n.cedente_fundo_id IS NOT NULL
    AND nfe.status_entrega NOT IN ('nao_aplicavel', 'cancelada', 'devolvida')
  GROUP BY n.cedente_id, n.fundo_id, n.cedente_fundo_id;

  IF cedente IS NULL OR fundo IS NULL OR cedente_fundo IS NULL OR nf_count <> expected_count THEN
    RAISE EXCEPTION 'As NFs precisam estar em acompanhamento ativo e pertencer ao mesmo cedente, fundo e vinculo';
  END IF;
  IF actor_role = 'cedente' AND cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'NF fora do cedente autenticado';
  END IF;
  IF actor_role = 'gestor' AND to_regclass('public.usuario_fundos') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.usuario_fundos uf
      WHERE uf.usuario_id = actor_id
        AND uf.fundo_id = fundo
        AND uf.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.documento_requisito_instancias dri
    JOIN public.nota_fiscal_entregas nfe ON nfe.id = dri.nota_fiscal_entrega_id
    WHERE nfe.nota_fiscal_id = ANY(p_nota_fiscal_ids)
      AND dri.tipo_documento_codigo_snapshot IN ('cte', 'cte_xml')
      AND dri.status NOT IN ('cancelado', 'dispensado')
  ) THEN
    RAISE EXCEPTION 'CT-e nao esta configurado como requisito documental para esta NF/operação';
  END IF;

  IF p_chave_cte IS NOT NULL AND EXISTS (SELECT 1 FROM public.ctes WHERE chave_cte = p_chave_cte) THEN
    RAISE EXCEPTION 'Chave de CT-e ja cadastrada';
  END IF;

  IF p_documento_tipo_codigo = 'cte_xml' AND status_validacao = 'rejeitado' THEN
    RAISE EXCEPTION 'CT-e incompativel com a NF-e';
  END IF;

  formato := CASE WHEN p_documento_tipo_codigo = 'cte_xml' THEN 'xml' ELSE 'pdf' END;

  INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
  VALUES (tipo.id, 'enviado', actor_id)
  RETURNING id INTO v_doc_id;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, enviado_por
  )
  VALUES (v_doc_id, 1, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', actor_id)
  RETURNING id INTO v_version_id;

  INSERT INTO public.ctes (
    fundo_id, cedente_id, cedente_fundo_id, chave_cte, numero, serie, data_emissao,
    ambiente, modelo, tipo_cte, tipo_servico, modal, cfop, natureza_operacao,
    protocolo, status_autorizacao, motivo_status, data_autorizacao,
    cnpj_transportadora, cnpj_remetente, cnpj_destinatario,
    transportadora_razao_social, transportadora_ie, rntrc, remetente_razao_social, destinatario_razao_social,
    municipio_origem_codigo, municipio_origem_nome, uf_origem,
    municipio_destino_codigo, municipio_destino_nome, uf_destino,
    valor_frete, valor_prestacao, valor_receber, valor_carga,
    produto_predominante, categoria_carga, quantidade_carga, unidade_carga,
    peso_bruto, peso_liquido, volume_quantidade, formato_origem, nivel_validacao,
    status, documento_id, documento_versao_atual_id, dados_extraidos, hash_sha256, uploaded_by, resultado_validacao
  )
  VALUES (
    fundo, cedente, cedente_fundo, p_chave_cte, p_numero, p_serie, p_data_emissao,
    nullif(p_dados_extraidos->>'ambiente', ''), nullif(p_dados_extraidos->>'modelo', ''),
    nullif(p_dados_extraidos->>'tipo_cte', ''), nullif(p_dados_extraidos->>'tipo_servico', ''),
    nullif(p_dados_extraidos->>'modal', ''), nullif(p_dados_extraidos->>'cfop', ''),
    nullif(p_dados_extraidos->>'natureza_operacao', ''), nullif(p_dados_extraidos->>'protocolo_autorizacao', ''),
    nullif(p_dados_extraidos->>'status_autorizacao', ''), nullif(p_dados_extraidos->>'motivo_status', ''),
    nullif(p_dados_extraidos->>'data_autorizacao', '')::timestamptz,
    NULLIF(regexp_replace(coalesce(p_cnpj_transportadora, ''), '\D', '', 'g'), ''),
    NULLIF(regexp_replace(coalesce(p_cnpj_remetente, ''), '\D', '', 'g'), ''),
    NULLIF(regexp_replace(coalesce(p_cnpj_destinatario, ''), '\D', '', 'g'), ''),
    nullif(p_dados_extraidos#>>'{transportadora,razao_social}', ''),
    nullif(p_dados_extraidos#>>'{transportadora,inscricao_estadual}', ''),
    nullif(p_dados_extraidos->>'rntrc', ''),
    nullif(p_dados_extraidos#>>'{remetente,razao_social}', ''),
    nullif(p_dados_extraidos#>>'{destinatario,razao_social}', ''),
    nullif(p_dados_extraidos->>'municipio_origem_codigo', ''),
    nullif(p_dados_extraidos->>'municipio_origem_nome', ''),
    nullif(p_dados_extraidos->>'uf_origem', ''),
    nullif(p_dados_extraidos->>'municipio_destino_codigo', ''),
    nullif(p_dados_extraidos->>'municipio_destino_nome', ''),
    nullif(p_dados_extraidos->>'uf_destino', ''),
    p_valor_frete,
    nullif(p_dados_extraidos->>'valor_prestacao', '')::numeric,
    nullif(p_dados_extraidos->>'valor_receber', '')::numeric,
    nullif(p_dados_extraidos->>'valor_carga', '')::numeric,
    nullif(p_dados_extraidos->>'produto_predominante', ''),
    nullif(p_dados_extraidos->>'categoria_carga', ''),
    nullif(p_dados_extraidos->>'quantidade_carga', '')::numeric,
    nullif(p_dados_extraidos->>'unidade_carga', ''),
    nullif(p_dados_extraidos->>'peso_bruto', '')::numeric,
    nullif(p_dados_extraidos->>'peso_liquido', '')::numeric,
    nullif(p_dados_extraidos->>'volume_quantidade', '')::numeric,
    formato, p_nivel_validacao, 'em_analise', v_doc_id, v_version_id,
    coalesce(p_dados_extraidos, '{}'::jsonb) - 'xml_original',
    lower(p_sha256), actor_id, resultado
  )
  RETURNING id INTO v_cte_id;

  INSERT INTO public.documento_vinculos (documento_id, cte_id, cedente_id)
  VALUES (v_doc_id, v_cte_id, cedente);

  INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id, principal)
  SELECT v_doc_id, nfe.id, cedente, false
  FROM public.nota_fiscal_entregas nfe
  WHERE nfe.nota_fiscal_id = ANY(p_nota_fiscal_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.cte_notas_fiscais (
    cte_id, nota_fiscal_id, chave_nfe_referenciada, status_validacao, resultado_validacao, divergencias, validado_em
  )
  SELECT
    v_cte_id,
    n.id,
    n.chave_acesso,
    coalesce(nullif(vnf.item->>'status', ''), status_validacao),
    coalesce(vnf.item, resultado),
    coalesce((vnf.item->'bloqueios') || (vnf.item->'alertas'), '[]'::jsonb),
    now()
  FROM public.notas_fiscais n
  LEFT JOIN LATERAL (
    SELECT item
    FROM jsonb_array_elements(coalesce(resultado->'validacoesPorNf', '[]'::jsonb)) item
    WHERE item->>'notaFiscalId' = n.id::text
    LIMIT 1
  ) vnf ON true
  WHERE n.id = ANY(p_nota_fiscal_ids);

  UPDATE public.documento_requisito_instancias dri
  SET documento_id = v_doc_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
  FROM public.nota_fiscal_entregas nfe
  WHERE dri.nota_fiscal_entrega_id = nfe.id
    AND nfe.nota_fiscal_id = ANY(p_nota_fiscal_ids)
    AND dri.tipo_documento_codigo_snapshot IN ('cte', 'cte_xml')
    AND dri.status NOT IN ('cancelado', 'dispensado');

  FOR delivery IN
    SELECT nfe.* FROM public.nota_fiscal_entregas nfe WHERE nfe.nota_fiscal_id = ANY(p_nota_fiscal_ids)
  LOOP
    PERFORM public.registrar_evento_entrega(delivery.id, 'cte_enviado', delivery.status_entrega, delivery.status_entrega, 'usuario', jsonb_build_object('cte_id', v_cte_id, 'versao_id', v_version_id, 'resultado_validacao', status_validacao));
  END LOOP;

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'CT-e enviado', 'Um CT-e foi enviado para analise.', 'cte_enviado',
         'cte:' || v_cte_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object(
    'cte_id', v_cte_id,
    'documento_id', v_doc_id,
    'versao_id', v_version_id,
    'status_validacao', status_validacao,
    'resultado_validacao', resultado
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revalidar_cte_nota_fiscal(
  p_cte_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  link record;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode revalidar CT-e';
  END IF;

  SELECT cnf.*, c.fundo_id, c.resultado_validacao
    INTO link
  FROM public.cte_notas_fiscais cnf
  JOIN public.ctes c ON c.id = cnf.cte_id
  WHERE cnf.cte_id = p_cte_id
    AND cnf.nota_fiscal_id = p_nota_fiscal_id;

  IF link.cte_id IS NULL THEN
    RAISE EXCEPTION 'Vinculo CT-e x NF-e nao encontrado';
  END IF;

  IF to_regclass('public.usuario_fundos') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.usuario_fundos uf
      WHERE uf.usuario_id = actor_id
        AND uf.fundo_id = link.fundo_id
        AND uf.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
    END IF;
  END IF;

  UPDATE public.cte_notas_fiscais
  SET validado_em = now(),
      resultado_validacao = coalesce(nullif(resultado_validacao, '{}'::jsonb), link.resultado_validacao, '{}'::jsonb)
  WHERE cte_id = p_cte_id
    AND nota_fiscal_id = p_nota_fiscal_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  )
  VALUES (
    actor_id, 'usuario', 'app', 'CTE_REVALIDADO', 'ctes', p_cte_id,
    jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id)
  );

  RETURN jsonb_build_object('cte_id', p_cte_id, 'nota_fiscal_id', p_nota_fiscal_id, 'revalidado_em', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revalidar_cte_nota_fiscal(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revalidar_cte_nota_fiscal(uuid, uuid) FROM PUBLIC;
