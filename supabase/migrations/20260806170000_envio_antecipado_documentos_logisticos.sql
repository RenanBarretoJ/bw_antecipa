BEGIN;

-- Envio antecipado de documentos logisticos oficiais de pos-cessao.
-- A migration e estritamente aditiva: nao reclassifica historico, nao cria
-- instancias pre-cessao e nao altera evidencias existentes.

DO $$
BEGIN
  IF to_regclass('public.politica_operacional_versoes') IS NULL
     OR to_regclass('public.politica_requisitos_documentais') IS NULL
     OR to_regclass('public.documentos_repositorio') IS NULL
     OR to_regclass('public.documento_versoes') IS NULL
     OR to_regclass('public.documento_vinculos') IS NULL
     OR to_regclass('public.notas_fiscais') IS NULL THEN
    RAISE EXCEPTION 'Dependencias do envio antecipado de documentos logisticos nao foram aplicadas';
  END IF;
END;
$$;

-- Novas politicas podem exigir uma evidencia logistica aprovada antes da
-- cessao. O default false preserva integralmente politicas e operacoes antigas.
ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS exigir_status_logistico_pre_cessao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.politica_operacional_versoes.exigir_status_logistico_pre_cessao IS
  'Quando true, novas operacoes exigem CT-e/DACTE ou comprovante de entrega aprovado antes da cessao. Default false preserva o legado.';

-- Familia semantica calculada, sem UPDATE em requisitos publicados (imutaveis).
ALTER TABLE public.politica_requisitos_documentais
  ADD COLUMN IF NOT EXISTS familia_documental text GENERATED ALWAYS AS (
    CASE lower(btrim(tipo_documento_codigo))
      WHEN 'cte' THEN 'cte'
      WHEN 'cte_xml' THEN 'cte'
      WHEN 'cte_pdf_dacte' THEN 'cte'
      WHEN 'cte_dacte_pdf' THEN 'cte'
      WHEN 'dacte' THEN 'cte'
      WHEN 'canhoto' THEN 'comprovante_entrega'
      WHEN 'comprovante_entrega' THEN 'comprovante_entrega'
      WHEN 'comprovante_de_entrega' THEN 'comprovante_entrega'
      ELSE NULL
    END
  ) STORED;

DO $$
DECLARE
  conflito record;
BEGIN
  SELECT
    pr.politica_operacional_versao_id,
    pr.familia_documental,
    count(*) AS quantidade
  INTO conflito
  FROM public.politica_requisitos_documentais pr
  WHERE pr.ativo = true
    AND pr.familia_documental IS NOT NULL
  GROUP BY pr.politica_operacional_versao_id, pr.familia_documental
  HAVING count(*) > 1
  LIMIT 1;

  IF conflito.politica_operacional_versao_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflito de familia documental na versao %: familia % possui % requisitos ativos. Corrija por nova versao antes de aplicar esta migration.',
      conflito.politica_operacional_versao_id,
      conflito.familia_documental,
      conflito.quantidade;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_politica_requisito_familia_logistica_ativa
  ON public.politica_requisitos_documentais(politica_operacional_versao_id, familia_documental)
  WHERE ativo = true AND familia_documental IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_politica_requisitos_versao_familia
  ON public.politica_requisitos_documentais(politica_operacional_versao_id, familia_documental)
  WHERE familia_documental IS NOT NULL;

-- Mantem a protecao de versoes publicadas incluindo o novo gate.
CREATE OR REPLACE FUNCTION public.validar_versao_publicada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publicada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Versao publicada de politica nao pode ser excluida';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.publicada_em IS NOT NULL AND (
    NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
    OR NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
    OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.exigir_status_logistico_pre_cessao IS DISTINCT FROM OLD.exigir_status_logistico_pre_cessao
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.regras IS DISTINCT FROM OLD.regras
    OR NEW.parametros IS DISTINCT FROM OLD.parametros
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.publicada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.publicada_em IS NULL)
     AND NEW.metodo_calculo_financeiro IS NULL THEN
    RAISE EXCEPTION 'Selecione o metodo de calculo financeiro antes de publicar';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, coalesce(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, coalesce(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.evidencias_logisticas_antecipadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  politica_operacional_versao_id uuid NOT NULL REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  politica_requisito_id uuid NOT NULL REFERENCES public.politica_requisitos_documentais(id) ON DELETE RESTRICT,
  familia_documental text NOT NULL,
  documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_atual_id uuid NOT NULL REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  primeiro_upload_em timestamptz NOT NULL DEFAULT now(),
  ultimo_upload_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidencias_logisticas_familia_check
    CHECK (familia_documental IN ('cte', 'comprovante_entrega')),
  CONSTRAINT evidencias_logisticas_nf_familia_versao_unique
    UNIQUE (nota_fiscal_id, politica_operacional_versao_id, familia_documental),
  CONSTRAINT evidencias_logisticas_versao_documento_fk
    FOREIGN KEY (documento_versao_atual_id, documento_id)
    REFERENCES public.documento_versoes(id, documento_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.evidencias_logisticas_antecipadas IS
  'Ponte virtual entre o requisito oficial pos-cessao e um documento enviado antes da cessao. Nao cria requisito pre-cessao duplicado.';

CREATE INDEX idx_evidencias_logisticas_documento_versao
  ON public.evidencias_logisticas_antecipadas(documento_versao_atual_id);
CREATE INDEX idx_evidencias_logisticas_fundo_nf
  ON public.evidencias_logisticas_antecipadas(fundo_id, nota_fiscal_id);
CREATE INDEX idx_evidencias_logisticas_requisito
  ON public.evidencias_logisticas_antecipadas(politica_requisito_id);

-- O ponteiro acima representa somente a versao corrente. Esta tabela append-only
-- preserva todas as tentativas, inclusive rejeitadas e substituidas, sem copiar o
-- arquivo quando uma mesma evidencia CT-e atende varias NFs.
CREATE TABLE public.evidencia_logistica_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidencia_logistica_id uuid NOT NULL REFERENCES public.evidencias_logisticas_antecipadas(id) ON DELETE RESTRICT,
  documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_id uuid NOT NULL REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidencia_logistica_versao_unique UNIQUE (evidencia_logistica_id, documento_versao_id),
  CONSTRAINT evidencia_logistica_versao_documento_fk
    FOREIGN KEY (documento_versao_id, documento_id)
    REFERENCES public.documento_versoes(id, documento_id) ON DELETE RESTRICT
);

CREATE INDEX idx_evidencia_logistica_versoes_documento_versao
  ON public.evidencia_logistica_versoes(documento_versao_id, evidencia_logistica_id);

CREATE TRIGGER evidencias_logisticas_updated_at
  BEFORE UPDATE ON public.evidencias_logisticas_antecipadas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.operacao_nf_logistica_memorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  politica_operacional_versao_id uuid NOT NULL REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  politica_snapshot_hash text,
  etapa text NOT NULL,
  gate_exigido boolean NOT NULL,
  status_logistico text NOT NULL,
  familia_vencedora text,
  documento_id uuid REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_id uuid REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  documento_analise_id uuid REFERENCES public.documento_analises(id) ON DELETE RESTRICT,
  analisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  analisado_em timestamptz,
  fundamento text NOT NULL,
  regra_classificacao text NOT NULL DEFAULT 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
  versao_resolvedor integer NOT NULL DEFAULT 1,
  memoria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacao_nf_logistica_etapa_check CHECK (etapa IN ('criacao', 'aprovacao')),
  CONSTRAINT operacao_nf_logistica_status_check CHECK (status_logistico IN ('ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA')),
  CONSTRAINT operacao_nf_logistica_familia_check CHECK (familia_vencedora IS NULL OR familia_vencedora IN ('cte', 'comprovante_entrega')),
  CONSTRAINT operacao_nf_logistica_memoria_unique UNIQUE (operacao_id, nota_fiscal_id, etapa)
);

COMMENT ON TABLE public.operacao_nf_logistica_memorias IS
  'Memoria imutavel da classificacao logistica calculada na criacao e na aprovacao da operacao.';

CREATE INDEX idx_operacao_nf_logistica_fundo_created
  ON public.operacao_nf_logistica_memorias(fundo_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.proteger_memoria_logistica_operacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Memoria logistica da operacao e imutavel';
END;
$$;

CREATE TRIGGER operacao_nf_logistica_memoria_append_only
  BEFORE UPDATE OR DELETE ON public.operacao_nf_logistica_memorias
  FOR EACH ROW EXECUTE FUNCTION public.proteger_memoria_logistica_operacao();

CREATE OR REPLACE FUNCTION private.resolver_familia_documental_logistica(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE lower(btrim(coalesce(p_codigo, '')))
    WHEN 'cte' THEN 'cte'
    WHEN 'cte_xml' THEN 'cte'
    WHEN 'cte_pdf_dacte' THEN 'cte'
    WHEN 'cte_dacte_pdf' THEN 'cte'
    WHEN 'dacte' THEN 'cte'
    WHEN 'canhoto' THEN 'comprovante_entrega'
    WHEN 'comprovante_entrega' THEN 'comprovante_entrega'
    WHEN 'comprovante_de_entrega' THEN 'comprovante_entrega'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.resolver_politica_versao_nf_logistica(p_nota_fiscal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao_id uuid;
  v_cedente_fundo_id uuid;
  v_fundo_id uuid;
  v_agora timestamptz := pg_catalog.now();
BEGIN
  SELECT o.politica_operacional_versao_id
  INTO v_versao_id
  FROM public.operacoes_nfs onf
  JOIN public.operacoes o ON o.id = onf.operacao_id
  WHERE onf.nota_fiscal_id = p_nota_fiscal_id
    AND o.politica_operacional_versao_id IS NOT NULL
    AND o.status::text NOT IN ('cancelada', 'reprovada')
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  IF v_versao_id IS NOT NULL THEN RETURN v_versao_id; END IF;

  SELECT nf.cedente_fundo_id, nf.fundo_id
  INTO v_cedente_fundo_id, v_fundo_id
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id;

  SELECT pov.id
  INTO v_versao_id
  FROM public.cedente_fundo_politicas cfp
  JOIN public.politicas_operacionais po
    ON po.id = cfp.politica_operacional_id
   AND po.fundo_id = v_fundo_id
   AND po.status = 'ativa'
  JOIN public.politica_operacional_versoes pov
    ON pov.politica_operacional_id = po.id
   AND pov.fundo_id = v_fundo_id
   AND pov.status = 'publicada'
   AND pov.publicada_em IS NOT NULL
   AND pov.vigente_desde <= v_agora
   AND (pov.vigente_ate IS NULL OR pov.vigente_ate > v_agora)
  WHERE cfp.cedente_fundo_id = v_cedente_fundo_id
    AND cfp.status = 'ativa'
    AND cfp.vigente_desde <= v_agora
    AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > v_agora)
  ORDER BY cfp.vigente_desde DESC, pov.versao DESC
  LIMIT 1;

  RETURN v_versao_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.classificar_status_logistico_pre_cessao(
  p_nota_fiscal_id uuid,
  p_politica_operacional_versao_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  vencedor record;
BEGIN
  SELECT
    ela.familia_documental,
    elv.documento_id,
    elv.documento_versao_id AS documento_versao_atual_id,
    da.id AS analise_id,
    da.resultado,
    da.analisado_por,
    da.analisado_em
  INTO vencedor
  FROM public.evidencias_logisticas_antecipadas ela
  JOIN public.evidencia_logistica_versoes elv
    ON elv.evidencia_logistica_id = ela.id
  JOIN public.documento_versoes dv ON dv.id = elv.documento_versao_id
  LEFT JOIN LATERAL (
    SELECT a.id, a.resultado, a.analisado_por, a.analisado_em
    FROM public.documento_analises a
    WHERE a.documento_versao_id = dv.id
    ORDER BY a.analisado_em DESC, a.id DESC
    LIMIT 1
  ) da ON true
  WHERE ela.nota_fiscal_id = p_nota_fiscal_id
    AND ela.politica_operacional_versao_id = p_politica_operacional_versao_id
    AND (dv.status = 'aprovado' OR da.resultado = 'aprovado')
  ORDER BY
    CASE ela.familia_documental WHEN 'comprovante_entrega' THEN 0 WHEN 'cte' THEN 1 ELSE 2 END,
    coalesce(da.analisado_em, dv.enviado_em, dv.created_at) DESC,
    elv.created_at DESC,
    elv.id DESC
  LIMIT 1;

  IF vencedor.documento_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'INDETERMINADA',
      'familia_vencedora', NULL,
      'documento_id', NULL,
      'documento_versao_id', NULL,
      'documento_analise_id', NULL,
      'analisado_por', NULL,
      'analisado_em', NULL,
      'fundamento', 'sem_evidencia_aprovada',
      'regra_classificacao', 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
      'versao_resolvedor', 1
    );
  END IF;

  RETURN jsonb_build_object(
    'status', CASE vencedor.familia_documental WHEN 'comprovante_entrega' THEN 'ENTREGUE' ELSE 'EM_TRANSITO' END,
    'familia_vencedora', vencedor.familia_documental,
    'documento_id', vencedor.documento_id,
    'documento_versao_id', vencedor.documento_versao_atual_id,
    'documento_analise_id', vencedor.analise_id,
    'analisado_por', vencedor.analisado_por,
    'analisado_em', vencedor.analisado_em,
    'fundamento', CASE vencedor.familia_documental WHEN 'comprovante_entrega' THEN 'comprovante_entrega_aprovado' ELSE 'cte_aprovado' END,
    'regra_classificacao', 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
    'versao_resolvedor', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.registrar_memoria_logistica_operacao(
  p_operacao_id uuid,
  p_nota_fiscal_id uuid,
  p_etapa text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  op record;
  nf record;
  classificacao jsonb;
  gate boolean;
BEGIN
  SELECT o.*, cf.fundo_id
  INTO op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id;

  SELECT * INTO nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF op.id IS NULL OR nf.id IS NULL
     OR nf.fundo_id IS DISTINCT FROM op.fundo_id
     OR nf.cedente_id IS DISTINCT FROM op.cedente_id
     OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id THEN
    RAISE EXCEPTION 'NF fora do contexto da operacao para classificacao logistica';
  END IF;

  -- Operacoes legadas sem versao/snapshot permanecem operacionais. O gate foi
  -- introduzido com default false e nao pode ser inferido retroativamente.
  IF op.politica_operacional_versao_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'INDETERMINADA',
      'familia_vencedora', NULL,
      'fundamento', 'operacao_legada_sem_versao',
      'gate_exigido', false,
      'regra_classificacao', 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
      'versao_resolvedor', 1
    );
  END IF;

  gate := coalesce(
    (op.politica_snapshot->>'exigir_status_logistico_pre_cessao')::boolean,
    (SELECT pov.exigir_status_logistico_pre_cessao
     FROM public.politica_operacional_versoes pov
     WHERE pov.id = op.politica_operacional_versao_id),
    false
  );
  classificacao := private.classificar_status_logistico_pre_cessao(
    p_nota_fiscal_id,
    op.politica_operacional_versao_id
  );

  INSERT INTO public.operacao_nf_logistica_memorias (
    operacao_id, nota_fiscal_id, fundo_id, politica_operacional_versao_id,
    politica_snapshot_hash, etapa, gate_exigido, status_logistico,
    familia_vencedora, documento_id, documento_versao_id, documento_analise_id,
    analisado_por, analisado_em, fundamento, regra_classificacao,
    versao_resolvedor, memoria
  ) VALUES (
    op.id, nf.id, op.fundo_id, op.politica_operacional_versao_id,
    op.politica_snapshot_hash, p_etapa, gate,
    classificacao->>'status', classificacao->>'familia_vencedora',
    nullif(classificacao->>'documento_id', '')::uuid,
    nullif(classificacao->>'documento_versao_id', '')::uuid,
    nullif(classificacao->>'documento_analise_id', '')::uuid,
    nullif(classificacao->>'analisado_por', '')::uuid,
    nullif(classificacao->>'analisado_em', '')::timestamptz,
    classificacao->>'fundamento', classificacao->>'regra_classificacao',
    (classificacao->>'versao_resolvedor')::integer, classificacao
  )
  ON CONFLICT (operacao_id, nota_fiscal_id, etapa) DO NOTHING;

  IF gate AND classificacao->>'status' = 'INDETERMINADA' THEN
    RAISE EXCEPTION 'A politica exige CT-e/DACTE ou comprovante de entrega aprovado antes da cessao';
  END IF;

  RETURN classificacao || jsonb_build_object('gate_exigido', gate);
END;
$$;

CREATE OR REPLACE FUNCTION public.avaliar_gate_logistico_pre_cessao_nfs(p_nota_fiscal_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  nf record;
  v_politica_versao_id uuid;
  v_gate boolean;
  v_classificacao jsonb;
  v_resultado jsonb := '[]'::jsonb;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para avaliar gate logistico' USING ERRCODE = '42501';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN RETURN v_resultado; END IF;

  FOR nf IN
    SELECT n.id, n.cedente_id, n.fundo_id
    FROM public.notas_fiscais n
    WHERE n.id = ANY(p_nota_fiscal_ids)
    ORDER BY n.id
  LOOP
    IF actor_role = 'cedente' AND nf.cedente_id IS DISTINCT FROM public.get_user_cedente_id() THEN
      RAISE EXCEPTION 'NF fora do cedente autenticado' USING ERRCODE = '42501';
    END IF;
    IF actor_role = 'gestor' AND NOT private.usuario_tem_acesso_fundo(nf.fundo_id) THEN
      RAISE EXCEPTION 'Gestor sem acesso ao fundo da NF' USING ERRCODE = '42501';
    END IF;

    v_politica_versao_id := private.resolver_politica_versao_nf_logistica(nf.id);
    SELECT coalesce(pov.exigir_status_logistico_pre_cessao, false)
    INTO v_gate
    FROM public.politica_operacional_versoes pov
    WHERE pov.id = v_politica_versao_id;
    v_classificacao := private.classificar_status_logistico_pre_cessao(nf.id, v_politica_versao_id);
    v_resultado := v_resultado || jsonb_build_array(jsonb_build_object(
      'nota_fiscal_id', nf.id,
      'politica_operacional_versao_id', v_politica_versao_id,
      'gate_exigido', coalesce(v_gate, false),
      'status', coalesce(v_classificacao->>'status', 'INDETERMINADA'),
      'permitido', NOT coalesce(v_gate, false) OR coalesce(v_classificacao->>'status', 'INDETERMINADA') <> 'INDETERMINADA'
    ));
  END LOOP;

  IF jsonb_array_length(v_resultado) <> (
    SELECT count(DISTINCT id) FROM unnest(p_nota_fiscal_ids) ids(id)
  ) THEN
    RAISE EXCEPTION 'Uma ou mais NFs nao foram encontradas';
  END IF;
  RETURN v_resultado;
END;
$$;

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
  nf record;
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
  FOR nf IN
    SELECT DISTINCT ids.nf_id AS id
    FROM unnest(p_nota_fiscal_ids) AS ids(nf_id)
    ORDER BY ids.nf_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        nf.id::text || ':' || req.politica_operacional_versao_id::text || ':' || v_familia,
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

  FOR nf IN SELECT DISTINCT unnest(p_nota_fiscal_ids) AS id LOOP
    INSERT INTO public.evidencias_logisticas_antecipadas(
      nota_fiscal_id, fundo_id, cedente_id, cedente_fundo_id,
      politica_operacional_versao_id, politica_requisito_id,
      familia_documental, documento_id, documento_versao_atual_id, criado_por
    ) VALUES (
      nf.id, contexto.fundo_id, contexto.cedente_id, contexto.cedente_fundo_id,
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
      contexto.cedente_fundo_id, nf.id,
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
      'ambos', 'documento_versoes', v_version_id::text || ':' || nf.id::text
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

CREATE OR REPLACE FUNCTION private.reconciliar_evidencia_logistica_nf(
  p_nota_fiscal_id uuid,
  p_familia text,
  p_resultado_analise text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  evidencia record;
  entrega record;
  instancia record;
  resultado text;
  status_instancia text;
  cte_id uuid;
BEGIN
  SELECT ela.*, dv.status AS versao_status
  INTO evidencia
  FROM public.evidencias_logisticas_antecipadas ela
  JOIN public.documento_versoes dv ON dv.id = ela.documento_versao_atual_id
  WHERE ela.nota_fiscal_id = p_nota_fiscal_id
    AND ela.familia_documental = p_familia
  ORDER BY ela.ultimo_upload_em DESC, ela.id DESC
  LIMIT 1;
  IF evidencia.id IS NULL THEN RETURN jsonb_build_object('reconciliado', false, 'motivo', 'sem_evidencia'); END IF;

  SELECT nfe.* INTO entrega
  FROM public.nota_fiscal_entregas nfe
  WHERE nfe.nota_fiscal_id = p_nota_fiscal_id
    AND nfe.status_entrega NOT IN ('nao_aplicavel', 'cancelada', 'devolvida')
  ORDER BY nfe.created_at DESC
  LIMIT 1;
  IF entrega.id IS NULL THEN RETURN jsonb_build_object('reconciliado', false, 'motivo', 'entrega_nao_criada'); END IF;

  SELECT dri.* INTO instancia
  FROM public.documento_requisito_instancias dri
  JOIN public.politica_requisitos_documentais pr ON pr.id = dri.politica_requisito_id
  WHERE dri.nota_fiscal_entrega_id = entrega.id
    AND pr.familia_documental = p_familia
    AND dri.status NOT IN ('cancelado', 'dispensado')
  ORDER BY dri.created_at DESC
  LIMIT 1;
  IF instancia.id IS NULL THEN RETURN jsonb_build_object('reconciliado', false, 'motivo', 'instancia_oficial_nao_criada'); END IF;

  resultado := coalesce(
    p_resultado_analise,
    (SELECT da.resultado FROM public.documento_analises da
     WHERE da.documento_versao_id = evidencia.documento_versao_atual_id
     ORDER BY da.analisado_em DESC, da.id DESC LIMIT 1),
    CASE evidencia.versao_status WHEN 'aprovado' THEN 'aprovado' WHEN 'rejeitado' THEN 'rejeitado' ELSE 'pendente' END
  );
  status_instancia := CASE WHEN resultado = 'aprovado' THEN 'satisfeito' ELSE 'pendente' END;

  UPDATE public.documento_requisito_instancias
  SET documento_id = evidencia.documento_id,
      versao_aprovada_id = CASE WHEN resultado = 'aprovado' THEN evidencia.documento_versao_atual_id ELSE NULL END,
      status = status_instancia,
      satisfeito_em = CASE WHEN resultado = 'aprovado' THEN pg_catalog.now() ELSE NULL END
  WHERE id = instancia.id;

  INSERT INTO public.documento_vinculos(documento_id, nota_fiscal_entrega_id, cedente_id, principal)
  VALUES (evidencia.documento_id, entrega.id, evidencia.cedente_id, false)
  ON CONFLICT DO NOTHING;

  IF p_familia = 'cte' THEN
    SELECT c.id INTO cte_id
    FROM public.ctes c
    WHERE c.documento_id = evidencia.documento_id
    ORDER BY c.created_at DESC LIMIT 1;
    IF cte_id IS NOT NULL THEN
      UPDATE public.ctes
      SET status = CASE WHEN resultado = 'aprovado' THEN 'aprovado' WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN 'rejeitado' ELSE 'em_analise' END,
          documento_versao_aprovada_id = CASE WHEN resultado = 'aprovado' THEN evidencia.documento_versao_atual_id ELSE NULL END,
          analisado_por = CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN auth.uid() ELSE analisado_por END,
          analisado_em = CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN pg_catalog.now() ELSE analisado_em END,
          motivo_rejeicao = CASE WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN coalesce(motivo_rejeicao, 'Documento rejeitado na analise documental') ELSE NULL END
      WHERE id = cte_id;
    END IF;
  ELSE
    INSERT INTO public.canhotos(
      nota_fiscal_entrega_id, status, recebido_em, documento_id,
      documento_versao_atual_id, documento_versao_aprovada_id,
      analisado_por, analisado_em, motivo_rejeicao
    )
    SELECT
      entrega.id,
      CASE WHEN resultado = 'aprovado' THEN 'aprovado' WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN 'rejeitado' ELSE 'em_analise' END,
      evidencia.primeiro_upload_em,
      evidencia.documento_id,
      evidencia.documento_versao_atual_id,
      CASE WHEN resultado = 'aprovado' THEN evidencia.documento_versao_atual_id ELSE NULL END,
      CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN auth.uid() ELSE NULL END,
      CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN pg_catalog.now() ELSE NULL END,
      CASE WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN 'Documento rejeitado na analise documental' ELSE NULL END
    WHERE NOT EXISTS (
      SELECT 1 FROM public.canhotos c
      WHERE c.nota_fiscal_entrega_id = entrega.id
        AND c.documento_id = evidencia.documento_id
    );

    UPDATE public.canhotos
    SET status = CASE WHEN resultado = 'aprovado' THEN 'aprovado' WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN 'rejeitado' ELSE 'em_analise' END,
        documento_versao_atual_id = evidencia.documento_versao_atual_id,
        documento_versao_aprovada_id = CASE WHEN resultado = 'aprovado' THEN evidencia.documento_versao_atual_id ELSE NULL END,
        analisado_por = CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN auth.uid() ELSE analisado_por END,
        analisado_em = CASE WHEN resultado IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN pg_catalog.now() ELSE analisado_em END,
        motivo_rejeicao = CASE WHEN resultado IN ('rejeitado', 'requer_ajuste') THEN coalesce(motivo_rejeicao, 'Documento rejeitado na analise documental') ELSE NULL END
    WHERE nota_fiscal_entrega_id = entrega.id
      AND documento_id = evidencia.documento_id;
  END IF;

  PERFORM public.avaliar_conclusao_entrega(entrega.id);
  RETURN jsonb_build_object('reconciliado', true, 'entrega_id', entrega.id, 'instancia_id', instancia.id, 'resultado', resultado);
END;
$$;

CREATE OR REPLACE FUNCTION private.reconciliar_evidencia_apos_analise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  evidencia record;
BEGIN
  FOR evidencia IN
    SELECT ela.id, ela.nota_fiscal_id, ela.familia_documental, ela.fundo_id, ela.cedente_id, ela.cedente_fundo_id
    FROM public.evidencias_logisticas_antecipadas ela
    WHERE ela.documento_versao_atual_id = NEW.documento_versao_id
  LOOP
    PERFORM private.reconciliar_evidencia_logistica_nf(
      evidencia.nota_fiscal_id,
      evidencia.familia_documental,
      NEW.resultado
    );
    INSERT INTO public.eventos_dominio(
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    ) VALUES (
      evidencia.fundo_id, evidencia.fundo_id, evidencia.cedente_id,
      evidencia.cedente_fundo_id, evidencia.nota_fiscal_id,
      CASE WHEN NEW.resultado = 'aprovado' THEN 'documento_logistico_antecipado_aprovado' ELSE 'documento_logistico_antecipado_rejeitado' END,
      'logistica', auth.uid(),
      coalesce((SELECT p.nome_completo FROM public.profiles p WHERE p.id = auth.uid()), 'Gestor'),
      'gestor', 'app',
      CASE WHEN NEW.resultado = 'aprovado' THEN 'Evidencia logistica antecipada aprovada.' ELSE 'Evidencia logistica antecipada rejeitada ou com ajuste solicitado.' END,
      jsonb_build_object(
        'familia_documental', evidencia.familia_documental,
        'evidencia_logistica_id', evidencia.id,
        'documento_versao_id', NEW.documento_versao_id,
        'documento_analise_id', NEW.id,
        'resultado', NEW.resultado
      ),
      'ambos', 'documento_analises', NEW.id::text || ':' || evidencia.id::text
    )
    ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
    DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

-- A RPC generica de analise e SECURITY DEFINER. Para evidencias antecipadas,
-- este trigger exige explicitamente gestor com acesso ao fundo de cada NF
-- vinculada antes de permitir a gravacao da analise.
CREATE OR REPLACE FUNCTION private.autorizar_analise_evidencia_logistica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  evidencia record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.evidencia_logistica_versoes elv
    WHERE elv.documento_versao_id = NEW.documento_versao_id
  ) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR public.get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autorizado pode analisar evidencia logistica antecipada'
      USING ERRCODE = '42501';
  END IF;

  FOR evidencia IN
    SELECT DISTINCT ela.fundo_id
    FROM public.evidencia_logistica_versoes elv
    JOIN public.evidencias_logisticas_antecipadas ela
      ON ela.id = elv.evidencia_logistica_id
    WHERE elv.documento_versao_id = NEW.documento_versao_id
  LOOP
    IF NOT private.usuario_tem_acesso_fundo(evidencia.fundo_id) THEN
      RAISE EXCEPTION 'Gestor sem acesso ao fundo da evidencia logistica'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documento_analise_autorizar_logistica_antecipada
  BEFORE INSERT ON public.documento_analises
  FOR EACH ROW EXECUTE FUNCTION private.autorizar_analise_evidencia_logistica();

CREATE TRIGGER documento_analise_reconciliar_logistica_antecipada
  AFTER INSERT ON public.documento_analises
  FOR EACH ROW EXECUTE FUNCTION private.reconciliar_evidencia_apos_analise();

CREATE OR REPLACE FUNCTION private.reconciliar_evidencia_apos_instancia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nf_id uuid;
  v_familia text;
  v_reconciliacao jsonb;
BEGIN
  IF NEW.nota_fiscal_entrega_id IS NULL THEN RETURN NEW; END IF;
  SELECT nfe.nota_fiscal_id INTO v_nf_id
  FROM public.nota_fiscal_entregas nfe WHERE nfe.id = NEW.nota_fiscal_entrega_id;
  SELECT pr.familia_documental INTO v_familia
  FROM public.politica_requisitos_documentais pr WHERE pr.id = NEW.politica_requisito_id;
  IF v_nf_id IS NOT NULL AND v_familia IS NOT NULL THEN
    v_reconciliacao := private.reconciliar_evidencia_logistica_nf(v_nf_id, v_familia, NULL);
    IF coalesce((v_reconciliacao->>'reconciliado')::boolean, false) THEN
      INSERT INTO public.eventos_dominio(
        tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
        tipo_evento, categoria, ator_nome_snapshot, ator_perfil_snapshot,
        origem, descricao, metadata, visibilidade, origem_evento, origem_registro_id
      )
      SELECT
        nf.fundo_id, nf.fundo_id, nf.cedente_id, nf.cedente_fundo_id, nf.id,
        'evidencia_logistica_antecipada_reconciliada', 'logistica',
        'Sistema', 'sistema', 'trigger',
        'Evidencia antecipada reconciliada com o requisito logistico oficial.',
        jsonb_build_object(
          'familia_documental', v_familia,
          'instancia_id', NEW.id,
          'nota_fiscal_entrega_id', NEW.nota_fiscal_entrega_id,
          'resultado', v_reconciliacao
        ),
        'ambos', 'documento_requisito_instancias', NEW.id::text
      FROM public.notas_fiscais nf
      WHERE nf.id = v_nf_id
      ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
        WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER requisito_instancia_reconciliar_logistica_antecipada
  AFTER INSERT ON public.documento_requisito_instancias
  FOR EACH ROW EXECUTE FUNCTION private.reconciliar_evidencia_apos_instancia();

CREATE OR REPLACE FUNCTION private.memorizar_logistica_ao_vincular_nf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.registrar_memoria_logistica_operacao(NEW.operacao_id, NEW.nota_fiscal_id, 'criacao');
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacao_nf_memorizar_logistica_criacao
  AFTER INSERT ON public.operacoes_nfs
  FOR EACH ROW EXECUTE FUNCTION private.memorizar_logistica_ao_vincular_nf();

CREATE OR REPLACE FUNCTION private.validar_logistica_antes_aprovacao_operacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item record;
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status IS DISTINCT FROM 'aprovada' THEN
    FOR item IN
      SELECT onf.nota_fiscal_id
      FROM public.operacoes_nfs onf
      WHERE onf.operacao_id = NEW.id
      ORDER BY onf.nota_fiscal_id
    LOOP
      PERFORM private.registrar_memoria_logistica_operacao(NEW.id, item.nota_fiscal_id, 'aprovacao');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_validar_logistica_pre_aprovacao
  BEFORE UPDATE OF status ON public.operacoes
  FOR EACH ROW EXECUTE FUNCTION private.validar_logistica_antes_aprovacao_operacao();

CREATE OR REPLACE FUNCTION private.validar_logistica_antes_transicao_nf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_politica_versao_id uuid;
  v_gate_exigido boolean := false;
  v_classificacao jsonb;
BEGIN
  IF NEW.status::text NOT IN ('submetida', 'aprovada')
     OR OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  v_politica_versao_id := private.resolver_politica_versao_nf_logistica(NEW.id);
  IF v_politica_versao_id IS NULL THEN RETURN NEW; END IF;

  SELECT pov.exigir_status_logistico_pre_cessao
  INTO v_gate_exigido
  FROM public.politica_operacional_versoes pov
  WHERE pov.id = v_politica_versao_id;

  IF NOT coalesce(v_gate_exigido, false) THEN RETURN NEW; END IF;

  v_classificacao := private.classificar_status_logistico_pre_cessao(NEW.id, v_politica_versao_id);
  IF coalesce(v_classificacao->>'status', 'INDETERMINADA') = 'INDETERMINADA' THEN
    RAISE EXCEPTION 'A politica exige CT-e/DACTE ou Comprovante de Entrega aprovado antes desta etapa'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER notas_fiscais_validar_logistica_pre_cessao
  BEFORE UPDATE OF status ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION private.validar_logistica_antes_transicao_nf();

CREATE OR REPLACE FUNCTION private.bloquear_postergacao_apos_evidencia_antecipada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.evidencias_logisticas_antecipadas ela
    JOIN public.evidencia_logistica_versoes elv
      ON elv.evidencia_logistica_id = ela.id
    WHERE ela.nota_fiscal_id = NEW.nota_fiscal_id
      AND ela.familia_documental = 'comprovante_entrega'
  ) THEN
    RAISE EXCEPTION 'A postergacao nao pode ser comunicada apos o primeiro envio do comprovante de entrega';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER postergacao_bloquear_apos_evidencia_antecipada
  BEFORE INSERT ON public.nota_fiscal_entrega_postergacoes_canhoto
  FOR EACH ROW EXECUTE FUNCTION private.bloquear_postergacao_apos_evidencia_antecipada();

ALTER TABLE public.evidencias_logisticas_antecipadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidencia_logistica_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacao_nf_logistica_memorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidencias_logisticas_cedente_select
  ON public.evidencias_logisticas_antecipadas
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'cedente'
    AND cedente_id = (SELECT public.get_user_cedente_id())
    AND EXISTS (
      SELECT 1 FROM public.cedente_fundos cf
      WHERE cf.id = evidencias_logisticas_antecipadas.cedente_fundo_id
        AND cf.cedente_id = evidencias_logisticas_antecipadas.cedente_id
        AND cf.fundo_id = evidencias_logisticas_antecipadas.fundo_id
        AND cf.status = 'ativo'
    )
  );

CREATE POLICY evidencias_logisticas_gestor_select
  ON public.evidencias_logisticas_antecipadas
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND (SELECT private.usuario_tem_acesso_fundo(fundo_id))
  );

CREATE POLICY evidencia_logistica_versoes_select
  ON public.evidencia_logistica_versoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.evidencias_logisticas_antecipadas ela
      WHERE ela.id = evidencia_logistica_versoes.evidencia_logistica_id
    )
  );

CREATE POLICY operacao_nf_logistica_gestor_select
  ON public.operacao_nf_logistica_memorias
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND (SELECT private.usuario_tem_acesso_fundo(fundo_id))
  );

CREATE POLICY operacao_nf_logistica_cedente_select
  ON public.operacao_nf_logistica_memorias
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'cedente'
    AND EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = operacao_nf_logistica_memorias.nota_fiscal_id
        AND nf.cedente_id = (SELECT public.get_user_cedente_id())
    )
  );

REVOKE ALL ON public.evidencias_logisticas_antecipadas FROM anon, authenticated;
REVOKE ALL ON public.evidencia_logistica_versoes FROM anon, authenticated;
REVOKE ALL ON public.operacao_nf_logistica_memorias FROM anon, authenticated;
GRANT SELECT ON public.evidencias_logisticas_antecipadas TO authenticated;
GRANT SELECT ON public.evidencia_logistica_versoes TO authenticated;
GRANT SELECT ON public.operacao_nf_logistica_memorias TO authenticated;
GRANT ALL ON public.evidencias_logisticas_antecipadas TO service_role;
GRANT ALL ON public.evidencia_logistica_versoes TO service_role;
GRANT ALL ON public.operacao_nf_logistica_memorias TO service_role;

REVOKE ALL ON FUNCTION public.registrar_documento_logistico_antecipado(uuid[], uuid, text, text, text, bigint, text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_logistico_antecipado(uuid[], uuid, text, text, text, bigint, text, text, text, jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.avaliar_gate_logistico_pre_cessao_nfs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_gate_logistico_pre_cessao_nfs(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION private.resolver_familia_documental_logistica(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.resolver_politica_versao_nf_logistica(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.classificar_status_logistico_pre_cessao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.registrar_memoria_logistica_operacao(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reconciliar_evidencia_logistica_nf(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.autorizar_analise_evidencia_logistica() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reconciliar_evidencia_apos_analise() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reconciliar_evidencia_apos_instancia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validar_logistica_antes_transicao_nf() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.memorizar_logistica_ao_vincular_nf() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validar_logistica_antes_aprovacao_operacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.bloquear_postergacao_apos_evidencia_antecipada() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proteger_memoria_logistica_operacao() FROM PUBLIC, anon, authenticated;

COMMIT;
