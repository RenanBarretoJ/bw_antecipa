-- P2.6.6/P1: o runtime da Central de Conciliacao usa Data API autenticada.
-- O ACL SELECT ja existe; a negacao era causada pelo helper legado exigir o
-- literal perfil_no_fundo='gestor', enquanto vinculos operacionais validos usam
-- tambem 'administrador'. A regra canonica continua exigindo papel operacional
-- e usuario_fundos ativo.
BEGIN;

DO $p266_preconditions$
BEGIN
  IF to_regprocedure('private.gestor_tem_acesso_fundo_operacional(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P2.6.6/P1: helper canonico multifundo ausente';
  END IF;
END
$p266_preconditions$;

CREATE OR REPLACE FUNCTION private.financeiro_gestor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.gestor_tem_acesso_fundo_operacional(p_fundo_id);
$function$;

-- Mantem compatibilidade com policies/functions historicas que ainda referenciem
-- o nome anterior. Nao concede um caminho alternativo de autorizacao.
CREATE OR REPLACE FUNCTION private.rlx_gestor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.gestor_tem_acesso_fundo_operacional(p_fundo_id);
$function$;

REVOKE ALL ON FUNCTION private.financeiro_gestor_tem_acesso_fundo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.financeiro_gestor_tem_acesso_fundo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid) TO authenticated, service_role;

-- As views financeiras permanecem estritamente read-only para authenticated.
GRANT SELECT ON TABLE
  public.estoque_atual,
  public.aquisicoes_atuais,
  public.liquidacoes_atuais,
  public.carteira_atual
TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.estoque_atual,
  public.aquisicoes_atuais,
  public.liquidacoes_atuais,
  public.carteira_atual
FROM authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
