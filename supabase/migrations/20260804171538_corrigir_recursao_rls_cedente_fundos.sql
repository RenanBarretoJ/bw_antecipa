-- Corrige a recursao indireta entre cedente_fundos e fundos sem alterar dados.
-- As decisoes de acesso ficam encapsuladas em helpers privados que derivam o
-- ator de auth.uid() e executam leituras controladas fora do grafo de RLS.

BEGIN;

CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.usuario_fundos uf ON uf.usuario_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.role::text = 'gestor'
        AND p.status::text = 'ativo'
        AND uf.fundo_id = p_fundo_id
        AND uf.status = 'ativo'
    );
$$;

COMMENT ON FUNCTION private.usuario_tem_acesso_fundo(uuid) IS
  'Decide se o gestor autenticado e ativo possui vinculo ativo com o fundo informado.';

CREATE OR REPLACE FUNCTION private.usuario_pode_administrar_fundo_ativo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT private.usuario_tem_acesso_fundo(p_fundo_id))
    AND EXISTS (
      SELECT 1
      FROM public.fundos f
      WHERE f.id = p_fundo_id
        AND f.ativo IS TRUE
    );
$$;

COMMENT ON FUNCTION private.usuario_pode_administrar_fundo_ativo(uuid) IS
  'Valida administracao pelo gestor autenticado e exige que o fundo esteja ativo.';

CREATE OR REPLACE FUNCTION private.cedente_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role::text = 'cedente'
        AND p.status::text = 'ativo'
    )
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.fundo_id = p_fundo_id
        AND cf.cedente_id = (SELECT public.get_user_cedente_id())
        AND cf.status = 'ativo'
    );
$$;

COMMENT ON FUNCTION private.cedente_tem_acesso_fundo(uuid) IS
  'Decide se o cedente autenticado e ativo possui vinculo ativo com o fundo informado.';

CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role::text = 'consultor'
        AND p.status::text = 'ativo'
    )
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.consultor_cedente cc ON cc.cedente_id = cf.cedente_id
      WHERE cf.fundo_id = p_fundo_id
        AND cf.status = 'ativo'
        AND cc.consultor_id = (SELECT auth.uid())
    );
$$;

COMMENT ON FUNCTION private.consultor_tem_acesso_fundo(uuid) IS
  'Decide se o consultor autenticado e ativo acompanha cedente vinculado ao fundo informado.';

REVOKE ALL ON FUNCTION private.usuario_tem_acesso_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.usuario_pode_administrar_fundo_ativo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.cedente_tem_acesso_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.consultor_tem_acesso_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.usuario_tem_acesso_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.usuario_pode_administrar_fundo_ativo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cedente_tem_acesso_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.consultor_tem_acesso_fundo(uuid) TO authenticated;

DROP POLICY IF EXISTS cedente_fundos_gestor_insert ON public.cedente_fundos;
CREATE POLICY cedente_fundos_gestor_insert ON public.cedente_fundos
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.usuario_pode_administrar_fundo_ativo(cedente_fundos.fundo_id))
  );

DROP POLICY IF EXISTS cedente_fundos_gestor_update ON public.cedente_fundos;
CREATE POLICY cedente_fundos_gestor_update ON public.cedente_fundos
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id))
  )
  WITH CHECK (
    (SELECT private.usuario_pode_administrar_fundo_ativo(cedente_fundos.fundo_id))
  );

DROP POLICY IF EXISTS fundos_cedente_vinculado_select ON public.fundos;
CREATE POLICY fundos_cedente_vinculado_select ON public.fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.cedente_tem_acesso_fundo(fundos.id)));

DROP POLICY IF EXISTS fundos_consultor_vinculado_select ON public.fundos;
CREATE POLICY fundos_consultor_vinculado_select ON public.fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_fundo(fundos.id)));

NOTIFY pgrst, 'reload schema';

COMMIT;
