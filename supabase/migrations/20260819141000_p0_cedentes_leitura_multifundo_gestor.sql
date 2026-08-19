-- P0 (correcao adicional descoberta pelo proprio E2E): a policy legada
-- cedentes_gestor_all ("FOR ALL USING (get_user_role() = 'gestor')") nunca
-- foi migrada para o padrao multifundo, ao contrario de documentos
-- (hotfix_dashboard_gestor_acl). Qualquer gestor autenticado conseguia ler
-- (SELECT) cedentes de fundos aos quais nao tem vinculo algum. Escrita
-- direta (INSERT/UPDATE/DELETE) ja estava bloqueada por GRANT desde
-- P2.6.4/onboarding, entao esta correcao e estritamente de leitura.

BEGIN;

DROP POLICY IF EXISTS cedentes_gestor_all ON public.cedentes;

CREATE POLICY cedentes_gestor_multifundo_select
  ON public.cedentes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'gestor'
    AND private.gestor_tem_acesso_cedente(id)
  );

COMMIT;
