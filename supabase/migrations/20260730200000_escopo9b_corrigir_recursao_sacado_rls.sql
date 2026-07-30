-- Escopo 9B: elimina recursao entre RLS de operacoes/operacoes_nfs e
-- normaliza o CNPJ do sacado antes da comparacao.
--
-- A regra de acesso nao muda: o sacado somente acessa NFs e operacoes
-- relacionadas ao seu proprio CNPJ. Os helpers evitam que uma policy de
-- operacoes consulte operacoes_nfs, que por sua vez consulte operacoes.

BEGIN;

CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao(p_operacao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'sacado'
    AND EXISTS (
      SELECT 1
      FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
      WHERE onf.operacao_id = p_operacao_id
        AND NULLIF(regexp_replace(COALESCE(nf.cnpj_destinatario, ''), '\D', '', 'g'), '') =
            (SELECT public.get_user_sacado_cnpj())
    );
$$;

CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao_nf(
  p_operacao_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'sacado'
    AND EXISTS (
      SELECT 1
      FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
      WHERE onf.operacao_id = p_operacao_id
        AND onf.nota_fiscal_id = p_nota_fiscal_id
        AND NULLIF(regexp_replace(COALESCE(nf.cnpj_destinatario, ''), '\D', '', 'g'), '') =
            (SELECT public.get_user_sacado_cnpj())
    );
$$;

REVOKE ALL ON FUNCTION private.sacado_tem_acesso_operacao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sacado_tem_acesso_operacao_nf(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.sacado_tem_acesso_operacao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.sacado_tem_acesso_operacao_nf(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS notas_fiscais_sacado_select ON public.notas_fiscais;
CREATE POLICY notas_fiscais_sacado_select ON public.notas_fiscais
  FOR SELECT TO authenticated
  USING (
    NULLIF(regexp_replace(COALESCE(notas_fiscais.cnpj_destinatario, ''), '\D', '', 'g'), '') =
      (SELECT public.get_user_sacado_cnpj())
  );

DROP POLICY IF EXISTS notas_fiscais_sacado_aceitar ON public.notas_fiscais;
CREATE POLICY notas_fiscais_sacado_aceitar ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (
    NULLIF(regexp_replace(COALESCE(notas_fiscais.cnpj_destinatario, ''), '\D', '', 'g'), '') =
      (SELECT public.get_user_sacado_cnpj())
    AND status = 'em_antecipacao'
  )
  WITH CHECK (status = 'aceita');

DROP POLICY IF EXISTS notas_fiscais_sacado_contestar ON public.notas_fiscais;
CREATE POLICY notas_fiscais_sacado_contestar ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (
    NULLIF(regexp_replace(COALESCE(notas_fiscais.cnpj_destinatario, ''), '\D', '', 'g'), '') =
      (SELECT public.get_user_sacado_cnpj())
    AND status = 'em_antecipacao'
  )
  WITH CHECK (status = 'contestada');

DROP POLICY IF EXISTS operacoes_sacado_select ON public.operacoes;
CREATE POLICY operacoes_sacado_select ON public.operacoes
  FOR SELECT TO authenticated
  USING ((SELECT private.sacado_tem_acesso_operacao(operacoes.id)));

DROP POLICY IF EXISTS operacoes_nfs_sacado_select ON public.operacoes_nfs;
CREATE POLICY operacoes_nfs_sacado_select ON public.operacoes_nfs
  FOR SELECT TO authenticated
  USING (
    (SELECT private.sacado_tem_acesso_operacao_nf(
      operacoes_nfs.operacao_id,
      operacoes_nfs.nota_fiscal_id
    ))
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
