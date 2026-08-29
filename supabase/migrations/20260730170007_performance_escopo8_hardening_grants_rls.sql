-- Escopo 8: fecha exposicoes comprovadas durante a homologacao transversal.
--
-- 1. As RPCs de performance sao SECURITY INVOKER e fazem parte apenas da API
--    autenticada. As migrations de origem concediam EXECUTE a authenticated,
--    mas os privilegios padrao do projeto tambem mantinham anon com acesso.
-- 2. taxas_cedente estava no schema public com privilegios para anon e sem RLS,
--    expondo parametros financeiros pelo Data API.

ALTER TABLE public.taxas_cedente ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.taxas_cedente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.taxas_cedente TO authenticated;

DROP POLICY IF EXISTS taxas_cedente_cedente_select ON public.taxas_cedente;
CREATE POLICY taxas_cedente_cedente_select
  ON public.taxas_cedente
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'cedente'
    AND cedente_id = (SELECT public.get_user_cedente_id())
  );

DROP POLICY IF EXISTS taxas_cedente_gestor_all ON public.taxas_cedente;
CREATE POLICY taxas_cedente_gestor_all
  ON public.taxas_cedente
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE cf.cedente_id = taxas_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
    )
  )
  WITH CHECK (
    (SELECT public.get_user_role()) = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.usuario_fundos uf
        ON uf.fundo_id = cf.fundo_id
       AND uf.usuario_id = (SELECT auth.uid())
       AND uf.status = 'ativo'
      WHERE cf.cedente_id = taxas_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
    )
  );

REVOKE EXECUTE ON FUNCTION public.listar_onboarding_cedentes_paginado(
  uuid, integer, integer, text, text, text, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_onboarding_cedentes_paginado(
  uuid, integer, integer, text, text, text, uuid, text, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.carregar_dashboard_sacado()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carregar_dashboard_sacado()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.carregar_indicadores_nfs_sacado()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carregar_indicadores_nfs_sacado()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.listar_cedentes_aprovacao_sacado()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_cedentes_aprovacao_sacado()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.listar_documentos_atuais_cedente(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_documentos_atuais_cedente(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dashboard_gestor_resumo(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_gestor_resumo(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dashboard_cedente_resumo(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_cedente_resumo(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.dashboard_consultor_resumo()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_consultor_resumo()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.relatorio_gestor_analitico(
  uuid, text, text, text, uuid, date, date, integer, integer, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_gestor_analitico(
  uuid, text, text, text, uuid, date, date, integer, integer, text, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
