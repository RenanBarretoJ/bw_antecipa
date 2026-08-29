-- Permite que cedentes leiam somente fundos aos quais possuem vinculo ativo.
-- Necessario para upload de NF/documentos, pois o contexto multifundo e validado
-- antes de criar a nota fiscal.

ALTER TABLE public.fundos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fundos TO authenticated;
GRANT ALL ON public.fundos TO service_role;

DROP POLICY IF EXISTS fundos_gestor_all ON public.fundos;
CREATE POLICY fundos_gestor_all ON public.fundos
  FOR ALL
  TO authenticated
  USING ((SELECT get_user_role()) = 'gestor')
  WITH CHECK ((SELECT get_user_role()) = 'gestor');

DROP POLICY IF EXISTS fundos_cedente_vinculado_select ON public.fundos;
CREATE POLICY fundos_cedente_vinculado_select ON public.fundos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.fundo_id = fundos.id
        AND cf.cedente_id = (SELECT get_user_cedente_id())
        AND cf.status = 'ativo'
    )
  );

DROP POLICY IF EXISTS fundos_consultor_vinculado_select ON public.fundos;
CREATE POLICY fundos_consultor_vinculado_select ON public.fundos
  FOR SELECT
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.consultor_cedente cc ON cc.cedente_id = cf.cedente_id
      WHERE cf.fundo_id = fundos.id
        AND cf.status = 'ativo'
        AND cc.consultor_id = (SELECT auth.uid())
    )
  );
