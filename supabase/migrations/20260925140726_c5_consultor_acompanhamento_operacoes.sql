-- C5 - carteira consolidada e detalhe read-only de operacoes do Consultor.
-- Reutiliza os predicates operacionais certificados em C2/C4 e concede
-- exclusivamente leitura das entidades necessarias ao detalhe do Cedente.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.usuario_pode_operar_cedente(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-condicoes C2/C4 ausentes para C5';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.consultor_pode_visualizar_operacao(p_operacao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.operacoes o
      JOIN public.cedente_fundos cf
        ON cf.id = o.cedente_fundo_id
       AND cf.cedente_id = o.cedente_id
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE o.id = p_operacao_id
        AND cf.status = 'ativo'
        AND coalesce(f.ativo, true) = true
        AND (SELECT private.usuario_pode_operar_cedente(o.cedente_id))
        AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
    );
$function$;

REVOKE ALL ON FUNCTION private.consultor_pode_visualizar_operacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.consultor_pode_visualizar_operacao(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultor_pode_visualizar_operacao(p_operacao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.consultor_pode_visualizar_operacao(p_operacao_id);
$function$;

REVOKE ALL ON FUNCTION public.consultor_pode_visualizar_operacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultor_pode_visualizar_operacao(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultor_pode_operar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.usuario_pode_operar_cedente(p_cedente_id))
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.cedente_id = p_cedente_id
        AND cf.status = 'ativo'
        AND coalesce(f.ativo, true) = true
        AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
    );
$function$;

REVOKE ALL ON FUNCTION public.consultor_pode_operar_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultor_pode_operar_cedente(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.listar_fundos_operacionais_consultor()
RETURNS TABLE(id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT f.id, f.nome
  FROM public.usuario_fundos uf
  JOIN public.fundos f ON f.id = uf.fundo_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND uf.usuario_id = (SELECT auth.uid())
    AND uf.status = 'ativo'
    AND coalesce(f.ativo, true) = true
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      JOIN public.cedentes c ON c.id = cc.cedente_id
      JOIN public.cedente_fundos cf
        ON cf.cedente_id = c.id
       AND cf.fundo_id = f.id
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.status = 'ativo'
        AND c.status = 'ativo'
        AND cf.status = 'ativo'
    )
  ORDER BY f.nome, f.id;
$function$;

REVOKE ALL ON FUNCTION public.listar_fundos_operacionais_consultor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_fundos_operacionais_consultor() TO authenticated, service_role;

-- Mantem o motor certificado do seletor C2/C4, acrescentando o Fundo do
-- Consultor ao mesmo predicate operacional usado pela carteira C5.
CREATE OR REPLACE FUNCTION private.buscar_cedentes_elegiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10
)
RETURNS TABLE(id uuid, razao_social text, nome_fantasia text, cnpj text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH parametros AS (
    SELECT
      pg_catalog.btrim(coalesce(p_termo, '')) AS termo,
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(coalesce(p_termo, '')))) AS termo_normalizado,
      pg_catalog.regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      greatest(1, least(coalesce(p_limite, 10), 10)) AS limite
  )
  SELECT c.id, c.razao_social, c.nome_fantasia, c.cnpj
  FROM public.consultor_cedente cc
  JOIN public.cedentes c ON c.id = cc.cedente_id
  CROSS JOIN parametros p
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND cc.consultor_id = (SELECT auth.uid())
    AND cc.status = 'ativo'
    AND c.status = 'ativo'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.cedente_id = c.id
        AND cf.status = 'ativo'
        AND coalesce(f.ativo, true) = true
        AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
    )
    AND (
      p.termo = ''
      OR (
        pg_catalog.char_length(p.termo) >= 4
        AND (
          pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(c.razao_social)), p.termo_normalizado) > 0
          OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(coalesce(c.nome_fantasia, ''))), p.termo_normalizado) > 0
          OR (
            p.termo_cnpj <> ''
            AND pg_catalog.strpos(pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g'), p.termo_cnpj) > 0
          )
        )
      )
    )
  ORDER BY c.razao_social, c.id
  LIMIT (SELECT limite FROM parametros);
$function$;

DROP POLICY IF EXISTS operacoes_consultor_select ON public.operacoes;
CREATE POLICY operacoes_consultor_select
  ON public.operacoes FOR SELECT TO authenticated
  USING ((SELECT private.consultor_pode_visualizar_operacao(operacoes.id)));

DROP POLICY IF EXISTS operacoes_nfs_consultor_select ON public.operacoes_nfs;
CREATE POLICY operacoes_nfs_consultor_select
  ON public.operacoes_nfs FOR SELECT TO authenticated
  USING (
    (SELECT private.consultor_pode_visualizar_operacao(operacoes_nfs.operacao_id))
    AND EXISTS (
      SELECT 1
      FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
      JOIN public.notas_fiscais nf ON nf.id = operacoes_nfs.nota_fiscal_id
      WHERE o.id = operacoes_nfs.operacao_id
        AND nf.cedente_id = o.cedente_id
        AND nf.fundo_id = cf.fundo_id
    )
  );

DROP POLICY IF EXISTS cedente_fundos_consultor_select ON public.cedente_fundos;
CREATE POLICY cedente_fundos_consultor_select
  ON public.cedente_fundos FOR SELECT TO authenticated
  USING (
    cedente_fundos.status = 'ativo'
    AND (SELECT private.usuario_pode_operar_cedente(cedente_fundos.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(cedente_fundos.fundo_id))
  );

DROP POLICY IF EXISTS operacao_calculo_nfs_consultor_select_c5 ON public.operacao_calculo_nfs;
CREATE POLICY operacao_calculo_nfs_consultor_select_c5
  ON public.operacao_calculo_nfs FOR SELECT TO authenticated
  USING (
    (SELECT private.consultor_pode_visualizar_operacao(operacao_calculo_nfs.operacao_id))
    AND (SELECT private.usuario_pode_operar_cedente(operacao_calculo_nfs.cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(operacao_calculo_nfs.fundo_id))
  );

DROP POLICY IF EXISTS operacoes_nf_parcelas_cedente_select ON public.operacoes_nf_parcelas;
CREATE POLICY operacoes_nf_parcelas_cedente_select
  ON public.operacoes_nf_parcelas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nf_parcelas.nota_fiscal_id
        AND (SELECT public.get_user_role()) = 'cedente'
        AND nf.cedente_id = (SELECT public.get_user_cedente_id())
    )
  );

DROP POLICY IF EXISTS operacoes_nf_parcelas_consultor_select_c5 ON public.operacoes_nf_parcelas;
CREATE POLICY operacoes_nf_parcelas_consultor_select_c5
  ON public.operacoes_nf_parcelas FOR SELECT TO authenticated
  USING (
    (SELECT private.consultor_pode_visualizar_operacao(operacoes_nf_parcelas.operacao_id))
    AND EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nf_parcelas.nota_fiscal_id
        AND (SELECT private.usuario_pode_operar_cedente(nf.cedente_id))
        AND (SELECT private.consultor_tem_acesso_fundo(nf.fundo_id))
    )
  );

DROP POLICY IF EXISTS documento_requisito_contexto_select ON public.documento_requisito_instancias;
CREATE POLICY documento_requisito_contexto_select
  ON public.documento_requisito_instancias FOR SELECT TO authenticated
  USING (
    documento_requisito_instancias.cedente_id = (SELECT public.get_user_cedente_id())
    OR (
      (SELECT public.get_user_role()) = 'consultor'
      AND (SELECT private.usuario_pode_operar_cedente(documento_requisito_instancias.cedente_id))
      AND (
        (
          documento_requisito_instancias.operacao_id IS NOT NULL
          AND (SELECT private.consultor_pode_visualizar_operacao(documento_requisito_instancias.operacao_id))
        )
        OR EXISTS (
          SELECT 1
          FROM public.notas_fiscais nf
          WHERE nf.id = documento_requisito_instancias.nota_fiscal_id
            AND nf.cedente_id = documento_requisito_instancias.cedente_id
            AND (SELECT private.consultor_tem_acesso_fundo(nf.fundo_id))
        )
        OR EXISTS (
          SELECT 1
          FROM public.nota_fiscal_entregas entrega
          WHERE entrega.id = documento_requisito_instancias.nota_fiscal_entrega_id
            AND (SELECT private.consultor_pode_visualizar_operacao(entrega.operacao_id))
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.logistica_usuario_pode_ler_entrega(p_entrega_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor'
      THEN private.gestor_tem_acesso_entrega(p_entrega_id)
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.nota_fiscal_entregas entrega
      JOIN public.operacoes operacao ON operacao.id = entrega.operacao_id
      WHERE entrega.id = p_entrega_id
        AND operacao.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.nota_fiscal_entregas entrega
      WHERE entrega.id = p_entrega_id
        AND (SELECT private.consultor_pode_visualizar_operacao(entrega.operacao_id))
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS eventos_dominio_consultor_select_c5 ON public.eventos_dominio;
CREATE POLICY eventos_dominio_consultor_select_c5
  ON public.eventos_dominio FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND eventos_dominio.visibilidade IN ('cedente', 'ambos')
    AND eventos_dominio.operacao_id IS NOT NULL
    AND (SELECT private.consultor_pode_visualizar_operacao(eventos_dominio.operacao_id))
  );

CREATE INDEX IF NOT EXISTS idx_operacoes_cedente_created_id_c5
  ON public.operacoes (cedente_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_operacoes_cedente_fundo_created_id_c5
  ON public.operacoes (cedente_fundo_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_operacoes_status_created_id_c5
  ON public.operacoes (status, created_at DESC, id);

COMMENT ON FUNCTION private.consultor_pode_visualizar_operacao(uuid) IS
  'C5: autoriza leitura de uma operacao somente para Consultor, Cedente e Fundo operacionalmente ativos.';

COMMIT;
