-- Fase 5: acompanhamento pos-cessao, CT-e, canhoto e entrega da NF.

DO $$
BEGIN
  IF to_regclass('public.documento_tipos') IS NULL
    OR to_regclass('public.documentos_repositorio') IS NULL
    OR to_regclass('public.documento_versoes') IS NULL
    OR to_regclass('public.documento_vinculos') IS NULL
    OR to_regclass('public.documento_requisito_instancias') IS NULL THEN
    RAISE EXCEPTION 'Fase 5 depende da Fase 3 (20260721132903_fase3_repositorio_documental_nf.sql). Aplique as migrations pendentes em ordem cronologica antes de rodar esta migration.';
  END IF;
END;
$$;

ALTER TABLE public.operacoes
  ADD COLUMN IF NOT EXISTS cessao_efetivada_em timestamptz;

INSERT INTO public.documento_tipos (codigo, nome, dominio, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes, permite_multiplas_versoes, ativo)
VALUES
  ('cte_xml', 'CT-e XML', 'entrega', ARRAY['application/xml', 'text/xml'], ARRAY['xml'], 10485760, true, true),
  ('cte_pdf_dacte', 'CT-e PDF/DACTE', 'entrega', ARRAY['application/pdf'], ARRAY['pdf'], 20971520, true, true),
  ('canhoto', 'Canhoto de entrega', 'entrega', ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520, true, true)
ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome,
  dominio = EXCLUDED.dominio,
  mime_types_aceitos = EXCLUDED.mime_types_aceitos,
  extensoes_aceitas = EXCLUDED.extensoes_aceitas,
  tamanho_max_bytes = EXCLUDED.tamanho_max_bytes,
  permite_multiplas_versoes = EXCLUDED.permite_multiplas_versoes,
  ativo = true;

CREATE TABLE IF NOT EXISTS public.nota_fiscal_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
  status_entrega text NOT NULL,
  cessao_efetivada_em timestamptz,
  data_limite_cte date,
  data_limite_canhoto date,
  data_entrega date,
  entrega_confirmada_em timestamptz,
  motivo_pendencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nota_fiscal_entregas_operacao_nf_unique UNIQUE (operacao_id, nota_fiscal_id),
  CONSTRAINT nota_fiscal_entregas_operacao_nf_fk FOREIGN KEY (operacao_id, nota_fiscal_id)
    REFERENCES public.operacoes_nfs(operacao_id, nota_fiscal_id) ON DELETE CASCADE,
  CONSTRAINT nota_fiscal_entregas_status_check CHECK (status_entrega IN (
    'nao_aplicavel', 'em_transito', 'aguardando_validacao', 'entregue',
    'entrega_com_pendencia', 'devolvida', 'cancelada'
  )),
  CONSTRAINT nota_fiscal_entregas_entregue_check CHECK (
    status_entrega <> 'entregue'
    OR (data_entrega IS NOT NULL AND entrega_confirmada_em IS NOT NULL)
  )
);

CREATE TRIGGER nota_fiscal_entregas_updated_at
  BEFORE UPDATE ON public.nota_fiscal_entregas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.eventos_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_entrega_id uuid NOT NULL REFERENCES public.nota_fiscal_entregas(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL,
  status_anterior text,
  status_novo text,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ator_tipo text NOT NULL DEFAULT 'usuario',
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_entrega_tipo_check CHECK (tipo_evento IN (
    'cessao_efetivada', 'cte_pendente', 'cte_enviado', 'cte_aprovado',
    'cte_rejeitado', 'cte_atrasado', 'canhoto_pendente', 'canhoto_enviado',
    'canhoto_aprovado', 'canhoto_rejeitado', 'canhoto_atrasado',
    'entrega_confirmada', 'entrega_com_pendencia', 'devolucao_registrada'
  )),
  CONSTRAINT eventos_entrega_ator_check CHECK (ator_tipo IN ('usuario', 'sistema', 'cron', 'integracao'))
);

CREATE OR REPLACE FUNCTION public.proteger_eventos_entrega()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Eventos de entrega sao append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_entrega_append_only
  BEFORE UPDATE OR DELETE ON public.eventos_entrega
  FOR EACH ROW EXECUTE FUNCTION public.proteger_eventos_entrega();

CREATE TABLE IF NOT EXISTS public.ctes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  chave_cte text,
  numero text,
  serie text,
  data_emissao date,
  cnpj_transportadora text,
  cnpj_remetente text,
  cnpj_destinatario text,
  valor_frete numeric,
  formato_origem text NOT NULL,
  nivel_validacao text NOT NULL,
  status text NOT NULL DEFAULT 'em_analise',
  analisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  analisado_em timestamptz,
  motivo_rejeicao text,
  documento_id uuid REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_atual_id uuid REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  documento_versao_aprovada_id uuid REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  dados_extraidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ctes_chave_unique UNIQUE (chave_cte),
  CONSTRAINT ctes_formato_check CHECK (formato_origem IN ('xml', 'pdf')),
  CONSTRAINT ctes_validacao_check CHECK (nivel_validacao IN ('estrutural', 'manual', 'hibrido')),
  CONSTRAINT ctes_status_check CHECK (status IN ('enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado')),
  CONSTRAINT ctes_valor_frete_check CHECK (valor_frete IS NULL OR valor_frete >= 0),
  CONSTRAINT ctes_motivo_rejeicao_check CHECK (status <> 'rejeitado' OR length(trim(coalesce(motivo_rejeicao, ''))) > 0),
  CONSTRAINT ctes_chave_formato_check CHECK (chave_cte IS NULL OR chave_cte ~ '^[0-9]{44}$'),
  CONSTRAINT ctes_cnpj_transportadora_check CHECK (cnpj_transportadora IS NULL OR cnpj_transportadora ~ '^[0-9]{14}$'),
  CONSTRAINT ctes_cnpj_remetente_check CHECK (cnpj_remetente IS NULL OR cnpj_remetente ~ '^[0-9]{14}$'),
  CONSTRAINT ctes_cnpj_destinatario_check CHECK (cnpj_destinatario IS NULL OR cnpj_destinatario ~ '^[0-9]{14}$')
);

CREATE TRIGGER ctes_updated_at
  BEFORE UPDATE ON public.ctes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.cte_notas_fiscais (
  cte_id uuid NOT NULL REFERENCES public.ctes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cte_id, nota_fiscal_id)
);

CREATE TABLE IF NOT EXISTS public.canhotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_entrega_id uuid NOT NULL REFERENCES public.nota_fiscal_entregas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'em_analise',
  data_assinatura date,
  nome_recebedor text,
  documento_recebedor text,
  possui_assinatura boolean NOT NULL DEFAULT false,
  possui_ressalva boolean NOT NULL DEFAULT false,
  descricao_ressalva text,
  recebido_em timestamptz,
  analisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  analisado_em timestamptz,
  motivo_rejeicao text,
  documento_id uuid REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_atual_id uuid REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  documento_versao_aprovada_id uuid REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canhotos_status_check CHECK (status IN ('pendente', 'enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado')),
  CONSTRAINT canhotos_motivo_rejeicao_check CHECK (status <> 'rejeitado' OR length(trim(coalesce(motivo_rejeicao, ''))) > 0),
  CONSTRAINT canhotos_ressalva_check CHECK (possui_ressalva = false OR length(trim(coalesce(descricao_ressalva, ''))) > 0)
);

CREATE TRIGGER canhotos_updated_at
  BEFORE UPDATE ON public.canhotos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.documento_vinculos
  ADD COLUMN IF NOT EXISTS nota_fiscal_entrega_id uuid REFERENCES public.nota_fiscal_entregas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cte_id uuid REFERENCES public.ctes(id) ON DELETE CASCADE;

ALTER TABLE public.documento_vinculos
  DROP CONSTRAINT IF EXISTS documento_vinculos_um_contexto_check;

ALTER TABLE public.documento_vinculos
  ADD CONSTRAINT documento_vinculos_um_contexto_check
  CHECK (num_nonnulls(nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, cte_id) = 1);

ALTER TABLE public.documento_requisito_instancias
  ADD COLUMN IF NOT EXISTS nota_fiscal_entrega_id uuid REFERENCES public.nota_fiscal_entregas(id) ON DELETE CASCADE;

ALTER TABLE public.documento_requisito_instancias
  DROP CONSTRAINT IF EXISTS documento_requisito_contexto_check;

ALTER TABLE public.documento_requisito_instancias
  ADD CONSTRAINT documento_requisito_contexto_check
  CHECK (num_nonnulls(nota_fiscal_id, operacao_id, nota_fiscal_entrega_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_documento_requisito_entrega
  ON public.documento_requisito_instancias(politica_requisito_id, nota_fiscal_entrega_id)
  WHERE nota_fiscal_entrega_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nota_fiscal_entregas_status ON public.nota_fiscal_entregas(status_entrega);
CREATE INDEX IF NOT EXISTS idx_nota_fiscal_entregas_prazos ON public.nota_fiscal_entregas(data_limite_cte, data_limite_canhoto);
CREATE INDEX IF NOT EXISTS idx_nota_fiscal_entregas_nf ON public.nota_fiscal_entregas(nota_fiscal_id);
CREATE INDEX IF NOT EXISTS idx_eventos_entrega_entrega_data ON public.eventos_entrega(nota_fiscal_entrega_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_ctes_cedente_status ON public.ctes(cedente_id, status);
CREATE INDEX IF NOT EXISTS idx_ctes_chave ON public.ctes(chave_cte) WHERE chave_cte IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cte_notas_nf ON public.cte_notas_fiscais(nota_fiscal_id);
CREATE INDEX IF NOT EXISTS idx_canhotos_entrega_status ON public.canhotos(nota_fiscal_entrega_id, status);

CREATE OR REPLACE FUNCTION public.logistica_usuario_pode_ler_entrega(p_entrega_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN get_user_role() = 'gestor' THEN true
    WHEN get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.nota_fiscal_entregas nfe
      JOIN public.operacoes op ON op.id = nfe.operacao_id
      WHERE nfe.id = p_entrega_id AND op.cedente_id = get_user_cedente_id()
    )
    WHEN get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.nota_fiscal_entregas nfe
      JOIN public.operacoes op ON op.id = nfe.operacao_id
      JOIN public.consultor_cedente cc ON cc.cedente_id = op.cedente_id
      WHERE nfe.id = p_entrega_id AND cc.consultor_id = auth.uid()
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_evento_entrega(
  p_entrega_id uuid,
  p_tipo_evento text,
  p_status_anterior text,
  p_status_novo text,
  p_ator_tipo text DEFAULT 'usuario',
  p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.eventos_entrega (
    nota_fiscal_entrega_id, tipo_evento, status_anterior, status_novo,
    registrado_por, ator_tipo, dados
  )
  VALUES (
    p_entrega_id, p_tipo_evento, p_status_anterior, p_status_novo,
    CASE WHEN p_ator_tipo = 'usuario' THEN auth.uid() ELSE NULL END,
    p_ator_tipo,
    coalesce(p_dados, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.avaliar_conclusao_entrega(p_nota_fiscal_entrega_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entrega record;
  has_cte boolean;
  canhoto_row record;
  old_status text;
BEGIN
  SELECT * INTO entrega FROM public.nota_fiscal_entregas WHERE id = p_nota_fiscal_entrega_id FOR UPDATE;
  IF entrega.id IS NULL THEN RAISE EXCEPTION 'Entrega nao encontrada'; END IF;
  IF entrega.status_entrega IN ('nao_aplicavel', 'entregue', 'cancelada', 'devolvida') THEN
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', entrega.status_entrega);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.cte_notas_fiscais cnf
    JOIN public.ctes c ON c.id = cnf.cte_id
    WHERE cnf.nota_fiscal_id = entrega.nota_fiscal_id
      AND c.status = 'aprovado'
      AND c.documento_versao_aprovada_id IS NOT NULL
  ) INTO has_cte;

  SELECT * INTO canhoto_row
  FROM public.canhotos c
  WHERE c.nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
    AND c.status = 'aprovado'
    AND c.documento_versao_aprovada_id IS NOT NULL
  ORDER BY c.analisado_em DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  old_status := entrega.status_entrega;
  IF has_cte AND canhoto_row.id IS NOT NULL THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'entregue',
        data_entrega = COALESCE(canhoto_row.data_assinatura, canhoto_row.recebido_em::date, now()::date),
        entrega_confirmada_em = now(),
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;
    PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'entrega_confirmada', old_status, 'entregue', 'sistema', '{}'::jsonb);
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', 'entregue');
  END IF;

  IF old_status <> 'aguardando_validacao' AND (has_cte OR canhoto_row.id IS NOT NULL) THEN
    UPDATE public.nota_fiscal_entregas SET status_entrega = 'aguardando_validacao' WHERE id = p_nota_fiscal_entrega_id;
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', 'aguardando_validacao');
  END IF;

  RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', old_status);
END;
$$;

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
    WHERE item->>'codigo' = 'canhoto' AND item->>'ativo' = 'true'
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
    PERFORM public.registrar_evento_entrega(entrega_id, 'cessao_efetivada', NULL, CASE WHEN cria_entrega THEN 'em_transito' ELSE 'nao_aplicavel' END, 'sistema', jsonb_build_object('operacao_id', p_operacao_id));

    IF cria_entrega THEN
      FOR req IN
        SELECT pr.*, dt.id AS tipo_id
        FROM public.politica_requisitos_documentais pr
        LEFT JOIN public.documento_tipos dt ON dt.codigo = CASE WHEN pr.codigo = 'cte' THEN 'cte_xml' ELSE pr.codigo END
        WHERE pr.politica_operacional_versao_id = op.politica_operacional_versao_id
          AND pr.codigo IN ('cte', 'canhoto')
          AND pr.ativo = true
      LOOP
        INSERT INTO public.documento_requisito_instancias (
          politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
          documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_entrega_id,
          cedente_id, status, obrigatorio, prazo_limite, formatos_aceitos_snapshot,
          nivel_validacao_snapshot, quantidade_minima_snapshot, responsavel_upload_snapshot,
          responsavel_aprovacao_snapshot
        )
        VALUES (
          req.id, req.politica_operacional_id, req.politica_operacional_versao_id, op.politica_versao,
          req.tipo_id, req.codigo, req.escopo, entrega_id,
          op.cedente_id, 'pendente', req.obrigatorio,
          CASE WHEN req.codigo = 'cte' THEN (now_ts::date + cte_prazo) ELSE (now_ts::date + canhoto_prazo) END,
          req.formatos_aceitos, req.nivel_validacao, req.quantidade_minima,
          req.responsavel_upload, req.responsavel_aprovacao
        )
        ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id) DO NOTHING;
      END LOOP;
      PERFORM public.registrar_evento_entrega(entrega_id, 'cte_pendente', 'em_transito', 'em_transito', 'sistema', jsonb_build_object('prazo_limite', (now_ts::date + cte_prazo)));
      PERFORM public.registrar_evento_entrega(entrega_id, 'canhoto_pendente', 'em_transito', 'em_transito', 'sistema', jsonb_build_object('prazo_limite', (now_ts::date + canhoto_prazo)));
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
  nf_count integer;
  delivery record;
  v_doc_id uuid;
  v_version_id uuid;
  v_cte_id uuid;
  formato text;
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

  SELECT n.cedente_id, count(DISTINCT n.id)
    INTO cedente, nf_count
  FROM public.notas_fiscais n
  JOIN public.nota_fiscal_entregas nfe ON nfe.nota_fiscal_id = n.id
  WHERE n.id = ANY(p_nota_fiscal_ids)
    AND nfe.status_entrega NOT IN ('nao_aplicavel', 'cancelada', 'devolvida')
  GROUP BY n.cedente_id;
  IF cedente IS NULL OR nf_count <> (SELECT count(DISTINCT nf_id) FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) THEN
    RAISE EXCEPTION 'As NFs precisam estar em acompanhamento ativo e pertencer ao mesmo cedente';
  END IF;
  IF actor_role = 'cedente' AND cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'NF fora do cedente autenticado';
  END IF;
  IF p_chave_cte IS NOT NULL AND EXISTS (SELECT 1 FROM public.ctes WHERE chave_cte = p_chave_cte) THEN
    RAISE EXCEPTION 'Chave de CT-e ja cadastrada';
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
    cedente_id, chave_cte, numero, serie, data_emissao, cnpj_transportadora,
    cnpj_remetente, cnpj_destinatario, valor_frete, formato_origem, nivel_validacao,
    status, documento_id, documento_versao_atual_id, dados_extraidos
  )
  VALUES (
    cedente, p_chave_cte, p_numero, p_serie, p_data_emissao, NULLIF(regexp_replace(coalesce(p_cnpj_transportadora, ''), '\D', '', 'g'), ''),
    NULLIF(regexp_replace(coalesce(p_cnpj_remetente, ''), '\D', '', 'g'), ''), NULLIF(regexp_replace(coalesce(p_cnpj_destinatario, ''), '\D', '', 'g'), ''),
    p_valor_frete, formato, p_nivel_validacao, 'em_analise', v_doc_id, v_version_id, coalesce(p_dados_extraidos, '{}'::jsonb)
  )
  RETURNING id INTO v_cte_id;

  INSERT INTO public.documento_vinculos (documento_id, cte_id, cedente_id)
  VALUES (v_doc_id, v_cte_id, cedente);

  INSERT INTO public.cte_notas_fiscais (cte_id, nota_fiscal_id)
  SELECT v_cte_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  FOR delivery IN
    SELECT nfe.* FROM public.nota_fiscal_entregas nfe WHERE nfe.nota_fiscal_id = ANY(p_nota_fiscal_ids)
  LOOP
    PERFORM public.registrar_evento_entrega(delivery.id, 'cte_enviado', delivery.status_entrega, delivery.status_entrega, 'usuario', jsonb_build_object('cte_id', v_cte_id, 'versao_id', v_version_id));
  END LOOP;

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'CT-e enviado', 'Um CT-e foi enviado para analise.', 'cte_enviado',
         'cte:' || v_cte_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('cte_id', v_cte_id, 'documento_id', v_doc_id, 'versao_id', v_version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_canhoto_documento(
  p_nota_fiscal_entrega_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_data_assinatura date DEFAULT NULL,
  p_nome_recebedor text DEFAULT NULL,
  p_documento_recebedor text DEFAULT NULL,
  p_possui_assinatura boolean DEFAULT false,
  p_possui_ressalva boolean DEFAULT false,
  p_descricao_ressalva text DEFAULT NULL
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
  tipo record;
  doc_id uuid;
  version_id uuid;
  canhoto_id uuid;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar canhoto';
  END IF;
  SELECT nfe.*, op.cedente_id INTO entrega
  FROM public.nota_fiscal_entregas nfe
  JOIN public.operacoes op ON op.id = nfe.operacao_id
  WHERE nfe.id = p_nota_fiscal_entrega_id;
  IF entrega.id IS NULL OR entrega.status_entrega IN ('nao_aplicavel', 'cancelada', 'devolvida', 'entregue') THEN
    RAISE EXCEPTION 'Entrega nao esta aberta para canhoto';
  END IF;
  IF actor_role = 'cedente' AND entrega.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Entrega fora do cedente autenticado';
  END IF;
  IF p_possui_ressalva AND length(trim(coalesce(p_descricao_ressalva, ''))) = 0 THEN
    RAISE EXCEPTION 'Descricao da ressalva e obrigatoria';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  SELECT * INTO tipo FROM public.documento_tipos WHERE codigo = 'canhoto' AND ativo = true;
  IF tipo.id IS NULL OR lower(p_mime_type) <> ALL (SELECT lower(unnest(tipo.mime_types_aceitos))) THEN
    RAISE EXCEPTION 'Arquivo de canhoto em formato invalido';
  END IF;

  INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
  VALUES (tipo.id, 'enviado', actor_id)
  RETURNING id INTO doc_id;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, enviado_por
  )
  VALUES (doc_id, 1, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', actor_id)
  RETURNING id INTO version_id;

  INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
  VALUES (doc_id, p_nota_fiscal_entrega_id, entrega.cedente_id);

  INSERT INTO public.canhotos (
    nota_fiscal_entrega_id, status, data_assinatura, nome_recebedor,
    documento_recebedor, possui_assinatura, possui_ressalva, descricao_ressalva,
    recebido_em, documento_id, documento_versao_atual_id
  )
  VALUES (
    p_nota_fiscal_entrega_id, 'em_analise', p_data_assinatura, p_nome_recebedor,
    NULLIF(regexp_replace(coalesce(p_documento_recebedor, ''), '\D', '', 'g'), ''), coalesce(p_possui_assinatura, false),
    coalesce(p_possui_ressalva, false), p_descricao_ressalva, now(), doc_id, version_id
  )
  RETURNING id INTO canhoto_id;

  PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'canhoto_enviado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', canhoto_id, 'versao_id', version_id));

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('canhoto_id', canhoto_id, 'documento_id', doc_id, 'versao_id', version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.analisar_cte_documento(
  p_cte_id uuid,
  p_documento_versao_id uuid,
  p_resultado text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cte_row record;
  novo_status text;
  nf record;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode analisar CT-e';
  END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'Resultado invalido'; END IF;
  IF p_resultado = 'rejeitado' AND length(trim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Motivo obrigatorio ao rejeitar'; END IF;

  SELECT * INTO cte_row FROM public.ctes WHERE id = p_cte_id FOR UPDATE;
  IF cte_row.id IS NULL OR cte_row.documento_versao_atual_id <> p_documento_versao_id THEN
    RAISE EXCEPTION 'Versao documental nao corresponde ao CT-e';
  END IF;

  novo_status := CASE WHEN p_resultado = 'aprovado' THEN 'aprovado' ELSE 'rejeitado' END;
  INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes, dados_estruturados)
  VALUES (p_documento_versao_id, p_resultado, auth.uid(), p_motivo, cte_row.dados_extraidos);

  UPDATE public.documento_versoes SET status = novo_status WHERE id = p_documento_versao_id;
  UPDATE public.documentos_repositorio SET status = novo_status WHERE id = cte_row.documento_id;
  UPDATE public.ctes
  SET status = novo_status,
      analisado_por = auth.uid(),
      analisado_em = now(),
      motivo_rejeicao = CASE WHEN p_resultado = 'rejeitado' THEN p_motivo ELSE NULL END,
      documento_versao_aprovada_id = CASE WHEN p_resultado = 'aprovado' THEN p_documento_versao_id ELSE NULL END
  WHERE id = p_cte_id;

  FOR nf IN
    SELECT nfe.id, nfe.status_entrega, nfe.nota_fiscal_id
    FROM public.cte_notas_fiscais cnf
    JOIN public.nota_fiscal_entregas nfe ON nfe.nota_fiscal_id = cnf.nota_fiscal_id
    WHERE cnf.cte_id = p_cte_id
  LOOP
    IF p_resultado = 'aprovado' THEN
      UPDATE public.documento_requisito_instancias
      SET status = 'satisfeito', versao_aprovada_id = p_documento_versao_id, satisfeito_em = now()
      WHERE nota_fiscal_entrega_id = nf.id AND tipo_documento_codigo_snapshot = 'cte';
      PERFORM public.registrar_evento_entrega(nf.id, 'cte_aprovado', nf.status_entrega, nf.status_entrega, 'usuario', jsonb_build_object('cte_id', p_cte_id));
    ELSE
      PERFORM public.registrar_evento_entrega(nf.id, 'cte_rejeitado', nf.status_entrega, nf.status_entrega, 'usuario', jsonb_build_object('cte_id', p_cte_id, 'motivo', p_motivo));
    END IF;
    PERFORM public.avaliar_conclusao_entrega(nf.id);
  END LOOP;

  RETURN jsonb_build_object('cte_id', p_cte_id, 'status', novo_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.analisar_canhoto_documento(
  p_canhoto_id uuid,
  p_documento_versao_id uuid,
  p_resultado text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canhoto_row record;
  entrega record;
  novo_status text;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode analisar canhoto';
  END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'Resultado invalido'; END IF;
  IF p_resultado = 'rejeitado' AND length(trim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Motivo obrigatorio ao rejeitar'; END IF;

  SELECT * INTO canhoto_row FROM public.canhotos WHERE id = p_canhoto_id FOR UPDATE;
  IF canhoto_row.id IS NULL OR canhoto_row.documento_versao_atual_id <> p_documento_versao_id THEN
    RAISE EXCEPTION 'Versao documental nao corresponde ao canhoto';
  END IF;
  SELECT * INTO entrega FROM public.nota_fiscal_entregas WHERE id = canhoto_row.nota_fiscal_entrega_id FOR UPDATE;
  novo_status := CASE WHEN p_resultado = 'aprovado' THEN 'aprovado' ELSE 'rejeitado' END;

  INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes, dados_estruturados)
  VALUES (p_documento_versao_id, p_resultado, auth.uid(), p_motivo, '{}'::jsonb);

  UPDATE public.documento_versoes SET status = novo_status WHERE id = p_documento_versao_id;
  UPDATE public.documentos_repositorio SET status = novo_status WHERE id = canhoto_row.documento_id;
  UPDATE public.canhotos
  SET status = novo_status,
      analisado_por = auth.uid(),
      analisado_em = now(),
      motivo_rejeicao = CASE WHEN p_resultado = 'rejeitado' THEN p_motivo ELSE NULL END,
      documento_versao_aprovada_id = CASE WHEN p_resultado = 'aprovado' THEN p_documento_versao_id ELSE NULL END
  WHERE id = p_canhoto_id;

  IF p_resultado = 'aprovado' THEN
    UPDATE public.documento_requisito_instancias
    SET status = 'satisfeito', versao_aprovada_id = p_documento_versao_id, satisfeito_em = now()
    WHERE nota_fiscal_entrega_id = canhoto_row.nota_fiscal_entrega_id AND tipo_documento_codigo_snapshot = 'canhoto';
    PERFORM public.registrar_evento_entrega(canhoto_row.nota_fiscal_entrega_id, 'canhoto_aprovado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', p_canhoto_id));
  ELSE
    PERFORM public.registrar_evento_entrega(canhoto_row.nota_fiscal_entrega_id, 'canhoto_rejeitado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', p_canhoto_id, 'motivo', p_motivo));
  END IF;

  PERFORM public.avaliar_conclusao_entrega(canhoto_row.nota_fiscal_entrega_id);
  RETURN jsonb_build_object('canhoto_id', p_canhoto_id, 'status', novo_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.processar_prazos_entrega(p_data date DEFAULT now()::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entrega record;
  cte_alertas integer := 0;
  canhoto_alertas integer := 0;
BEGIN
  IF get_user_role() NOT IN ('gestor') AND coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sem permissao para processar prazos';
  END IF;

  FOR entrega IN
    SELECT nfe.*, op.cedente_id, c.user_id
    FROM public.nota_fiscal_entregas nfe
    JOIN public.operacoes op ON op.id = nfe.operacao_id
    JOIN public.cedentes c ON c.id = op.cedente_id
    WHERE nfe.status_entrega IN ('em_transito', 'aguardando_validacao', 'entrega_com_pendencia')
  LOOP
    IF entrega.data_limite_cte IS NOT NULL AND entrega.data_limite_cte <= p_data THEN
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'CT-e vencido', 'O prazo de CT-e de uma NF antecipada venceu.', 'cte_vencido', 'entrega:' || entrega.id::text || ':cte_vencido')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
      IF NOT EXISTS (
        SELECT 1 FROM public.eventos_entrega ev
        WHERE ev.nota_fiscal_entrega_id = entrega.id
          AND ev.tipo_evento = 'cte_atrasado'
          AND ev.dados->>'data_referencia' = p_data::text
      ) THEN
        INSERT INTO public.eventos_entrega (nota_fiscal_entrega_id, tipo_evento, status_anterior, status_novo, ator_tipo, dados)
        VALUES (entrega.id, 'cte_atrasado', entrega.status_entrega, 'entrega_com_pendencia', 'cron', jsonb_build_object('data_referencia', p_data));
      END IF;
      UPDATE public.nota_fiscal_entregas SET status_entrega = 'entrega_com_pendencia', motivo_pendencia = 'CT-e vencido' WHERE id = entrega.id AND status_entrega <> 'entregue';
      UPDATE public.documento_requisito_instancias SET status = 'vencido' WHERE nota_fiscal_entrega_id = entrega.id AND tipo_documento_codigo_snapshot = 'cte' AND status = 'pendente';
      cte_alertas := cte_alertas + 1;
    ELSIF entrega.data_limite_cte IS NOT NULL AND entrega.data_limite_cte - 2 = p_data THEN
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'CT-e proximo do prazo', 'O prazo de CT-e vence em 2 dias corridos.', 'cte_prazo_proximo', 'entrega:' || entrega.id::text || ':cte_d8')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
      cte_alertas := cte_alertas + 1;
    END IF;

    IF entrega.data_limite_canhoto IS NOT NULL AND entrega.data_limite_canhoto <= p_data THEN
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'Canhoto vencido', 'O prazo de canhoto de uma NF antecipada venceu.', 'canhoto_vencido', 'entrega:' || entrega.id::text || ':canhoto_vencido')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
      IF NOT EXISTS (
        SELECT 1 FROM public.eventos_entrega ev
        WHERE ev.nota_fiscal_entrega_id = entrega.id
          AND ev.tipo_evento = 'canhoto_atrasado'
          AND ev.dados->>'data_referencia' = p_data::text
      ) THEN
        INSERT INTO public.eventos_entrega (nota_fiscal_entrega_id, tipo_evento, status_anterior, status_novo, ator_tipo, dados)
        VALUES (entrega.id, 'canhoto_atrasado', entrega.status_entrega, 'entrega_com_pendencia', 'cron', jsonb_build_object('data_referencia', p_data));
      END IF;
      UPDATE public.nota_fiscal_entregas SET status_entrega = 'entrega_com_pendencia', motivo_pendencia = 'Canhoto vencido' WHERE id = entrega.id AND status_entrega <> 'entregue';
      UPDATE public.documento_requisito_instancias SET status = 'vencido' WHERE nota_fiscal_entrega_id = entrega.id AND tipo_documento_codigo_snapshot = 'canhoto' AND status = 'pendente';
      canhoto_alertas := canhoto_alertas + 1;
    ELSIF entrega.data_limite_canhoto IS NOT NULL AND entrega.data_limite_canhoto - 4 = p_data THEN
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'Canhoto proximo do prazo', 'O prazo de canhoto vence em 4 dias corridos.', 'canhoto_prazo_proximo', 'entrega:' || entrega.id::text || ':canhoto_d16')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
      canhoto_alertas := canhoto_alertas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cte_alertas', cte_alertas, 'canhoto_alertas', canhoto_alertas, 'data', p_data);
END;
$$;

ALTER TABLE public.nota_fiscal_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ctes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cte_notas_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canhotos ENABLE ROW LEVEL SECURITY;

CREATE POLICY nota_fiscal_entregas_select ON public.nota_fiscal_entregas
FOR SELECT TO authenticated USING (public.logistica_usuario_pode_ler_entrega(id));
CREATE POLICY nota_fiscal_entregas_gestor_all ON public.nota_fiscal_entregas
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY eventos_entrega_select ON public.eventos_entrega
FOR SELECT TO authenticated USING (public.logistica_usuario_pode_ler_entrega(nota_fiscal_entrega_id));
CREATE POLICY eventos_entrega_insert_gestor ON public.eventos_entrega
FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY ctes_select ON public.ctes
FOR SELECT TO authenticated USING (
  get_user_role() = 'gestor'
  OR (get_user_role() = 'cedente' AND cedente_id = get_user_cedente_id())
  OR (get_user_role() = 'consultor' AND EXISTS (
    SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = auth.uid() AND cc.cedente_id = ctes.cedente_id
  ))
);
CREATE POLICY ctes_gestor_all ON public.ctes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY cte_notas_select ON public.cte_notas_fiscais
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ctes c WHERE c.id = cte_notas_fiscais.cte_id)
);
CREATE POLICY cte_notas_gestor_all ON public.cte_notas_fiscais
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY canhotos_select ON public.canhotos
FOR SELECT TO authenticated USING (public.logistica_usuario_pode_ler_entrega(nota_fiscal_entrega_id));
CREATE POLICY canhotos_gestor_all ON public.canhotos
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

GRANT SELECT ON public.nota_fiscal_entregas, public.eventos_entrega, public.ctes, public.cte_notas_fiscais, public.canhotos TO authenticated;
GRANT INSERT, UPDATE ON public.nota_fiscal_entregas, public.eventos_entrega, public.ctes, public.cte_notas_fiscais, public.canhotos TO authenticated;
GRANT ALL ON public.nota_fiscal_entregas, public.eventos_entrega, public.ctes, public.cte_notas_fiscais, public.canhotos TO service_role;

GRANT EXECUTE ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_entrega(uuid, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.avaliar_conclusao_entrega(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desembolsar_operacao_com_logistica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analisar_cte_documento(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analisar_canhoto_documento(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.processar_prazos_entrega(date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_evento_entrega(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avaliar_conclusao_entrega(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.desembolsar_operacao_com_logistica(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_cte_documento(uuid[], text, text, text, bigint, text, text, text, text, text, text, date, text, text, text, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analisar_cte_documento(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analisar_canhoto_documento(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.processar_prazos_entrega(date) FROM PUBLIC;
