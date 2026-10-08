-- C5-R2 hotfix - superficies de carteira para o papel LEITOR.
-- A listagem reutiliza exclusivamente o predicado read-only do C5 e nao
-- concede capacidades de criacao, edicao ou exclusao de C2/C3/C4.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('private.consultor_usuario_pode_visualizar_cedente_fundo(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'C5-R2 reader surfaces: predicado de leitura organizacional ausente';
  END IF;
  IF to_regprocedure('private.consultor_usuario_pode_visualizar_nota_fiscal(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'C5-R2 reader surfaces: predicado read-only de nota fiscal ausente';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION private.listar_cedentes_visiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  razao_social text,
  nome_fantasia text,
  cnpj text,
  status text,
  vinculo_status text,
  fundo_id uuid,
  fundo_nome text,
  onboarding_concluido_em timestamptz,
  documentos_pendentes bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH parametros AS (
    SELECT
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(coalesce(p_termo, '')))) AS termo,
      pg_catalog.regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      greatest(1, least(coalesce(p_limite, 10), 50)) AS limite,
      greatest(0, coalesce(p_offset, 0)) AS deslocamento
  ), base AS (
    SELECT DISTINCT
      c.id,
      c.razao_social,
      c.nome_fantasia,
      c.cnpj,
      c.status::text AS status,
      cc.status AS vinculo_status,
      cf.fundo_id,
      f.nome AS fundo_nome,
      c.onboarding_concluido_em,
      0::bigint AS documentos_pendentes
    FROM public.consultor_usuarios cu
    JOIN public.consultor_cedentes cc
      ON cc.consultor_id = cu.consultor_id
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
    JOIN public.fundos f
      ON f.id = cf.fundo_id
     AND coalesce(f.ativo, true) = true
    CROSS JOIN parametros p
    WHERE cu.user_id = (SELECT auth.uid())
      AND private.consultor_usuario_pode_visualizar_cedente_fundo(
        (SELECT auth.uid()),
        c.id,
        cf.id
      )
      AND (
        p.termo = ''
        OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(c.razao_social)), p.termo) > 0
        OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(coalesce(c.nome_fantasia, ''))), p.termo) > 0
        OR (
          p.termo_cnpj <> ''
          AND pg_catalog.strpos(pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g'), p.termo_cnpj) > 0
        )
      )
  )
  SELECT base.*, count(*) OVER () AS total_count
  FROM base
  ORDER BY base.razao_social, base.id, base.fundo_id
  LIMIT (SELECT limite FROM parametros)
  OFFSET (SELECT deslocamento FROM parametros);
$function$;

CREATE OR REPLACE FUNCTION public.listar_cedentes_visiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  razao_social text,
  nome_fantasia text,
  cnpj text,
  status text,
  vinculo_status text,
  fundo_id uuid,
  fundo_nome text,
  onboarding_concluido_em timestamptz,
  documentos_pendentes bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT *
  FROM private.listar_cedentes_visiveis_consultor(p_termo, p_limite, p_offset);
$function$;

REVOKE ALL ON FUNCTION private.listar_cedentes_visiveis_consultor(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_cedentes_visiveis_consultor(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.listar_cedentes_visiveis_consultor(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_cedentes_visiveis_consultor(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.listar_cedentes_visiveis_consultor(text, integer, integer) IS
  'C5-R2: carteira paginada read-only, incluindo LEITOR, sob Cedente e Fundo ativos da organizacao.';

CREATE OR REPLACE FUNCTION public.consultor_pode_visualizar_nota_fiscal(p_nota_fiscal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_user_role()) = 'consultor'
    AND private.consultor_usuario_pode_visualizar_nota_fiscal(
      (SELECT auth.uid()),
      p_nota_fiscal_id
    );
$function$;

REVOKE ALL ON FUNCTION public.consultor_pode_visualizar_nota_fiscal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultor_pode_visualizar_nota_fiscal(uuid) TO authenticated;

COMMENT ON FUNCTION public.consultor_pode_visualizar_nota_fiscal(uuid) IS
  'C5-R2: gate read-only de NF vinculada a operacao visivel da organizacao consultora.';

NOTIFY pgrst, 'reload schema';

COMMIT;
