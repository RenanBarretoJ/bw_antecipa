-- Refatoracao do onboarding de cedentes sem fundo.
--
-- Objetivo:
-- - manter cedentes como cadastro global;
-- - tornar cedente_fundos a unica fonte de verdade operacional;
-- - migrar dados legados de cedentes.fundo_id para cedente_fundos apenas quando
--   nao houver ambiguidade;
-- - produzir relatorio de divergencias sem alterar/remover cedentes.fundo_id.

ALTER TABLE IF EXISTS public.logs_auditoria
  ALTER COLUMN usuario_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.logs_auditoria
  ADD COLUMN IF NOT EXISTS ator_tipo text NOT NULL DEFAULT 'usuario',
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'server_action',
  ADD COLUMN IF NOT EXISTS ator_identificador text;

CREATE TABLE IF NOT EXISTS public.cedente_fundo_migracao_legado_relatorio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE CASCADE,
  fundo_legado_id uuid,
  status text NOT NULL CHECK (status IN (
    'migrado',
    'ja_existia',
    'ambiguidade_vinculo_ativo',
    'fundo_legado_inexistente',
    'fundo_legado_inativo'
  )),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cedente_fundo_migracao_legado_relatorio
  ON public.cedente_fundo_migracao_legado_relatorio(cedente_id, (COALESCE(fundo_legado_id, '00000000-0000-0000-0000-000000000000'::uuid)), status);

ALTER TABLE public.cedente_fundo_migracao_legado_relatorio ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.cedente_fundo_migracao_legado_relatorio TO authenticated;
GRANT ALL ON public.cedente_fundo_migracao_legado_relatorio TO service_role;

DROP POLICY IF EXISTS cedente_fundo_migracao_relatorio_gestor_select ON public.cedente_fundo_migracao_legado_relatorio;
CREATE POLICY cedente_fundo_migracao_relatorio_gestor_select
  ON public.cedente_fundo_migracao_legado_relatorio
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'gestor');

WITH legado AS (
  SELECT
    c.id AS cedente_id,
    c.fundo_id AS fundo_legado_id,
    f.id AS fundo_existente_id,
    f.ativo AS fundo_ativo,
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = c.id
        AND cf.fundo_id = c.fundo_id
        AND cf.status = 'ativo'
    ) AS ja_tem_mesmo_vinculo,
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = c.id
        AND cf.fundo_id IS DISTINCT FROM c.fundo_id
        AND cf.status = 'ativo'
    ) AS tem_outro_vinculo_ativo
  FROM public.cedentes c
  LEFT JOIN public.fundos f ON f.id = c.fundo_id
  WHERE c.fundo_id IS NOT NULL
),
relatorio AS (
  SELECT
    cedente_id,
    fundo_legado_id,
    CASE
      WHEN fundo_existente_id IS NULL THEN 'fundo_legado_inexistente'
      WHEN COALESCE(fundo_ativo, false) IS NOT TRUE THEN 'fundo_legado_inativo'
      WHEN ja_tem_mesmo_vinculo THEN 'ja_existia'
      WHEN tem_outro_vinculo_ativo THEN 'ambiguidade_vinculo_ativo'
      ELSE 'migrado'
    END AS status,
    jsonb_build_object(
      'origem', 'migracao_legado',
      'fundo_existente', fundo_existente_id IS NOT NULL,
      'fundo_ativo', fundo_ativo,
      'ja_tem_mesmo_vinculo', ja_tem_mesmo_vinculo,
      'tem_outro_vinculo_ativo', tem_outro_vinculo_ativo
    ) AS detalhes
  FROM legado
)
INSERT INTO public.cedente_fundo_migracao_legado_relatorio (cedente_id, fundo_legado_id, status, detalhes)
SELECT cedente_id, fundo_legado_id, status, detalhes
FROM relatorio
ON CONFLICT DO NOTHING;

WITH candidatos AS (
  SELECT
    c.id AS cedente_id,
    c.fundo_id AS fundo_id
  FROM public.cedentes c
  JOIN public.fundos f ON f.id = c.fundo_id
  WHERE c.fundo_id IS NOT NULL
    AND COALESCE(f.ativo, false) IS TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = c.id
        AND cf.status = 'ativo'
    )
)
INSERT INTO public.cedente_fundos (
  cedente_id,
  fundo_id,
  status,
  vigente_desde,
  observacoes
)
SELECT
  cedente_id,
  fundo_id,
  'ativo',
  now(),
  'migracao_legado: criado a partir de cedentes.fundo_id sem ambiguidade'
FROM candidatos
ON CONFLICT DO NOTHING;

INSERT INTO public.logs_auditoria (
  usuario_id,
  ator_tipo,
  origem,
  tipo_evento,
  entidade_tipo,
  entidade_id,
  dados_depois
)
SELECT
  NULL,
  'sistema',
  'migration',
  'cedente_fundos_migracao_legado',
  'cedente_fundos',
  NULL,
  jsonb_build_object(
    'migrados', COUNT(*) FILTER (WHERE status = 'migrado'),
    'ja_existia', COUNT(*) FILTER (WHERE status = 'ja_existia'),
    'ambiguidade_vinculo_ativo', COUNT(*) FILTER (WHERE status = 'ambiguidade_vinculo_ativo'),
    'fundo_legado_inexistente', COUNT(*) FILTER (WHERE status = 'fundo_legado_inexistente'),
    'fundo_legado_inativo', COUNT(*) FILTER (WHERE status = 'fundo_legado_inativo')
  )
FROM public.cedente_fundo_migracao_legado_relatorio r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.logs_auditoria la
  WHERE la.tipo_evento = 'cedente_fundos_migracao_legado'
    AND la.entidade_tipo = 'cedente_fundos'
    AND la.origem = 'migration'
);
