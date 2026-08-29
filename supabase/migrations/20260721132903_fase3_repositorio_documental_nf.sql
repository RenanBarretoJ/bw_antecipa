-- Fase 3: repositorio documental e documentos pre-cessao por nota fiscal.
-- O modelo legado "documentos" e notas_fiscais.arquivo_url permanecem intactos.

CREATE TABLE public.documento_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  dominio text NOT NULL,
  mime_types_aceitos text[] NOT NULL DEFAULT '{}',
  extensoes_aceitas text[] NOT NULL DEFAULT '{}',
  tamanho_max_bytes bigint NOT NULL DEFAULT 20971520,
  permite_multiplas_versoes boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_tipos_dominio_check CHECK (dominio IN ('nf', 'operacao', 'juridico', 'entrega', 'integracao')),
  CONSTRAINT documento_tipos_tamanho_check CHECK (tamanho_max_bytes > 0)
);

CREATE TRIGGER documento_tipos_updated_at
  BEFORE UPDATE ON public.documento_tipos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.documento_tipos (codigo, nome, dominio, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes)
VALUES
  ('nf_xml', 'XML da NF-e', 'nf', ARRAY['application/xml', 'text/xml', 'application/octet-stream'], ARRAY['xml'], 20971520),
  ('nf_danfe_pdf', 'DANFE/PDF', 'nf', ARRAY['application/pdf'], ARRAY['pdf'], 20971520),
  ('nf_pedido_compra', 'Pedido de Compra', 'nf', ARRAY['application/pdf', 'application/xml', 'text/xml', 'image/jpeg', 'image/png'], ARRAY['pdf', 'xml', 'jpg', 'jpeg', 'png'], 20971520)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.politica_requisitos_documentais
  ADD COLUMN documento_tipo_id uuid REFERENCES public.documento_tipos(id) ON DELETE RESTRICT;

UPDATE public.politica_requisitos_documentais pr
SET documento_tipo_id = dt.id
FROM public.documento_tipos dt
WHERE dt.codigo = pr.tipo_documento_codigo
  AND pr.tipo_documento_codigo IN ('nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra');

CREATE INDEX idx_politica_requisitos_documento_tipo
  ON public.politica_requisitos_documentais(documento_tipo_id, ativo);

CREATE TABLE public.documentos_repositorio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_tipo_id uuid NOT NULL REFERENCES public.documento_tipos(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pendente',
  criado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT documentos_repositorio_status_check CHECK (status IN ('pendente', 'enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado'))
);

CREATE TRIGGER documentos_repositorio_updated_at
  BEFORE UPDATE ON public.documentos_repositorio
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.documento_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  numero_versao integer NOT NULL,
  bucket text NOT NULL DEFAULT 'documentos-v2',
  path text NOT NULL,
  nome_original text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'enviado',
  substitui_versao_id uuid,
  enviado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_versoes_numero_check CHECK (numero_versao > 0),
  CONSTRAINT documento_versoes_bucket_check CHECK (bucket = 'documentos-v2'),
  CONSTRAINT documento_versoes_path_check CHECK (length(path) > 0),
  CONSTRAINT documento_versoes_tamanho_check CHECK (tamanho_bytes > 0),
  CONSTRAINT documento_versoes_sha256_check CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT documento_versoes_status_check CHECK (status IN ('enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado')),
  CONSTRAINT documento_versoes_numero_unique UNIQUE (documento_id, numero_versao),
  CONSTRAINT documento_versoes_path_unique UNIQUE (bucket, path),
  CONSTRAINT documento_versoes_id_documento_unique UNIQUE (id, documento_id),
  CONSTRAINT documento_versoes_substituicao_fk FOREIGN KEY (substitui_versao_id, documento_id)
    REFERENCES public.documento_versoes(id, documento_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.proteger_versao_documento_aprovada()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'aprovado' THEN
    RAISE EXCEPTION 'Versao aprovada nao pode ser removida';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'aprovado' THEN
    IF NEW.documento_id IS DISTINCT FROM OLD.documento_id
       OR NEW.numero_versao IS DISTINCT FROM OLD.numero_versao
       OR NEW.bucket IS DISTINCT FROM OLD.bucket
       OR NEW.path IS DISTINCT FROM OLD.path
       OR NEW.nome_original IS DISTINCT FROM OLD.nome_original
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.tamanho_bytes IS DISTINCT FROM OLD.tamanho_bytes
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.substitui_versao_id IS DISTINCT FROM OLD.substitui_versao_id
       OR NEW.enviado_por IS DISTINCT FROM OLD.enviado_por
       OR NEW.enviado_em IS DISTINCT FROM OLD.enviado_em
    THEN
      RAISE EXCEPTION 'Versao aprovada e imutavel';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER documento_versao_aprovada_immutavel
  BEFORE UPDATE OR DELETE ON public.documento_versoes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_versao_documento_aprovada();

CREATE TABLE public.documento_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  principal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_vinculos_um_contexto_check CHECK (num_nonnulls(nota_fiscal_id, operacao_id) = 1),
  CONSTRAINT documento_vinculos_documento_nf_unique UNIQUE (documento_id, nota_fiscal_id)
);

CREATE UNIQUE INDEX uq_documento_vinculos_principal
  ON public.documento_vinculos(documento_id) WHERE principal;

CREATE TABLE public.documento_requisito_instancias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_requisito_id uuid NOT NULL REFERENCES public.politica_requisitos_documentais(id) ON DELETE RESTRICT,
  politica_operacional_id uuid NOT NULL REFERENCES public.politicas_operacionais(id) ON DELETE RESTRICT,
  politica_operacional_versao_id uuid NOT NULL REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  politica_versao integer NOT NULL,
  documento_tipo_id uuid REFERENCES public.documento_tipos(id) ON DELETE RESTRICT,
  tipo_documento_codigo_snapshot text NOT NULL,
  escopo_snapshot text NOT NULL,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pendente',
  obrigatorio boolean NOT NULL,
  prazo_limite date,
  formatos_aceitos_snapshot text[] NOT NULL DEFAULT '{}',
  nivel_validacao_snapshot text NOT NULL,
  quantidade_minima_snapshot integer NOT NULL,
  responsavel_upload_snapshot text NOT NULL,
  responsavel_aprovacao_snapshot text NOT NULL,
  documento_id uuid REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  versao_aprovada_id uuid,
  satisfeito_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_requisito_status_check CHECK (status IN ('pendente', 'satisfeito', 'vencido', 'dispensado', 'cancelado')),
  CONSTRAINT documento_requisito_contexto_check CHECK (num_nonnulls(nota_fiscal_id, operacao_id) = 1),
  CONSTRAINT documento_requisito_quantidade_check CHECK (quantidade_minima_snapshot > 0),
  CONSTRAINT documento_requisito_politica_versao_check CHECK (politica_versao > 0),
  CONSTRAINT documento_requisito_unique UNIQUE (politica_requisito_id, nota_fiscal_id),
  CONSTRAINT documento_requisito_versao_fk FOREIGN KEY (versao_aprovada_id, documento_id)
    REFERENCES public.documento_versoes(id, documento_id) ON DELETE RESTRICT
);

CREATE TRIGGER documento_requisito_updated_at
  BEFORE UPDATE ON public.documento_requisito_instancias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.documento_analises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_versao_id uuid NOT NULL REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  resultado text NOT NULL,
  analisado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ator_tipo text NOT NULL DEFAULT 'usuario',
  observacoes text,
  dados_estruturados jsonb NOT NULL DEFAULT '{}'::jsonb,
  analisado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_analises_resultado_check CHECK (resultado IN ('aprovado', 'rejeitado', 'pendente', 'requer_ajuste')),
  CONSTRAINT documento_analises_ator_check CHECK (ator_tipo IN ('usuario', 'sistema', 'cron', 'integracao')),
  CONSTRAINT documento_analises_motivo_check CHECK (resultado NOT IN ('rejeitado', 'requer_ajuste') OR length(trim(coalesce(observacoes, ''))) > 0)
);

CREATE OR REPLACE FUNCTION public.proteger_analise_documento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Analises de documentos sao append-only'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documento_analise_append_only
  BEFORE UPDATE OR DELETE ON public.documento_analises
  FOR EACH ROW EXECUTE FUNCTION public.proteger_analise_documento();

CREATE INDEX idx_documentos_repositorio_tipo_status ON public.documentos_repositorio(documento_tipo_id, status);
CREATE INDEX idx_documento_versoes_documento_status ON public.documento_versoes(documento_id, status, numero_versao DESC);
CREATE INDEX idx_documento_vinculos_nf ON public.documento_vinculos(nota_fiscal_id);
CREATE INDEX idx_documento_requisito_nf_status ON public.documento_requisito_instancias(nota_fiscal_id, status);
CREATE INDEX idx_documento_analises_versao_data ON public.documento_analises(documento_versao_id, analisado_em DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos-v2', 'documentos-v2', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.documento_tipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_repositorio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_requisito_instancias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_analises ENABLE ROW LEVEL SECURITY;

CREATE POLICY documento_tipos_authenticated_select ON public.documento_tipos
  FOR SELECT TO authenticated USING (ativo OR (SELECT get_user_role()) = 'gestor');
CREATE POLICY documento_tipos_gestor_write ON public.documento_tipos
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');

CREATE POLICY documentos_repositorio_gestor_all ON public.documentos_repositorio
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');
CREATE POLICY documentos_repositorio_vinculo_select ON public.documentos_repositorio
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.documento_vinculos v
      WHERE v.documento_id = documentos_repositorio.id
        AND (v.cedente_id = (SELECT get_user_cedente_id())
          OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
            SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = v.cedente_id
          ))))
  );

CREATE POLICY documento_versoes_gestor_all ON public.documento_versoes
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');
CREATE POLICY documento_versoes_vinculo_select ON public.documento_versoes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.documento_vinculos v
      WHERE v.documento_id = documento_versoes.documento_id
        AND (v.cedente_id = (SELECT get_user_cedente_id())
          OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
            SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = v.cedente_id
          ))))
  );

CREATE POLICY documento_vinculos_gestor_all ON public.documento_vinculos
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');
CREATE POLICY documento_vinculos_contexto_select ON public.documento_vinculos
  FOR SELECT TO authenticated USING (
    cedente_id = (SELECT get_user_cedente_id())
    OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
      SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = documento_vinculos.cedente_id
    ))
  );

CREATE POLICY documento_requisito_gestor_all ON public.documento_requisito_instancias
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');
CREATE POLICY documento_requisito_contexto_select ON public.documento_requisito_instancias
  FOR SELECT TO authenticated USING (
    cedente_id = (SELECT get_user_cedente_id())
    OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
      SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = documento_requisito_instancias.cedente_id
    ))
  );

CREATE POLICY documento_analises_gestor_all ON public.documento_analises
  FOR ALL TO authenticated USING ((SELECT get_user_role()) = 'gestor') WITH CHECK ((SELECT get_user_role()) = 'gestor');
CREATE POLICY documento_analises_contexto_select ON public.documento_analises
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.documento_versoes dv
      JOIN public.documento_vinculos v ON v.documento_id = dv.documento_id
      WHERE dv.id = documento_analises.documento_versao_id
        AND (v.cedente_id = (SELECT get_user_cedente_id())
          OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
            SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = v.cedente_id
          ))))
  );

GRANT SELECT, INSERT, UPDATE ON public.documento_tipos TO authenticated;
GRANT SELECT ON public.documentos_repositorio, public.documento_versoes, public.documento_vinculos,
  public.documento_requisito_instancias, public.documento_analises TO authenticated;
GRANT ALL ON public.documento_tipos, public.documentos_repositorio, public.documento_versoes,
  public.documento_vinculos, public.documento_requisito_instancias, public.documento_analises TO service_role;

CREATE POLICY storage_documentos_v2_select ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'documentos-v2'
    AND (
      (SELECT get_user_role()) = 'gestor'
      OR EXISTS (
        SELECT 1
        FROM public.documento_versoes dv
        JOIN public.documento_vinculos v ON v.documento_id = dv.documento_id
        WHERE dv.bucket = storage.objects.bucket_id
          AND dv.path = storage.objects.name
          AND (v.cedente_id = (SELECT get_user_cedente_id())
            OR ((SELECT get_user_role()) = 'consultor' AND EXISTS (
              SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = v.cedente_id
            )))
      )
    )
  );

CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nf_cedente uuid;
  policy_cedente_fundo uuid;
  policy_cedente uuid;
  version_number integer;
  inserted_count integer;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;
  SELECT cedente_id INTO nf_cedente FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  SELECT po.cedente_fundo_id, cf.cedente_id, pov.versao
    INTO policy_cedente_fundo, policy_cedente, version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundos cf ON cf.id = pov.cedente_fundo_id
  WHERE pov.id = p_politica_versao_id AND po.id = p_politica_operacional_id;
  IF policy_cedente IS NULL THEN RAISE EXCEPTION 'Versao de politica invalida'; END IF;
  IF policy_cedente <> nf_cedente THEN RAISE EXCEPTION 'Politica nao pertence ao cedente da NF'; END IF;

  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, cedente_id,
    status, obrigatorio, prazo_limite, formatos_aceitos_snapshot, nivel_validacao_snapshot,
    quantidade_minima_snapshot, responsavel_upload_snapshot, responsavel_aprovacao_snapshot
  )
  SELECT r.id, r.politica_operacional_id, r.politica_operacional_versao_id, version_number,
    r.documento_tipo_id, r.tipo_documento_codigo, r.escopo, p_nota_fiscal_id, nf_cedente,
    'pendente', r.obrigatorio,
    CASE WHEN r.prazo_dias_corridos IS NULL THEN NULL ELSE (now()::date + r.prazo_dias_corridos) END,
    r.formatos_aceitos, r.nivel_validacao, r.quantidade_minima, r.responsavel_upload, r.responsavel_aprovacao
  FROM public.politica_requisitos_documentais r
  WHERE r.politica_operacional_id = p_politica_operacional_id
    AND r.politica_operacional_versao_id = p_politica_versao_id
    AND r.escopo = 'nf_pre_cessao'
    AND r.ativo
  ON CONFLICT (politica_requisito_id, nota_fiscal_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'inseridos', inserted_count, 'politica_versao', version_number);
END;
$$;

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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_role text;
  nf_cedente uuid;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  actor_role := get_user_role();
  IF auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente') OR p_enviado_por <> auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento';
  END IF;
  SELECT cedente_id INTO nf_cedente FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF actor_role = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN RAISE EXCEPTION 'NF fora do cedente autenticado'; END IF;
  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id AND nota_fiscal_id = p_nota_fiscal_id AND status NOT IN ('cancelado', 'satisfeito');
  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
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
    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_id, nf_cedente);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;
  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, p_mime_type, p_tamanho_bytes, lower(p_sha256),
    'enviado', p_substitui_versao_id, p_enviado_por
  ) RETURNING id INTO version_id;
  UPDATE public.documentos_repositorio SET status = 'enviado', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id, versao_aprovada_id = NULL, status = 'pendente', satisfeito_em = NULL
  WHERE id = p_requisito_id;
  RETURN jsonb_build_object('documento_id', doc_id, 'versao_id', version_id, 'numero_versao', version_number, 'sha256_igual', same_hash);
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
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN RAISE EXCEPTION 'Somente gestor pode analisar documentos'; END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado', 'pendente', 'requer_ajuste') THEN RAISE EXCEPTION 'Resultado de analise invalido'; END IF;
  IF p_resultado IN ('rejeitado', 'requer_ajuste') AND length(trim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Motivo obrigatorio para rejeicao ou ajuste';
  END IF;
  SELECT dv.*, dr.id AS repo_id INTO version_row
  FROM public.documento_versoes dv JOIN public.documentos_repositorio dr ON dr.id = dv.documento_id
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
  RETURN jsonb_build_object('analise_id', analysis_id, 'versao_id', p_documento_versao_id, 'status', new_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid),
  public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid),
  public.analisar_documento_versao(uuid, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_documento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analisar_documento_versao(uuid, text, text, jsonb) FROM PUBLIC;
