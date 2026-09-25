-- C1.1 - Administracao de consultorias e lifecycle de convites.
-- Nesta fase somente Super Admin administra organizacoes, usuarios e Fundos.

BEGIN;

CREATE OR REPLACE FUNCTION private.c1_1_exigir_super_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Acesso administrativo negado.';
  END IF;
  RETURN v_actor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_criar_consultoria_convite_owner(
  p_cnpj text,
  p_razao_social text,
  p_nome_fantasia text,
  p_fundo_ids uuid[],
  p_usuario_id uuid,
  p_usuario_nome text,
  p_usuario_email text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_cnpj text := pg_catalog.regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_razao text := pg_catalog.btrim(coalesce(p_razao_social, ''));
  v_fantasia text := nullif(pg_catalog.btrim(coalesce(p_nome_fantasia, '')), '');
  v_nome text := pg_catalog.btrim(coalesce(p_usuario_nome, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_usuario_email, '')));
  v_consultor_id uuid;
  v_fundos_esperados integer;
  v_fundos_encontrados integer;
  v_fundos jsonb;
BEGIN
  IF NOT private.cnpj_valido(v_cnpj) OR pg_catalog.length(v_razao) < 3
     OR pg_catalog.length(v_nome) < 2 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados da Consultoria ou do OWNER invalidos.';
  END IF;
  IF p_correlation_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Identificadores administrativos invalidos.';
  END IF;

  SELECT count(DISTINCT item) INTO v_fundos_esperados FROM unnest(coalesce(p_fundo_ids, '{}'::uuid[])) item;
  IF v_fundos_esperados = 0 OR v_fundos_esperados <> cardinality(coalesce(p_fundo_ids, '{}'::uuid[])) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selecione ao menos um Fundo valido, sem duplicidade.';
  END IF;
  SELECT count(*) INTO v_fundos_encontrados
  FROM public.fundos f
  WHERE f.id = ANY(p_fundo_ids) AND coalesce(f.ativo, true) = true;
  IF v_fundos_encontrados <> v_fundos_esperados THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Um ou mais Fundos nao estao ativos.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('consultoria-cnpj:' || v_cnpj));
  IF EXISTS (SELECT 1 FROM public.consultores co WHERE co.cnpj = v_cnpj) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CNPJ de Consultoria ja cadastrado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultor_usuarios cu WHERE cu.user_id = p_usuario_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Usuario ja pertence a uma Consultoria.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_usuario_id
      AND pg_catalog.lower(p.email) = v_email
      AND p.role::text = 'consultor'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Perfil Auth do OWNER nao foi provisionado como Consultor.';
  END IF;

  INSERT INTO public.consultores (cnpj, razao_social, nome_fantasia, status, created_by)
  VALUES (v_cnpj, v_razao, v_fantasia, 'ativo', v_actor_id)
  RETURNING id INTO v_consultor_id;

  UPDATE public.profiles
  SET nome_completo = v_nome, email = v_email, status = 'inativo'::public.user_status
  WHERE id = p_usuario_id;

  INSERT INTO public.consultor_usuarios (
    consultor_id, user_id, papel, status, convidado_por, convite_expires_at
  ) VALUES (
    v_consultor_id, p_usuario_id, 'OWNER', 'pendente', v_actor_id, now() + interval '1 hour'
  );

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status, concedido_por)
  SELECT v_consultor_id, f.id, 'ativo', v_actor_id
  FROM public.fundos f
  WHERE f.id = ANY(p_fundo_ids);

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', f.id, 'nome', f.nome) ORDER BY f.nome), '[]'::jsonb)
  INTO v_fundos
  FROM public.fundos f
  WHERE f.id = ANY(p_fundo_ids);

  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, usuario_alvo_id, origem, correlation_id, dados
  ) VALUES (
    'CONSULTORIA_CRIADA_COM_OWNER_PENDENTE', v_actor_id, p_usuario_id,
    'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object(
      'consultor_id', v_consultor_id, 'cnpj', v_cnpj,
      'papel', 'OWNER', 'fundo_ids', p_fundo_ids
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'consultor_id', v_consultor_id,
    'usuario_id', p_usuario_id,
    'papel', 'OWNER',
    'status', 'PENDENTE',
    'fundos', v_fundos
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_preparar_convite_consultor_usuario(
  p_consultor_id uuid,
  p_usuario_id uuid,
  p_usuario_nome text,
  p_usuario_email text,
  p_papel text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_nome text := pg_catalog.btrim(coalesce(p_usuario_nome, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_usuario_email, '')));
  v_papel text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_papel, '')));
BEGIN
  IF v_papel NOT IN ('ADMIN', 'OPERADOR', 'LEITOR')
     OR pg_catalog.length(v_nome) < 2
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados do usuario da Consultoria invalidos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultores co WHERE co.id = p_consultor_id AND co.status = 'ativo') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Consultoria ativa nao encontrada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultor_usuarios cu WHERE cu.user_id = p_usuario_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Usuario ja pertence a uma Consultoria.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_usuario_id
      AND pg_catalog.lower(p.email) = v_email
      AND p.role::text = 'consultor'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Perfil Auth nao foi provisionado como Consultor.';
  END IF;

  UPDATE public.profiles
  SET nome_completo = v_nome, email = v_email, status = 'inativo'::public.user_status
  WHERE id = p_usuario_id;

  INSERT INTO public.consultor_usuarios (
    consultor_id, user_id, papel, status, convidado_por, convite_expires_at
  ) VALUES (
    p_consultor_id, p_usuario_id, v_papel, 'pendente', v_actor_id, now() + interval '1 hour'
  );

  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, usuario_alvo_id, origem, correlation_id, dados
  ) VALUES (
    'CONSULTORIA_USUARIO_CONVIDADO', v_actor_id, p_usuario_id,
    'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', p_consultor_id, 'papel', v_papel)
  );

  RETURN pg_catalog.jsonb_build_object(
    'consultor_id', p_consultor_id, 'usuario_id', p_usuario_id,
    'papel', v_papel, 'status', 'PENDENTE'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancelar_convite_consultor(
  p_consultor_id uuid,
  p_usuario_id uuid,
  p_remover_consultoria boolean,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.consultor_usuarios cu
    WHERE cu.consultor_id = p_consultor_id
      AND cu.user_id = p_usuario_id
      AND cu.status = 'pendente'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Convite pendente nao encontrado.';
  END IF;

  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, usuario_alvo_id, origem, correlation_id, dados
  ) VALUES (
    'CONSULTORIA_CONVITE_COMPENSADO', v_actor_id, p_usuario_id,
    'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', p_consultor_id, 'removeu_consultoria', p_remover_consultoria)
  );

  IF p_remover_consultoria THEN
    IF EXISTS (SELECT 1 FROM public.consultor_cedentes cc WHERE cc.consultor_id = p_consultor_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Consultoria com carteira nao pode ser removida por compensacao.';
    END IF;
    DELETE FROM public.consultores WHERE id = p_consultor_id;
  ELSE
    DELETE FROM public.consultor_usuarios
    WHERE consultor_id = p_consultor_id AND user_id = p_usuario_id AND status = 'pendente';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.consultar_convite_consultor_atual()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'consultor_id', cu.consultor_id,
    'consultor_nome', coalesce(co.nome_fantasia, co.razao_social),
    'papel', cu.papel,
    'status', CASE
      WHEN cu.status = 'ativo' THEN 'ACEITO'
      WHEN cu.status = 'inativo' THEN 'CANCELADO'
      WHEN cu.convite_expires_at <= now() THEN 'EXPIRADO'
      ELSE 'PENDENTE'
    END,
    'expires_at', cu.convite_expires_at
  )
  FROM public.consultor_usuarios cu
  JOIN public.consultores co ON co.id = cu.consultor_id
  WHERE cu.user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.aceitar_convite_consultor(p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_membership public.consultor_usuarios%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Convite sem sessao autenticada.';
  END IF;

  SELECT cu.* INTO v_membership
  FROM public.consultor_usuarios cu
  JOIN public.consultores co ON co.id = cu.consultor_id
  WHERE cu.user_id = v_user_id AND co.status = 'ativo'
  FOR UPDATE OF cu;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Convite de Consultoria nao encontrado.';
  END IF;
  IF v_membership.status <> 'pendente' OR v_membership.convite_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Convite expirado, cancelado ou ja aceito.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.role::text = 'consultor' AND p.status::text = 'inativo'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Perfil do Consultor nao esta pendente.';
  END IF;

  UPDATE public.consultor_usuarios
  SET status = 'ativo', ativado_em = now(), desativado_em = NULL
  WHERE id = v_membership.id;
  UPDATE public.profiles
  SET status = 'ativo'::public.user_status, senha_alterada_em = now()
  WHERE id = v_user_id;

  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, usuario_alvo_id, origem, correlation_id, dados
  ) VALUES (
    'CONSULTORIA_CONVITE_ACEITO', v_user_id, v_user_id,
    'convite_consultor', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', v_membership.consultor_id, 'papel', v_membership.papel)
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'consultor_id', v_membership.consultor_id, 'papel', v_membership.papel
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_consultorias(
  p_busca text DEFAULT NULL,
  p_status text DEFAULT 'todos',
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
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_result jsonb;
BEGIN
  IF p_status NOT IN ('todos', 'ativo', 'inativo')
     OR p_pagina < 1 OR p_por_pagina NOT IN (20, 50, 100)
     OR pg_catalog.length(coalesce(p_busca, '')) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Filtros de Consultorias invalidos.';
  END IF;

  WITH base AS (
    SELECT co.id, co.cnpj, co.razao_social, co.nome_fantasia, co.status, co.created_at,
      (SELECT count(*) FROM public.consultor_usuarios cu WHERE cu.consultor_id = co.id AND cu.status = 'ativo') AS usuarios_ativos,
      (SELECT count(*) FROM public.consultor_cedentes cc WHERE cc.consultor_id = co.id AND cc.status IN ('pendente', 'ativo')) AS cedentes_total,
      coalesce((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', f.id, 'nome', f.nome) ORDER BY f.nome)
        FROM public.consultor_fundos cfu
        JOIN public.fundos f ON f.id = cfu.fundo_id
        WHERE cfu.consultor_id = co.id AND cfu.status = 'ativo'
      ), '[]'::jsonb) AS fundos
    FROM public.consultores co
    WHERE (p_status = 'todos' OR co.status = p_status)
      AND (
        pg_catalog.btrim(coalesce(p_busca, '')) = ''
        OR co.razao_social ILIKE '%' || pg_catalog.btrim(p_busca) || '%'
        OR coalesce(co.nome_fantasia, '') ILIKE '%' || pg_catalog.btrim(p_busca) || '%'
        OR co.cnpj LIKE '%' || pg_catalog.regexp_replace(p_busca, '[^0-9]', '', 'g') || '%'
      )
  ), paginada AS (
    SELECT *, count(*) OVER () AS total
    FROM base
    ORDER BY razao_social, id
    LIMIT p_por_pagina OFFSET (p_pagina - 1) * p_por_pagina
  )
  SELECT pg_catalog.jsonb_build_object(
    'itens', coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(paginada) - 'total' ORDER BY razao_social, id), '[]'::jsonb),
    'total', coalesce(max(total), 0),
    'pagina', p_pagina,
    'por_pagina', p_por_pagina,
    'total_paginas', greatest(1, pg_catalog.ceil(coalesce(max(total), 0)::numeric / p_por_pagina)::integer)
  ) INTO v_result
  FROM paginada;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_obter_consultoria(p_consultor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_result jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'id', co.id, 'cnpj', co.cnpj, 'razao_social', co.razao_social,
    'nome_fantasia', co.nome_fantasia, 'status', co.status,
    'created_at', co.created_at, 'updated_at', co.updated_at,
    'usuarios', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', cu.id, 'user_id', cu.user_id, 'nome', p.nome_completo,
        'email', p.email, 'papel', cu.papel, 'status', cu.status,
        'convite_expires_at', cu.convite_expires_at, 'ativado_em', cu.ativado_em
      ) ORDER BY CASE cu.papel WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'OPERADOR' THEN 2 ELSE 3 END, p.nome_completo)
      FROM public.consultor_usuarios cu JOIN public.profiles p ON p.id = cu.user_id
      WHERE cu.consultor_id = co.id
    ), '[]'::jsonb),
    'fundos', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'cnpj', f.cnpj, 'status', cfu.status, 'fundo_ativo', coalesce(f.ativo, true)
      ) ORDER BY f.nome)
      FROM public.consultor_fundos cfu JOIN public.fundos f ON f.id = cfu.fundo_id
      WHERE cfu.consultor_id = co.id
    ), '[]'::jsonb),
    'cedentes', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'razao_social', c.razao_social, 'cnpj', c.cnpj,
        'status', c.status::text, 'vinculo_status', cc.status
      ) ORDER BY c.razao_social)
      FROM public.consultor_cedentes cc JOIN public.cedentes c ON c.id = cc.cedente_id
      WHERE cc.consultor_id = co.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.consultores co
  WHERE co.id = p_consultor_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_atualizar_status_consultoria(
  p_consultor_id uuid,
  p_ativo boolean,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
BEGIN
  UPDATE public.consultores SET status = CASE WHEN p_ativo THEN 'ativo' ELSE 'inativo' END
  WHERE id = p_consultor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Consultoria nao encontrada.'; END IF;
  INSERT INTO public.plataforma_auditoria (tipo_evento, ator_usuario_id, origem, correlation_id, dados)
  VALUES ('CONSULTORIA_STATUS_ALTERADO', v_actor_id, 'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', p_consultor_id, 'status', CASE WHEN p_ativo THEN 'ativo' ELSE 'inativo' END));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_atualizar_usuario_consultoria(
  p_consultor_id uuid,
  p_user_id uuid,
  p_papel text,
  p_ativo boolean,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_papel text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_papel, '')));
  v_papel_atual text;
BEGIN
  IF v_papel NOT IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Papel interno invalido.';
  END IF;
  SELECT cu.papel INTO v_papel_atual
  FROM public.consultor_usuarios cu
  WHERE cu.consultor_id = p_consultor_id AND cu.user_id = p_user_id AND cu.status <> 'pendente';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Usuario ativo/inativo da Consultoria nao encontrado.';
  END IF;
  IF (v_papel_atual = 'OWNER' AND v_papel <> 'OWNER')
     OR (v_papel_atual <> 'OWNER' AND v_papel = 'OWNER') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'O papel OWNER nao pode ser transferido nesta fase.';
  END IF;
  IF NOT p_ativo AND EXISTS (
    SELECT 1 FROM public.consultor_usuarios cu
    WHERE cu.consultor_id = p_consultor_id AND cu.user_id = p_user_id
      AND cu.papel = 'OWNER' AND cu.status = 'ativo'
      AND NOT EXISTS (
        SELECT 1 FROM public.consultor_usuarios outro
        WHERE outro.consultor_id = cu.consultor_id AND outro.user_id <> cu.user_id
          AND outro.papel IN ('OWNER', 'ADMIN') AND outro.status = 'ativo'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'O ultimo administrador ativo da Consultoria nao pode ser desativado.';
  END IF;

  UPDATE public.consultor_usuarios
  SET papel = v_papel,
      status = CASE WHEN p_ativo THEN 'ativo' ELSE 'inativo' END,
      ativado_em = CASE WHEN p_ativo THEN coalesce(ativado_em, now()) ELSE ativado_em END,
      desativado_em = CASE WHEN p_ativo THEN NULL ELSE now() END
  WHERE consultor_id = p_consultor_id AND user_id = p_user_id AND status <> 'pendente';

  UPDATE public.profiles SET status = CASE WHEN p_ativo THEN 'ativo'::public.user_status ELSE 'inativo'::public.user_status END
  WHERE id = p_user_id;
  INSERT INTO public.plataforma_auditoria (tipo_evento, ator_usuario_id, usuario_alvo_id, origem, correlation_id, dados)
  VALUES ('CONSULTORIA_USUARIO_ATUALIZADO', v_actor_id, p_user_id, 'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', p_consultor_id, 'papel', v_papel, 'ativo', p_ativo));
END;
$$;

-- As mutacoes da nova area administrativa exigem TOTP fresco e autorizacao
-- curta, vinculada a acao exata, como as demais operacoes de Super Admin.
ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
      'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
      'publicar_integracao', 'desativar_integracao', 'testar_integracao',
      'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira',
      'confirmar_match_manual', 'revogar_match_manual', 'revisar_risco_operacao',
      'criar_integracao_transportadora', 'ativar_integracao_transportadora',
      'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
      'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora',
      'configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs',
      'criar_consultoria', 'convidar_usuario_consultoria',
      'atualizar_consultoria', 'atualizar_fundos_consultoria'
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
    'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
    'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
    'publicar_integracao', 'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira',
    'confirmar_match_manual', 'revogar_match_manual', 'revisar_risco_operacao',
    'criar_integracao_transportadora', 'ativar_integracao_transportadora',
    'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
    'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora',
    'configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs',
    'criar_consultoria', 'convidar_usuario_consultoria',
    'atualizar_consultoria', 'atualizar_fundos_consultoria'
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

CREATE OR REPLACE FUNCTION public.admin_atualizar_fundos_consultoria(
  p_consultor_id uuid,
  p_fundo_ids uuid[],
  p_correlation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := private.c1_1_exigir_super_admin();
  v_esperados integer;
  v_encontrados integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.consultores co WHERE co.id = p_consultor_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Consultoria nao encontrada.';
  END IF;
  SELECT count(DISTINCT item) INTO v_esperados FROM unnest(coalesce(p_fundo_ids, '{}'::uuid[])) item;
  IF v_esperados <> cardinality(coalesce(p_fundo_ids, '{}'::uuid[])) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Fundos duplicados.';
  END IF;
  SELECT count(*) INTO v_encontrados FROM public.fundos f
  WHERE f.id = ANY(coalesce(p_fundo_ids, '{}'::uuid[])) AND coalesce(f.ativo, true) = true;
  IF v_encontrados <> v_esperados THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Um ou mais Fundos nao estao ativos.';
  END IF;

  UPDATE public.consultor_fundos
  SET status = 'inativo', revogado_por = v_actor_id, revogado_em = now()
  WHERE consultor_id = p_consultor_id
    AND status = 'ativo'
    AND NOT (fundo_id = ANY(coalesce(p_fundo_ids, '{}'::uuid[])));

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status, concedido_por)
  SELECT p_consultor_id, item, 'ativo', v_actor_id
  FROM unnest(coalesce(p_fundo_ids, '{}'::uuid[])) item
  ON CONFLICT (consultor_id, fundo_id) DO UPDATE
    SET status = 'ativo', concedido_por = EXCLUDED.concedido_por,
        revogado_por = NULL, revogado_em = NULL;

  INSERT INTO public.plataforma_auditoria (tipo_evento, ator_usuario_id, origem, correlation_id, dados)
  VALUES ('CONSULTORIA_FUNDOS_ATUALIZADOS', v_actor_id, 'admin_consultorias', p_correlation_id,
    pg_catalog.jsonb_build_object('consultor_id', p_consultor_id, 'fundo_ids', coalesce(p_fundo_ids, '{}'::uuid[])));
END;
$$;

REVOKE ALL ON FUNCTION private.c1_1_exigir_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_criar_consultoria_convite_owner(text, text, text, uuid[], uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_preparar_convite_consultor_usuario(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancelar_convite_consultor(uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultar_convite_consultor_atual() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aceitar_convite_consultor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_listar_consultorias(text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_obter_consultoria(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_atualizar_status_consultoria(uuid, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_atualizar_usuario_consultoria(uuid, uuid, text, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_atualizar_fundos_consultoria(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_criar_consultoria_convite_owner(text, text, text, uuid[], uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_preparar_convite_consultor_usuario(uuid, uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_convite_consultor(uuid, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_convite_consultor_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_consultor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_consultorias(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obter_consultoria(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_status_consultoria(uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_usuario_consultoria(uuid, uuid, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_fundos_consultoria(uuid, uuid[], uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
