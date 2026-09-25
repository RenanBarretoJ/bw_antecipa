-- C1.1 - Cutover direto da autorizacao CONSULTOR para o escopo da organizacao.
-- Producao nao possui usuarios CONSULTOR nem vinculos legados; por isso nao ha
-- dual-read ou backfill com identidade fiscal inventada.

BEGIN;

CREATE OR REPLACE FUNCTION private.consultor_organizacao_ativa_do_usuario(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cu.consultor_id
  FROM public.consultor_usuarios cu
  JOIN public.consultores co ON co.id = cu.consultor_id
  JOIN public.profiles p ON p.id = cu.user_id
  WHERE cu.user_id = p_user_id
    AND cu.status = 'ativo'
    AND co.status = 'ativo'
    AND p.role::text = 'consultor'
    AND p.status::text = 'ativo'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_tem_papel(
  p_user_id uuid,
  p_papeis text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultor_usuarios cu
    JOIN public.consultores co ON co.id = cu.consultor_id
    JOIN public.profiles p ON p.id = cu.user_id
    WHERE cu.user_id = p_user_id
      AND cu.status = 'ativo'
      AND cu.papel = ANY (p_papeis)
      AND co.status = 'ativo'
      AND p.role::text = 'consultor'
      AND p.status::text = 'ativo'
  );
$$;

CREATE OR REPLACE FUNCTION private.consultor_usuario_tem_acesso_fundo(
  p_user_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultor_usuarios cu
    JOIN public.consultores co ON co.id = cu.consultor_id
    JOIN public.consultor_fundos cfu
      ON cfu.consultor_id = cu.consultor_id
     AND cfu.fundo_id = p_fundo_id
     AND cfu.status = 'ativo'
    JOIN public.fundos f ON f.id = cfu.fundo_id
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

CREATE OR REPLACE FUNCTION private.consultor_usuario_pode_gerenciar_cedente(
  p_user_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consultor_usuarios cu
    JOIN public.consultores co ON co.id = cu.consultor_id
    JOIN public.consultor_cedentes cc
      ON cc.consultor_id = cu.consultor_id
     AND cc.cedente_id = p_cedente_id
     AND cc.status IN ('pendente', 'ativo')
    JOIN public.cedente_fundos cf
      ON cf.cedente_id = cc.cedente_id
     AND cf.status IN ('ativo', 'suspenso')
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
  SELECT EXISTS (
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

CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.consultor_usuario_tem_acesso_fundo((SELECT auth.uid()), p_fundo_id);
$$;

CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.consultor_usuario_pode_operar_cedente((SELECT auth.uid()), p_cedente_id);
$$;

CREATE OR REPLACE FUNCTION private.usuario_pode_gerenciar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.status::text = 'ativo'
    )
    AND (
      (
        (SELECT public.get_user_role()) = 'cedente'
        AND (SELECT private.usuario_e_admin_cedente(p_cedente_id))
      )
      OR (
        (SELECT public.get_user_role()) = 'consultor'
        AND private.consultor_usuario_pode_gerenciar_cedente((SELECT auth.uid()), p_cedente_id)
      )
      OR (
        (SELECT public.get_user_role()) = 'gestor'
        AND (SELECT private.gestor_tem_acesso_cedente(p_cedente_id))
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.usuario_pode_operar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (SELECT public.get_user_role()) = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.cedentes c
      WHERE c.id = p_cedente_id
        AND c.status = 'ativo'::public.cedente_status
        AND public.get_user_cedente_id() = c.id
        AND EXISTS (
          SELECT 1 FROM public.cedente_fundos cf
          JOIN public.fundos f ON f.id = cf.fundo_id
          WHERE cf.cedente_id = c.id
            AND cf.status = 'ativo'
            AND coalesce(f.ativo, true) = true
        )
    )
    WHEN (SELECT public.get_user_role()) = 'consultor'
      THEN private.consultor_usuario_pode_operar_cedente((SELECT auth.uid()), p_cedente_id)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.consultor_pode_operar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'consultor'
    AND private.consultor_usuario_pode_operar_cedente((SELECT auth.uid()), p_cedente_id);
$$;

CREATE OR REPLACE FUNCTION public.consultor_listar_cedente_ids_operacionais()
RETURNS TABLE (cedente_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT cc.cedente_id
  FROM public.consultor_usuarios cu
  JOIN public.consultores co ON co.id = cu.consultor_id
  JOIN public.consultor_cedentes cc
    ON cc.consultor_id = cu.consultor_id
   AND cc.status = 'ativo'
  WHERE cu.user_id = (SELECT auth.uid())
    AND cu.status = 'ativo'
    AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR')
    AND co.status = 'ativo'
    AND private.consultor_usuario_pode_operar_cedente((SELECT auth.uid()), cc.cedente_id)
  ORDER BY cc.cedente_id;
$$;

REVOKE ALL ON FUNCTION private.consultor_organizacao_ativa_do_usuario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.consultor_usuario_tem_papel(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.consultor_usuario_tem_acesso_fundo(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_gerenciar_cedente(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.consultor_usuario_pode_operar_cedente(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.consultor_tem_acesso_fundo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.consultor_tem_acesso_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.usuario_pode_gerenciar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.usuario_pode_operar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultor_pode_operar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultor_listar_cedente_ids_operacionais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.consultor_tem_acesso_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.consultor_tem_acesso_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.usuario_pode_gerenciar_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.usuario_pode_operar_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultor_pode_operar_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultor_listar_cedente_ids_operacionais() TO authenticated;

COMMENT ON FUNCTION private.consultor_tem_acesso_fundo(uuid) IS
  'Resolve fundo pela organizacao ativa do usuario e nega LEITOR.';
COMMENT ON FUNCTION private.consultor_tem_acesso_cedente(uuid) IS
  'Resolve Cedente e Fundo pela organizacao ativa do usuario e nega LEITOR.';

-- O legado user-centric permanece apenas para rastreabilidade historica.
DROP POLICY IF EXISTS consultor_cedente_gestor_all ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_select_own ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_select ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_insert ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_update ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_delete ON public.consultor_cedente;
REVOKE ALL ON TABLE public.consultor_cedente FROM anon, authenticated;
GRANT ALL ON TABLE public.consultor_cedente TO service_role;
COMMENT ON TABLE public.consultor_cedente IS
  'LEGADO C1.1: vinculo user-centric congelado, sem uso na autorizacao corrente.';

-- Carteiras C2/C3 passam a consultar o mesmo escopo organizacional.
CREATE OR REPLACE FUNCTION private.buscar_cedentes_elegiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10
)
RETURNS TABLE (id uuid, razao_social text, nome_fantasia text, cnpj text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH parametros AS (
    SELECT
      pg_catalog.btrim(coalesce(p_termo, '')) AS termo,
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(coalesce(p_termo, '')))) AS termo_normalizado,
      pg_catalog.regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      greatest(1, least(coalesce(p_limite, 10), 10)) AS limite
  )
  SELECT DISTINCT c.id, c.razao_social, c.nome_fantasia, c.cnpj
  FROM public.consultor_usuarios cu
  JOIN public.consultor_cedentes cc ON cc.consultor_id = cu.consultor_id
  JOIN public.cedentes c ON c.id = cc.cedente_id
  CROSS JOIN parametros p
  WHERE cu.user_id = (SELECT auth.uid())
    AND private.consultor_usuario_pode_operar_cedente((SELECT auth.uid()), c.id)
    AND (
      p.termo = ''
      OR (
        pg_catalog.char_length(p.termo) >= 4
        AND (
          pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(c.razao_social)), p.termo_normalizado) > 0
          OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(coalesce(c.nome_fantasia, ''))), p.termo_normalizado) > 0
          OR (p.termo_cnpj <> '' AND pg_catalog.strpos(pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g'), p.termo_cnpj) > 0)
        )
      )
    )
  ORDER BY c.razao_social, c.id
  LIMIT (SELECT limite FROM parametros);
$$;

CREATE OR REPLACE FUNCTION private.listar_fundos_criacao_cedente_consultor()
RETURNS TABLE (id uuid, nome text, cnpj text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT f.id, f.nome, f.cnpj
  FROM public.fundos f
  WHERE coalesce(f.ativo, true) = true
    AND private.consultor_usuario_tem_acesso_fundo((SELECT auth.uid()), f.id)
  ORDER BY f.nome, f.id;
$$;

CREATE OR REPLACE FUNCTION private.listar_cedentes_gerenciados_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, razao_social text, nome_fantasia text, cnpj text, status text,
  vinculo_status text, fundo_id uuid, fundo_nome text,
  onboarding_concluido_em timestamptz, documentos_pendentes bigint, total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH parametros AS (
    SELECT
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(coalesce(p_termo, '')))) AS termo,
      pg_catalog.regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      greatest(1, least(coalesce(p_limite, 10), 50)) AS limite,
      greatest(0, coalesce(p_offset, 0)) AS deslocamento
  ), base AS (
    SELECT DISTINCT
      c.id, c.razao_social, c.nome_fantasia, c.cnpj,
      c.status::text AS status, cc.status AS vinculo_status,
      cf.fundo_id, f.nome AS fundo_nome, c.onboarding_concluido_em,
      (
        SELECT count(*) FROM public.documentos d
        WHERE d.cedente_id = c.id AND d.status <> 'aprovado'::public.documento_status
      ) AS documentos_pendentes
    FROM public.consultor_usuarios cu
    JOIN public.consultor_cedentes cc ON cc.consultor_id = cu.consultor_id
    JOIN public.cedentes c ON c.id = cc.cedente_id
    JOIN public.cedente_fundos cf ON cf.cedente_id = c.id AND cf.status IN ('ativo', 'suspenso')
    JOIN public.consultor_fundos cfu
      ON cfu.consultor_id = cu.consultor_id
     AND cfu.fundo_id = cf.fundo_id
     AND cfu.status = 'ativo'
    JOIN public.fundos f ON f.id = cf.fundo_id AND coalesce(f.ativo, true) = true
    CROSS JOIN parametros p
    WHERE cu.user_id = (SELECT auth.uid())
      AND cu.status = 'ativo'
      AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR')
      AND cc.status IN ('pendente', 'ativo')
      AND private.consultor_usuario_pode_gerenciar_cedente((SELECT auth.uid()), c.id)
      AND (
        p.termo = ''
        OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(c.razao_social)), p.termo) > 0
        OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(coalesce(c.nome_fantasia, ''))), p.termo) > 0
        OR (p.termo_cnpj <> '' AND pg_catalog.strpos(pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g'), p.termo_cnpj) > 0)
      )
  )
  SELECT base.*, count(*) OVER () AS total_count
  FROM base
  ORDER BY base.razao_social, base.id
  LIMIT (SELECT limite FROM parametros)
  OFFSET (SELECT deslocamento FROM parametros);
$$;

-- A criacao continua atomica, mas o vinculo pertence a organizacao e o ator
-- individual permanece em logs_auditoria.
CREATE OR REPLACE FUNCTION public.criar_cedente_consultor(
  p_fundo_id uuid,
  p_cnpj text,
  p_razao_social text,
  p_nome_fantasia text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_consultor_id uuid;
  v_cnpj text := pg_catalog.regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_razao_social text := pg_catalog.btrim(coalesce(p_razao_social, ''));
  v_nome_fantasia text := nullif(pg_catalog.btrim(coalesce(p_nome_fantasia, '')), '');
  v_cedente_id uuid;
  v_cedente_fundo_id uuid;
  v_vinculo_id uuid;
BEGIN
  v_consultor_id := private.consultor_organizacao_ativa_do_usuario(v_actor_id);
  IF v_actor_id IS NULL OR v_consultor_id IS NULL
     OR NOT private.consultor_usuario_tem_papel(v_actor_id, ARRAY['OWNER', 'ADMIN', 'OPERADOR']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Consultor inativo ou sem permissao para cadastrar Cedente.';
  END IF;
  IF p_fundo_id IS NULL OR NOT private.consultor_usuario_tem_acesso_fundo(v_actor_id, p_fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Fundo nao autorizado para esta Consultoria.';
  END IF;
  IF NOT (SELECT private.cnpj_valido(v_cnpj)) OR pg_catalog.length(v_razao_social) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CNPJ ou Razao Social invalidos.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('c3-cedente:' || v_cnpj));
  IF EXISTS (SELECT 1 FROM public.cedentes c WHERE pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g') = v_cnpj) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CNPJ ja cadastrado.';
  END IF;

  INSERT INTO public.cedentes (
    user_id, cnpj, razao_social, nome_fantasia, status, fundo_id, onboarding_concluido_em
  ) VALUES (
    NULL, v_cnpj, v_razao_social, v_nome_fantasia,
    'pendente'::public.cedente_status, p_fundo_id, NULL
  ) RETURNING id INTO v_cedente_id;

  INSERT INTO public.cedente_fundos (
    cedente_id, fundo_id, status, vigente_desde, observacoes
  ) VALUES (
    v_cedente_id, p_fundo_id, 'ativo', now(), 'C3 - criado pela Consultoria'
  ) RETURNING id INTO v_cedente_fundo_id;

  INSERT INTO public.consultor_cedentes (
    consultor_id, cedente_id, comissao_percentual, status, vinculado_por
  ) VALUES (
    v_consultor_id, v_cedente_id, 0, 'pendente', v_actor_id
  ) RETURNING id INTO v_vinculo_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, ator_identificador, origem,
    tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id, 'usuario', v_actor_id::text, 'consultor_c3',
    'CEDENTE_CRIADO_POR_CONSULTOR', 'cedentes', v_cedente_id,
    pg_catalog.jsonb_build_object(
      'actor_role', 'CONSULTOR', 'consultor_id', v_consultor_id,
      'cedente_id', v_cedente_id, 'fundo_id', p_fundo_id,
      'cedente_fundo_id', v_cedente_fundo_id,
      'consultor_cedente_id', v_vinculo_id, 'vinculo_status', 'pendente'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'cedente_id', v_cedente_id,
    'cedente_fundo_id', v_cedente_fundo_id,
    'consultor_cedente_id', v_vinculo_id,
    'consultor_id', v_consultor_id,
    'status', 'pendente'
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ativados integer;
BEGIN
  IF NEW.status = 'ativo'::public.cedente_status
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.consultor_cedentes cc
    SET status = 'ativo'
    WHERE cc.cedente_id = NEW.id AND cc.status = 'pendente';
    GET DIAGNOSTICS v_ativados = ROW_COUNT;
    IF v_ativados > 0 THEN
      INSERT INTO public.logs_auditoria (
        usuario_id, ator_tipo, ator_identificador, origem,
        tipo_evento, entidade_tipo, entidade_id, dados_depois
      ) VALUES (
        auth.uid(), 'usuario', auth.uid()::text, 'gestor_aprovacao_c3',
        'VINCULO_CONSULTORIA_ATIVADO_APOS_APROVACAO', 'cedentes', NEW.id,
        pg_catalog.jsonb_build_object(
          'actor_role', pg_catalog.upper(coalesce(public.get_user_role(), '')),
          'cedente_id', NEW.id, 'vinculos_ativados', v_ativados
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Reinstala o trigger para registrar semanticamente o cutover organizacional.
DROP TRIGGER IF EXISTS cedentes_ativar_vinculo_consultor_c3 ON public.cedentes;
CREATE TRIGGER cedentes_ativar_vinculo_consultor_c3
  AFTER UPDATE OF status ON public.cedentes
  FOR EACH ROW EXECUTE FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao();

REVOKE ALL ON FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao() FROM PUBLIC, anon, authenticated;

-- Policies legadas com join direto no usuario sao substituidas por predicates
-- organizacionais. Ramos de Cedente/Gestor permanecem equivalentes.
DROP POLICY IF EXISTS contas_escrow_consultor_select ON public.contas_escrow;
CREATE POLICY contas_escrow_consultor_select
  ON public.contas_escrow FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.consultor_tem_acesso_cedente(contas_escrow.cedente_id))
  );

DROP POLICY IF EXISTS ctes_contexto_select ON public.ctes;
CREATE POLICY ctes_contexto_select
  ON public.ctes FOR SELECT TO authenticated
  USING (
    ((SELECT public.get_user_role()) = 'cedente' AND cedente_id = (SELECT public.get_user_cedente_id()))
    OR ((SELECT public.get_user_role()) = 'consultor' AND (SELECT private.consultor_tem_acesso_cedente(ctes.cedente_id)))
  );

DROP POLICY IF EXISTS documento_vinculos_contexto_select ON public.documento_vinculos;
CREATE POLICY documento_vinculos_contexto_select
  ON public.documento_vinculos FOR SELECT TO authenticated
  USING (
    cedente_id = (SELECT public.get_user_cedente_id())
    OR (
      (SELECT public.get_user_role()) = 'consultor'
      AND (SELECT private.consultor_tem_acesso_cedente(documento_vinculos.cedente_id))
    )
  );

DROP POLICY IF EXISTS documento_requisito_contexto_select ON public.documento_requisito_instancias;
CREATE POLICY documento_requisito_contexto_select
  ON public.documento_requisito_instancias FOR SELECT TO authenticated
  USING (
    cedente_id = (SELECT public.get_user_cedente_id())
    OR (
      (SELECT public.get_user_role()) = 'consultor'
      AND (SELECT private.consultor_tem_acesso_cedente(documento_requisito_instancias.cedente_id))
    )
  );

DROP POLICY IF EXISTS documentos_repositorio_vinculo_select ON public.documentos_repositorio;
CREATE POLICY documentos_repositorio_vinculo_select
  ON public.documentos_repositorio FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documento_vinculos v
      WHERE v.documento_id = documentos_repositorio.id
        AND (
          v.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(v.cedente_id))
          )
        )
    )
  );

DROP POLICY IF EXISTS documento_versoes_vinculo_select ON public.documento_versoes;
CREATE POLICY documento_versoes_vinculo_select
  ON public.documento_versoes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documento_vinculos v
      WHERE v.documento_id = documento_versoes.documento_id
        AND (
          v.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(v.cedente_id))
          )
        )
    )
  );

DROP POLICY IF EXISTS documento_analises_contexto_select ON public.documento_analises;
CREATE POLICY documento_analises_contexto_select
  ON public.documento_analises FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documento_versoes dv
      JOIN public.documento_vinculos v ON v.documento_id = dv.documento_id
      WHERE dv.id = documento_analises.documento_versao_id
        AND (
          v.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(v.cedente_id))
          )
        )
    )
  );

DROP POLICY IF EXISTS movimentos_escrow_consultor_select ON public.movimentos_escrow;
CREATE POLICY movimentos_escrow_consultor_select
  ON public.movimentos_escrow FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.contas_escrow ce
      WHERE ce.id = movimentos_escrow.conta_escrow_id
        AND (SELECT private.consultor_tem_acesso_cedente(ce.cedente_id))
    )
  );

DROP POLICY IF EXISTS operacoes_nf_parcelas_cedente_select ON public.operacoes_nf_parcelas;
CREATE POLICY operacoes_nf_parcelas_cedente_select
  ON public.operacoes_nf_parcelas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nf_parcelas.nota_fiscal_id
        AND (
          nf.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(nf.cedente_id))
          )
        )
    )
  );

DROP POLICY IF EXISTS politica_operacional_versoes_vinculo_select ON public.politica_operacional_versoes;
CREATE POLICY politica_operacional_versoes_vinculo_select
  ON public.politica_operacional_versoes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = politica_operacional_versoes.politica_operacional_id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE cf.fundo_id = politica_operacional_versoes.fundo_id
        AND cf.status = 'ativo'
        AND (
          cf.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(cf.cedente_id))
            AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
          )
        )
    )
  );

DROP POLICY IF EXISTS politica_requisitos_vinculo_select ON public.politica_requisitos_documentais;
CREATE POLICY politica_requisitos_vinculo_select
  ON public.politica_requisitos_documentais FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.politica_operacional_versoes pov
      JOIN public.cedente_fundos cf ON cf.fundo_id = pov.fundo_id AND cf.status = 'ativo'
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = pov.politica_operacional_id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE pov.id = politica_requisitos_documentais.politica_operacional_versao_id
        AND (
          cf.cedente_id = (SELECT public.get_user_cedente_id())
          OR (
            (SELECT public.get_user_role()) = 'consultor'
            AND (SELECT private.consultor_tem_acesso_cedente(cf.cedente_id))
            AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
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
AS $$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor'
      THEN private.gestor_tem_acesso_entrega(p_entrega_id)
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.nota_fiscal_entregas entrega
      JOIN public.operacoes operacao ON operacao.id = entrega.operacao_id
      WHERE entrega.id = p_entrega_id
        AND operacao.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.nota_fiscal_entregas entrega
      JOIN public.operacoes operacao ON operacao.id = entrega.operacao_id
      WHERE entrega.id = p_entrega_id
        AND private.consultor_tem_acesso_cedente(operacao.cedente_id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_documento_gerado(p_documento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor' THEN EXISTS (
      SELECT 1 FROM public.documentos_gerados dg
      WHERE dg.id = p_documento_id
        AND private.gestor_tem_acesso_fundo_operacional(dg.fundo_id)
    )
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.documentos_gerados dg
      WHERE dg.id = p_documento_id
        AND dg.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.documentos_gerados dg
      WHERE dg.id = p_documento_id
        AND private.consultor_tem_acesso_cedente(dg.cedente_id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_integracao_execucao(p_execucao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.get_user_role()::text = 'gestor' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      JOIN public.usuario_fundos uf ON uf.fundo_id = e.fundo_id
      JOIN public.fundos f ON f.id = e.fundo_id
      WHERE e.id = p_execucao_id AND uf.usuario_id = (SELECT auth.uid())
        AND uf.status = 'ativo' AND f.ativo IS TRUE
    )
    WHEN public.get_user_role()::text = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = coalesce(e.operacao_id, ro.operacao_id)
      WHERE e.id = p_execucao_id
        AND private.consultor_tem_acesso_cedente(o.cedente_id)
    )
    WHEN public.get_user_role()::text = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = coalesce(e.operacao_id, ro.operacao_id)
      JOIN public.cedentes c ON c.id = o.cedente_id
      WHERE e.id = p_execucao_id AND private.usuario_tem_acesso_cedente(c.id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_remessa_cnab(p_remessa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor' THEN EXISTS (
      SELECT 1 FROM public.remessas_cnab remessa
      WHERE remessa.id = p_remessa_id
        AND private.gestor_tem_acesso_fundo_operacional(remessa.fundo_id)
    )
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1 FROM public.remessas_cnab remessa
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = remessa.id
      JOIN public.operacoes operacao ON operacao.id = ro.operacao_id
      WHERE remessa.id = p_remessa_id
        AND operacao.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1 FROM public.remessas_cnab remessa
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = remessa.id
      JOIN public.operacoes operacao ON operacao.id = ro.operacao_id
      WHERE remessa.id = p_remessa_id
        AND private.consultor_tem_acesso_cedente(operacao.cedente_id)
    )
    ELSE false
  END;
$$;

-- A fronteira transacional C2 valida a organizacao e o Fundo exato antes de
-- reservar qualquer NF. O usuario autenticado continua como actor_id.
CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
  p_cedente_id uuid, p_cedente_fundo_id uuid, p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid, p_politica_versao integer, p_politica_snapshot jsonb,
  p_politica_snapshot_hash text, p_aceite_sacado_exigido boolean, p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[], p_valor_bruto_total numeric, p_taxa_desconto numeric,
  p_prazo_dias integer, p_valor_liquido_desembolso numeric, p_data_vencimento date,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid(); actor_role text := public.get_user_role();
  cedente_row record; vinculo_row record; escrow_row record; existing_op record;
  expected_count integer; matched_count integer; already_linked_count integer;
  parcelas_expected_count integer; parcelas_matched_count integer;
  inserted_op_id uuid; now_ts timestamptz := now(); politica_atribuicao_row record;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF actor_role NOT IN ('cedente', 'consultor') THEN RAISE EXCEPTION 'Somente Cedente ou Consultor pode solicitar antecipacao'; END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma NF'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN RAISE EXCEPTION 'Chave de idempotencia invalida'; END IF;

  SELECT * INTO cedente_row FROM public.cedentes WHERE id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de Cedente nao encontrado'; END IF;
  IF cedente_row.status <> 'ativo' THEN RAISE EXCEPTION 'Cedente nao esta aprovado e ativo'; END IF;

  IF actor_role = 'cedente' THEN
    IF public.get_user_cedente_id() IS DISTINCT FROM p_cedente_id THEN
      RAISE EXCEPTION 'Cedente sem acesso ao cadastro informado';
    END IF;
  ELSIF NOT private.consultor_usuario_pode_operar_cedente(actor_id, p_cedente_id) THEN
    RAISE EXCEPTION 'Consultor sem vinculo organizacional ativo com o Cedente informado';
  END IF;

  SELECT * INTO existing_op FROM public.operacoes WHERE solicitacao_idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF existing_op.cedente_id IS DISTINCT FROM p_cedente_id
       OR existing_op.cedente_fundo_id IS DISTINCT FROM p_cedente_fundo_id THEN
      RAISE EXCEPTION 'Chave de idempotencia pertence a outro contexto operacional';
    END IF;
    RETURN jsonb_build_object('operacao_id', existing_op.id, 'idempotent_replay', true, 'status', existing_op.status);
  END IF;

  SELECT * INTO vinculo_row FROM public.cedente_fundos WHERE id = p_cedente_fundo_id AND cedente_id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado'; END IF;
  IF vinculo_row.status <> 'ativo' THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = vinculo_row.fundo_id AND coalesce(f.ativo, true) = true) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;
  IF actor_role = 'consultor'
     AND NOT private.consultor_usuario_tem_acesso_fundo(actor_id, vinculo_row.fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para esta Consultoria';
  END IF;

  SELECT cfp.* INTO politica_atribuicao_row
  FROM public.cedente_fundo_politicas cfp
  JOIN public.politicas_operacionais p ON p.id = cfp.politica_operacional_id
  JOIN public.politica_operacional_versoes v ON v.id = p_politica_operacional_versao_id AND v.politica_operacional_id = p.id
  WHERE cfp.cedente_fundo_id = p_cedente_fundo_id AND cfp.politica_operacional_id = p_politica_operacional_id
    AND cfp.status = 'ativa' AND cfp.vigente_desde <= now_ts AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now_ts)
    AND p.fundo_id = vinculo_row.fundo_id AND p.status = 'ativa'
    AND v.fundo_id = vinculo_row.fundo_id AND v.publicada_em IS NOT NULL AND v.publicada_por IS NOT NULL
    AND v.vigente_ate IS NULL AND v.versao = p_politica_versao
  ORDER BY cfp.vigente_desde DESC LIMIT 1;
  IF politica_atribuicao_row.id IS NULL THEN RAISE EXCEPTION 'Politica operacional vigente nao vinculada ao cedente-fundo'; END IF;

  SELECT * INTO escrow_row FROM public.contas_escrow WHERE cedente_id = p_cedente_id AND status = 'ativa'
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta escrow nao encontrada ou inativa'; END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count FROM unnest(p_nota_fiscal_ids) AS item(nf_id);
  IF expected_count <> cardinality(p_nota_fiscal_ids) THEN RAISE EXCEPTION 'A selecao contem NFs repetidas'; END IF;

  WITH locked_nfs AS (
    SELECT nf.id FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count FROM locked_nfs;
  IF matched_count <> expected_count THEN RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas'; END IF;

  -- P14: operacoes_nfs preserva historico. Somente operacoes em status que
  -- reservam a NF bloqueiam o novo pedido; reprovada permanece reutilizavel.
  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  JOIN public.operacoes op ON op.id = onf.operacao_id
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = onf.nota_fiscal_id)
    AND private.operacao_status_reserva_nf(op.status);
  IF already_linked_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1401',
      MESSAGE = 'NF_ALREADY_LINKED_TO_ACTIVE_OPERATION';
  END IF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    SELECT count(DISTINCT id) INTO parcelas_expected_count FROM unnest(p_parcela_ids) AS item(id);
    IF parcelas_expected_count <> cardinality(p_parcela_ids) THEN RAISE EXCEPTION 'A selecao contem parcelas repetidas'; END IF;

    WITH locked_parcelas AS (
      SELECT p.id FROM public.nota_fiscal_parcelas p
      JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
      WHERE p.id = ANY(p_parcela_ids) AND p.status = 'disponivel'
        AND nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
        AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      FOR UPDATE OF p
    )
    SELECT count(DISTINCT id) INTO parcelas_matched_count FROM locked_parcelas;
    IF parcelas_matched_count <> parcelas_expected_count THEN
      RAISE EXCEPTION 'Uma ou mais parcelas nao estao disponiveis ou nao pertencem ao contexto ativo';
    END IF;

    IF EXISTS (
      SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
      WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.nota_fiscal_parcelas p
          WHERE p.nota_fiscal_id = item.nf_id AND p.id = ANY(p_parcela_ids)
        )
    ) THEN
      RAISE EXCEPTION 'Toda NF com parcelas precisa ter ao menos uma parcela selecionada';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
    WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
  ) THEN
    RAISE EXCEPTION 'NF com parcelas precisa informar quais parcelas foram selecionadas';
  END IF;

  INSERT INTO public.operacoes (
    cedente_id, conta_escrow_id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso,
    data_vencimento, status, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id,
    politica_atribuicao_id, politica_versao, politica_snapshot, politica_snapshot_hash,
    contexto_configuracao_status, contexto_capturado_em, aceite_sacado_exigido, aceite_sacado_status,
    aceite_sacado_em, cessao_efetivada_em, solicitacao_idempotency_key
  ) VALUES (
    p_cedente_id, escrow_row.id, p_valor_bruto_total, p_taxa_desconto, p_prazo_dias, greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento, 'solicitada', p_cedente_fundo_id, p_politica_operacional_id, p_politica_operacional_versao_id,
    politica_atribuicao_row.id, p_politica_versao, p_politica_snapshot, p_politica_snapshot_hash,
    'completo', now_ts, p_aceite_sacado_exigido, p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END, NULL, p_idempotency_key
  ) RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    INSERT INTO public.operacoes_nf_parcelas (operacao_id, nota_fiscal_id, parcela_id)
    SELECT inserted_op_id, p.nota_fiscal_id, p.id
    FROM public.nota_fiscal_parcelas p
    WHERE p.id = ANY(p_parcela_ids);

    UPDATE public.nota_fiscal_parcelas SET status = 'em_operacao' WHERE id = ANY(p_parcela_ids);
  END IF;

  UPDATE public.notas_fiscais nf
  SET status = 'em_antecipacao'
  WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id AND nf.cedente_fundo_id = p_cedente_fundo_id
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = nf.id AND p.status = 'disponivel');

  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (actor_id, 'OPERACAO_SOLICITADA', 'operacoes', inserted_op_id, jsonb_build_object(
      'solicitado_por_role', actor_role,
      'consultor_id', CASE WHEN actor_role = 'consultor' THEN private.consultor_organizacao_ativa_do_usuario(actor_id) ELSE NULL END,
      'cedente_id', p_cedente_id,
      'valor_bruto_total', p_valor_bruto_total, 'taxa_desconto', p_taxa_desconto, 'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids, 'parcela_ids', p_parcela_ids, 'cedente_fundo_id', p_cedente_fundo_id,
      'politica_atribuicao_id', politica_atribuicao_row.id, 'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
  ));

  RETURN jsonb_build_object('operacao_id', inserted_op_id, 'idempotent_replay', false, 'status', 'solicitada',
    'politica_atribuicao_id', politica_atribuicao_row.id);
END;
$$;

-- Dashboard e relatorio existentes preservam o contrato JSON e trocam apenas
-- a origem da carteira para a organizacao ativa.
CREATE OR REPLACE FUNCTION public.dashboard_consultor_resumo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'consultor' THEN
    RAISE EXCEPTION 'Perfil nao autorizado'
      USING ERRCODE = '42501';
  END IF;

  WITH carteira AS (
    SELECT cc.cedente_id, cc.comissao_percentual, cc.created_at,
           c.razao_social, c.cnpj, c.status
    FROM public.consultor_usuarios cu
    JOIN public.consultor_cedentes cc ON cc.consultor_id = cu.consultor_id
    JOIN public.cedentes c ON c.id = cc.cedente_id
    WHERE cu.user_id = auth.uid()
      AND private.consultor_usuario_pode_operar_cedente(auth.uid(), c.id)
  ),
  operacoes_escopo AS (
    SELECT o.*, c.comissao_percentual, c.razao_social
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
  ),
  recentes AS (
    SELECT *
    FROM operacoes_escopo
    ORDER BY created_at DESC, id DESC
    LIMIT 5
  ),
  carteira_recente AS (
    SELECT *
    FROM carteira
    ORDER BY created_at DESC, cedente_id DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'cedentesTotal', (SELECT count(*) FROM carteira),
    'cedentesAtivos', (SELECT count(*) FROM carteira WHERE status::text = 'ativo'),
    'opsAtivas', (
      SELECT count(*)
      FROM operacoes_escopo
      WHERE status::text IN ('em_andamento', 'solicitada', 'em_analise')
    ),
    'volumeAtivo', COALESCE((
      SELECT sum(valor_bruto_total)
      FROM operacoes_escopo
      WHERE status::text IN ('em_andamento', 'solicitada', 'em_analise')
    ), 0),
    'volumeMes', COALESCE((
      SELECT sum(valor_bruto_total)
      FROM operacoes_escopo
      WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        AND created_at < (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '1 month'
        AND status::text NOT IN ('cancelada', 'reprovada')
    ), 0),
    'comissaoEstimada', COALESCE((
      SELECT sum(valor_liquido_desembolso * comissao_percentual / 100)
      FROM operacoes_escopo
      WHERE status::text = 'em_andamento'
    ), 0),
    'operacoesRecentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'cedenteNome', r.razao_social,
        'valorBruto', r.valor_bruto_total,
        'status', r.status::text,
        'aceiteSacadoExigido', r.aceite_sacado_exigido,
        'aceiteSacadoStatus', r.aceite_sacado_status::text,
        'dataVencimento', r.data_vencimento,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC, r.id DESC)
      FROM recentes r
    ), '[]'::jsonb),
    'carteiraRecente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', c.cedente_id,
        'razaoSocial', c.razao_social,
        'cnpj', c.cnpj,
        'status', c.status::text,
        'comissaoPercentual', c.comissao_percentual
      ) ORDER BY c.created_at DESC, c.cedente_id DESC)
      FROM carteira_recente c
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_gestor_analitico(
  p_fundo_id uuid,
  p_mes text,
  p_busca text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL,
  p_data_inicial date DEFAULT NULL,
  p_data_final date DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_page_size integer DEFAULT 10,
  p_sort text DEFAULT 'volume_total',
  p_direction text DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mes_inicio timestamp with time zone;
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'gestor'
     OR NOT EXISTS (
       SELECT 1 FROM public.usuario_fundos uf
       WHERE uf.usuario_id = auth.uid()
         AND uf.fundo_id = p_fundo_id
         AND uf.status = 'ativo'
     )
  THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Mes de referencia invalido' USING ERRCODE = '22023';
  END IF;

  IF p_offset < 0 OR p_offset > 39999960 OR p_page_size NOT IN (10, 20, 40)
     OR p_sort NOT IN ('volume_total', 'volume_mes', 'operacoes_total', 'cedente')
     OR p_direction NOT IN ('asc', 'desc')
     OR (p_status IS NOT NULL AND p_status NOT IN (
       'solicitada', 'em_analise', 'aprovada', 'em_andamento',
       'liquidada', 'inadimplente', 'reprovada', 'cancelada'
     ))
     OR length(COALESCE(p_busca, '')) > 120
     OR (p_data_inicial IS NOT NULL AND p_data_final IS NOT NULL AND p_data_inicial > p_data_final)
  THEN
    RAISE EXCEPTION 'Parametros de paginacao ou ordenacao invalidos' USING ERRCODE = '22023';
  END IF;

  v_mes_inicio := to_date(p_mes || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'UTC';
  WITH links AS (
    SELECT cf.id, cf.cedente_id
    FROM public.cedente_fundos cf
    WHERE cf.fundo_id = p_fundo_id
      AND cf.status = 'ativo'
  ),
  cedentes_escopo AS (
    SELECT DISTINCT c.id, c.razao_social, c.cnpj, c.status
    FROM links l
    JOIN public.cedentes c ON c.id = l.cedente_id
  ),
  operacoes_escopo AS (
    SELECT o.*
    FROM public.operacoes o
    JOIN links l ON l.id = o.cedente_fundo_id
  ),
  operacoes_tabela AS (
    SELECT o.*
    FROM operacoes_escopo o
    WHERE (p_status IS NULL OR o.status::text = p_status)
      AND (p_data_inicial IS NULL OR o.created_at >= (p_data_inicial::timestamp AT TIME ZONE 'UTC'))
      AND (p_data_final IS NULL OR o.created_at < ((p_data_final + 1)::timestamp AT TIME ZONE 'UTC'))
  ),
  linhas AS (
    SELECT
      c.id AS cedente_id,
      c.razao_social,
      c.cnpj,
      COALESCE(sum(o.valor_bruto_total) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
          AND (p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada'))
      ), 0) AS volume_mes,
      count(o.id) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
          AND (p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada'))
      ) AS operacoes_mes,
      COALESCE(sum(o.valor_bruto_total) FILTER (
        WHERE p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada')
      ), 0) AS volume_total,
      count(o.id) FILTER (
        WHERE p_status IS NOT NULL OR o.status::text NOT IN ('cancelada', 'reprovada')
      ) AS operacoes_total,
      count(o.id) FILTER (WHERE o.status::text = 'inadimplente') AS inadimplentes
    FROM cedentes_escopo c
    LEFT JOIN operacoes_tabela o ON o.cedente_id = c.id
    WHERE c.status::text = 'ativo'
      AND (p_cedente_id IS NULL OR c.id = p_cedente_id)
      AND (
        COALESCE(trim(p_busca), '') = ''
        OR c.razao_social ILIKE '%' || trim(p_busca) || '%'
        OR (
          regexp_replace(trim(p_busca), '[^0-9]', '', 'g') <> ''
          AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') LIKE '%' || regexp_replace(trim(p_busca), '[^0-9]', '', 'g') || '%'
        )
    )
    GROUP BY c.id, c.razao_social, c.cnpj
    HAVING (
      (p_status IS NULL AND p_data_inicial IS NULL AND p_data_final IS NULL)
      OR count(o.id) > 0
    )
  ),
  linhas_paginadas AS (
    SELECT *,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_total END DESC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_total END ASC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
          cedente_id
      ) AS ordem
    FROM linhas
    ORDER BY
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_total END DESC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_total END ASC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
      cedente_id
    LIMIT p_page_size OFFSET p_offset
  ),
  ops_mes AS (
    SELECT *
    FROM operacoes_escopo
    WHERE created_at >= v_mes_inicio
      AND created_at < v_mes_inicio + interval '1 month'
  ),
  ops_validas_mes AS (
    SELECT *
    FROM ops_mes
    WHERE status::text NOT IN ('cancelada', 'reprovada')
  ),
  resumo AS (
    SELECT jsonb_build_object(
      'volumeBrutoMes', COALESCE((SELECT sum(valor_bruto_total) FROM ops_validas_mes), 0),
      'receitaMes', COALESCE((SELECT sum(valor_bruto_total - valor_liquido_desembolso) FROM ops_validas_mes), 0),
      'taxaMedia', COALESCE((SELECT avg(taxa_desconto) FROM ops_validas_mes), 0),
      'operacoesValidasMes', (SELECT count(*) FROM ops_validas_mes),
      'operacoesAtivasMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'em_andamento'),
      'operacoesLiquidadasMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'liquidada'),
      'operacoesInadimplentesMes', (SELECT count(*) FROM ops_validas_mes WHERE status::text = 'inadimplente'),
      'operacoesAguardandoAceiteMes', (
        SELECT count(*) FROM ops_mes
        WHERE status::text IN ('solicitada', 'em_analise')
          AND aceite_sacado_exigido IS NOT FALSE
          AND aceite_sacado_status::text IS DISTINCT FROM 'aceito'
      ),
      'operacoesProntasAnaliseMes', (
        SELECT count(*) FROM ops_mes
        WHERE status::text IN ('solicitada', 'em_analise')
          AND (
            aceite_sacado_exigido IS FALSE
            OR aceite_sacado_status::text IN ('dispensado', 'aceito')
          )
      ),
      'operacoesReprovadasMes', (SELECT count(*) FROM ops_mes WHERE status::text = 'reprovada'),
      'operacoesCanceladasMes', (SELECT count(*) FROM ops_mes WHERE status::text = 'cancelada'),
      'volumeTotalGeral', COALESCE((
        SELECT sum(valor_bruto_total)
        FROM operacoes_escopo
        WHERE status::text NOT IN ('cancelada', 'reprovada')
      ), 0),
      'operacoesTotalGeral', (
        SELECT count(*)
        FROM operacoes_escopo
        WHERE status::text NOT IN ('cancelada', 'reprovada')
      ),
      'mesesDisponiveis', COALESCE((
        SELECT jsonb_agg(mes ORDER BY mes DESC)
        FROM (
          SELECT DISTINCT to_char(timezone('UTC', created_at), 'YYYY-MM') AS mes
          FROM operacoes_escopo
        ) meses
      ), '[]'::jsonb)
    ) AS value
  )
  SELECT jsonb_build_object(
    'resumo', (SELECT value FROM resumo),
    'total', (SELECT count(*) FROM linhas),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', l.cedente_id,
        'razaoSocial', l.razao_social,
        'cnpj', l.cnpj,
        'volumeMes', l.volume_mes,
        'operacoesMes', l.operacoes_mes,
        'volumeTotal', l.volume_total,
        'operacoesTotal', l.operacoes_total,
        'inadimplentes', l.inadimplentes
      ) ORDER BY l.ordem)
      FROM linhas_paginadas l
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_consultor_analitico(
  p_mes text,
  p_busca text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL,
  p_data_inicial date DEFAULT NULL,
  p_data_final date DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_page_size integer DEFAULT 10,
  p_sort text DEFAULT 'volume_total',
  p_direction text DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mes_inicio timestamp with time zone;
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'consultor' THEN
    RAISE EXCEPTION 'Perfil nao autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR p_offset < 0
     OR p_offset > 39999960
     OR p_page_size NOT IN (10, 20, 40)
     OR p_sort NOT IN ('volume_total', 'volume_mes', 'operacoes_total', 'cedente')
     OR p_direction NOT IN ('asc', 'desc')
     OR (p_status IS NOT NULL AND p_status NOT IN ('em_andamento', 'liquidada'))
     OR length(COALESCE(p_busca, '')) > 120
     OR (p_data_inicial IS NOT NULL AND p_data_final IS NOT NULL AND p_data_inicial > p_data_final)
  THEN
    RAISE EXCEPTION 'Parametros de relatorio invalidos' USING ERRCODE = '22023';
  END IF;

  v_mes_inicio := to_date(p_mes || '-01', 'YYYY-MM-DD')::timestamp AT TIME ZONE 'UTC';
  WITH carteira AS (
    SELECT cc.cedente_id, cc.comissao_percentual,
           c.razao_social, c.cnpj, c.status
    FROM public.consultor_usuarios cu
    JOIN public.consultor_cedentes cc ON cc.consultor_id = cu.consultor_id
    JOIN public.cedentes c ON c.id = cc.cedente_id
    WHERE cu.user_id = auth.uid()
      AND private.consultor_usuario_pode_operar_cedente(auth.uid(), c.id)
  ),
  operacoes_escopo AS (
    SELECT o.*, c.comissao_percentual
    FROM public.operacoes o
    JOIN carteira c ON c.cedente_id = o.cedente_id
    WHERE o.status::text IN ('em_andamento', 'liquidada')
  ),
  operacoes_tabela AS (
    SELECT o.*
    FROM operacoes_escopo o
    WHERE (p_status IS NULL OR o.status::text = p_status)
      AND (p_data_inicial IS NULL OR o.created_at >= (p_data_inicial::timestamp AT TIME ZONE 'UTC'))
      AND (p_data_final IS NULL OR o.created_at < ((p_data_final + 1)::timestamp AT TIME ZONE 'UTC'))
  ),
  linhas AS (
    SELECT
      c.cedente_id,
      c.razao_social,
      c.cnpj,
      c.status::text AS status,
      c.comissao_percentual,
      COALESCE(sum(o.valor_liquido_desembolso) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ), 0) AS volume_mes,
      COALESCE(sum(o.valor_liquido_desembolso * c.comissao_percentual / 100) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ), 0) AS comissao_mes,
      count(o.id) FILTER (
        WHERE o.created_at >= v_mes_inicio
          AND o.created_at < v_mes_inicio + interval '1 month'
      ) AS operacoes_mes,
      COALESCE(sum(o.valor_bruto_total), 0) AS volume_total
    FROM carteira c
    LEFT JOIN operacoes_tabela o ON o.cedente_id = c.cedente_id
    WHERE (p_cedente_id IS NULL OR c.cedente_id = p_cedente_id)
      AND (
        COALESCE(trim(p_busca), '') = ''
        OR c.razao_social ILIKE '%' || trim(p_busca) || '%'
        OR (
          regexp_replace(trim(p_busca), '[^0-9]', '', 'g') <> ''
          AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') LIKE '%' || regexp_replace(trim(p_busca), '[^0-9]', '', 'g') || '%'
        )
    )
    GROUP BY c.cedente_id, c.razao_social, c.cnpj, c.status, c.comissao_percentual
    HAVING (
      (p_status IS NULL AND p_data_inicial IS NULL AND p_data_final IS NULL)
      OR count(o.id) > 0
    )
  ),
  linhas_paginadas AS (
    SELECT *,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
          CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
          CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_mes END DESC,
          CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_mes END ASC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
          CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
          cedente_id
      ) AS ordem
    FROM linhas
    ORDER BY
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'desc' THEN volume_total END DESC,
      CASE WHEN p_sort = 'volume_total' AND p_direction = 'asc' THEN volume_total END ASC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'desc' THEN volume_mes END DESC,
      CASE WHEN p_sort = 'volume_mes' AND p_direction = 'asc' THEN volume_mes END ASC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'desc' THEN operacoes_mes END DESC,
      CASE WHEN p_sort = 'operacoes_total' AND p_direction = 'asc' THEN operacoes_mes END ASC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'desc' THEN razao_social END DESC,
      CASE WHEN p_sort = 'cedente' AND p_direction = 'asc' THEN razao_social END ASC,
      cedente_id
    LIMIT p_page_size OFFSET p_offset
  ),
  resumo AS (
    SELECT jsonb_build_object(
      'volumeMes', COALESCE((
        SELECT sum(valor_bruto_total)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ), 0),
      'operacoesMes', (
        SELECT count(*)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ),
      'comissaoMes', COALESCE((
        SELECT sum(valor_liquido_desembolso * comissao_percentual / 100)
        FROM operacoes_escopo
        WHERE created_at >= v_mes_inicio
          AND created_at < v_mes_inicio + interval '1 month'
      ), 0),
      'volumeAcumulado', COALESCE((SELECT sum(valor_bruto_total) FROM operacoes_escopo), 0),
      'cedentesAtivos', (SELECT count(*) FROM carteira WHERE status::text = 'ativo'),
      'mesesDisponiveis', COALESCE((
        SELECT jsonb_agg(mes ORDER BY mes DESC)
        FROM (
          SELECT DISTINCT to_char(timezone('UTC', created_at), 'YYYY-MM') AS mes
          FROM operacoes_escopo
        ) meses
      ), '[]'::jsonb)
    ) AS value
  )
  SELECT jsonb_build_object(
    'resumo', (SELECT value FROM resumo),
    'total', (SELECT count(*) FROM linhas),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', l.cedente_id,
        'razaoSocial', l.razao_social,
        'cnpj', l.cnpj,
        'status', l.status,
        'percentual', l.comissao_percentual,
        'volumeMes', l.volume_mes,
        'comissaoMes', l.comissao_mes,
        'operacoesMes', l.operacoes_mes,
        'volumeTotal', l.volume_total
      ) ORDER BY l.ordem)
      FROM linhas_paginadas l
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
