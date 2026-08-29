-- Fase 7: CNAB configuravel, versionado e rastreavel por fundo.
-- Nao implementa Sinqia, credenciais criptografadas ou substituicao da Fromtis.
-- Mantem campos legados em operacoes durante a transicao.

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
    OR to_regclass('public.operacoes') IS NULL
    OR to_regclass('public.cedentes') IS NULL
    OR to_regclass('public.cedente_fundos') IS NULL THEN
    RAISE EXCEPTION 'Fase 7 depende das tabelas de fundos, cedentes, operacoes e cedente_fundos.';
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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('remessas-cnab', 'remessas-cnab', false, 10485760, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.configuracoes_cnab (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  finalidade text NOT NULL DEFAULT 'remessa',
  status text NOT NULL DEFAULT 'rascunho',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracoes_cnab_codigo_unique UNIQUE (fundo_id, codigo),
  CONSTRAINT configuracoes_cnab_codigo_check CHECK (codigo ~ '^[a-z0-9_\-]+$'),
  CONSTRAINT configuracoes_cnab_finalidade_check CHECK (finalidade IN ('remessa')),
  CONSTRAINT configuracoes_cnab_status_check CHECK (status IN ('rascunho', 'ativa', 'desativada'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_configuracoes_cnab_ativa_fundo_finalidade
  ON public.configuracoes_cnab(fundo_id, finalidade)
  WHERE status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_configuracoes_cnab_fundo_status
  ON public.configuracoes_cnab(fundo_id, status);

CREATE TRIGGER configuracoes_cnab_updated_at
  BEFORE UPDATE ON public.configuracoes_cnab
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.configuracao_cnab_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  configuracao_cnab_id uuid NOT NULL REFERENCES public.configuracoes_cnab(id) ON DELETE RESTRICT,
  versao integer NOT NULL,
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_ate timestamptz,
  layout text NOT NULL,
  versao_layout text NOT NULL,
  codigo_banco text NOT NULL,
  banco text NOT NULL,
  agencia text NOT NULL,
  conta text NOT NULL,
  digito_conta text NOT NULL,
  carteira text NOT NULL,
  convenio text NOT NULL,
  codigo_originador text NOT NULL,
  codigo_empresa text NOT NULL,
  tipo_inscricao text NOT NULL,
  numero_inscricao text NOT NULL,
  especie_titulo text NOT NULL,
  tipo_recebivel text NOT NULL,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  conteudo_hash text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  publicada_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  publicada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracao_cnab_versoes_unique UNIQUE (configuracao_cnab_id, versao),
  CONSTRAINT configuracao_cnab_versoes_versao_check CHECK (versao > 0),
  CONSTRAINT configuracao_cnab_versoes_layout_check CHECK (layout IN ('cnab444')),
  CONSTRAINT configuracao_cnab_versoes_vigencia_check CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde),
  CONSTRAINT configuracao_cnab_versoes_originador_check CHECK (codigo_originador ~ '^[0-9]{1,20}$'),
  CONSTRAINT configuracao_cnab_versoes_hash_check CHECK (conteudo_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT configuracao_cnab_versoes_status_check CHECK (status IN ('rascunho', 'publicada', 'substituida', 'cancelada')),
  CONSTRAINT configuracao_cnab_versoes_publicacao_check CHECK (
    (status = 'publicada' AND publicada_por IS NOT NULL AND publicada_em IS NOT NULL)
    OR (status <> 'publicada')
  )
);

ALTER TABLE public.configuracao_cnab_versoes
  ADD COLUMN IF NOT EXISTS codigo_originador text;

UPDATE public.configuracao_cnab_versoes
SET codigo_originador = codigo_empresa
WHERE codigo_originador IS NULL;

ALTER TABLE public.configuracao_cnab_versoes
  ALTER COLUMN codigo_originador SET NOT NULL;

ALTER TABLE public.configuracao_cnab_versoes
  DROP CONSTRAINT IF EXISTS configuracao_cnab_versoes_originador_check;

ALTER TABLE public.configuracao_cnab_versoes
  ADD CONSTRAINT configuracao_cnab_versoes_originador_check CHECK (codigo_originador ~ '^[0-9]{1,20}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_configuracao_cnab_versoes_vigente_aberta
  ON public.configuracao_cnab_versoes(configuracao_cnab_id)
  WHERE status = 'publicada' AND vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_configuracao_cnab_versoes_config_status
  ON public.configuracao_cnab_versoes(configuracao_cnab_id, status, vigente_desde DESC);

CREATE TABLE IF NOT EXISTS public.sequencias_remessa (
  configuracao_cnab_id uuid NOT NULL REFERENCES public.configuracoes_cnab(id) ON DELETE RESTRICT,
  data_referencia date NOT NULL,
  proximo_sequencial integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (configuracao_cnab_id, data_referencia),
  CONSTRAINT sequencias_remessa_proximo_check CHECK (proximo_sequencial > 0)
);

CREATE TABLE IF NOT EXISTS public.remessas_cnab (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  configuracao_cnab_id uuid NOT NULL REFERENCES public.configuracoes_cnab(id) ON DELETE RESTRICT,
  configuracao_cnab_versao_id uuid NOT NULL REFERENCES public.configuracao_cnab_versoes(id) ON DELETE RESTRICT,
  integracao_fundo_versao_id uuid,
  configuracao_versao integer NOT NULL,
  configuracao_hash text NOT NULL,
  status text NOT NULL DEFAULT 'gerada',
  bucket text NOT NULL DEFAULT 'remessas-cnab',
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  quantidade_registros integer NOT NULL,
  quantidade_titulos integer NOT NULL,
  valor_total numeric(18,2) NOT NULL DEFAULT 0,
  nome_arquivo text NOT NULL,
  sequencial integer NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  gerado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  retorno_resumido text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remessas_cnab_status_check CHECK (status IN ('gerada', 'validada', 'enviada', 'aceita', 'rejeitada', 'cancelada', 'erro')),
  CONSTRAINT remessas_cnab_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$' AND configuracao_hash ~ '^[0-9a-f]{64}$' AND payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT remessas_cnab_quantidades_check CHECK (quantidade_registros >= 3 AND quantidade_titulos >= 1),
  CONSTRAINT remessas_cnab_sequencial_check CHECK (sequencial > 0),
  CONSTRAINT remessas_cnab_path_unique UNIQUE (bucket, storage_path),
  CONSTRAINT remessas_cnab_idempotency_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.integracoes_fundo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracoes_fundo_provedor_check CHECK (provedor IN ('fromtis', 'sinqia')),
  CONSTRAINT integracoes_fundo_status_check CHECK (status IN ('rascunho', 'ativa', 'desativada')),
  CONSTRAINT integracoes_fundo_unique UNIQUE (fundo_id, provedor)
);

CREATE TABLE IF NOT EXISTS public.integracao_fundo_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_fundo_id uuid NOT NULL REFERENCES public.integracoes_fundo(id) ON DELETE RESTRICT,
  versao integer NOT NULL,
  ambiente text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  identificador_cliente text NOT NULL,
  codigo_originador text,
  endpoint_base text NOT NULL,
  configuracao_nao_sensivel jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text NOT NULL,
  secret_name text,
  vault_key text,
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_ate timestamptz,
  publicada_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  publicada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_fundo_versoes_unique UNIQUE (integracao_fundo_id, versao),
  CONSTRAINT integracao_fundo_versoes_versao_check CHECK (versao > 0),
  CONSTRAINT integracao_fundo_versoes_ambiente_check CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT integracao_fundo_versoes_status_check CHECK (status IN ('rascunho', 'publicada', 'substituida', 'cancelada')),
  CONSTRAINT integracao_fundo_versoes_vigencia_check CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde),
  CONSTRAINT integracao_fundo_versoes_publicacao_check CHECK (
    (status = 'publicada' AND publicada_por IS NOT NULL AND publicada_em IS NOT NULL)
    OR (status <> 'publicada')
  ),
  CONSTRAINT integracao_fundo_versoes_credential_ref_check CHECK (credential_ref <> '')
);

ALTER TABLE public.remessas_cnab
  ADD COLUMN IF NOT EXISTS integracao_fundo_versao_id uuid REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'remessas_cnab_integracao_fundo_versao_id_fkey'
  ) THEN
    ALTER TABLE public.remessas_cnab
      ADD CONSTRAINT remessas_cnab_integracao_fundo_versao_id_fkey
      FOREIGN KEY (integracao_fundo_versao_id)
      REFERENCES public.integracao_fundo_versoes(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_fundo_ativa_provedor
  ON public.integracoes_fundo(fundo_id, provedor)
  WHERE status = 'ativa';

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracao_fundo_versoes_vigente_aberta
  ON public.integracao_fundo_versoes(integracao_fundo_id)
  WHERE status = 'publicada' AND vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_integracoes_fundo_fundo
  ON public.integracoes_fundo(fundo_id, provedor, status);
CREATE INDEX IF NOT EXISTS idx_integracao_fundo_versoes_status
  ON public.integracao_fundo_versoes(integracao_fundo_id, status, vigente_desde DESC);

CREATE TRIGGER integracoes_fundo_updated_at
  BEFORE UPDATE ON public.integracoes_fundo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_remessas_cnab_fundo_status
  ON public.remessas_cnab(fundo_id, status, gerado_em DESC);
CREATE INDEX IF NOT EXISTS idx_remessas_cnab_config_versao
  ON public.remessas_cnab(configuracao_cnab_versao_id);

CREATE TABLE IF NOT EXISTS public.remessas_cnab_operacoes (
  remessa_cnab_id uuid NOT NULL REFERENCES public.remessas_cnab(id) ON DELETE RESTRICT,
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remessa_cnab_id, operacao_id)
);

CREATE INDEX IF NOT EXISTS idx_remessas_cnab_operacoes_operacao
  ON public.remessas_cnab_operacoes(operacao_id);

CREATE TRIGGER remessas_cnab_updated_at
  BEFORE UPDATE ON public.remessas_cnab
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.validar_integracao_fundo_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.remessas_cnab r WHERE r.integracao_fundo_versao_id = OLD.id) THEN
      RAISE EXCEPTION 'Versao de integracao utilizada por remessa nao pode ser excluida';
    END IF;
    IF OLD.status = 'publicada' THEN
      RAISE EXCEPTION 'Versao publicada de integracao nao pode ser excluida; cancele ou substitua';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicada' AND (
    NEW.integracao_fundo_id IS DISTINCT FROM OLD.integracao_fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
    OR NEW.identificador_cliente IS DISTINCT FROM OLD.identificador_cliente
    OR NEW.codigo_originador IS DISTINCT FROM OLD.codigo_originador
    OR NEW.endpoint_base IS DISTINCT FROM OLD.endpoint_base
    OR NEW.configuracao_nao_sensivel IS DISTINCT FROM OLD.configuracao_nao_sensivel
    OR NEW.credential_ref IS DISTINCT FROM OLD.credential_ref
    OR NEW.secret_name IS DISTINCT FROM OLD.secret_name
    OR NEW.vault_key IS DISTINCT FROM OLD.vault_key
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Campos de versao publicada de integracao sao imutaveis';
  END IF;

  IF NEW.status = 'publicada' THEN
    IF NEW.publicada_por IS NULL OR NEW.publicada_em IS NULL THEN
      RAISE EXCEPTION 'Versao publicada de integracao exige publicada_por e publicada_em';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.integracao_fundo_versoes other
      WHERE other.integracao_fundo_id = NEW.integracao_fundo_id
        AND other.id <> NEW.id
        AND other.status = 'publicada'
        AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
    ) THEN
      RAISE EXCEPTION 'Versoes publicadas de uma integracao nao podem sobrepor vigencia';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER integracao_fundo_versoes_validacao
  BEFORE INSERT OR UPDATE OR DELETE ON public.integracao_fundo_versoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_integracao_fundo_versao();

CREATE OR REPLACE FUNCTION public.reservar_sequencial_remessa(
  p_configuracao_cnab_id uuid,
  p_data_referencia date
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sequencial integer;
BEGIN
  INSERT INTO public.sequencias_remessa (configuracao_cnab_id, data_referencia, proximo_sequencial)
  VALUES (p_configuracao_cnab_id, p_data_referencia, 2)
  ON CONFLICT (configuracao_cnab_id, data_referencia)
  DO UPDATE SET
    proximo_sequencial = public.sequencias_remessa.proximo_sequencial + 1,
    updated_at = now()
  RETURNING proximo_sequencial - 1 INTO v_sequencial;

  RETURN v_sequencial;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_configuracao_cnab_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.remessas_cnab r WHERE r.configuracao_cnab_versao_id = OLD.id) THEN
      RAISE EXCEPTION 'Versao de configuracao CNAB utilizada por remessa nao pode ser excluida';
    END IF;
    IF OLD.status = 'publicada' THEN
      RAISE EXCEPTION 'Versao publicada de configuracao CNAB nao pode ser excluida; cancele ou substitua';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicada' AND (
    NEW.configuracao_cnab_id IS DISTINCT FROM OLD.configuracao_cnab_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.layout IS DISTINCT FROM OLD.layout
    OR NEW.versao_layout IS DISTINCT FROM OLD.versao_layout
    OR NEW.codigo_banco IS DISTINCT FROM OLD.codigo_banco
    OR NEW.banco IS DISTINCT FROM OLD.banco
    OR NEW.agencia IS DISTINCT FROM OLD.agencia
    OR NEW.conta IS DISTINCT FROM OLD.conta
    OR NEW.digito_conta IS DISTINCT FROM OLD.digito_conta
    OR NEW.carteira IS DISTINCT FROM OLD.carteira
    OR NEW.convenio IS DISTINCT FROM OLD.convenio
    OR NEW.codigo_originador IS DISTINCT FROM OLD.codigo_originador
    OR NEW.codigo_empresa IS DISTINCT FROM OLD.codigo_empresa
    OR NEW.tipo_inscricao IS DISTINCT FROM OLD.tipo_inscricao
    OR NEW.numero_inscricao IS DISTINCT FROM OLD.numero_inscricao
    OR NEW.especie_titulo IS DISTINCT FROM OLD.especie_titulo
    OR NEW.tipo_recebivel IS DISTINCT FROM OLD.tipo_recebivel
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Campos de versao publicada de configuracao CNAB sao imutaveis';
  END IF;

  IF NEW.status = 'publicada' THEN
    IF NEW.publicada_por IS NULL OR NEW.publicada_em IS NULL THEN
      RAISE EXCEPTION 'Versao publicada exige publicada_por e publicada_em';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.configuracao_cnab_versoes other
      WHERE other.configuracao_cnab_id = NEW.configuracao_cnab_id
        AND other.id <> NEW.id
        AND other.status = 'publicada'
        AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
    ) THEN
      RAISE EXCEPTION 'Versoes publicadas de uma configuracao CNAB nao podem sobrepor vigencia';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER configuracao_cnab_versoes_validacao
  BEFORE INSERT OR UPDATE OR DELETE ON public.configuracao_cnab_versoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_configuracao_cnab_versao();

CREATE OR REPLACE FUNCTION public.impedir_exclusao_configuracao_cnab_utilizada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.remessas_cnab r WHERE r.configuracao_cnab_id = OLD.id) THEN
    RAISE EXCEPTION 'Configuracao CNAB utilizada por remessa nao pode ser excluida';
  END IF;
  IF EXISTS (SELECT 1 FROM public.configuracao_cnab_versoes v WHERE v.configuracao_cnab_id = OLD.id AND v.status = 'publicada') THEN
    RAISE EXCEPTION 'Configuracao CNAB com versao publicada nao pode ser excluida; desative-a';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER configuracoes_cnab_sem_delete_utilizado
  BEFORE DELETE ON public.configuracoes_cnab
  FOR EACH ROW EXECUTE FUNCTION public.impedir_exclusao_configuracao_cnab_utilizada();

CREATE OR REPLACE FUNCTION public.impedir_exclusao_remessa_cnab()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Remessa CNAB compoe trilha operacional e nao pode ser excluida; cancele-a';
END;
$$;

CREATE TRIGGER remessas_cnab_sem_delete
  BEFORE DELETE ON public.remessas_cnab
  FOR EACH ROW EXECUTE FUNCTION public.impedir_exclusao_remessa_cnab();

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_remessa_cnab(p_remessa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN get_user_role() = 'gestor' THEN true
    WHEN get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.remessas_cnab r
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = r.id
      JOIN public.operacoes o ON o.id = ro.operacao_id
      JOIN public.cedentes c ON c.id = o.cedente_id
      WHERE r.id = p_remessa_id AND c.user_id = auth.uid()
    )
    WHEN get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.remessas_cnab r
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = r.id
      JOIN public.operacoes o ON o.id = ro.operacao_id
      JOIN public.consultor_cedente cc ON cc.cedente_id = o.cedente_id
      WHERE r.id = p_remessa_id AND cc.consultor_id = auth.uid()
    )
    ELSE false
  END;
$$;

ALTER TABLE public.configuracoes_cnab ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracao_cnab_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracoes_fundo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_fundo_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequencias_remessa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remessas_cnab ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remessas_cnab_operacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuracoes_cnab_gestor_all ON public.configuracoes_cnab
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY configuracao_cnab_versoes_gestor_all ON public.configuracao_cnab_versoes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY integracoes_fundo_gestor_all ON public.integracoes_fundo
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY integracao_fundo_versoes_gestor_all ON public.integracao_fundo_versoes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY sequencias_remessa_gestor_select ON public.sequencias_remessa
FOR SELECT TO authenticated USING (get_user_role() = 'gestor');

CREATE POLICY remessas_cnab_gestor_all ON public.remessas_cnab
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY remessas_cnab_contexto_select ON public.remessas_cnab
FOR SELECT TO authenticated USING (public.usuario_pode_ler_remessa_cnab(id));

CREATE POLICY remessas_cnab_operacoes_gestor_all ON public.remessas_cnab_operacoes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY remessas_cnab_operacoes_contexto_select ON public.remessas_cnab_operacoes
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.remessas_cnab r
    WHERE r.id = remessas_cnab_operacoes.remessa_cnab_id
      AND public.usuario_pode_ler_remessa_cnab(r.id)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes_cnab, public.configuracao_cnab_versoes, public.integracoes_fundo, public.integracao_fundo_versoes TO authenticated;
GRANT SELECT ON public.sequencias_remessa TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.remessas_cnab, public.remessas_cnab_operacoes TO authenticated;
GRANT ALL ON public.configuracoes_cnab, public.configuracao_cnab_versoes, public.integracoes_fundo, public.integracao_fundo_versoes, public.sequencias_remessa, public.remessas_cnab, public.remessas_cnab_operacoes TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_sequencial_remessa(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.usuario_pode_ler_remessa_cnab(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_sequencial_remessa(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.usuario_pode_ler_remessa_cnab(uuid) FROM PUBLIC;
