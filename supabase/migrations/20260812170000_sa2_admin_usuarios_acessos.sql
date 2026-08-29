-- SA2: administracao de usuarios, gestores e acessos por fundo.
--
-- Mantem usuario_fundos como fonte canonica, fecha mutacoes diretas para
-- authenticated e concentra alteracoes em RPCs auditaveis de Super Admin.

BEGIN;

CREATE INDEX IF NOT EXISTS profiles_email_normalizado_idx
  ON public.profiles ((lower(email)));

CREATE INDEX IF NOT EXISTS profiles_status_role_nome_idx
  ON public.profiles (status, role, nome_completo, id);

CREATE INDEX IF NOT EXISTS plataforma_auditoria_usuario_alvo_created_idx
  ON public.plataforma_auditoria (usuario_alvo_id, created_at DESC, id DESC);

-- As acoes do SA2 usam a autorizacao sensivel curta e de uso unico existente.
ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural',
      'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo',
      'revogar_gestor_fundo', 'reativar_gestor_fundo',
      'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin'
    ])
  );

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
RETURNS TABLE (expira_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;

  IF p_action_type IS NULL OR p_action_type NOT IN (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural',
    'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo',
    'revogar_gestor_fundo', 'reativar_gestor_fundo',
    'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;

  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
     WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;

  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );

  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION private.registrar_auditoria_usuario(
  p_tipo_evento text,
  p_usuario_alvo_id uuid,
  p_fundo_id uuid,
  p_dados_antes jsonb,
  p_dados_depois jsonb,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.plataforma_auditoria (
    tipo_evento,
    ator_usuario_id,
    usuario_alvo_id,
    origem,
    correlation_id,
    dados
  ) VALUES (
    p_tipo_evento,
    (SELECT auth.uid()),
    p_usuario_alvo_id,
    'admin_usuarios',
    COALESCE(p_correlation_id, gen_random_uuid()),
    jsonb_build_object(
      'usuario_alvo_id', p_usuario_alvo_id,
      'fundo_id', p_fundo_id,
      'dados_antes', COALESCE(p_dados_antes, '{}'::jsonb),
      'dados_depois', COALESCE(p_dados_depois, '{}'::jsonb)
    )
  );
$$;

CREATE OR REPLACE FUNCTION private.usuario_possui_super_admin_ativo(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.usuario_papeis up ON up.usuario_id = p.id
     WHERE p.id = p_usuario_id
       AND p.status::text = 'ativo'
       AND up.papel::text = 'super_admin'
       AND up.ativo IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION private.proteger_ultimo_super_admin(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quantidade integer;
BEGIN
  -- Serializa revogacoes/desativacoes concorrentes do conjunto administrativo.
  PERFORM pg_catalog.pg_advisory_xact_lock(82002612, 2);

  IF NOT (SELECT private.usuario_possui_super_admin_ativo(p_usuario_id)) THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_quantidade
    FROM public.profiles p
    JOIN public.usuario_papeis up ON up.usuario_id = p.id
   WHERE p.status::text = 'ativo'
     AND up.papel::text = 'super_admin'
     AND up.ativo IS TRUE;

  IF v_quantidade <= 1 THEN
    RAISE EXCEPTION 'O ultimo Super Admin ativo nao pode ser removido ou desativado'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- O papel primario so pode ser alterado pelas rotinas administrativas
-- auditaveis abaixo. O cliente continua impedido de editar profiles.role.
CREATE OR REPLACE FUNCTION public.proteger_papel_primario_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('app.sa2_role_change', true), '') <> 'autorizado' THEN
    RAISE EXCEPTION 'O papel primario nao pode ser alterado pelo proprio usuario'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.registrar_auditoria_usuario(text, uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.usuario_possui_super_admin_ativo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.proteger_ultimo_super_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_resumo_usuarios()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'ativos', count(*) FILTER (WHERE p.status::text = 'ativo'),
    'inativos', count(*) FILTER (WHERE p.status::text <> 'ativo'),
    'gestores', count(*) FILTER (WHERE p.role::text = 'gestor'),
    'super_admins', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.usuario_papeis up
       WHERE up.usuario_id = p.id AND up.papel::text = 'super_admin' AND up.ativo IS TRUE
    ))
  ) INTO v_resultado
  FROM public.profiles p;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios(
  p_busca text DEFAULT NULL,
  p_papel text DEFAULT 'todos',
  p_status text DEFAULT 'todos',
  p_super_admin text DEFAULT 'todos',
  p_pagina integer DEFAULT 1,
  p_por_pagina integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_busca text := NULLIF(trim(COALESCE(p_busca, '')), '');
  v_total bigint;
  v_itens jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_papel NOT IN ('todos', 'gestor', 'super_admin', 'cedente', 'consultor', 'sacado')
     OR p_status NOT IN ('todos', 'ativos', 'inativos')
     OR p_super_admin NOT IN ('todos', 'sim', 'nao')
     OR p_pagina < 1 OR p_por_pagina NOT IN (20, 50, 100) THEN
    RAISE EXCEPTION 'Filtros administrativos invalidos' USING ERRCODE = '22023';
  END IF;

  WITH base AS (
    SELECT p.*,
      EXISTS (
        SELECT 1 FROM public.usuario_papeis up
         WHERE up.usuario_id = p.id AND up.papel::text = 'super_admin' AND up.ativo IS TRUE
      ) AS super_admin,
      (
        SELECT count(*)
          FROM public.usuario_fundos uf
          JOIN public.fundos f ON f.id = uf.fundo_id
         WHERE uf.usuario_id = p.id
           AND uf.status = 'ativo'
           AND f.ativo IS TRUE
      ) AS fundos_ativos
    FROM public.profiles p
  )
  SELECT count(*) INTO v_total
  FROM base b
  WHERE (v_busca IS NULL OR b.nome_completo ILIKE '%' || v_busca || '%' OR b.email ILIKE '%' || v_busca || '%')
    AND (p_papel = 'todos' OR b.role::text = p_papel OR (p_papel = 'super_admin' AND b.super_admin))
    AND (p_status = 'todos' OR (p_status = 'ativos' AND b.status::text = 'ativo') OR (p_status = 'inativos' AND b.status::text <> 'ativo'))
    AND (p_super_admin = 'todos' OR (p_super_admin = 'sim' AND b.super_admin) OR (p_super_admin = 'nao' AND NOT b.super_admin));

  WITH base AS (
    SELECT p.*,
      EXISTS (
        SELECT 1 FROM public.usuario_papeis up
         WHERE up.usuario_id = p.id AND up.papel::text = 'super_admin' AND up.ativo IS TRUE
      ) AS super_admin,
      (
        SELECT count(*)
          FROM public.usuario_fundos uf
          JOIN public.fundos f ON f.id = uf.fundo_id
         WHERE uf.usuario_id = p.id
           AND uf.status = 'ativo'
           AND f.ativo IS TRUE
      ) AS fundos_ativos
    FROM public.profiles p
  ), pagina AS (
    SELECT b.* FROM base b
    WHERE (v_busca IS NULL OR b.nome_completo ILIKE '%' || v_busca || '%' OR b.email ILIKE '%' || v_busca || '%')
      AND (p_papel = 'todos' OR b.role::text = p_papel OR (p_papel = 'super_admin' AND b.super_admin))
      AND (p_status = 'todos' OR (p_status = 'ativos' AND b.status::text = 'ativo') OR (p_status = 'inativos' AND b.status::text <> 'ativo'))
      AND (p_super_admin = 'todos' OR (p_super_admin = 'sim' AND b.super_admin) OR (p_super_admin = 'nao' AND NOT b.super_admin))
    ORDER BY b.nome_completo, b.id
    OFFSET ((p_pagina - 1) * p_por_pagina)
    LIMIT p_por_pagina
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'nome_completo', p.nome_completo,
    'email', p.email,
    'papel_primario', p.role,
    'status', p.status,
    'super_admin', p.super_admin,
    'fundos_ativos', p.fundos_ativos,
    'mfa_configurado', p.mfa_ativado_em IS NOT NULL,
    'created_at', p.created_at
  ) ORDER BY p.nome_completo, p.id), '[]'::jsonb)
  INTO v_itens
  FROM pagina p;

  RETURN jsonb_build_object(
    'itens', v_itens,
    'total', v_total,
    'pagina', p_pagina,
    'por_pagina', p_por_pagina,
    'total_paginas', GREATEST(1, ceil(v_total::numeric / p_por_pagina)::integer)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_obter_usuario(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'nome_completo', p.nome_completo,
    'email', p.email,
    'papel_primario', p.role,
    'status', p.status,
    'mfa_configurado', p.mfa_ativado_em IS NOT NULL,
    'mfa_reset_em', p.mfa_reset_em,
    'sessoes_revogadas_em', p.sessoes_revogadas_em,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'capacidades', COALESCE((
      SELECT jsonb_agg(up.papel::text ORDER BY up.papel::text)
      FROM public.usuario_papeis up
      WHERE up.usuario_id = p.id AND up.ativo IS TRUE
    ), '[]'::jsonb),
    'super_admin', EXISTS (
      SELECT 1
        FROM public.usuario_papeis up
       WHERE up.usuario_id = p.id
         AND up.papel::text = 'super_admin'
         AND up.ativo IS TRUE
    )
  ) INTO v_resultado
  FROM public.profiles p
  WHERE p.id = p_usuario_id;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_obter_usuario_por_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_id FROM public.profiles p WHERE lower(p.email) = lower(trim(p_email)) LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.admin_obter_usuario(v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_fundos_usuario(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'fundo_id', f.id,
    'fundo_nome', f.nome,
    'fundo_cnpj', f.cnpj,
    'fundo_ativo', f.ativo,
    'vinculo_id', uf.id,
    'vinculo_status', uf.status,
    'principal', COALESCE(uf.principal, false),
    'updated_at', uf.updated_at
  ) ORDER BY f.nome, f.id), '[]'::jsonb)
  INTO v_resultado
  FROM public.fundos f
  LEFT JOIN public.usuario_fundos uf ON uf.fundo_id = f.id AND uf.usuario_id = p_usuario_id;
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_gestores_fundo(p_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'usuario_id', p.id,
    'nome_completo', p.nome_completo,
    'email', p.email,
    'usuario_status', p.status,
    'super_admin', EXISTS (
      SELECT 1
        FROM public.usuario_papeis up
       WHERE up.usuario_id = p.id
         AND up.papel::text = 'super_admin'
         AND up.ativo IS TRUE
    ),
    'vinculo_id', uf.id,
    'vinculo_status', uf.status,
    'updated_at', uf.updated_at
  ) ORDER BY p.nome_completo, p.id), '[]'::jsonb)
  INTO v_resultado
  FROM public.profiles p
  LEFT JOIN public.usuario_fundos uf ON uf.usuario_id = p.id AND uf.fundo_id = p_fundo_id
  WHERE p.role::text = 'gestor';
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_auditoria_usuario(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'tipo_evento', a.tipo_evento,
    'ator_usuario_id', a.ator_usuario_id,
    'ator_nome', ator.nome_completo,
    'origem', a.origem,
    'correlation_id', a.correlation_id,
    'dados', a.dados,
    'created_at', a.created_at
  ) ORDER BY a.created_at DESC, a.id DESC), '[]'::jsonb)
  INTO v_resultado
  FROM public.plataforma_auditoria a
  LEFT JOIN public.profiles ator ON ator.id = a.ator_usuario_id
  WHERE a.origem = 'admin_usuarios'
    AND a.usuario_alvo_id = p_usuario_id;
  RETURN v_resultado;
END;
$$;

-- Inclui eventos de acesso do SA2 na auditoria estrutural do fundo.
CREATE OR REPLACE FUNCTION public.admin_listar_auditoria_fundo(p_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'tipo_evento', a.tipo_evento,
    'ator_usuario_id', a.ator_usuario_id,
    'ator_nome', p.nome_completo,
    'origem', a.origem,
    'correlation_id', a.correlation_id,
    'dados', a.dados,
    'created_at', a.created_at
  ) ORDER BY a.created_at DESC, a.id DESC), '[]'::jsonb)
  INTO v_resultado
  FROM public.plataforma_auditoria a
  LEFT JOIN public.profiles p ON p.id = a.ator_usuario_id
  WHERE a.origem IN ('admin_fundos', 'admin_usuarios')
    AND a.dados->>'fundo_id' = p_fundo_id::text;
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_vincular_gestor_fundo(p_usuario_id uuid, p_fundo_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
  v_vinculo public.usuario_fundos%ROWTYPE;
  v_antes jsonb;
  v_evento text;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  -- Serializa o par usuario/fundo antes do SELECT para que duas abas
  -- concorrentes terminem no mesmo vinculo canonico, sem conflito UNIQUE.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_usuario_id::text || ':' || p_fundo_id::text, 82002612)
  );
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.role::text <> 'gestor' THEN RAISE EXCEPTION 'Usuario alvo nao possui papel Gestor' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_vinculo FROM public.usuario_fundos uf
   WHERE uf.usuario_id = p_usuario_id AND uf.fundo_id = p_fundo_id FOR UPDATE;
  IF FOUND THEN
    IF v_vinculo.status = 'ativo' THEN
      RETURN jsonb_build_object('id', v_vinculo.id, 'status', v_vinculo.status, 'idempotente', true);
    END IF;
    v_antes := to_jsonb(v_vinculo);
    UPDATE public.usuario_fundos SET status = 'ativo', perfil_no_fundo = 'gestor'
     WHERE id = v_vinculo.id RETURNING * INTO v_vinculo;
    v_evento := 'GESTOR_VINCULO_REATIVADO';
  ELSE
    v_antes := NULL;
    INSERT INTO public.usuario_fundos (usuario_id, fundo_id, perfil_no_fundo, status, principal)
    VALUES (p_usuario_id, p_fundo_id, 'gestor', 'ativo', false)
    RETURNING * INTO v_vinculo;
    v_evento := 'GESTOR_VINCULADO_FUNDO';
  END IF;
  PERFORM private.registrar_auditoria_usuario(v_evento, p_usuario_id, p_fundo_id, v_antes, to_jsonb(v_vinculo), p_correlation_id);
  RETURN jsonb_build_object('id', v_vinculo.id, 'status', v_vinculo.status, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revogar_gestor_fundo(p_usuario_id uuid, p_fundo_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vinculo public.usuario_fundos%ROWTYPE;
  v_antes jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_vinculo FROM public.usuario_fundos uf
   WHERE uf.usuario_id = p_usuario_id AND uf.fundo_id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_vinculo.status = 'revogado' THEN RETURN jsonb_build_object('id', v_vinculo.id, 'status', v_vinculo.status, 'idempotente', true); END IF;
  v_antes := to_jsonb(v_vinculo);
  UPDATE public.usuario_fundos SET status = 'revogado', principal = false
   WHERE id = v_vinculo.id RETURNING * INTO v_vinculo;
  PERFORM private.registrar_auditoria_usuario('GESTOR_VINCULO_REVOGADO', p_usuario_id, p_fundo_id, v_antes, to_jsonb(v_vinculo), p_correlation_id);
  RETURN jsonb_build_object('id', v_vinculo.id, 'status', v_vinculo.status, 'idempotente', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reativar_gestor_fundo(p_usuario_id uuid, p_fundo_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.admin_vincular_gestor_fundo(p_usuario_id, p_fundo_id, p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_vincular_gestor_fundos(p_usuario_id uuid, p_fundo_ids uuid[], p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fundo_id uuid;
  v_ids uuid[] := COALESCE(p_fundo_ids, ARRAY[]::uuid[]);
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.array_length(v_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Quantidade de fundos acima do limite administrativo' USING ERRCODE = '22023';
  END IF;

  FOREACH v_fundo_id IN ARRAY v_ids LOOP
    PERFORM public.admin_vincular_gestor_fundo(p_usuario_id, v_fundo_id, p_correlation_id);
  END LOOP;

  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_conceder_super_admin(p_usuario_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
  v_ja_ativo boolean;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.role::text <> 'gestor' THEN RAISE EXCEPTION 'Somente um Gestor pode receber capacidade Super Admin complementar' USING ERRCODE = '22023'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id = p_usuario_id AND up.papel::text = 'super_admin' AND up.ativo IS TRUE) INTO v_ja_ativo;
  IF v_ja_ativo THEN RETURN public.admin_obter_usuario(p_usuario_id); END IF;
  INSERT INTO public.usuario_papeis (usuario_id, papel, ativo, origem, atribuido_por, atribuido_em, revogado_em)
  VALUES (p_usuario_id, 'super_admin'::public.user_role, true, 'administracao', (SELECT auth.uid()), now(), NULL)
  ON CONFLICT (usuario_id, papel) DO UPDATE SET ativo = true, origem = 'administracao', atribuido_por = EXCLUDED.atribuido_por, atribuido_em = now(), revogado_em = NULL;
  PERFORM private.registrar_auditoria_usuario('SUPER_ADMIN_CONCEDIDO', p_usuario_id, NULL, NULL, jsonb_build_object('papel_primario', v_perfil.role, 'super_admin', true), p_correlation_id);
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revogar_super_admin(p_usuario_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_usuario_id = (SELECT auth.uid()) THEN RAISE EXCEPTION 'A autorrevogacao administrativa esta bloqueada neste fluxo' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_perfil.role::text = 'super_admin' THEN RAISE EXCEPTION 'Super Admin puro deve ser desativado; conversao automatica de papel nao e permitida' USING ERRCODE = '22023'; END IF;
  IF NOT (SELECT private.usuario_possui_super_admin_ativo(p_usuario_id)) THEN RETURN public.admin_obter_usuario(p_usuario_id); END IF;
  PERFORM private.proteger_ultimo_super_admin(p_usuario_id);
  UPDATE public.usuario_papeis SET ativo = false, revogado_em = now()
   WHERE usuario_id = p_usuario_id AND papel::text = 'super_admin' AND ativo IS TRUE;
  PERFORM private.registrar_auditoria_usuario('SUPER_ADMIN_REVOGADO', p_usuario_id, NULL, jsonb_build_object('super_admin', true), jsonb_build_object('super_admin', false, 'papel_primario', v_perfil.role), p_correlation_id);
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_usuario(p_usuario_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_usuario_id = (SELECT auth.uid()) THEN RAISE EXCEPTION 'A autodesativacao administrativa esta bloqueada neste fluxo' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_perfil.status::text <> 'ativo' THEN RETURN public.admin_obter_usuario(p_usuario_id); END IF;
  PERFORM private.proteger_ultimo_super_admin(p_usuario_id);
  UPDATE public.profiles SET status = 'inativo', sessoes_revogadas_em = now() WHERE id = p_usuario_id;
  PERFORM private.registrar_auditoria_usuario('USUARIO_DESATIVADO', p_usuario_id, NULL, jsonb_build_object('status', v_perfil.status), jsonb_build_object('status', 'inativo', 'sessoes_revogadas_em', now()), p_correlation_id);
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reativar_usuario(p_usuario_id uuid, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_perfil.status::text = 'ativo' THEN RETURN public.admin_obter_usuario(p_usuario_id); END IF;
  UPDATE public.profiles SET status = 'ativo' WHERE id = p_usuario_id;
  PERFORM private.registrar_auditoria_usuario('USUARIO_REATIVADO', p_usuario_id, NULL, jsonb_build_object('status', v_perfil.status), jsonb_build_object('status', 'ativo'), p_correlation_id);
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_concluir_reset_mfa(p_usuario_id uuid, p_fatores_removidos integer, p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agora timestamptz := now();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_usuario_id = (SELECT auth.uid()) THEN RAISE EXCEPTION 'O reset administrativo do proprio MFA esta bloqueado' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_usuario_id) THEN RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.mfa_recovery_codes
     SET invalidado_em = v_agora
   WHERE user_id = p_usuario_id AND usado_em IS NULL AND invalidado_em IS NULL;
  DELETE FROM public.sessoes_elevadas WHERE user_id = p_usuario_id;
  UPDATE public.profiles
     SET mfa_ativado_em = NULL, mfa_reset_em = v_agora, sessoes_revogadas_em = v_agora
   WHERE id = p_usuario_id;
  PERFORM private.registrar_auditoria_usuario(
    'MFA_RESETADO_ADMIN', p_usuario_id, NULL,
    NULL, jsonb_build_object('fatores_removidos', GREATEST(COALESCE(p_fatores_removidos, 0), 0), 'sessoes_revogadas_em', v_agora), p_correlation_id
  );
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

-- Finaliza o estado de aplicacao depois do convite Auth. O convite em si fica
-- isolado no adaptador server-only; papeis e fundos continuam sob esta RPC.
CREATE OR REPLACE FUNCTION public.admin_finalizar_convite_usuario(
  p_usuario_id uuid,
  p_tipo text,
  p_nome text,
  p_fundo_ids uuid[],
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.profiles%ROWTYPE;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_tipo NOT IN ('gestor', 'super_admin') OR NULLIF(trim(COALESCE(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Dados do convite invalidos' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_perfil FROM public.profiles p WHERE p.id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.role::text <> 'gestor' THEN
    RAISE EXCEPTION 'Perfil criado pelo convite nao esta no estado esperado' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles SET nome_completo = trim(p_nome) WHERE id = p_usuario_id;

  IF p_tipo = 'super_admin' THEN
    IF COALESCE(pg_catalog.array_length(p_fundo_ids, 1), 0) > 0 THEN
      RAISE EXCEPTION 'Super Admin puro nao recebe fundos operacionais' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.set_config('app.sa2_role_change', 'autorizado', true);
    UPDATE public.profiles SET role = 'super_admin'::public.user_role WHERE id = p_usuario_id;
    INSERT INTO public.usuario_papeis (usuario_id, papel, ativo, origem, atribuido_por, atribuido_em, revogado_em)
    VALUES (p_usuario_id, 'super_admin'::public.user_role, true, 'administracao', (SELECT auth.uid()), now(), NULL)
    ON CONFLICT (usuario_id, papel) DO UPDATE SET ativo = true, origem = 'administracao', atribuido_por = EXCLUDED.atribuido_por, atribuido_em = now(), revogado_em = NULL;
    PERFORM private.registrar_auditoria_usuario('SUPER_ADMIN_CONCEDIDO', p_usuario_id, NULL, NULL, jsonb_build_object('papel_primario', 'super_admin', 'convite', true), p_correlation_id);
  ELSE
    PERFORM private.registrar_auditoria_usuario('USUARIO_GESTOR_CONVIDADO', p_usuario_id, NULL, NULL, jsonb_build_object('papel_primario', 'gestor'), p_correlation_id);
    PERFORM public.admin_vincular_gestor_fundos(p_usuario_id, p_fundo_ids, p_correlation_id);
  END IF;
  RETURN public.admin_obter_usuario(p_usuario_id);
END;
$$;

-- Gestores deixam de administrar os proprios vinculos. SELECT continua
-- permitido pelas policies canonicas, mas toda mutacao passa pelas RPCs SA2.
DROP POLICY IF EXISTS usuario_fundos_gestor_manage ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_insert ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_update ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_delete ON public.usuario_fundos;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.usuario_fundos FROM authenticated;
GRANT SELECT ON TABLE public.usuario_fundos TO authenticated;

-- API administrativa fechada: leitura e mutacao exigem JWT autenticado e a
-- propria funcao revalida Super Admin ativo no banco.
DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_resumo_usuarios()',
    'public.admin_listar_usuarios(text,text,text,text,integer,integer)',
    'public.admin_obter_usuario(uuid)',
    'public.admin_obter_usuario_por_email(text)',
    'public.admin_listar_fundos_usuario(uuid)',
    'public.admin_listar_gestores_fundo(uuid)',
    'public.admin_listar_auditoria_usuario(uuid)',
    'public.admin_vincular_gestor_fundo(uuid,uuid,uuid)',
    'public.admin_vincular_gestor_fundos(uuid,uuid[],uuid)',
    'public.admin_revogar_gestor_fundo(uuid,uuid,uuid)',
    'public.admin_reativar_gestor_fundo(uuid,uuid,uuid)',
    'public.admin_conceder_super_admin(uuid,uuid)',
    'public.admin_revogar_super_admin(uuid,uuid)',
    'public.admin_desativar_usuario(uuid,uuid)',
    'public.admin_reativar_usuario(uuid,uuid)',
    'public.admin_concluir_reset_mfa(uuid,integer,uuid)',
    'public.admin_finalizar_convite_usuario(uuid,text,text,uuid[],uuid)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_signature || ' FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_signature || ' TO authenticated';
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) TO authenticated;

COMMIT;

COMMENT ON FUNCTION public.admin_finalizar_convite_usuario(uuid, text, text, uuid[], uuid) IS
  'Finaliza o perfil e os acessos de um convite criado exclusivamente pelo adaptador Auth Admin server-only.';
