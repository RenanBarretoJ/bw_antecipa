-- Refatoracao incremental: politicas operacionais passam a ser catalogo do fundo.
--
-- Compatibilidade:
-- - Mantem colunas legadas cedente_fundo_id em politicas/versoes/requisitos quando
--   ja existirem, mas deixa de usa-las como fonte de verdade para novas resolucoes.
-- - Operacoes antigas continuam apontando para os mesmos IDs e preservam snapshot.
-- - A aplicacao de uma politica a um cedente_fundo passa a ser registrada em
--   cedente_fundo_politicas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.politicas_operacionais
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS padrao boolean NOT NULL DEFAULT false;

UPDATE public.politicas_operacionais po
SET fundo_id = cf.fundo_id
FROM public.cedente_fundos cf
WHERE po.cedente_fundo_id = cf.id
  AND po.fundo_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.politicas_operacionais
    WHERE fundo_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Nao foi possivel resolver fundo_id para todas as politicas operacionais existentes.';
  END IF;

  ALTER TABLE public.politicas_operacionais
    ALTER COLUMN fundo_id SET NOT NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Codigos antes eram unicos por cedente_fundo. No catalogo passam a ser
-- unicos por fundo; duplicidades legadas recebem sufixo antes da constraint.
WITH ranked_codes AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY fundo_id, codigo ORDER BY created_at ASC, id ASC) AS rn
  FROM public.politicas_operacionais
)
UPDATE public.politicas_operacionais po
SET codigo = left(po.codigo, 48) || '-legado-' || left(po.id::text, 8),
    updated_at = now()
FROM ranked_codes rc
WHERE rc.id = po.id
  AND rc.rn > 1
  AND po.codigo !~ '-legado-[0-9a-f]{8}$';

ALTER TABLE IF EXISTS public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS regras jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS substituida_em timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.politica_operacional_versoes pov
SET fundo_id = po.fundo_id,
    status = CASE
      WHEN pov.publicada_em IS NOT NULL AND pov.vigente_ate IS NULL THEN 'publicada'
      WHEN pov.publicada_em IS NOT NULL AND pov.vigente_ate IS NOT NULL THEN 'substituida'
      ELSE COALESCE(NULLIF(pov.status, ''), 'rascunho')
    END,
    regras = CASE
      WHEN pov.configuracao ? 'fluxo_operacional' THEN jsonb_build_object('fluxo_operacional', pov.configuracao->'fluxo_operacional')
      ELSE '{}'::jsonb
    END,
    parametros = COALESCE(pov.configuracao, '{}'::jsonb)
FROM public.politicas_operacionais po
WHERE pov.politica_operacional_id = po.id
  AND (pov.fundo_id IS NULL OR pov.status = 'rascunho');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.politica_operacional_versoes WHERE fundo_id IS NULL) THEN
    RAISE EXCEPTION 'Nao foi possivel resolver fundo_id para todas as versoes de politica existentes.';
  END IF;

  ALTER TABLE public.politica_operacional_versoes
    ALTER COLUMN fundo_id SET NOT NULL;
END;
$$;

ALTER TABLE IF EXISTS public.politica_requisitos_documentais
  ADD COLUMN IF NOT EXISTS fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS momento_obrigatorio text,
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS bloqueia_fluxo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS observacoes text;

UPDATE public.politica_requisitos_documentais pr
SET fundo_id = po.fundo_id,
    momento_obrigatorio = COALESCE(pr.momento_obrigatorio, pr.escopo),
    categoria = COALESCE(pr.categoria, pr.escopo),
    bloqueia_fluxo = COALESCE(pr.bloqueia_fluxo, pr.obrigatorio)
FROM public.politicas_operacionais po
WHERE pr.politica_operacional_id = po.id
  AND pr.fundo_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes pov
    WHERE pov.id = pr.politica_operacional_versao_id
      AND pov.publicada_em IS NOT NULL
  );

-- Requisitos de versoes ja publicadas sao imutaveis por trigger
-- (proteger_requisito_publicado). Por isso, registros legados publicados nao
-- sao atualizados aqui. Novas versoes passam a nascer com fundo_id preenchido
-- pela aplicacao, e as funcoes usam a versao/politica como contexto canonico.

-- Relaxa FKs compostas legadas para permitir catalogo por fundo.
ALTER TABLE IF EXISTS public.operacoes
  DROP CONSTRAINT IF EXISTS operacoes_politica_versao_contexto_fk,
  DROP CONSTRAINT IF EXISTS operacoes_politica_contexto_fk;

ALTER TABLE IF EXISTS public.politica_requisitos_documentais
  DROP CONSTRAINT IF EXISTS politica_requisitos_versao_fk;

ALTER TABLE IF EXISTS public.politica_operacional_versoes
  DROP CONSTRAINT IF EXISTS politica_operacional_versoes_politica_fk;

ALTER TABLE IF EXISTS public.politicas_operacionais
  DROP CONSTRAINT IF EXISTS politicas_operacionais_id_vinculo_unique,
  DROP CONSTRAINT IF EXISTS politicas_operacionais_vinculo_codigo_unique,
  DROP CONSTRAINT IF EXISTS politicas_operacionais_status_check;

DROP INDEX IF EXISTS public.uq_politicas_operacionais_ativas_vinculo;

ALTER TABLE public.politicas_operacionais
  ADD CONSTRAINT politicas_operacionais_status_check
    CHECK (status IN ('rascunho', 'ativa', 'arquivada', 'desativada'));

DO $$
BEGIN
  ALTER TABLE public.politicas_operacionais
    ADD CONSTRAINT politicas_operacionais_fundo_codigo_unique UNIQUE (fundo_id, codigo);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_politicas_operacionais_padrao_fundo
  ON public.politicas_operacionais(fundo_id)
  WHERE padrao = true AND status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_politicas_operacionais_fundo_status
  ON public.politicas_operacionais(fundo_id, status);

ALTER TABLE IF EXISTS public.politica_operacional_versoes
  DROP CONSTRAINT IF EXISTS politica_operacional_versoes_status_check;

ALTER TABLE public.politica_operacional_versoes
  ADD CONSTRAINT politica_operacional_versoes_status_check
    CHECK (status IN ('rascunho', 'publicada', 'substituida', 'arquivada'));

DO $$
BEGIN
  ALTER TABLE public.politica_operacional_versoes
    ADD CONSTRAINT politica_operacional_versoes_politica_fk
    FOREIGN KEY (politica_operacional_id)
    REFERENCES public.politicas_operacionais(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.politica_requisitos_documentais
    ADD CONSTRAINT politica_requisitos_versao_fk
    FOREIGN KEY (politica_operacional_versao_id)
    REFERENCES public.politica_operacional_versoes(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.politica_requisitos_documentais
    ADD CONSTRAINT politica_requisitos_politica_fk
    FOREIGN KEY (politica_operacional_id)
    REFERENCES public.politicas_operacionais(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.operacoes
    ADD CONSTRAINT operacoes_politica_contexto_fk
    FOREIGN KEY (politica_operacional_id)
    REFERENCES public.politicas_operacionais(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.operacoes
    ADD CONSTRAINT operacoes_politica_versao_contexto_fk
    FOREIGN KEY (politica_operacional_versao_id)
    REFERENCES public.politica_operacional_versoes(id)
    ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cedente_fundo_politicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  politica_operacional_id uuid NOT NULL REFERENCES public.politicas_operacionais(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ativa',
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_ate timestamptz,
  atribuido_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cedente_fundo_politicas_status_check
    CHECK (status IN ('ativa', 'encerrada')),
  CONSTRAINT cedente_fundo_politicas_vigencia_check
    CHECK (vigente_ate IS NULL OR vigente_ate > vigente_desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cedente_fundo_politicas_ativa
  ON public.cedente_fundo_politicas(cedente_fundo_id)
  WHERE status = 'ativa' AND vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_cedente_fundo_politicas_vinculo
  ON public.cedente_fundo_politicas(cedente_fundo_id, status, vigente_desde DESC);

CREATE INDEX IF NOT EXISTS idx_cedente_fundo_politicas_politica
  ON public.cedente_fundo_politicas(politica_operacional_id, status);

CREATE OR REPLACE FUNCTION public.validar_cedente_fundo_politica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fundo_id uuid;
  v_vinculo_status text;
  v_politica_fundo_id uuid;
  v_politica_status text;
BEGIN
  SELECT fundo_id, status INTO v_fundo_id, v_vinculo_status
  FROM public.cedente_fundos
  WHERE id = NEW.cedente_fundo_id;

  IF v_fundo_id IS NULL THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado.';
  END IF;

  SELECT fundo_id, status INTO v_politica_fundo_id, v_politica_status
  FROM public.politicas_operacionais
  WHERE id = NEW.politica_operacional_id;

  IF v_politica_fundo_id IS NULL THEN
    RAISE EXCEPTION 'Politica operacional nao encontrada.';
  END IF;

  IF v_politica_fundo_id <> v_fundo_id THEN
    RAISE EXCEPTION 'Politica operacional pertence a outro fundo.';
  END IF;

  IF NEW.status <> 'ativa' THEN
    RETURN NEW;
  END IF;

  IF v_vinculo_status <> 'ativo' THEN
    RAISE EXCEPTION 'Somente vinculos cedente-fundo ativos podem receber politica operacional.';
  END IF;

  IF v_politica_status <> 'ativa' THEN
    RAISE EXCEPTION 'Somente politicas ativas podem ser vinculadas ao cedente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes v
    WHERE v.politica_operacional_id = NEW.politica_operacional_id
      AND v.status = 'publicada'
      AND v.publicada_em IS NOT NULL
      AND v.vigente_ate IS NULL
  ) THEN
    RAISE EXCEPTION 'Politica operacional nao possui versao publicada vigente.';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.cedente_fundo_politicas atual
       WHERE atual.cedente_fundo_id = NEW.cedente_fundo_id
         AND atual.id <> COALESCE(NEW.id, gen_random_uuid())
         AND atual.status = 'ativa'
         AND tstzrange(atual.vigente_desde, COALESCE(atual.vigente_ate, 'infinity'::timestamptz), '[)')
             && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
     ) THEN
    RAISE EXCEPTION 'Ja existe politica operacional vigente neste periodo para o vinculo.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cedente_fundo_politicas_validacao ON public.cedente_fundo_politicas;
CREATE TRIGGER cedente_fundo_politicas_validacao
  BEFORE INSERT OR UPDATE ON public.cedente_fundo_politicas
  FOR EACH ROW EXECUTE FUNCTION public.validar_cedente_fundo_politica();

DROP TRIGGER IF EXISTS cedente_fundo_politicas_updated_at ON public.cedente_fundo_politicas;
CREATE TRIGGER cedente_fundo_politicas_updated_at
  BEFORE UPDATE ON public.cedente_fundo_politicas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Backfill: vinculos existentes passam a apontar explicitamente para a politica
-- canonica do proprio fundo quando houver politicas identicas. Nao altera
-- operacoes antigas nem snapshots; politicas duplicadas ficam arquivadas
-- somente para impedir novas atribuicoes diretas.
CREATE TEMP TABLE IF NOT EXISTS tmp_politicas_catalogo_dedup ON COMMIT DROP AS
WITH current_versions AS (
  SELECT DISTINCT ON (pov.politica_operacional_id)
    pov.politica_operacional_id,
    pov.id AS versao_id,
    pov.configuracao,
    pov.aceite_sacado_obrigatorio,
    pov.cessao_no_desembolso,
    pov.cria_acompanhamento_entrega
  FROM public.politica_operacional_versoes pov
  ORDER BY pov.politica_operacional_id, pov.publicada_em DESC NULLS LAST, pov.versao DESC
),
requirements AS (
  SELECT
    pr.politica_operacional_versao_id,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'codigo', pr.codigo,
        'escopo', pr.escopo,
        'tipo_documento_codigo', pr.tipo_documento_codigo,
        'obrigatorio', pr.obrigatorio,
        'quantidade_minima', pr.quantidade_minima,
        'formatos_aceitos', pr.formatos_aceitos,
        'nivel_validacao', pr.nivel_validacao,
        'prazo_dias_corridos', pr.prazo_dias_corridos,
        'responsavel_upload', pr.responsavel_upload,
        'responsavel_aprovacao', pr.responsavel_aprovacao,
        'momento_obrigatorio', pr.momento_obrigatorio,
        'categoria', pr.categoria,
        'bloqueia_fluxo', pr.bloqueia_fluxo
      ))
      ORDER BY pr.codigo, pr.escopo, pr.tipo_documento_codigo
    ) AS requisitos_normalizados
  FROM public.politica_requisitos_documentais pr
  WHERE pr.ativo = true
  GROUP BY pr.politica_operacional_versao_id
),
hashes AS (
  SELECT
    po.id AS original_id,
    po.fundo_id,
    encode(digest(
      jsonb_build_object(
        'versao', jsonb_build_object(
          'configuracao', COALESCE(cv.configuracao, '{}'::jsonb),
          'aceite_sacado_obrigatorio', cv.aceite_sacado_obrigatorio,
          'cessao_no_desembolso', cv.cessao_no_desembolso,
          'cria_acompanhamento_entrega', cv.cria_acompanhamento_entrega
        ),
        'requisitos', COALESCE(r.requisitos_normalizados, '[]'::jsonb)
      )::text,
      'sha256'
    ), 'hex') AS conteudo_hash
  FROM public.politicas_operacionais po
  LEFT JOIN current_versions cv ON cv.politica_operacional_id = po.id
  LEFT JOIN requirements r ON r.politica_operacional_versao_id = cv.versao_id
  WHERE po.status = 'ativa'
),
canonicas AS (
  SELECT
    original_id,
    first_value(original_id) OVER (
      PARTITION BY fundo_id, conteudo_hash
      ORDER BY original_id ASC
    ) AS canonica_id,
    conteudo_hash
  FROM hashes
)
SELECT * FROM canonicas;

INSERT INTO public.cedente_fundo_politicas (
  cedente_fundo_id,
  politica_operacional_id,
  status,
  vigente_desde,
  atribuido_por,
  motivo
)
SELECT
  po.cedente_fundo_id,
  COALESCE(d.canonica_id, po.id),
  'ativa',
  COALESCE(v.publicada_em, po.created_at, now()),
  po.created_by,
  CASE
    WHEN d.canonica_id IS NOT NULL AND d.canonica_id <> po.id
      THEN 'Backfill: politica ativa existente vinculada a politica canonica equivalente do fundo.'
    ELSE 'Backfill: politica ativa existente migrada para vinculo explicito.'
  END
FROM public.politicas_operacionais po
LEFT JOIN tmp_politicas_catalogo_dedup d ON d.original_id = po.id
LEFT JOIN LATERAL (
  SELECT publicada_em
  FROM public.politica_operacional_versoes pov
  WHERE pov.politica_operacional_id = COALESCE(d.canonica_id, po.id)
    AND pov.publicada_em IS NOT NULL
  ORDER BY pov.versao DESC
  LIMIT 1
) v ON true
WHERE po.status = 'ativa'
  AND po.cedente_fundo_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.cedente_fundo_politicas cfp
    WHERE cfp.cedente_fundo_id = po.cedente_fundo_id
      AND cfp.status = 'ativa'
      AND cfp.vigente_ate IS NULL
  );

UPDATE public.politicas_operacionais po
SET status = 'arquivada',
    padrao = false,
    updated_at = now()
FROM tmp_politicas_catalogo_dedup d
WHERE po.id = d.original_id
  AND d.canonica_id <> d.original_id
  AND po.status = 'ativa';

-- Define padrao apenas quando ha uma unica politica ativa por fundo.
WITH active_counts AS (
  SELECT fundo_id, count(*) AS total, min(id::text)::uuid AS politica_id
  FROM public.politicas_operacionais
  WHERE status = 'ativa'
  GROUP BY fundo_id
)
UPDATE public.politicas_operacionais po
SET padrao = true
FROM active_counts ac
WHERE po.id = ac.politica_id
  AND ac.total = 1
  AND po.padrao = false;

CREATE OR REPLACE FUNCTION public.obter_politica_aplicavel_cedente_fundo(
  p_cedente_fundo_id uuid,
  p_data_referencia timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_vinculo public.cedente_fundos%ROWTYPE;
  v_atribuicao public.cedente_fundo_politicas%ROWTYPE;
  v_politica public.politicas_operacionais%ROWTYPE;
  v_versao public.politica_operacional_versoes%ROWTYPE;
  v_requisitos jsonb;
BEGIN
  SELECT * INTO v_vinculo
  FROM public.cedente_fundos
  WHERE id = p_cedente_fundo_id
    AND status = 'ativo';

  IF v_vinculo.id IS NULL THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo ativo nao encontrado.';
  END IF;

  SELECT * INTO v_atribuicao
  FROM public.cedente_fundo_politicas cfp
  WHERE cfp.cedente_fundo_id = p_cedente_fundo_id
    AND cfp.status = 'ativa'
    AND cfp.vigente_desde <= p_data_referencia
    AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > p_data_referencia)
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF v_atribuicao.id IS NULL THEN
    RAISE EXCEPTION 'Politica operacional pendente para este vinculo cedente-fundo.';
  END IF;

  SELECT * INTO v_politica
  FROM public.politicas_operacionais
  WHERE id = v_atribuicao.politica_operacional_id
    AND fundo_id = v_vinculo.fundo_id
    AND status = 'ativa';

  IF v_politica.id IS NULL THEN
    RAISE EXCEPTION 'Politica operacional vinculada nao esta ativa ou pertence a outro fundo.';
  END IF;

  SELECT * INTO v_versao
  FROM public.politica_operacional_versoes pov
  WHERE pov.politica_operacional_id = v_politica.id
    AND pov.fundo_id = v_vinculo.fundo_id
    AND pov.status = 'publicada'
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_desde <= p_data_referencia
    AND (pov.vigente_ate IS NULL OR pov.vigente_ate > p_data_referencia)
  ORDER BY pov.versao DESC
  LIMIT 1;

  IF v_versao.id IS NULL THEN
    RAISE EXCEPTION 'Politica operacional nao possui versao publicada vigente.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(req) ORDER BY req.ordem, req.codigo), '[]'::jsonb)
  INTO v_requisitos
  FROM public.politica_requisitos_documentais req
  WHERE req.politica_operacional_versao_id = v_versao.id
    AND req.ativo = true;

  RETURN jsonb_build_object(
    'cedente_fundo', to_jsonb(v_vinculo),
    'atribuicao', to_jsonb(v_atribuicao),
    'politica', to_jsonb(v_politica),
    'versao', to_jsonb(v_versao),
    'requisitos', v_requisitos
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_status_versao_politica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.publicada_em IS NOT NULL AND NEW.vigente_ate IS NULL THEN
    NEW.status := 'publicada';
  ELSIF NEW.publicada_em IS NOT NULL AND NEW.vigente_ate IS NOT NULL THEN
    NEW.status := 'substituida';
    NEW.substituida_em := COALESCE(NEW.substituida_em, NEW.vigente_ate);
  ELSIF NEW.publicada_em IS NULL THEN
    NEW.status := COALESCE(NULLIF(NEW.status, ''), 'rascunho');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS politica_versao_status_sync ON public.politica_operacional_versoes;
CREATE TRIGGER politica_versao_status_sync
  BEFORE INSERT OR UPDATE ON public.politica_operacional_versoes
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_status_versao_politica();

ALTER TABLE public.cedente_fundo_politicas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cedente_fundo_politicas_gestor_all ON public.cedente_fundo_politicas;
CREATE POLICY cedente_fundo_politicas_gestor_all ON public.cedente_fundo_politicas
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

DROP POLICY IF EXISTS cedente_fundo_politicas_cedente_select ON public.cedente_fundo_politicas;
CREATE POLICY cedente_fundo_politicas_cedente_select ON public.cedente_fundo_politicas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = cedente_fundo_politicas.cedente_fundo_id
        AND cf.cedente_id = (SELECT get_user_cedente_id())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cedente_fundo_politicas TO authenticated;
GRANT ALL ON public.cedente_fundo_politicas TO service_role;
REVOKE ALL ON FUNCTION public.obter_politica_aplicavel_cedente_fundo(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obter_politica_aplicavel_cedente_fundo(uuid, timestamptz) TO authenticated;

ALTER TABLE public.operacoes
  ADD COLUMN IF NOT EXISTS politica_atribuicao_id uuid REFERENCES public.cedente_fundo_politicas(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_operacoes_politica_atribuicao
  ON public.operacoes(politica_atribuicao_id);

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
  p_cedente_id uuid,
  p_cedente_fundo_id uuid,
  p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid,
  p_politica_versao integer,
  p_politica_snapshot jsonb,
  p_politica_snapshot_hash text,
  p_aceite_sacado_exigido boolean,
  p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[],
  p_valor_bruto_total numeric,
  p_taxa_desconto numeric,
  p_prazo_dias integer,
  p_valor_liquido_desembolso numeric,
  p_data_vencimento date,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  cedente_row record;
  vinculo_row record;
  escrow_row record;
  existing_op record;
  expected_count integer;
  matched_count integer;
  already_linked_count integer;
  inserted_op_id uuid;
  now_ts timestamptz := now();
  politica_atribuicao_row record;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF actor_role <> 'cedente' THEN
    RAISE EXCEPTION 'Somente cedente pode solicitar antecipacao';
  END IF;

  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma NF';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN
    RAISE EXCEPTION 'Chave de idempotencia invalida';
  END IF;

  SELECT * INTO existing_op
  FROM public.operacoes
  WHERE solicitacao_idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'operacao_id', existing_op.id,
      'idempotent_replay', true,
      'status', existing_op.status
    );
  END IF;

  SELECT * INTO cedente_row
  FROM public.cedentes
  WHERE id = p_cedente_id
    AND user_id = actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastro de cedente nao encontrado para o usuario autenticado';
  END IF;

  IF cedente_row.status <> 'ativo' THEN
    RAISE EXCEPTION 'Cedente nao esta ativo';
  END IF;

  SELECT * INTO vinculo_row
  FROM public.cedente_fundos
  WHERE id = p_cedente_fundo_id
    AND cedente_id = p_cedente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado';
  END IF;

  IF vinculo_row.status <> 'ativo' THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.fundos f
    WHERE f.id = vinculo_row.fundo_id
      AND coalesce(f.ativo, true) = true
  ) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;

  SELECT cfp.*
  INTO politica_atribuicao_row
  FROM public.cedente_fundo_politicas cfp
  JOIN public.politicas_operacionais p
    ON p.id = cfp.politica_operacional_id
  JOIN public.politica_operacional_versoes v
    ON v.id = p_politica_operacional_versao_id
   AND v.politica_operacional_id = p.id
  WHERE cfp.cedente_fundo_id = p_cedente_fundo_id
    AND cfp.politica_operacional_id = p_politica_operacional_id
    AND cfp.status = 'ativa'
    AND cfp.vigente_desde <= now_ts
    AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now_ts)
    AND p.fundo_id = vinculo_row.fundo_id
    AND p.status = 'ativa'
    AND v.fundo_id = vinculo_row.fundo_id
    AND v.publicada_em IS NOT NULL
    AND v.publicada_por IS NOT NULL
    AND v.vigente_ate IS NULL
    AND v.versao = p_politica_versao
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF politica_atribuicao_row.id IS NULL THEN
    RAISE EXCEPTION 'Politica operacional vigente nao vinculada ao cedente-fundo';
  END IF;

  SELECT * INTO escrow_row
  FROM public.contas_escrow
  WHERE cedente_id = p_cedente_id
    AND status = 'ativa'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta escrow nao encontrada ou inativa';
  END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);

  WITH locked_nfs AS (
    SELECT nf.id
    FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
      AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count
  FROM locked_nfs;

  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas';
  END IF;

  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids);

  IF already_linked_count > 0 THEN
    RAISE EXCEPTION 'Uma ou mais NFs ja estao vinculadas a uma operacao';
  END IF;

  INSERT INTO public.operacoes (
    cedente_id,
    conta_escrow_id,
    valor_bruto_total,
    taxa_desconto,
    prazo_dias,
    valor_liquido_desembolso,
    data_vencimento,
    status,
    cedente_fundo_id,
    politica_operacional_id,
    politica_operacional_versao_id,
    politica_atribuicao_id,
    politica_versao,
    politica_snapshot,
    politica_snapshot_hash,
    contexto_configuracao_status,
    contexto_capturado_em,
    aceite_sacado_exigido,
    aceite_sacado_status,
    aceite_sacado_em,
    cessao_efetivada_em,
    solicitacao_idempotency_key
  )
  VALUES (
    p_cedente_id,
    escrow_row.id,
    p_valor_bruto_total,
    p_taxa_desconto,
    p_prazo_dias,
    greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento,
    'solicitada',
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    politica_atribuicao_row.id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    'completo',
    now_ts,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END,
    NULL,
    p_idempotency_key
  )
  RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  UPDATE public.notas_fiscais
  SET status = 'em_antecipacao'
  WHERE id = ANY(p_nota_fiscal_ids)
    AND cedente_id = p_cedente_id
    AND cedente_fundo_id = p_cedente_fundo_id;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count <> expected_count THEN
    RAISE EXCEPTION 'Falha ao atualizar todas as NFs da operacao';
  END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_depois
  )
  VALUES (
    actor_id,
    'OPERACAO_SOLICITADA',
    'operacoes',
    inserted_op_id,
    jsonb_build_object(
      'valor_bruto_total', p_valor_bruto_total,
      'taxa_desconto', p_taxa_desconto,
      'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids,
      'cedente_fundo_id', p_cedente_fundo_id,
      'politica_atribuicao_id', politica_atribuicao_row.id,
      'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', inserted_op_id,
    'idempotent_replay', false,
    'status', 'solicitada',
    'politica_atribuicao_id', politica_atribuicao_row.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  version_number integer;
  inserted_count integer;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  SELECT pov.versao
    INTO version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundo_politicas cfp
    ON cfp.politica_operacional_id = po.id
   AND cfp.cedente_fundo_id = nf_cedente_fundo
   AND cfp.status = 'ativa'
   AND cfp.vigente_desde <= now()
   AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND po.fundo_id = nf_fundo
    AND po.status = 'ativa'
    AND pov.fundo_id = nf_fundo
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_ate IS NULL
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF version_number IS NULL THEN
    RAISE EXCEPTION 'Politica operacional publicada nao vinculada ao contexto da NF';
  END IF;

  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id,
    cedente_id, cedente_fundo_id, status, obrigatorio, prazo_limite, formatos_aceitos_snapshot,
    nivel_validacao_snapshot, quantidade_minima_snapshot, responsavel_upload_snapshot,
    responsavel_aprovacao_snapshot
  )
  SELECT r.id, r.politica_operacional_id, r.politica_operacional_versao_id, version_number,
    r.documento_tipo_id, r.tipo_documento_codigo, r.escopo, p_nota_fiscal_id,
    nf_cedente, nf_cedente_fundo, 'pendente', r.obrigatorio,
    CASE WHEN r.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + r.prazo_dias_corridos) END,
    r.formatos_aceitos, r.nivel_validacao, r.quantidade_minima,
    r.responsavel_upload, r.responsavel_aprovacao
  FROM public.politica_requisitos_documentais r
  WHERE r.politica_operacional_versao_id = p_politica_versao_id
    AND r.escopo = 'nf_pre_cessao'
    AND r.ativo
  ON CONFLICT (politica_requisito_id, nota_fiscal_id) DO UPDATE
    SET cedente_fundo_id = COALESCE(documento_requisito_instancias.cedente_fundo_id, EXCLUDED.cedente_fundo_id),
        documento_tipo_id = COALESCE(documento_requisito_instancias.documento_tipo_id, EXCLUDED.documento_tipo_id);

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'inseridos', inserted_count,
    'politica_versao', version_number,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;
