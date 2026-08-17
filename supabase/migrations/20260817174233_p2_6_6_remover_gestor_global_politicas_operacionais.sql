-- P2.6.6 follow-up: remove os ultimos ramos permissivos de gestor global.
-- O gestor continua autorizado pelas policies *_gestor_multifundo_all,
-- vinculadas ao fundo por private.gestor_tem_acesso_fundo_operacional().
-- Cedente e consultor preservam os mesmos relacionamentos funcionais.

BEGIN;

DROP POLICY IF EXISTS politicas_operacionais_fundo_select
  ON public.politicas_operacionais;

CREATE POLICY politicas_operacionais_fundo_select
  ON public.politicas_operacionais
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = politicas_operacionais.id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE cf.fundo_id = politicas_operacionais.fundo_id
        AND cf.status = 'ativo'
        AND cf.cedente_id = (SELECT public.get_user_cedente_id())
    )
  );

DROP POLICY IF EXISTS politica_operacional_versoes_vinculo_select
  ON public.politica_operacional_versoes;

CREATE POLICY politica_operacional_versoes_vinculo_select
  ON public.politica_operacional_versoes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
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
        AND cf.cedente_id = (SELECT public.get_user_cedente_id())
    )
    OR (
      (SELECT public.get_user_role()) = 'consultor'
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

DROP POLICY IF EXISTS politica_requisitos_vinculo_select
  ON public.politica_requisitos_documentais;

CREATE POLICY politica_requisitos_vinculo_select
  ON public.politica_requisitos_documentais
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
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
        AND cf.cedente_id = (SELECT public.get_user_cedente_id())
    )
    OR (
      (SELECT public.get_user_role()) = 'consultor'
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

NOTIFY pgrst, 'reload schema';

COMMIT;
