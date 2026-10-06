-- NOTIFICACOES-R1. Deploy only together with fund-scoped producers and UI.
-- There is intentionally no default scope for future INSERTs.
ALTER TABLE public.notificacoes
  ADD COLUMN fundo_id uuid REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ADD COLUMN cedente_fundo_id uuid REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  ADD COLUMN cedente_id uuid REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  ADD COLUMN scope_type text;

UPDATE public.notificacoes SET scope_type = 'LEGACY_UNSCOPED';

-- Resolve only explicit domain references, never message/title/href/dedupe text.
-- This resolver is also used by the consistency guard, so backfill and new
-- writes agree about the source of truth. An unresolved entity returns no row.
CREATE FUNCTION private.notificacao_contexto_entidade(p_tipo text, p_id uuid)
RETURNS TABLE(fundo_id uuid, cedente_fundo_id uuid, cedente_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT nf.fundo_id, cf.id, nf.cedente_id
  FROM public.notas_fiscais nf
  JOIN public.cedente_fundos cf ON cf.id = nf.cedente_fundo_id
    AND cf.fundo_id = nf.fundo_id AND cf.cedente_id = nf.cedente_id
  WHERE p_tipo = 'nota_fiscal' AND nf.id = p_id
  UNION ALL
  SELECT cf.fundo_id, cf.id, op.cedente_id
  FROM public.operacoes op JOIN public.cedente_fundos cf
    ON cf.id = op.cedente_fundo_id AND cf.cedente_id = op.cedente_id
  WHERE p_tipo = 'operacao' AND op.id = p_id
  UNION ALL
  SELECT cf.fundo_id, cf.id, cf.cedente_id
  FROM public.cedente_fundos cf WHERE p_tipo = 'cedente_fundo' AND cf.id = p_id
  UNION ALL
  SELECT cf.fundo_id, cf.id, op.cedente_id
  FROM public.nota_fiscal_entregas e
  JOIN public.operacoes op ON op.id = e.operacao_id
  JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id AND cf.cedente_id = op.cedente_id
  JOIN public.notas_fiscais nf ON nf.id = e.nota_fiscal_id
    AND nf.fundo_id = cf.fundo_id AND nf.cedente_fundo_id = cf.id
  WHERE p_tipo = 'entrega' AND e.id = p_id
  UNION ALL
  SELECT ev.fundo_id, cf.id, ev.cedente_id
  FROM public.eventos_dominio ev
  JOIN public.cedente_fundos cf ON cf.id = ev.cedente_fundo_id
    AND cf.fundo_id = ev.fundo_id AND cf.cedente_id = ev.cedente_id
  WHERE p_tipo = 'evento_dominio' AND ev.id = p_id
    AND (ev.nota_fiscal_id IS NULL OR EXISTS (SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = ev.nota_fiscal_id AND nf.fundo_id = cf.fundo_id AND nf.cedente_fundo_id = cf.id))
    AND (ev.operacao_id IS NULL OR EXISTS (SELECT 1 FROM public.operacoes op
      WHERE op.id = ev.operacao_id AND op.cedente_fundo_id = cf.id));
$$;
REVOKE ALL ON FUNCTION private.notificacao_contexto_entidade(text,uuid) FROM PUBLIC, anon, authenticated, service_role;

WITH comprovadas AS (
  SELECT n.id, c.* FROM public.notificacoes n
  CROSS JOIN LATERAL private.notificacao_contexto_entidade(n.entidade_tipo, n.entidade_id) c
)
UPDATE public.notificacoes n SET scope_type = 'FUNDO', fundo_id = c.fundo_id,
  cedente_fundo_id = c.cedente_fundo_id, cedente_id = c.cedente_id
FROM comprovadas c WHERE c.id = n.id;

ALTER TABLE public.notificacoes
  ALTER COLUMN scope_type SET NOT NULL,
  ADD CONSTRAINT notificacoes_scope_check CHECK (
    (scope_type = 'FUNDO' AND fundo_id IS NOT NULL)
    OR (scope_type IN ('GLOBAL','LEGACY_UNSCOPED') AND fundo_id IS NULL
      AND cedente_fundo_id IS NULL AND cedente_id IS NULL)
  ),
  ADD CONSTRAINT notificacoes_global_tipo_check CHECK (
    scope_type <> 'GLOBAL' OR tipo IN ('mfa_reset_administrativo','seguranca_senha_alterada','institucional_global')
  );

-- Recipient authorization is internal. Callers cannot probe arbitrary users.
-- Definer is required to read canonical memberships without recursive RLS.
CREATE FUNCTION private.notificacao_usuario_acessa_fundo(p_usuario_id uuid, p_fundo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.fundos f ON f.id = p_fundo_id AND f.ativo
    WHERE p.id = p_usuario_id AND p.status::text = 'ativo' AND (
      EXISTS (SELECT 1 FROM public.usuario_papeis up
        WHERE up.usuario_id = p.id AND up.papel::text = 'super_admin' AND up.ativo)
      OR (EXISTS (SELECT 1 FROM public.usuario_fundos uf
            WHERE uf.usuario_id = p.id AND uf.fundo_id = f.id AND uf.status = 'ativo')
          AND (p.role::text = 'gestor' OR EXISTS (SELECT 1 FROM public.usuario_papeis up
            WHERE up.usuario_id = p.id AND up.papel::text = 'gestor' AND up.ativo)))
      OR (p.role::text = 'cedente' AND EXISTS (
        SELECT 1 FROM public.cedente_fundos cf JOIN public.cedentes c ON c.id = cf.cedente_id
        WHERE cf.fundo_id = f.id AND cf.status = 'ativo'
          AND cf.vigente_desde <= now() AND (cf.vigente_ate IS NULL OR cf.vigente_ate > now())
          AND (EXISTS (SELECT 1 FROM public.cedente_acessos ca
            WHERE ca.cedente_id = c.id AND ca.user_id = p.id AND ca.status = 'ATIVO')
            OR (c.user_id = p.id AND NOT EXISTS (
              SELECT 1 FROM public.cedente_acessos ca WHERE ca.cedente_id = c.id)))
      ))
      OR (p.role::text = 'sacado' AND EXISTS (SELECT 1 FROM public.sacado_acessos sa
        WHERE sa.user_id = p.id AND sa.fundo_id = f.id AND sa.status = 'ativo'))
      OR (p.role::text = 'consultor' AND EXISTS (
        SELECT 1 FROM public.consultor_usuarios cu
        JOIN public.consultores co ON co.id = cu.consultor_id AND co.status = 'ativo'
        JOIN public.consultor_fundos cf ON cf.consultor_id = cu.consultor_id
          AND cf.status = 'ativo' AND cf.fundo_id = f.id
        WHERE cu.user_id = p.id AND cu.status = 'ativo'
          AND cu.papel IN ('OWNER','ADMIN','OPERADOR','LEITOR')
      ))
    )
  );
$$;
REVOKE ALL ON FUNCTION private.notificacao_usuario_acessa_fundo(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notificacao_ator_acessa_fundo(p_fundo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND private.notificacao_usuario_acessa_fundo((SELECT auth.uid()), p_fundo_id);
$$;
REVOKE ALL ON FUNCTION private.notificacao_ator_acessa_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.notificacao_ator_acessa_fundo(uuid) TO authenticated;

CREATE FUNCTION private.notificacao_ator_ativo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.status::text = 'ativo');
$$;
REVOKE ALL ON FUNCTION private.notificacao_ator_ativo() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.notificacao_ator_ativo() TO authenticated;

-- Uncorrelated membership set: RLS computes it once per statement, not per row.
CREATE FUNCTION private.listar_fundos_notificacoes()
RETURNS TABLE(id uuid, nome text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.id,f.nome FROM public.fundos f
  WHERE (SELECT auth.uid()) IS NOT NULL AND f.ativo
    AND private.notificacao_usuario_acessa_fundo((SELECT auth.uid()),f.id)
  ORDER BY f.nome,f.id;
$$;
REVOKE ALL ON FUNCTION private.listar_fundos_notificacoes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.listar_fundos_notificacoes() TO authenticated;

CREATE FUNCTION private.validar_contexto_notificacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'lida') IS DISTINCT FROM (to_jsonb(OLD) - 'lida') THEN
      RAISE EXCEPTION 'NOTIFICACAO_CONTEXTO_IMUTAVEL' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.scope_type IS NULL OR NEW.scope_type = 'LEGACY_UNSCOPED' THEN
    RAISE EXCEPTION 'NOTIFICACAO_ESCOPO_OBRIGATORIO' USING ERRCODE = '23514';
  END IF;
  IF NEW.scope_type = 'GLOBAL' THEN
    IF NEW.entidade_tipo IS NOT NULL OR NEW.entidade_id IS NOT NULL THEN
      RAISE EXCEPTION 'NOTIFICACAO_GLOBAL_SEM_ENTIDADE_NEGOCIO' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.scope_type <> 'FUNDO' OR NEW.fundo_id IS NULL THEN
    RAISE EXCEPTION 'NOTIFICACAO_FUNDO_OBRIGATORIO' USING ERRCODE = '23514';
  END IF;
  IF NOT private.notificacao_usuario_acessa_fundo(NEW.usuario_id, NEW.fundo_id) THEN
    RAISE EXCEPTION 'NOTIFICACAO_DESTINATARIO_FORA_FUNDO' USING ERRCODE = '42501';
  END IF;
  IF NEW.cedente_fundo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cedente_fundos cf WHERE cf.id = NEW.cedente_fundo_id
      AND cf.fundo_id = NEW.fundo_id AND cf.cedente_id = NEW.cedente_id
  ) THEN
    RAISE EXCEPTION 'NOTIFICACAO_VINCULO_INCONSISTENTE' USING ERRCODE = '23514';
  END IF;
  IF NEW.cedente_id IS NOT NULL AND NEW.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'NOTIFICACAO_VINCULO_OBRIGATORIO' USING ERRCODE = '23514';
  END IF;
  IF (NEW.entidade_tipo IS NULL) <> (NEW.entidade_id IS NULL) THEN
    RAISE EXCEPTION 'NOTIFICACAO_ENTIDADE_INCOMPLETA' USING ERRCODE = '23514';
  END IF;
  IF NEW.entidade_tipo IS NOT NULL THEN
    IF NEW.entidade_tipo NOT IN ('nota_fiscal','operacao','cedente_fundo','entrega','evento_dominio') THEN
      RAISE EXCEPTION 'NOTIFICACAO_ENTIDADE_NAO_SUPORTADA' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_context FROM private.notificacao_contexto_entidade(NEW.entidade_tipo, NEW.entidade_id);
    IF NOT FOUND OR v_context.fundo_id IS DISTINCT FROM NEW.fundo_id
      OR (NEW.cedente_fundo_id IS NOT NULL AND v_context.cedente_fundo_id IS DISTINCT FROM NEW.cedente_fundo_id)
      OR (NEW.cedente_id IS NOT NULL AND v_context.cedente_id IS DISTINCT FROM NEW.cedente_id) THEN
      RAISE EXCEPTION 'NOTIFICACAO_ENTIDADE_FORA_FUNDO' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validar_contexto_notificacao() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notificacoes_contexto_guard BEFORE INSERT OR UPDATE ON public.notificacoes
FOR EACH ROW EXECUTE FUNCTION private.validar_contexto_notificacao();

DROP POLICY notificacoes_own_select ON public.notificacoes;
DROP POLICY notificacoes_own_update ON public.notificacoes;
CREATE POLICY notificacoes_own_select ON public.notificacoes FOR SELECT TO authenticated USING (
  usuario_id = (SELECT auth.uid()) AND (SELECT private.notificacao_ator_ativo()) AND (
    scope_type = 'GLOBAL' OR (scope_type = 'FUNDO' AND fundo_id IN (SELECT id FROM private.listar_fundos_notificacoes()))
  )
);
CREATE POLICY notificacoes_own_update ON public.notificacoes FOR UPDATE TO authenticated USING (
  usuario_id = (SELECT auth.uid()) AND (SELECT private.notificacao_ator_ativo()) AND (
    scope_type = 'GLOBAL' OR (scope_type = 'FUNDO' AND fundo_id IN (SELECT id FROM private.listar_fundos_notificacoes()))
  )
) WITH CHECK (
  usuario_id = (SELECT auth.uid()) AND (SELECT private.notificacao_ator_ativo()) AND (
    scope_type = 'GLOBAL' OR (scope_type = 'FUNDO' AND fundo_id IN (SELECT id FROM private.listar_fundos_notificacoes()))
  )
);
REVOKE ALL ON public.notificacoes FROM anon, authenticated;
GRANT SELECT ON public.notificacoes TO authenticated;
GRANT UPDATE(lida) ON public.notificacoes TO authenticated;

-- Private producers: callable only from trusted backend/definer functions.
-- Dedupe is scoped before INSERT; keep the existing unique constraint intact.
CREATE FUNCTION private.criar_notificacao_fundo(
  p_usuario_id uuid, p_fundo_id uuid, p_titulo text, p_mensagem text, p_tipo text,
  p_dedupe_key text DEFAULT NULL, p_cedente_fundo_id uuid DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL, p_entidade_tipo text DEFAULT NULL,
  p_entidade_id uuid DEFAULT NULL, p_href text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notificacoes(usuario_id, fundo_id, scope_type, titulo, mensagem, tipo,
    dedupe_key, cedente_fundo_id, cedente_id, entidade_tipo, entidade_id, href)
  VALUES(p_usuario_id, p_fundo_id, 'FUNDO', p_titulo, p_mensagem, p_tipo,
    CASE WHEN p_dedupe_key IS NOT NULL THEN 'fund:' || p_fundo_id::text || ':' || p_dedupe_key || ':user:' || p_usuario_id::text END,
    p_cedente_fundo_id, p_cedente_id, p_entidade_tipo, p_entidade_id, p_href)
  ON CONFLICT(usuario_id,dedupe_key) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.criar_notificacao_fundo(uuid,uuid,text,text,text,text,uuid,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notificar_gestores_fundo(
  p_fundo_id uuid, p_titulo text, p_mensagem text, p_tipo text,
  p_dedupe_key text DEFAULT NULL, p_cedente_fundo_id uuid DEFAULT NULL,
  p_cedente_id uuid DEFAULT NULL, p_entidade_tipo text DEFAULT NULL,
  p_entidade_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid; v_count integer := 0;
BEGIN
  IF p_fundo_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id = p_fundo_id AND ativo) THEN
    RAISE EXCEPTION 'NOTIFICACAO_FUNDO_OBRIGATORIO' USING ERRCODE = '23514';
  END IF;
  FOR v_user IN SELECT uf.usuario_id FROM public.usuario_fundos uf
    JOIN public.profiles p ON p.id = uf.usuario_id AND p.status::text = 'ativo'
    WHERE uf.fundo_id = p_fundo_id AND uf.status = 'ativo'
      AND (p.role::text = 'gestor' OR EXISTS (SELECT 1 FROM public.usuario_papeis up
        WHERE up.usuario_id = p.id AND up.papel::text = 'gestor' AND up.ativo))
  LOOP
    IF private.criar_notificacao_fundo(v_user,p_fundo_id,p_titulo,p_mensagem,p_tipo,
      p_dedupe_key,p_cedente_fundo_id,p_cedente_id,p_entidade_tipo,p_entidade_id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_gestores_fundo(uuid,text,text,text,text,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notificar_cedente_fundo(
  p_cedente_fundo_id uuid, p_titulo text, p_mensagem text, p_tipo text,
  p_dedupe_key text DEFAULT NULL, p_somente_admin boolean DEFAULT false,
  p_entidade_tipo text DEFAULT NULL, p_entidade_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.cedente_fundos%ROWTYPE; v_user uuid; v_count integer := 0;
BEGIN
  SELECT * INTO v_link FROM public.cedente_fundos WHERE id = p_cedente_fundo_id
    AND status = 'ativo' AND vigente_desde <= now() AND (vigente_ate IS NULL OR vigente_ate > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICACAO_VINCULO_INVALIDO' USING ERRCODE = '23514'; END IF;
  FOR v_user IN
    SELECT ca.user_id FROM public.cedente_acessos ca JOIN public.profiles p
      ON p.id = ca.user_id AND p.status::text = 'ativo'
    WHERE ca.cedente_id = v_link.cedente_id AND ca.status = 'ATIVO'
      AND (NOT p_somente_admin OR ca.perfil = 'ADMIN')
    UNION
    SELECT c.user_id FROM public.cedentes c JOIN public.profiles p
      ON p.id = c.user_id AND p.status::text = 'ativo'
    WHERE c.id = v_link.cedente_id AND NOT EXISTS (
      SELECT 1 FROM public.cedente_acessos ca WHERE ca.cedente_id = c.id)
  LOOP
    IF private.criar_notificacao_fundo(v_user,v_link.fundo_id,p_titulo,p_mensagem,p_tipo,
      p_dedupe_key,v_link.id,v_link.cedente_id,p_entidade_tipo,p_entidade_id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_cedente_fundo(uuid,text,text,text,text,boolean,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Context is an explicit input: NULL is never shorthand for all funds.
CREATE FUNCTION private.validar_escopo_leitura_notificacoes(p_scope text, p_fundo_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT private.notificacao_ator_ativo() THEN
    RAISE EXCEPTION 'NOTIFICACAO_ACESSO_NEGADO' USING ERRCODE = '42501';
  END IF;
  IF p_scope = 'GLOBAL' AND p_fundo_id IS NULL THEN RETURN; END IF;
  IF p_scope = 'FUNDO' AND p_fundo_id IS NOT NULL AND private.notificacao_ator_acessa_fundo(p_fundo_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'NOTIFICACAO_CONTEXTO_NEGADO' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.validar_escopo_leitura_notificacoes(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.validar_escopo_leitura_notificacoes(text,uuid) TO authenticated;

CREATE FUNCTION public.listar_notificacoes(
  p_scope text, p_fundo_id uuid, p_limit integer DEFAULT 20,
  p_cursor_em timestamptz DEFAULT NULL, p_cursor_id uuid DEFAULT NULL,
  p_somente_nao_lidas boolean DEFAULT false
) RETURNS SETOF public.notificacoes LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM private.validar_escopo_leitura_notificacoes(p_scope,p_fundo_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40
    OR (p_cursor_em IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'NOTIFICACAO_PAGINACAO_INVALIDA' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT n.* FROM public.notificacoes n
  WHERE n.usuario_id = (SELECT auth.uid()) AND n.scope_type = p_scope
    AND (n.fundo_id = p_fundo_id OR (p_scope = 'GLOBAL' AND n.fundo_id IS NULL))
    AND (NOT p_somente_nao_lidas OR NOT n.lida)
    AND (p_cursor_em IS NULL OR (n.created_at,n.id) < (p_cursor_em,p_cursor_id))
  ORDER BY n.created_at DESC,n.id DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.listar_notificacoes(text,uuid,integer,timestamptz,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_notificacoes(text,uuid,integer,timestamptz,uuid,boolean) TO authenticated;

CREATE FUNCTION public.contar_notificacoes(p_scope text, p_fundo_id uuid)
RETURNS TABLE(total bigint, nao_lidas bigint) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM private.validar_escopo_leitura_notificacoes(p_scope,p_fundo_id);
  RETURN QUERY SELECT count(*), count(*) FILTER(WHERE NOT n.lida)
  FROM public.notificacoes n WHERE n.usuario_id = (SELECT auth.uid()) AND n.scope_type = p_scope
    AND (n.fundo_id = p_fundo_id OR (p_scope = 'GLOBAL' AND n.fundo_id IS NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.contar_notificacoes(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contar_notificacoes(text,uuid) TO authenticated;

CREATE FUNCTION public.marcar_notificacoes_lidas(p_scope text, p_fundo_id uuid, p_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM private.validar_escopo_leitura_notificacoes(p_scope,p_fundo_id);
  IF p_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notificacoes n
    WHERE n.id = p_id AND n.usuario_id = (SELECT auth.uid()) AND n.scope_type = p_scope
      AND (n.fundo_id = p_fundo_id OR (p_scope = 'GLOBAL' AND n.fundo_id IS NULL))) THEN
    RAISE EXCEPTION 'NOTIFICACAO_ACESSO_NEGADO' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notificacoes n SET lida = true
  WHERE n.usuario_id = (SELECT auth.uid()) AND n.scope_type = p_scope
    AND (n.fundo_id = p_fundo_id OR (p_scope = 'GLOBAL' AND n.fundo_id IS NULL)) AND NOT n.lida
    AND (p_id IS NULL OR n.id = p_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_notificacoes_lidas(text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_notificacoes_lidas(text,uuid,uuid) TO authenticated;

-- Used only when the portal does not already expose a canonical fund selector.
-- Unlike a general funds directory, this never returns unauthorized contexts.
CREATE FUNCTION public.listar_fundos_notificacoes()
RETURNS TABLE(id uuid, nome text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM private.listar_fundos_notificacoes();
$$;
REVOKE ALL ON FUNCTION public.listar_fundos_notificacoes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_fundos_notificacoes() TO authenticated;

COMMENT ON COLUMN public.notificacoes.scope_type IS
  'FUNDO: contexto canonico explicito. GLOBAL: seguranca/institucional. LEGACY_UNSCOPED: somente historico nao comprovado, nunca novas notificacoes.';

-- EXPLAIN with RLS, 20k synthetic rows: removes full scan/top-N sort;
-- measured 4.961ms -> 1.072ms locally. No speculative second unread index.
CREATE INDEX idx_notificacoes_fundo_contexto
  ON public.notificacoes(usuario_id,fundo_id,created_at DESC,id DESC)
  WHERE scope_type = 'FUNDO';
