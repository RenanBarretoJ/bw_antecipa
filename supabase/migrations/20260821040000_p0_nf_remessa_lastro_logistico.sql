-- P0/P1 Claude: NF de Remessa como lastro logistico auxiliar.
--
-- A NF de venda continua sendo o UNICO ativo financeiro. A NF de remessa e um
-- documento fiscal/logistico auxiliar e opcional (relacao 1 venda : N
-- remessas) que nunca e cadastrada em notas_fiscais nem participa de
-- parcelas/VP/taxa/operacao/exposicao. Quando presente, ela pode se interpor
-- na cadeia entre a venda e o CT-e (venda -> remessa -> CT-e); sem remessa, o
-- fluxo atual (venda -> CT-e direto) permanece inalterado.
--
-- Este migration:
--   1. estende notas_fiscais com itens/quantidade estruturados (necessarios
--      para o saldo logistico entre a venda e suas remessas);
--   2. cria nota_fiscal_remessas (RLS somente leitura -- toda mutacao passa
--      pela RPC registrar_nota_fiscal_remessa, que resolve fundo/vinculo a
--      partir da venda, nunca do payload do cliente);
--   3. estende ctes/cte_notas_fiscais para persistir a cadeia
--      (DIRETO_VENDA | VIA_REMESSA) e a classificacao do tomador;
--   4. adiciona um vinculo opcional e somente-informativo de canhoto ->
--      remessa (a satisfacao do gate logistico da venda em si independe
--      deste vinculo: canhotos.nota_fiscal_entrega_id ja e por venda).

BEGIN;

-- 1. notas_fiscais: itens/quantidade estruturados -----------------------

ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS quantidade_total numeric,
  ADD COLUMN IF NOT EXISTS unidade_quantidade text,
  ADD COLUMN IF NOT EXISTS itens_estruturados jsonb;

ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_quantidade_total_check;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_quantidade_total_check CHECK (quantidade_total IS NULL OR quantidade_total >= 0);

COMMENT ON COLUMN public.notas_fiscais.quantidade_total IS
  'Soma de <det><prod><qCom> do XML da NF-e. Null quando a NF foi cadastrada sem itens estruturados (upload de PDF, cadastro manual) -- nesses casos o saldo logistico com remessas e avaliado por valor (valor_bruto), nunca por uma quantidade inferida.';
COMMENT ON COLUMN public.notas_fiscais.itens_estruturados IS
  'Array de {descricao,codigo,quantidade,unidade,valor} extraido de <det><prod>. Auditoria e matching de produtos com NF de remessa; nao substitui descricao_itens (preservado por compatibilidade).';

-- 2. nota_fiscal_remessas -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.nota_fiscal_remessas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_venda_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  chave_acesso text NOT NULL,
  numero text,
  serie text,
  emitente_cnpj text,
  emitente_razao_social text,
  destinatario_cnpj text,
  destinatario_razao_social text,
  data_emissao date,
  valor_total numeric NOT NULL DEFAULT 0,
  quantidade_total numeric,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  status_validacao text NOT NULL,
  referencia_nf_venda_confirmada boolean NOT NULL DEFAULT false,
  motivos_validacao jsonb NOT NULL DEFAULT '[]'::jsonb,
  bucket text NOT NULL,
  path text NOT NULL,
  nome_original text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nota_fiscal_remessas_chave_unique UNIQUE (chave_acesso),
  CONSTRAINT nota_fiscal_remessas_chave_formato_check CHECK (chave_acesso ~ '^[0-9]{44}$'),
  CONSTRAINT nota_fiscal_remessas_status_check CHECK (status_validacao IN ('VALIDADA', 'REVISAO_MANUAL', 'REJEITADA')),
  CONSTRAINT nota_fiscal_remessas_valor_check CHECK (valor_total >= 0),
  CONSTRAINT nota_fiscal_remessas_quantidade_check CHECK (quantidade_total IS NULL OR quantidade_total >= 0),
  CONSTRAINT nota_fiscal_remessas_cnpj_emitente_check CHECK (emitente_cnpj IS NULL OR emitente_cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT nota_fiscal_remessas_cnpj_destinatario_check CHECK (destinatario_cnpj IS NULL OR destinatario_cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT nota_fiscal_remessas_tamanho_check CHECK (tamanho_bytes > 0),
  CONSTRAINT nota_fiscal_remessas_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.nota_fiscal_remessas IS
  'Documento fiscal/logistico auxiliar (NF de remessa), opcional, 1 remessa : 1 venda, 1 venda : N remessas. Nunca e um ativo financeiro -- nenhuma integracao de parcelas/VP/taxa/operacao/exposicao le esta tabela. Mutacao exclusiva via registrar_nota_fiscal_remessa (SECURITY DEFINER); nao existe policy de INSERT direto.';

CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessas_venda ON public.nota_fiscal_remessas(nota_fiscal_venda_id);
CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessas_fundo ON public.nota_fiscal_remessas(fundo_id);
CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessas_cedente ON public.nota_fiscal_remessas(cedente_id);
CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessas_venda_status ON public.nota_fiscal_remessas(nota_fiscal_venda_id, status_validacao);

DROP TRIGGER IF EXISTS nota_fiscal_remessas_updated_at ON public.nota_fiscal_remessas;
CREATE TRIGGER nota_fiscal_remessas_updated_at
  BEFORE UPDATE ON public.nota_fiscal_remessas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.nota_fiscal_remessas ENABLE ROW LEVEL SECURITY;

-- Somente leitura via RLS. Toda escrita (insert) passa por
-- registrar_nota_fiscal_remessa, que resolve cedente_id/fundo_id/
-- cedente_fundo_id a partir da NF de venda (nunca do payload do cliente) e
-- computa status_validacao/referencia_nf_venda_confirmada no servidor.
DROP POLICY IF EXISTS nota_fiscal_remessas_gestor_select ON public.nota_fiscal_remessas;
CREATE POLICY nota_fiscal_remessas_gestor_select ON public.nota_fiscal_remessas
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(nota_fiscal_remessas.fundo_id)));

DROP POLICY IF EXISTS nota_fiscal_remessas_consultor_select ON public.nota_fiscal_remessas;
CREATE POLICY nota_fiscal_remessas_consultor_select ON public.nota_fiscal_remessas
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(nota_fiscal_remessas.cedente_id)));

DROP POLICY IF EXISTS nota_fiscal_remessas_cedente_select ON public.nota_fiscal_remessas;
CREATE POLICY nota_fiscal_remessas_cedente_select ON public.nota_fiscal_remessas
  FOR SELECT TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()));

REVOKE ALL ON public.nota_fiscal_remessas FROM PUBLIC, anon;
GRANT SELECT ON public.nota_fiscal_remessas TO authenticated;

-- 3. RPC registrar_nota_fiscal_remessa -----------------------------------

CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa(
  p_nota_fiscal_venda_id uuid,
  p_chave_acesso text,
  p_numero text,
  p_serie text,
  p_emitente_cnpj text,
  p_emitente_razao_social text,
  p_destinatario_cnpj text,
  p_destinatario_razao_social text,
  p_data_emissao date,
  p_valor_total numeric,
  p_quantidade_total numeric,
  p_itens jsonb,
  p_status_validacao text,
  p_referencia_nf_venda_confirmada boolean,
  p_motivos_validacao jsonb,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  venda record;
  chave_limpa text := regexp_replace(coalesce(p_chave_acesso, ''), '\D', '', 'g');
  v_id uuid;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar NF de remessa';
  END IF;
  IF p_status_validacao NOT IN ('VALIDADA', 'REVISAO_MANUAL', 'REJEITADA') THEN
    RAISE EXCEPTION 'Status de validacao da remessa invalido';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  IF chave_limpa !~ '^[0-9]{44}$' THEN
    RAISE EXCEPTION 'Chave de acesso da remessa invalida';
  END IF;
  IF p_valor_total < 0 THEN
    RAISE EXCEPTION 'Valor total da remessa invalido';
  END IF;

  SELECT id, cedente_id, fundo_id, cedente_fundo_id, chave_acesso
    INTO venda
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_venda_id;

  IF venda.id IS NULL THEN
    RAISE EXCEPTION 'NF de venda nao encontrada';
  END IF;
  IF venda.fundo_id IS NULL OR venda.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'NF de venda sem contexto de fundo e vinculo';
  END IF;
  IF venda.chave_acesso IS NOT NULL AND venda.chave_acesso = chave_limpa THEN
    RAISE EXCEPTION 'A remessa nao pode ter a mesma chave de acesso da NF de venda';
  END IF;

  IF actor_role = 'cedente' AND venda.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'NF de venda fora do cedente autenticado';
  END IF;
  IF actor_role = 'gestor' AND NOT private.usuario_tem_acesso_fundo(venda.fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nota_fiscal_remessas WHERE chave_acesso = chave_limpa) THEN
    RAISE EXCEPTION 'Chave de acesso da remessa ja cadastrada';
  END IF;

  INSERT INTO public.nota_fiscal_remessas (
    nota_fiscal_venda_id, cedente_id, fundo_id, cedente_fundo_id,
    chave_acesso, numero, serie,
    emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social,
    data_emissao, valor_total, quantidade_total, itens,
    status_validacao, referencia_nf_venda_confirmada, motivos_validacao,
    bucket, path, nome_original, mime_type, tamanho_bytes, sha256, criado_por
  )
  VALUES (
    venda.id, venda.cedente_id, venda.fundo_id, venda.cedente_fundo_id,
    chave_limpa, nullif(p_numero, ''), nullif(p_serie, ''),
    nullif(regexp_replace(coalesce(p_emitente_cnpj, ''), '\D', '', 'g'), ''), nullif(p_emitente_razao_social, ''),
    nullif(regexp_replace(coalesce(p_destinatario_cnpj, ''), '\D', '', 'g'), ''), nullif(p_destinatario_razao_social, ''),
    p_data_emissao, coalesce(p_valor_total, 0), p_quantidade_total, coalesce(p_itens, '[]'::jsonb),
    p_status_validacao, coalesce(p_referencia_nf_venda_confirmada, false), coalesce(p_motivos_validacao, '[]'::jsonb),
    p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), actor_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status_validacao', p_status_validacao, 'nota_fiscal_venda_id', venda.id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_nota_fiscal_remessa(uuid, text, text, text, text, text, text, text, date, numeric, numeric, jsonb, text, boolean, jsonb, text, text, text, text, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_nota_fiscal_remessa(uuid, text, text, text, text, text, text, text, date, numeric, numeric, jsonb, text, boolean, jsonb, text, text, text, text, bigint, text)
  TO authenticated;

-- 4. ctes / cte_notas_fiscais: cadeia direta vs via remessa ---------------

ALTER TABLE public.ctes
  ADD COLUMN IF NOT EXISTS tomador_cnpj text,
  ADD COLUMN IF NOT EXISTS tomador_classificacao text;

ALTER TABLE public.ctes
  DROP CONSTRAINT IF EXISTS ctes_tomador_cnpj_check,
  DROP CONSTRAINT IF EXISTS ctes_tomador_classificacao_check;
ALTER TABLE public.ctes
  ADD CONSTRAINT ctes_tomador_cnpj_check CHECK (tomador_cnpj IS NULL OR tomador_cnpj ~ '^[0-9]{14}$'),
  ADD CONSTRAINT ctes_tomador_classificacao_check CHECK (tomador_classificacao IS NULL OR tomador_classificacao IN ('ALLOW', 'REVISAO_MANUAL', 'DENY'));

COMMENT ON COLUMN public.ctes.tomador_classificacao IS
  'Regra 6 (NF de Remessa): ALLOW quando o tomador e o emitente exato da NF de venda; REVISAO_MANUAL quando e outro estabelecimento aprovado do mesmo Cedente; DENY quando e terceiro estranho ou nao identificavel no XML (fail-closed). Null quando o CT-e referencia a venda diretamente (DIRETO_VENDA) e a regra do tomador nao se aplica.';

ALTER TABLE public.cte_notas_fiscais
  ADD COLUMN IF NOT EXISTS nota_fiscal_remessa_id uuid REFERENCES public.nota_fiscal_remessas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tipo_vinculo text NOT NULL DEFAULT 'DIRETO_VENDA';

ALTER TABLE public.cte_notas_fiscais
  DROP CONSTRAINT IF EXISTS cte_notas_fiscais_tipo_vinculo_check,
  DROP CONSTRAINT IF EXISTS cte_notas_fiscais_vinculo_remessa_check;
ALTER TABLE public.cte_notas_fiscais
  ADD CONSTRAINT cte_notas_fiscais_tipo_vinculo_check CHECK (tipo_vinculo IN ('DIRETO_VENDA', 'VIA_REMESSA')),
  ADD CONSTRAINT cte_notas_fiscais_vinculo_remessa_check CHECK (
    (tipo_vinculo = 'VIA_REMESSA' AND nota_fiscal_remessa_id IS NOT NULL)
    OR (tipo_vinculo = 'DIRETO_VENDA' AND nota_fiscal_remessa_id IS NULL)
  );

COMMENT ON COLUMN public.cte_notas_fiscais.tipo_vinculo IS
  'DIRETO_VENDA: o CT-e referencia a chave da propria NF de venda (fluxo atual, preservado). VIA_REMESSA: o CT-e referencia a chave de uma NF de remessa VALIDADA vinculada a esta venda (regra E do ticket NF de Remessa).';

CREATE INDEX IF NOT EXISTS idx_cte_notas_fiscais_remessa ON public.cte_notas_fiscais(nota_fiscal_remessa_id) WHERE nota_fiscal_remessa_id IS NOT NULL;

-- 5. canhotos: vinculo informativo com a remessa (regra F) ----------------

ALTER TABLE public.canhotos
  ADD COLUMN IF NOT EXISTS nota_fiscal_remessa_id uuid REFERENCES public.nota_fiscal_remessas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.canhotos.nota_fiscal_remessa_id IS
  'Somente informativo/exibicao ("Entrega comprovada via NF de Remessa <numero>"). A satisfacao do gate logistico da venda independe deste campo -- canhotos.nota_fiscal_entrega_id ja e por venda, com ou sem remessa.';

-- 6. registrar_cte_documento: nova versao com suporte a cadeia via remessa e
--    classificacao de tomador (regras E e 6 do ticket). Assinatura estendida
--    apenas com parametros DEFAULT no final -- chamadas existentes (sem
--    remessa) continuam funcionando sem alteracao e persistem
--    tipo_vinculo='DIRETO_VENDA' (default da coluna).

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
  p_dados_extraidos jsonb DEFAULT '{}'::jsonb,
  p_tomador_cnpj text DEFAULT NULL,
  p_tomador_classificacao text DEFAULT NULL,
  p_vinculos_remessa jsonb DEFAULT '[]'::jsonb
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

  -- Regra 6 do ticket NF de Remessa: quando o vinculo e via remessa, um
  -- tomador classificado como DENY (terceiro estranho, ou nao identificavel
  -- no XML) bloqueia o cadastro -- fail-closed, igual ao bloqueio de
  -- status_validacao='rejeitado' acima.
  IF p_tomador_classificacao = 'DENY' THEN
    RAISE EXCEPTION 'Tomador do CT-e nao autorizado para o vinculo via remessa';
  END IF;

  -- Defesa em profundidade: todo vinculo VIA_REMESSA informado precisa
  -- corresponder a uma NF de remessa realmente VALIDADA e pertencente a
  -- venda indicada -- nunca confia apenas no jsonb computado pelo chamador.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p_vinculos_remessa, '[]'::jsonb)) v
    WHERE NOT EXISTS (
      SELECT 1 FROM public.nota_fiscal_remessas r
      WHERE r.id = (v->>'nota_fiscal_remessa_id')::uuid
        AND r.nota_fiscal_venda_id = (v->>'nota_fiscal_id')::uuid
        AND r.status_validacao = 'VALIDADA'
    )
  ) THEN
    RAISE EXCEPTION 'Vinculo via remessa invalido: a NF de remessa informada nao esta validada para a NF de venda informada';
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
    status, documento_id, documento_versao_atual_id, dados_extraidos, hash_sha256, uploaded_by, resultado_validacao,
    tomador_cnpj, tomador_classificacao
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
    lower(p_sha256), actor_id, resultado,
    NULLIF(regexp_replace(coalesce(p_tomador_cnpj, ''), '\D', '', 'g'), ''), p_tomador_classificacao
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
    cte_id, nota_fiscal_id, chave_nfe_referenciada, status_validacao, resultado_validacao, divergencias, validado_em,
    nota_fiscal_remessa_id, tipo_vinculo
  )
  SELECT
    v_cte_id,
    n.id,
    n.chave_acesso,
    coalesce(nullif(vnf.item->>'status', ''), status_validacao),
    coalesce(vnf.item, resultado),
    coalesce((vnf.item->'bloqueios') || (vnf.item->'alertas'), '[]'::jsonb),
    now(),
    vinc.remessa_id,
    CASE WHEN vinc.remessa_id IS NOT NULL THEN 'VIA_REMESSA' ELSE 'DIRETO_VENDA' END
  FROM public.notas_fiscais n
  LEFT JOIN LATERAL (
    SELECT item
    FROM jsonb_array_elements(coalesce(resultado->'validacoesPorNf', '[]'::jsonb)) item
    WHERE item->>'notaFiscalId' = n.id::text
    LIMIT 1
  ) vnf ON true
  LEFT JOIN LATERAL (
    SELECT (item->>'nota_fiscal_remessa_id')::uuid AS remessa_id
    FROM jsonb_array_elements(coalesce(p_vinculos_remessa, '[]'::jsonb)) item
    WHERE item->>'nota_fiscal_id' = n.id::text
    LIMIT 1
  ) vinc ON true
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

REVOKE ALL ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb, text, text, jsonb)
  TO authenticated;

COMMIT;
