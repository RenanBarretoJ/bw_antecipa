-- P2.6.4: estado funcional canonico do dominio.
-- Esta migration e idempotente por definicao e interrompe em pre-condicoes inseguras.
BEGIN;

DO $p264$
BEGIN
  IF to_regclass('public.notas_fiscais') IS NULL
     OR to_regclass('public.remessas_cnab') IS NULL
     OR to_regclass('public.integracao_fundo_versoes') IS NULL
     OR to_regclass('public.operacoes') IS NULL
     OR to_regclass('public.operacao_calculo_nfs') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: pre-condicoes funcionais ausentes';
  END IF;

  IF EXISTS (SELECT 1 FROM public.notas_fiscais WHERE valor_bruto <= 0) THEN
    RAISE EXCEPTION 'P2.6.4: existem notas fiscais com valor_bruto nao positivo';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.remessas_cnab r
    LEFT JOIN public.integracao_fundo_versoes iv ON iv.id = r.integracao_fundo_versao_id
    WHERE r.integracao_fundo_versao_id IS NOT NULL
      AND iv.id IS NULL
  ) THEN
    RAISE EXCEPTION 'P2.6.4: existem remessas CNAB com versao de integracao orfa';
  END IF;

  IF to_regprocedure('private.usuario_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: helper privado de acesso por fundo ausente';
  END IF;
END
$p264$;

ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_valor_bruto_check;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_valor_bruto_check
  CHECK (valor_bruto > 0) NOT VALID;
ALTER TABLE public.notas_fiscais
  VALIDATE CONSTRAINT notas_fiscais_valor_bruto_check;

DO $p264$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.remessas_cnab'::regclass
      AND conname = 'remessas_cnab_integracao_fundo_versao_id_fkey'
  ) THEN
    ALTER TABLE public.remessas_cnab
      ADD CONSTRAINT remessas_cnab_integracao_fundo_versao_id_fkey
      FOREIGN KEY (integracao_fundo_versao_id)
      REFERENCES public.integracao_fundo_versoes(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$p264$;

ALTER TABLE public.remessas_cnab
  VALIDATE CONSTRAINT remessas_cnab_integracao_fundo_versao_id_fkey;

DO $p264$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.operacao_calculo_nfs'::regclass
      AND conname = 'operacao_calculo_nfs_operacao_nf_unique'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'P2.6.4: unicidade canonica de memoria financeira ausente';
  END IF;
END
$p264$;

DROP INDEX IF EXISTS public.idx_operacao_calculo_nfs_operacao;

CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica_financeiro_v1(
  p_operacao_id uuid,
  p_taxa_desconto numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  op record;
  nf record;
  memoria jsonb;
  metodo text;
  data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  fundo_id_operacao uuid;
  v_valor_bruto_total numeric := 0;
  valor_liquido_total numeric := 0;
  desconto_total numeric := 0;
  prazo_ponderado numeric := 0;
  prazo_medio integer := 0;
  prazo_referencia integer := 0;
  vencimento_maximo date;
  nfs_count integer := 0;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa mensal invalida';
  END IF;

  SELECT o.*, cf.fundo_id
  INTO op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  fundo_id_operacao := op.fundo_id;
  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  IF op.status = 'aprovada' THEN
    RETURN jsonb_build_object(
      'operacao_id', op.id,
      'idempotent_replay', true,
      'status', op.status,
      'valor_liquido_desembolso', op.valor_liquido_desembolso,
      'metodo_calculo_financeiro', coalesce(op.metodo_calculo_financeiro, 'LEGADO_MENSAL_DIAS_REAIS_30'),
      'data_base', op.calculo_data_base
    );
  END IF;
  IF op.status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', op.status;
  END IF;
  IF op.contexto_configuracao_status = 'completo' AND (
    op.cedente_fundo_id IS NULL OR op.politica_operacional_versao_id IS NULL OR op.politica_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Operacao sem contexto operacional completo';
  END IF;

  metodo := coalesce(
    op.metodo_calculo_financeiro,
    op.politica_snapshot #>> '{calculo_financeiro,metodo}',
    'LEGADO_MENSAL_DIAS_REAIS_30'
  );
  IF metodo NOT IN ('LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365') THEN
    RAISE EXCEPTION 'Metodo financeiro congelado na operacao e invalido';
  END IF;

  DELETE FROM public.operacao_calculo_nfs WHERE operacao_id = p_operacao_id;

  FOR nf IN
    SELECT n.*
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
    FOR UPDATE OF n
  LOOP
    IF nf.cedente_id <> op.cedente_id
       OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id
       OR nf.fundo_id IS DISTINCT FROM fundo_id_operacao THEN
      RAISE EXCEPTION 'NF fora do contexto da operacao';
    END IF;
    IF nf.status NOT IN ('em_antecipacao', 'aceita') THEN
      RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf;
    END IF;

    memoria := private.calcular_memoria_financeira_nf(
      nf.id, nf.valor_bruto, p_taxa_desconto, data_base, nf.data_vencimento, metodo
    );

    INSERT INTO public.operacao_calculo_nfs (
      operacao_id, nota_fiscal_id, fundo_id, cedente_id, metodo_calculo_financeiro,
      valor_nominal, taxa_mensal, data_base, vencimento_contratual, vencimento_calculo,
      base_calculo, calendario, dias_corridos_reais, dias_uteis, dias_financeiros,
      dias_aplicados, expoente, fator, valor_presente, desconto, regra_arredondamento, versao_motor
    ) VALUES (
      op.id, nf.id, fundo_id_operacao, op.cedente_id, metodo,
      (memoria->>'valor_nominal')::numeric, p_taxa_desconto, data_base,
      (memoria->>'vencimento_contratual')::date, (memoria->>'vencimento_calculo')::date,
      (memoria->>'base')::integer, memoria->>'calendario',
      (memoria->>'dias_corridos_reais')::integer, (memoria->>'dias_uteis')::integer,
      (memoria->>'dias_financeiros')::integer, (memoria->>'dias')::integer,
      (memoria->>'expoente')::numeric, (memoria->>'fator')::numeric,
      (memoria->>'valor_presente')::numeric, (memoria->>'desconto')::numeric,
      memoria->>'arredondamento', (memoria->>'versao_motor')::integer
    );

    UPDATE public.notas_fiscais
    SET taxa_desagio = p_taxa_desconto,
        valor_antecipado = (memoria->>'valor_presente')::numeric
    WHERE id = nf.id;

    v_valor_bruto_total := v_valor_bruto_total + (memoria->>'valor_nominal')::numeric;
    valor_liquido_total := valor_liquido_total + (memoria->>'valor_presente')::numeric;
    desconto_total := desconto_total + (memoria->>'desconto')::numeric;
    prazo_ponderado := prazo_ponderado + ((memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric);
    prazo_referencia := greatest(prazo_referencia, (memoria->>'dias')::integer);
    vencimento_maximo := greatest(vencimento_maximo, nf.data_vencimento);
    nfs_count := nfs_count + 1;
  END LOOP;

  IF nfs_count = 0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.taxas_cedente tc
    WHERE tc.cedente_id = op.cedente_id
      AND tc.taxa_percentual = p_taxa_desconto
      AND prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max
  ) THEN
    RAISE EXCEPTION 'A taxa selecionada nao esta configurada para o prazo da operacao';
  END IF;

  prazo_medio := round(prazo_ponderado / v_valor_bruto_total);

  PERFORM pg_catalog.set_config('app.calculo_aprovacao', 'true', true);

  UPDATE public.operacoes
  SET taxa_desconto = p_taxa_desconto,
      prazo_dias = prazo_medio,
      valor_bruto_total = round(v_valor_bruto_total, 2),
      valor_liquido_desembolso = round(valor_liquido_total, 2),
      data_vencimento = vencimento_maximo,
      metodo_calculo_financeiro = metodo,
      calculo_data_base = data_base,
      calculo_versao_motor = 1,
      calculo_memoria = jsonb_build_object(
        'metodo', metodo,
        'taxa_mensal', p_taxa_desconto,
        'data_base', data_base,
        'valor_bruto_total', round(v_valor_bruto_total, 2),
        'valor_liquido_total', round(valor_liquido_total, 2),
        'desconto_total', round(desconto_total, 2),
        'prazo_medio', prazo_medio,
        'prazo_unidade', CASE metodo
          WHEN 'DIAS_UTEIS_252' THEN 'dias_uteis'
          WHEN 'TRINTA_360' THEN 'dias_financeiros'
          ELSE 'dias_corridos'
        END,
        'vencimento_maximo', vencimento_maximo,
        'quantidade_nfs', nfs_count,
        'previa_valor_liquido_solicitacao', op.valor_liquido_desembolso,
        'diferenca_previa_aprovacao', CASE
          WHEN op.valor_liquido_desembolso IS NULL THEN NULL
          ELSE round(valor_liquido_total - op.valor_liquido_desembolso, 2)
        END,
        'versao_motor', 1,
        'arredondamento', 'ROUND_HALF_UP_2_CASAS'
      ),
      status = 'aprovada',
      aprovado_por = actor_id,
      aprovado_em = now()
  WHERE id = p_operacao_id AND status IN ('solicitada', 'em_analise');

  IF NOT FOUND THEN RAISE EXCEPTION 'A operacao foi alterada concorrentemente'; END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    actor_id, 'OPERACAO_APROVADA', 'operacoes', p_operacao_id,
    jsonb_build_object('status', op.status),
    jsonb_build_object(
      'status', 'aprovada', 'taxa_desconto', p_taxa_desconto,
      'metodo_calculo_financeiro', metodo, 'data_base', data_base,
      'prazo_dias', prazo_medio, 'valor_liquido_desembolso', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'nfs', nfs_count
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'idempotent_replay', false,
    'status', 'aprovada',
    'prazo_dias', prazo_medio,
    'valor_liquido_desembolso', round(valor_liquido_total, 2),
    'desconto_total', round(desconto_total, 2),
    'metodo_calculo_financeiro', metodo,
    'data_base', data_base,
    'nfs', nfs_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_aprovacao_financeira_direta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'aprovada'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'aprovada')
     AND coalesce(current_setting('app.calculo_aprovacao', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Aprovacao financeira deve ocorrer pela RPC atomica';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operacoes_bloquear_aprovacao_financeira_direta ON public.operacoes;
CREATE TRIGGER operacoes_bloquear_aprovacao_financeira_direta
BEFORE INSERT OR UPDATE OF status ON public.operacoes
FOR EACH ROW
EXECUTE FUNCTION public.bloquear_aprovacao_financeira_direta();

CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  operacao_status text;
  fundo_id_operacao uuid;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;

  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa mensal invalida';
  END IF;

  SELECT o.status, cf.fundo_id
  INTO operacao_status, fundo_id_operacao
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;

  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  IF operacao_status = 'aprovada' THEN
    RAISE EXCEPTION 'A operacao ja foi aprovada e nao pode ser aprovada novamente';
  END IF;

  IF operacao_status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', operacao_status;
  END IF;

  RETURN public.aprovar_operacao_atomica_financeiro_v1(
    p_operacao_id,
    p_taxa_desconto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_aprovacao_financeira_direta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica_financeiro_v1(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric) FROM PUBLIC, anon, authenticated;

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
    RAISE EXCEPTION 'CT-e nao esta configurado como requisito documental para esta NF/operaÃ§Ã£o';
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

REVOKE ALL ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb)
  TO authenticated;

COMMIT;
