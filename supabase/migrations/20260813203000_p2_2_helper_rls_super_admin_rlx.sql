BEGIN;

CREATE OR REPLACE FUNCTION private.rlx_usuario_e_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.usuario_e_super_admin();
$$;

REVOKE ALL ON FUNCTION private.rlx_usuario_e_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rlx_usuario_e_super_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS rlx_importacoes_super_admin_select ON public.rlx_importacoes_financeiras;
CREATE POLICY rlx_importacoes_super_admin_select ON public.rlx_importacoes_financeiras
  FOR SELECT TO authenticated USING (private.rlx_usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_arquivos_super_admin_select ON public.rlx_importacao_arquivos;
CREATE POLICY rlx_arquivos_super_admin_select ON public.rlx_importacao_arquivos
  FOR SELECT TO authenticated USING (private.rlx_usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_linhas_super_admin_select ON public.rlx_importacao_linhas;
CREATE POLICY rlx_linhas_super_admin_select ON public.rlx_importacao_linhas
  FOR SELECT TO authenticated USING (private.rlx_usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_ciclos_super_admin_select ON public.rlx_importacao_ciclos;
CREATE POLICY rlx_ciclos_super_admin_select ON public.rlx_importacao_ciclos
  FOR SELECT TO authenticated USING (private.rlx_usuario_e_super_admin());

DROP POLICY IF EXISTS financeiro_importacoes_super_admin_read ON storage.objects;
CREATE POLICY financeiro_importacoes_super_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'financeiro-importacoes' AND private.rlx_usuario_e_super_admin());

COMMIT;
