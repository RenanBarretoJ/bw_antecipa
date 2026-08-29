-- Fase 6: templates juridicos versionados por fundo.
-- Nao remove templates locais nem campos legados de URL.

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
    OR to_regclass('public.operacoes') IS NULL
    OR to_regclass('public.cedentes') IS NULL
    OR to_regclass('public.cedente_fundos') IS NULL THEN
    RAISE EXCEPTION 'Fase 6 depende das tabelas de fundos, cedentes, operacoes e cedente_fundos.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.templates_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  codigo text NOT NULL,
  tipo_documento text NOT NULL,
  nome text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'rascunho',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT templates_documentos_codigo_unique UNIQUE (fundo_id, codigo),
  CONSTRAINT templates_documentos_codigo_check CHECK (codigo ~ '^[a-z0-9_\\-]+$'),
  CONSTRAINT templates_documentos_tipo_check CHECK (tipo_documento IN ('contrato_mae', 'termo_cessao', 'notificacao_sacado', 'termo_quitacao')),
  CONSTRAINT templates_documentos_status_check CHECK (status IN ('rascunho', 'ativo', 'desativado'))
);

CREATE TRIGGER templates_documentos_updated_at
  BEFORE UPDATE ON public.templates_documentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.template_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.templates_documentos(id) ON DELETE RESTRICT,
  versao integer NOT NULL,
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_ate timestamptz,
  conteudo_html text NOT NULL,
  variaveis_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  publicada_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  publicada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_versoes_template_versao_unique UNIQUE (template_id, versao),
  CONSTRAINT template_versoes_versao_check CHECK (versao > 0),
  CONSTRAINT template_versoes_vigencia_check CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde),
  CONSTRAINT template_versoes_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT template_versoes_status_check CHECK (status IN ('rascunho', 'publicada', 'substituida', 'cancelada')),
  CONSTRAINT template_versoes_publicacao_check CHECK (
    (status = 'publicada' AND publicada_por IS NOT NULL AND publicada_em IS NOT NULL)
    OR (status <> 'publicada')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_versoes_vigente_aberta
  ON public.template_versoes(template_id)
  WHERE status = 'publicada' AND vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_template_versoes_template_status
  ON public.template_versoes(template_id, status, vigente_desde DESC);

CREATE TABLE IF NOT EXISTS public.documentos_gerados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES public.templates_documentos(id) ON DELETE RESTRICT,
  template_versao_id uuid NOT NULL REFERENCES public.template_versoes(id) ON DELETE RESTRICT,
  template_versao integer NOT NULL,
  template_hash text NOT NULL,
  tipo_documento text NOT NULL,
  bucket text NOT NULL DEFAULT 'contratos',
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'gerado',
  gerado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentos_gerados_tipo_check CHECK (tipo_documento IN ('contrato_mae', 'termo_cessao', 'notificacao_sacado', 'termo_quitacao')),
  CONSTRAINT documentos_gerados_status_check CHECK (status IN ('gerado', 'assinado', 'substituido', 'cancelado')),
  CONSTRAINT documentos_gerados_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$' AND template_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documentos_gerados_path_unique UNIQUE (bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_templates_documentos_fundo_tipo
  ON public.templates_documentos(fundo_id, tipo_documento, status);
CREATE INDEX IF NOT EXISTS idx_documentos_gerados_operacao_tipo
  ON public.documentos_gerados(operacao_id, tipo_documento, gerado_em DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_gerados_cedente
  ON public.documentos_gerados(cedente_id, gerado_em DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_gerados_template_versao
  ON public.documentos_gerados(template_versao_id);

CREATE OR REPLACE FUNCTION public.validar_template_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.documentos_gerados dg WHERE dg.template_versao_id = OLD.id) THEN
      RAISE EXCEPTION 'Versao de template utilizada por documento gerado nao pode ser excluida';
    END IF;
    IF OLD.status = 'publicada' THEN
      RAISE EXCEPTION 'Versao publicada de template nao pode ser excluida; cancele ou substitua';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicada' AND (
    NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.conteudo_html IS DISTINCT FROM OLD.conteudo_html
    OR NEW.variaveis_schema IS DISTINCT FROM OLD.variaveis_schema
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Conteudo e metadados de versao publicada de template sao imutaveis';
  END IF;

  IF NEW.status = 'publicada' THEN
    IF NEW.publicada_por IS NULL OR NEW.publicada_em IS NULL THEN
      RAISE EXCEPTION 'Versao publicada exige publicada_por e publicada_em';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.template_versoes other
      WHERE other.template_id = NEW.template_id
        AND other.id <> NEW.id
        AND other.status = 'publicada'
        AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
    ) THEN
      RAISE EXCEPTION 'Versoes publicadas de um template nao podem sobrepor vigencia';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER template_versoes_validacao
  BEFORE INSERT OR UPDATE OR DELETE ON public.template_versoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_template_versao();

CREATE OR REPLACE FUNCTION public.impedir_exclusao_template_utilizado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.documentos_gerados dg
    JOIN public.template_versoes tv ON tv.id = dg.template_versao_id
    WHERE tv.template_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Template utilizado por documento gerado nao pode ser excluido';
  END IF;
  IF EXISTS (SELECT 1 FROM public.template_versoes tv WHERE tv.template_id = OLD.id AND tv.status = 'publicada') THEN
    RAISE EXCEPTION 'Template com versao publicada nao pode ser excluido; desative-o';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER templates_documentos_sem_delete_utilizado
  BEFORE DELETE ON public.templates_documentos
  FOR EACH ROW EXECUTE FUNCTION public.impedir_exclusao_template_utilizado();

CREATE OR REPLACE FUNCTION public.impedir_exclusao_documento_gerado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Documento gerado compoe trilha juridica e nao pode ser excluido; cancele ou substitua';
END;
$$;

CREATE TRIGGER documentos_gerados_sem_delete
  BEFORE DELETE ON public.documentos_gerados
  FOR EACH ROW EXECUTE FUNCTION public.impedir_exclusao_documento_gerado();

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_documento_gerado(p_documento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN get_user_role() = 'gestor' THEN true
    WHEN get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.documentos_gerados dg
      JOIN public.cedentes c ON c.id = dg.cedente_id
      WHERE dg.id = p_documento_id AND c.user_id = auth.uid()
    )
    WHEN get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.documentos_gerados dg
      JOIN public.consultor_cedente cc ON cc.cedente_id = dg.cedente_id
      WHERE dg.id = p_documento_id AND cc.consultor_id = auth.uid()
    )
    ELSE false
  END;
$$;

ALTER TABLE public.templates_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_gerados ENABLE ROW LEVEL SECURITY;

CREATE POLICY templates_documentos_gestor_all ON public.templates_documentos
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY template_versoes_gestor_all ON public.template_versoes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY documentos_gerados_gestor_all ON public.documentos_gerados
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY documentos_gerados_contexto_select ON public.documentos_gerados
FOR SELECT TO authenticated USING (public.usuario_pode_ler_documento_gerado(id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates_documentos, public.template_versoes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documentos_gerados TO authenticated;
GRANT ALL ON public.templates_documentos, public.template_versoes, public.documentos_gerados TO service_role;
GRANT EXECUTE ON FUNCTION public.usuario_pode_ler_documento_gerado(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.usuario_pode_ler_documento_gerado(uuid) FROM PUBLIC;
