-- Fase 2: núcleo multifundo, políticas versionadas e snapshot da operação.
-- Migration incremental. Não remove cedentes.fundo_id nem altera migrations históricas.

CREATE TABLE public.cedente_fundos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  codigo_externo text,
  status text NOT NULL DEFAULT 'ativo',
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_ate timestamptz,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cedente_fundos_status_check
    CHECK (status IN ('ativo', 'suspenso', 'encerrado')),
  CONSTRAINT cedente_fundos_vigencia_check
    CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde)
);

CREATE UNIQUE INDEX uq_cedente_fundos_par_ativo
  ON public.cedente_fundos(cedente_id, fundo_id)
  WHERE status = 'ativo';

CREATE INDEX idx_cedente_fundos_cedente_status
  ON public.cedente_fundos(cedente_id, status);

CREATE INDEX idx_cedente_fundos_fundo_status
  ON public.cedente_fundos(fundo_id, status);

CREATE INDEX idx_cedente_fundos_status_vigencia
  ON public.cedente_fundos(status, vigente_desde);

CREATE TRIGGER cedente_fundos_updated_at
  BEFORE UPDATE ON public.cedente_fundos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Bridge inicial: somente cedentes com fundo_id existente.
-- cedentes.created_at é a única data histórica disponível no modelo atual.
INSERT INTO public.cedente_fundos (
  cedente_id,
  fundo_id,
  status,
  vigente_desde,
  observacoes
)
SELECT
  c.id,
  c.fundo_id,
  'ativo',
  c.created_at,
  'Backfill Fase 2 originado de cedentes.fundo_id'
FROM public.cedentes c
WHERE c.fundo_id IS NOT NULL
ON CONFLICT (cedente_id, fundo_id) WHERE status = 'ativo' DO NOTHING;

CREATE TABLE public.politicas_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'rascunho',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT politicas_operacionais_status_check
    CHECK (status IN ('rascunho', 'ativa', 'desativada')),
  CONSTRAINT politicas_operacionais_codigo_check
    CHECK (length(btrim(codigo)) > 0),
  CONSTRAINT politicas_operacionais_id_vinculo_unique
    UNIQUE (id, cedente_fundo_id),
  CONSTRAINT politicas_operacionais_vinculo_codigo_unique
    UNIQUE (cedente_fundo_id, codigo)
);

CREATE UNIQUE INDEX uq_politicas_operacionais_ativas_vinculo
  ON public.politicas_operacionais(cedente_fundo_id)
  WHERE status = 'ativa';

CREATE INDEX idx_politicas_operacionais_vinculo_status
  ON public.politicas_operacionais(cedente_fundo_id, status);

CREATE TRIGGER politicas_operacionais_updated_at
  BEFORE UPDATE ON public.politicas_operacionais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.impedir_exclusao_politica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Politica operacional nao pode ser excluida; desative-a';
END;
$$;

CREATE TRIGGER politicas_operacionais_sem_delete
  BEFORE DELETE ON public.politicas_operacionais
  FOR EACH ROW EXECUTE FUNCTION public.impedir_exclusao_politica();

CREATE TABLE public.politica_operacional_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_operacional_id uuid NOT NULL,
  cedente_fundo_id uuid NOT NULL,
  versao integer NOT NULL,
  vigente_desde timestamptz NOT NULL,
  vigente_ate timestamptz,
  aceite_sacado_obrigatorio boolean NOT NULL DEFAULT true,
  cessao_no_desembolso boolean NOT NULL DEFAULT true,
  cria_acompanhamento_entrega boolean NOT NULL DEFAULT false,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  conteudo_hash text NOT NULL,
  publicada_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  publicada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT politica_operacional_versoes_politica_fk
    FOREIGN KEY (politica_operacional_id, cedente_fundo_id)
    REFERENCES public.politicas_operacionais(id, cedente_fundo_id)
    ON DELETE RESTRICT,
  CONSTRAINT politica_operacional_versoes_versao_check
    CHECK (versao > 0),
  CONSTRAINT politica_operacional_versoes_vigencia_check
    CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde),
  CONSTRAINT politica_operacional_versoes_publicacao_check
    CHECK (publicada_em IS NULL OR publicada_por IS NOT NULL),
  CONSTRAINT politica_operacional_versoes_unique
    UNIQUE (politica_operacional_id, versao),
  CONSTRAINT politica_operacional_versoes_id_contexto_unique
    UNIQUE (id, politica_operacional_id, cedente_fundo_id)
);

CREATE INDEX idx_politica_versoes_vinculo_vigencia
  ON public.politica_operacional_versoes(cedente_fundo_id, vigente_desde);

CREATE INDEX idx_politica_versoes_politica_publicada
  ON public.politica_operacional_versoes(politica_operacional_id, publicada_em);

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
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER politica_versao_publicada_validacao
  BEFORE INSERT OR UPDATE OR DELETE ON public.politica_operacional_versoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_versao_publicada();

CREATE TABLE public.politica_requisitos_documentais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_operacional_versao_id uuid NOT NULL,
  politica_operacional_id uuid NOT NULL,
  cedente_fundo_id uuid NOT NULL,
  codigo text NOT NULL,
  escopo text NOT NULL,
  tipo_documento_codigo text NOT NULL,
  obrigatorio boolean NOT NULL DEFAULT true,
  quantidade_minima integer NOT NULL DEFAULT 1,
  formatos_aceitos text[] NOT NULL DEFAULT '{}',
  nivel_validacao text NOT NULL DEFAULT 'manual',
  prazo_dias_corridos integer,
  responsavel_upload text NOT NULL,
  responsavel_aprovacao text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT politica_requisitos_versao_fk
    FOREIGN KEY (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id)
    REFERENCES public.politica_operacional_versoes(id, politica_operacional_id, cedente_fundo_id)
    ON DELETE RESTRICT,
  CONSTRAINT politica_requisitos_escopo_check
    CHECK (escopo IN ('nf_pre_cessao', 'operacao', 'pos_cessao', 'entrega')),
  CONSTRAINT politica_requisitos_tipo_check
    CHECK (tipo_documento_codigo IN ('nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra', 'cte', 'canhoto')),
  CONSTRAINT politica_requisitos_validacao_check
    CHECK (nivel_validacao IN ('estrutural', 'manual', 'hibrido')),
  CONSTRAINT politica_requisitos_upload_check
    CHECK (responsavel_upload IN ('cedente', 'gestor', 'sacado', 'sistema')),
  CONSTRAINT politica_requisitos_aprovacao_check
    CHECK (responsavel_aprovacao IN ('cedente', 'gestor', 'sacado', 'sistema')),
  CONSTRAINT politica_requisitos_quantidade_check
    CHECK (quantidade_minima > 0),
  CONSTRAINT politica_requisitos_prazo_check
    CHECK (prazo_dias_corridos IS NULL OR prazo_dias_corridos >= 0),
  CONSTRAINT politica_requisitos_codigo_unique
    UNIQUE (politica_operacional_versao_id, codigo)
);

CREATE INDEX idx_politica_requisitos_versao_escopo
  ON public.politica_requisitos_documentais(politica_operacional_versao_id, escopo, ativo);

CREATE INDEX idx_politica_requisitos_tipo
  ON public.politica_requisitos_documentais(tipo_documento_codigo, ativo);

CREATE OR REPLACE FUNCTION public.proteger_requisito_publicado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  version_id uuid;
BEGIN
  version_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.politica_operacional_versao_id ELSE NEW.politica_operacional_versao_id END;
  IF EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes v
    WHERE v.id = version_id
      AND v.publicada_em IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Requisitos de versao publicada sao imutaveis';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER politica_requisito_publicado_immutavel
  BEFORE INSERT OR UPDATE OR DELETE ON public.politica_requisitos_documentais
  FOR EACH ROW EXECUTE FUNCTION public.proteger_requisito_publicado();

ALTER TABLE public.operacoes
  ADD COLUMN cedente_fundo_id uuid,
  ADD COLUMN politica_operacional_id uuid,
  ADD COLUMN politica_operacional_versao_id uuid,
  ADD COLUMN politica_versao integer,
  ADD COLUMN politica_snapshot jsonb,
  ADD COLUMN politica_snapshot_hash text,
  ADD COLUMN contexto_configuracao_status text,
  ADD COLUMN contexto_capturado_em timestamptz,
  ADD COLUMN aceite_sacado_exigido boolean,
  ADD COLUMN aceite_sacado_status text,
  ADD COLUMN aceite_sacado_em timestamptz,
  ADD COLUMN cessao_efetivada_em timestamptz;

-- Operacoes anteriores continuam legiveis sem inventar politica ou snapshot.
-- Quando havia fundo legado, preserva-se apenas a inferencia do vinculo backfillado.
UPDATE public.operacoes o
SET
  cedente_fundo_id = cf.id,
  contexto_configuracao_status = 'legado_inferido'
FROM public.cedente_fundos cf
WHERE o.cedente_id = cf.cedente_id
  AND cf.fundo_id = (SELECT c.fundo_id FROM public.cedentes c WHERE c.id = o.cedente_id)
  AND cf.status = 'ativo'
  AND o.contexto_configuracao_status IS NULL;

UPDATE public.operacoes
SET contexto_configuracao_status = 'legado_indefinido'
WHERE contexto_configuracao_status IS NULL;

ALTER TABLE public.operacoes
  ADD CONSTRAINT operacoes_cedente_fundo_fk
    FOREIGN KEY (cedente_fundo_id) REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  ADD CONSTRAINT operacoes_politica_contexto_fk
    FOREIGN KEY (politica_operacional_id, cedente_fundo_id)
    REFERENCES public.politicas_operacionais(id, cedente_fundo_id) ON DELETE RESTRICT,
  ADD CONSTRAINT operacoes_politica_versao_contexto_fk
    FOREIGN KEY (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id)
    REFERENCES public.politica_operacional_versoes(id, politica_operacional_id, cedente_fundo_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT operacoes_politica_versao_check
    CHECK (politica_versao IS NULL OR politica_versao > 0),
  ADD CONSTRAINT operacoes_contexto_status_check
    CHECK (contexto_configuracao_status IS NULL OR contexto_configuracao_status IN ('completo', 'legado_inferido', 'legado_indefinido')),
  ADD CONSTRAINT operacoes_aceite_status_check
    CHECK (aceite_sacado_status IS NULL OR aceite_sacado_status IN ('pendente', 'aceito', 'contestado', 'dispensado')),
  ADD CONSTRAINT operacoes_snapshot_hash_check
    CHECK (politica_snapshot IS NULL OR politica_snapshot_hash IS NOT NULL),
  ADD CONSTRAINT operacoes_contexto_completo_check
    CHECK (
      contexto_configuracao_status IS DISTINCT FROM 'completo'
      OR (
        cedente_fundo_id IS NOT NULL
        AND politica_operacional_id IS NOT NULL
        AND politica_operacional_versao_id IS NOT NULL
        AND politica_versao IS NOT NULL
        AND politica_snapshot IS NOT NULL
        AND politica_snapshot_hash IS NOT NULL
        AND contexto_capturado_em IS NOT NULL
        AND aceite_sacado_exigido IS NOT NULL
        AND aceite_sacado_status IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION public.proteger_contexto_operacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
     OR NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
     OR NEW.politica_operacional_versao_id IS DISTINCT FROM OLD.politica_operacional_versao_id
     OR NEW.politica_versao IS DISTINCT FROM OLD.politica_versao
     OR NEW.politica_snapshot IS DISTINCT FROM OLD.politica_snapshot
     OR NEW.politica_snapshot_hash IS DISTINCT FROM OLD.politica_snapshot_hash
     OR NEW.contexto_configuracao_status IS DISTINCT FROM OLD.contexto_configuracao_status
     OR NEW.contexto_capturado_em IS DISTINCT FROM OLD.contexto_capturado_em
     OR NEW.aceite_sacado_exigido IS DISTINCT FROM OLD.aceite_sacado_exigido
  THEN
    RAISE EXCEPTION 'O contexto da politica da operacao e imutavel apos sua criacao';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_contexto_immutavel
  BEFORE UPDATE ON public.operacoes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_contexto_operacao();

CREATE INDEX idx_operacoes_cedente_fundo
  ON public.operacoes(cedente_fundo_id);

CREATE INDEX idx_operacoes_politica_contexto
  ON public.operacoes(politica_operacional_id, politica_operacional_versao_id);

CREATE INDEX idx_operacoes_contexto_status
  ON public.operacoes(contexto_configuracao_status, aceite_sacado_status);

-- RLS das tabelas novas. Service role bypassa RLS para backfill e rotinas técnicas.
ALTER TABLE public.cedente_fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politicas_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_operacional_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_requisitos_documentais ENABLE ROW LEVEL SECURITY;

CREATE POLICY cedente_fundos_gestor_all ON public.cedente_fundos
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

CREATE POLICY cedente_fundos_cedente_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING (cedente_id = (SELECT get_user_cedente_id()));

CREATE POLICY cedente_fundos_consultor_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.cedente_id = cedente_fundos.cedente_id
    )
  );

CREATE POLICY politicas_operacionais_gestor_all ON public.politicas_operacionais
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

CREATE POLICY politicas_operacionais_vinculo_select ON public.politicas_operacionais
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = politicas_operacionais.cedente_fundo_id
        AND (
          cf.cedente_id = (SELECT get_user_cedente_id())
          OR (
            (SELECT get_user_role()) = 'consultor'
            AND EXISTS (
              SELECT 1 FROM public.consultor_cedente cc
              WHERE cc.consultor_id = (SELECT auth.uid())
                AND cc.cedente_id = cf.cedente_id
            )
          )
        )
    )
  );

CREATE POLICY politica_operacional_versoes_gestor_all ON public.politica_operacional_versoes
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

CREATE POLICY politica_operacional_versoes_vinculo_select ON public.politica_operacional_versoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = politica_operacional_versoes.cedente_fundo_id
        AND (
          cf.cedente_id = (SELECT get_user_cedente_id())
          OR (
            (SELECT get_user_role()) = 'consultor'
            AND EXISTS (
              SELECT 1 FROM public.consultor_cedente cc
              WHERE cc.consultor_id = (SELECT auth.uid())
                AND cc.cedente_id = cf.cedente_id
            )
          )
        )
    )
  );

CREATE POLICY politica_requisitos_gestor_all ON public.politica_requisitos_documentais
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

CREATE POLICY politica_requisitos_vinculo_select ON public.politica_requisitos_documentais
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = politica_requisitos_documentais.cedente_fundo_id
        AND (
          cf.cedente_id = (SELECT get_user_cedente_id())
          OR (
            (SELECT get_user_role()) = 'consultor'
            AND EXISTS (
              SELECT 1 FROM public.consultor_cedente cc
              WHERE cc.consultor_id = (SELECT auth.uid())
                AND cc.cedente_id = cf.cedente_id
            )
          )
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cedente_fundos,
     public.politicas_operacionais,
     public.politica_operacional_versoes,
     public.politica_requisitos_documentais
  TO authenticated;

GRANT ALL
  ON public.cedente_fundos,
     public.politicas_operacionais,
     public.politica_operacional_versoes,
     public.politica_requisitos_documentais
  TO service_role;
