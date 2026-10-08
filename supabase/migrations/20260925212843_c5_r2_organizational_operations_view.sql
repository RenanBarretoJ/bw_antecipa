-- C5-R2 - acompanhamento read-only de operacoes pela organizacao consultora.
-- OWNER, ADMIN, OPERADOR e LEITOR podem consultar somente operacoes ligadas
-- simultaneamente a Cedente e Fundo ativos da mesma organizacao.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.consultor_usuarios') IS NULL
     OR to_regclass('public.consultor_cedentes') IS NULL
     OR to_regclass('public.consultor_fundos') IS NULL
     OR to_regprocedure('private.consultor_usuario_pode_operar_cedente(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'C5-R2: pre-condicoes organizacionais C1.1 ausentes';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_cedente_fundo(
  p_user_id uuid,
  p_cedente_id uuid,
  p_cedente_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultor_usuarios cu
    JOIN public.consultores co
      ON co.id = cu.consultor_id
     AND co.status = 'ativo'
    JOIN public.profiles p
      ON p.id = cu.user_id
     AND p.role::text = 'consultor'
     AND p.status::text = 'ativo'
    JOIN public.consultor_cedentes cc
      ON cc.consultor_id = cu.consultor_id
     AND cc.cedente_id = p_cedente_id
     AND cc.status = 'ativo'
    JOIN public.cedentes c
      ON c.id = cc.cedente_id
     AND c.status = 'ativo'::public.cedente_status
    JOIN public.cedente_fundos cf
      ON cf.id = p_cedente_fundo_id
     AND cf.cedente_id = c.id
     AND cf.status = 'ativo'
    JOIN public.consultor_fundos cfu
      ON cfu.consultor_id = cu.consultor_id
     AND cfu.fundo_id = cf.fundo_id
     AND cfu.status = 'ativo'
    JOIN public.fundos f
      ON f.id = cfu.fundo_id
     AND coalesce(f.ativo, true) = true
    WHERE cu.user_id = p_user_id
      AND cu.status = 'ativo'
      AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')
  );
$function$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_cedente(
  p_user_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cedente_fundos cf
    WHERE cf.cedente_id = p_cedente_id
      AND private.consultor_usuario_pode_visualizar_cedente_fundo(
        p_user_id,
        p_cedente_id,
        cf.id
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_fundo(
  p_user_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultor_usuarios cu
    JOIN public.consultores co ON co.id = cu.consultor_id AND co.status = 'ativo'
    JOIN public.profiles p ON p.id = cu.user_id AND p.role::text = 'consultor' AND p.status::text = 'ativo'
    JOIN public.consultor_fundos cfu
      ON cfu.consultor_id = cu.consultor_id
     AND cfu.fundo_id = p_fundo_id
     AND cfu.status = 'ativo'
    JOIN public.fundos f ON f.id = cfu.fundo_id AND coalesce(f.ativo, true) = true
    WHERE cu.user_id = p_user_id
      AND cu.status = 'ativo'
      AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')
      AND EXISTS (
        SELECT 1
        FROM public.consultor_cedentes cc
        JOIN public.cedente_fundos cf
          ON cf.cedente_id = cc.cedente_id
         AND cf.fundo_id = cfu.fundo_id
         AND cf.status = 'ativo'
        JOIN public.cedentes c
          ON c.id = cc.cedente_id
         AND c.status = 'ativo'::public.cedente_status
        WHERE cc.consultor_id = cu.consultor_id
          AND cc.status = 'ativo'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_operacao(
  p_user_id uuid,
  p_operacao_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.operacoes o
    WHERE o.id = p_operacao_id
      AND o.cedente_fundo_id IS NOT NULL
      AND private.consultor_usuario_pode_visualizar_cedente_fundo(
        p_user_id,
        o.cedente_id,
        o.cedente_fundo_id
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_nota_fiscal(
  p_user_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.notas_fiscais nf
    JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    JOIN public.operacoes o ON o.id = onf.operacao_id
    JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
    WHERE nf.id = p_nota_fiscal_id
      AND nf.cedente_id = o.cedente_id
      AND nf.fundo_id = cf.fundo_id
      AND private.consultor_usuario_pode_visualizar_operacao(p_user_id, o.id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_visualizar_entrega(
  p_user_id uuid,
  p_entrega_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.nota_fiscal_entregas entrega
    WHERE entrega.id = p_entrega_id
      AND private.consultor_usuario_pode_visualizar_operacao(
        p_user_id,
        entrega.operacao_id
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_cedente_fundo(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_cedente(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_fundo(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_operacao(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_nota_fiscal(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_visualizar_entrega(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_cedente_fundo(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_cedente(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_fundo(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_operacao(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_nota_fiscal(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.consultor_usuario_pode_visualizar_entrega(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultor_pode_visualizar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND private.consultor_usuario_pode_visualizar_cedente((SELECT auth.uid()), p_cedente_id);
$function$;

CREATE OR REPLACE FUNCTION public.consultor_pode_visualizar_operacao(p_operacao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND private.consultor_usuario_pode_visualizar_operacao((SELECT auth.uid()), p_operacao_id);
$function$;

CREATE OR REPLACE FUNCTION public.consultor_listar_cedente_ids_visiveis()
RETURNS TABLE (cedente_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT cc.cedente_id
  FROM public.consultor_usuarios cu
  JOIN public.consultor_cedentes cc
    ON cc.consultor_id = cu.consultor_id
   AND cc.status = 'ativo'
  WHERE cu.user_id = (SELECT auth.uid())
    AND cu.status = 'ativo'
    AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')
    AND private.consultor_usuario_pode_visualizar_cedente((SELECT auth.uid()), cc.cedente_id)
  ORDER BY cc.cedente_id;
$function$;

CREATE OR REPLACE FUNCTION public.listar_fundos_visiveis_consultor()
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT f.id, f.nome
  FROM public.fundos f
  WHERE private.consultor_usuario_pode_visualizar_fundo((SELECT auth.uid()), f.id)
  ORDER BY f.nome, f.id;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_cedentes_visiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10
)
RETURNS TABLE (id uuid, razao_social text, nome_fantasia text, cnpj text)
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
  SELECT DISTINCT c.id, c.razao_social, c.nome_fantasia, c.cnpj
  FROM public.cedentes c
  CROSS JOIN parametros p
  WHERE private.consultor_usuario_pode_visualizar_cedente((SELECT auth.uid()), c.id)
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

REVOKE ALL ON FUNCTION public.consultor_pode_visualizar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultor_pode_visualizar_operacao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultor_listar_cedente_ids_visiveis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_fundos_visiveis_consultor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buscar_cedentes_visiveis_consultor(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultor_pode_visualizar_cedente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultor_pode_visualizar_operacao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultor_listar_cedente_ids_visiveis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_fundos_visiveis_consultor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_cedentes_visiveis_consultor(text, integer) TO authenticated, service_role;

DROP POLICY IF EXISTS cedentes_consultor_select ON public.cedentes;
CREATE POLICY cedentes_consultor_select
  ON public.cedentes FOR SELECT TO authenticated
  USING (private.consultor_usuario_pode_visualizar_cedente((SELECT auth.uid()), cedentes.id));

DROP POLICY IF EXISTS fundos_consultor_vinculado_select ON public.fundos;
CREATE POLICY fundos_consultor_vinculado_select
  ON public.fundos FOR SELECT TO authenticated
  USING (private.consultor_usuario_pode_visualizar_fundo((SELECT auth.uid()), fundos.id));

DROP POLICY IF EXISTS cedente_fundos_consultor_select ON public.cedente_fundos;
CREATE POLICY cedente_fundos_consultor_select
  ON public.cedente_fundos FOR SELECT TO authenticated
  USING (
    private.consultor_usuario_pode_visualizar_cedente_fundo(
      (SELECT auth.uid()),
      cedente_fundos.cedente_id,
      cedente_fundos.id
    )
  );

DROP POLICY IF EXISTS operacoes_consultor_select ON public.operacoes;
CREATE POLICY operacoes_consultor_select
  ON public.operacoes FOR SELECT TO authenticated
  USING (private.consultor_usuario_pode_visualizar_operacao((SELECT auth.uid()), operacoes.id));

DROP POLICY IF EXISTS operacoes_nfs_consultor_select ON public.operacoes_nfs;
CREATE POLICY operacoes_nfs_consultor_select
  ON public.operacoes_nfs FOR SELECT TO authenticated
  USING (
    private.consultor_usuario_pode_visualizar_operacao((SELECT auth.uid()), operacoes_nfs.operacao_id)
    AND private.consultor_usuario_pode_visualizar_nota_fiscal(
      (SELECT auth.uid()),
      operacoes_nfs.nota_fiscal_id
    )
  );

DROP POLICY IF EXISTS notas_fiscais_consultor_select ON public.notas_fiscais;
CREATE POLICY notas_fiscais_consultor_select
  ON public.notas_fiscais FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND (
      (SELECT private.usuario_pode_operar_cedente(notas_fiscais.cedente_id))
      OR private.consultor_usuario_pode_visualizar_nota_fiscal(
        (SELECT auth.uid()),
        notas_fiscais.id
      )
    )
  );

DROP POLICY IF EXISTS nota_fiscal_parcelas_consultor_select_c5 ON public.nota_fiscal_parcelas;
CREATE POLICY nota_fiscal_parcelas_consultor_select_c5
  ON public.nota_fiscal_parcelas FOR SELECT TO authenticated
  USING (
    private.consultor_usuario_pode_visualizar_nota_fiscal(
      (SELECT auth.uid()),
      nota_fiscal_parcelas.nota_fiscal_id
    )
  );

DROP POLICY IF EXISTS operacoes_nf_parcelas_consultor_select_c5 ON public.operacoes_nf_parcelas;
CREATE POLICY operacoes_nf_parcelas_consultor_select_c5
  ON public.operacoes_nf_parcelas FOR SELECT TO authenticated
  USING (
    private.consultor_usuario_pode_visualizar_operacao(
      (SELECT auth.uid()),
      operacoes_nf_parcelas.operacao_id
    )
  );

DROP POLICY IF EXISTS operacao_calculo_nfs_consultor_select_c5 ON public.operacao_calculo_nfs;
CREATE POLICY operacao_calculo_nfs_consultor_select_c5
  ON public.operacao_calculo_nfs FOR SELECT TO authenticated
  USING (
    private.consultor_usuario_pode_visualizar_operacao(
      (SELECT auth.uid()),
      operacao_calculo_nfs.operacao_id
    )
  );

DROP POLICY IF EXISTS documento_requisito_consultor_select_c5 ON public.documento_requisito_instancias;
CREATE POLICY documento_requisito_consultor_select_c5
  ON public.documento_requisito_instancias FOR SELECT TO authenticated
  USING (
    (
      documento_requisito_instancias.operacao_id IS NOT NULL
      AND private.consultor_usuario_pode_visualizar_operacao(
        (SELECT auth.uid()),
        documento_requisito_instancias.operacao_id
      )
    )
    OR (
      documento_requisito_instancias.nota_fiscal_id IS NOT NULL
      AND private.consultor_usuario_pode_visualizar_nota_fiscal(
        (SELECT auth.uid()),
        documento_requisito_instancias.nota_fiscal_id
      )
    )
    OR (
      documento_requisito_instancias.nota_fiscal_entrega_id IS NOT NULL
      AND private.consultor_usuario_pode_visualizar_entrega(
        (SELECT auth.uid()),
        documento_requisito_instancias.nota_fiscal_entrega_id
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
        AND private.consultor_usuario_pode_visualizar_operacao(
          (SELECT auth.uid()),
          entrega.operacao_id
        )
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistica_usuario_pode_ler_entrega(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS eventos_dominio_consultor_select ON public.eventos_dominio;
CREATE POLICY eventos_dominio_consultor_select
  ON public.eventos_dominio FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND eventos_dominio.visibilidade IN ('cedente', 'ambos')
    AND eventos_dominio.operacao_id IS NOT NULL
    AND private.consultor_usuario_pode_visualizar_operacao(
      (SELECT auth.uid()),
      eventos_dominio.operacao_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_operacoes_cedente_created_id_c5
  ON public.operacoes (cedente_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_operacoes_cedente_fundo_created_id_c5
  ON public.operacoes (cedente_fundo_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_operacoes_status_created_id_c5
  ON public.operacoes (status, created_at DESC, id);

COMMENT ON FUNCTION public.consultor_pode_visualizar_operacao(uuid) IS
  'C5-R2: leitura organizacional de operacao; inclui LEITOR e valida Cedente e Fundo exatos.';

NOTIFY pgrst, 'reload schema';

COMMIT;
