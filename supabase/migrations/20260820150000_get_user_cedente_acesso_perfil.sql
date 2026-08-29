BEGIN;

-- Incidente ao vivo em homolog: usuarios convidados via cedente_acessos
-- (perfil administrador/operador) ficam sem acesso em varios pontos do
-- sistema porque cedente_acessos so tem GRANT para service_role desde a
-- canonicalizacao de ACL/RLS (20260817150507_p2_6_4_canonicalizar_acl_rls),
-- mas 4 pontos de chamada continuavam lendo a tabela direto pelo client
-- autenticado (permission denied, descartado em silencio, tratado como
-- "sem acesso"): requireCedenteAccess (src/lib/auth/authorization.ts, ja
-- corrigido reaproveitando a RPC get_user_cedente_id existente), a tela
-- "Acessos Vinculados" do gestor (ja corrigida via service_role), e estas
-- duas checagens de perfil "administrador", que precisam do campo perfil
-- (nao so do cedente_id) e por isso nao podiam reaproveitar
-- get_user_cedente_id(): ehAdministrador (src/lib/actions/cedente.ts) e
-- usuarioEhAdministradorCedente (src/lib/auth/mfa.ts).
--
-- Mesmo padrao/mesma tabela de get_user_cedente_id() (SECURITY DEFINER,
-- le cedente_acessos internamente, ignora GRANT/RLS do chamador).

CREATE OR REPLACE FUNCTION public.get_user_cedente_acesso_perfil()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT ca.perfil
    FROM public.cedente_acessos ca
    WHERE ca.user_id = auth.uid()
      AND ca.ativo = true
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_cedente_acesso_perfil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_cedente_acesso_perfil() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_cedente_acesso_perfil() IS
  'Perfil (administrador/operador) do vinculo cedente_acessos ATIVO do usuario autenticado, ou NULL se nao houver. SECURITY DEFINER, mesmo padrao de get_user_cedente_id() -- necessario porque cedente_acessos so tem GRANT para service_role.';

COMMIT;
