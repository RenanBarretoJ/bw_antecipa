-- Corrige a leitura da politica operacional no modelo catalogado por fundo.
--
-- Contexto:
-- - No modelo antigo, politica_operacional_versoes.cedente_fundo_id era a
--   ponte usada pelas policies de SELECT do cedente.
-- - No modelo atual, a politica e suas versoes pertencem ao fundo, e a
--   aplicacao ao cedente ocorre por public.cedente_fundo_politicas.
-- - Versoes publicadas podem ter cedente_fundo_id NULL, portanto a policy
--   antiga escondia a versao vigente do proprio cedente e bloqueava a
--   solicitacao de antecipacao com "sem politica operacional definida".

ALTER TABLE public.politica_operacional_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_requisitos_documentais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS politica_operacional_versoes_vinculo_select ON public.politica_operacional_versoes;
CREATE POLICY politica_operacional_versoes_vinculo_select
  ON public.politica_operacional_versoes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'gestor'
    OR EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = politica_operacional_versoes.politica_operacional_id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE cf.fundo_id = politica_operacional_versoes.fundo_id
        AND cf.status = 'ativo'
        AND cf.cedente_id = (SELECT get_user_cedente_id())
    )
    OR (
      (SELECT get_user_role()) = 'consultor'
      AND EXISTS (
        SELECT 1
        FROM public.cedente_fundos cf
        JOIN public.cedente_fundo_politicas cfp
          ON cfp.cedente_fundo_id = cf.id
         AND cfp.politica_operacional_id = politica_operacional_versoes.politica_operacional_id
         AND cfp.status = 'ativa'
         AND cfp.vigente_desde <= now()
         AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
        JOIN public.consultor_cedente cc
          ON cc.cedente_id = cf.cedente_id
         AND cc.consultor_id = (SELECT auth.uid())
        WHERE cf.fundo_id = politica_operacional_versoes.fundo_id
          AND cf.status = 'ativo'
      )
    )
  );

DROP POLICY IF EXISTS politica_requisitos_vinculo_select ON public.politica_requisitos_documentais;
CREATE POLICY politica_requisitos_vinculo_select
  ON public.politica_requisitos_documentais
  FOR SELECT
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'gestor'
    OR EXISTS (
      SELECT 1
      FROM public.politica_operacional_versoes pov
      JOIN public.cedente_fundos cf
        ON cf.fundo_id = pov.fundo_id
       AND cf.status = 'ativo'
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = pov.politica_operacional_id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE pov.id = politica_requisitos_documentais.politica_operacional_versao_id
        AND cf.cedente_id = (SELECT get_user_cedente_id())
    )
    OR (
      (SELECT get_user_role()) = 'consultor'
      AND EXISTS (
        SELECT 1
        FROM public.politica_operacional_versoes pov
        JOIN public.cedente_fundos cf
          ON cf.fundo_id = pov.fundo_id
         AND cf.status = 'ativo'
        JOIN public.cedente_fundo_politicas cfp
          ON cfp.cedente_fundo_id = cf.id
         AND cfp.politica_operacional_id = pov.politica_operacional_id
         AND cfp.status = 'ativa'
         AND cfp.vigente_desde <= now()
         AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
        JOIN public.consultor_cedente cc
          ON cc.cedente_id = cf.cedente_id
         AND cc.consultor_id = (SELECT auth.uid())
        WHERE pov.id = politica_requisitos_documentais.politica_operacional_versao_id
      )
    )
  );
