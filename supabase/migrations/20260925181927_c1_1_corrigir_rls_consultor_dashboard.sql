-- C1.1 - As politicas organizacionais nao podem chamar diretamente o helper
-- administrativo, cujo EXECUTE permanece deliberadamente revogado para
-- authenticated. O wrapper abaixo expoe somente o predicado booleano exigido
-- pelas politicas RLS e preserva a funcao administrativa fechada.

BEGIN;

CREATE OR REPLACE FUNCTION private.c1_1_usuario_e_super_admin_rls()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (SELECT private.usuario_e_super_admin());
$$;

REVOKE ALL ON FUNCTION private.c1_1_usuario_e_super_admin_rls()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.c1_1_usuario_e_super_admin_rls()
  TO authenticated, service_role;

-- Dashboard, relatorio e o predicado publico de operacao sao SECURITY
-- INVOKER e dependem deste helper. A assinatura recebe user_id para uso
-- interno, portanto o acesso autenticado so e seguro quando o argumento fica
-- obrigatoriamente vinculado ao proprio auth.uid().
CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_operar_cedente(
  p_user_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      JOIN public.consultores co ON co.id = cu.consultor_id
      JOIN public.consultor_cedentes cc
        ON cc.consultor_id = cu.consultor_id
       AND cc.cedente_id = p_cedente_id
       AND cc.status = 'ativo'
      JOIN public.cedentes c
        ON c.id = cc.cedente_id
       AND c.status = 'ativo'::public.cedente_status
      JOIN public.cedente_fundos cf
        ON cf.cedente_id = c.id
       AND cf.status = 'ativo'
      JOIN public.consultor_fundos cfu
        ON cfu.consultor_id = cu.consultor_id
       AND cfu.fundo_id = cf.fundo_id
       AND cfu.status = 'ativo'
      JOIN public.fundos f ON f.id = cf.fundo_id
      JOIN public.profiles p ON p.id = cu.user_id
      WHERE cu.user_id = p_user_id
        AND cu.status = 'ativo'
        AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR')
        AND co.status = 'ativo'
        AND p.role::text = 'consultor'
        AND p.status::text = 'ativo'
        AND coalesce(f.ativo, true) = true
    );
$$;

REVOKE ALL ON FUNCTION private.consultor_usuario_pode_operar_cedente(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_operar_cedente(uuid, uuid)
  TO authenticated;

DROP POLICY IF EXISTS consultores_select_membro_ou_admin
  ON public.consultores;
CREATE POLICY consultores_select_membro_ou_admin
  ON public.consultores FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      WHERE cu.consultor_id = consultores.id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
    )
  );

DROP POLICY IF EXISTS consultor_usuarios_select_proprio_ou_admin
  ON public.consultor_usuarios;
CREATE POLICY consultor_usuarios_select_proprio_ou_admin
  ON public.consultor_usuarios FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS consultor_fundos_select_membro_ou_admin
  ON public.consultor_fundos;
CREATE POLICY consultor_fundos_select_membro_ou_admin
  ON public.consultor_fundos FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      JOIN public.consultores co ON co.id = cu.consultor_id
      WHERE cu.consultor_id = consultor_fundos.consultor_id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
        AND co.status = 'ativo'
    )
  );

DROP POLICY IF EXISTS consultor_cedentes_select_membro_ou_admin
  ON public.consultor_cedentes;
CREATE POLICY consultor_cedentes_select_membro_ou_admin
  ON public.consultor_cedentes FOR SELECT TO authenticated
  USING (
    (SELECT private.c1_1_usuario_e_super_admin_rls())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      JOIN public.consultores co ON co.id = cu.consultor_id
      WHERE cu.consultor_id = consultor_cedentes.consultor_id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
        AND co.status = 'ativo'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
