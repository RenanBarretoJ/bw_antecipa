-- SA1: administracao estrutural de fundos pelo Super Admin.
--
-- A mutacao estrutural passa a ocorrer exclusivamente por RPCs fechadas. O
-- gestor mantem somente leitura dos fundos aos quais ja esta vinculado e
-- continua responsavel pelas configuracoes operacionais em tabelas proprias.

BEGIN;

ALTER TABLE public.fundos
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Os defaults legados identificavam empresas especificas e nao podem ser
-- herdados silenciosamente por um novo fundo cadastrado pela plataforma.
ALTER TABLE public.fundos
  ALTER COLUMN gestora_nome DROP DEFAULT,
  ALTER COLUMN gestora_cnpj DROP DEFAULT,
  ALTER COLUMN custodiante_nome DROP DEFAULT,
  ALTER COLUMN custodiante_nome DROP NOT NULL,
  ALTER COLUMN custodiante_cnpj DROP DEFAULT,
  ALTER COLUMN custodiante_cnpj DROP NOT NULL;

DROP TRIGGER IF EXISTS fundos_updated_at ON public.fundos;
CREATE TRIGGER fundos_updated_at
  BEFORE UPDATE ON public.fundos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS fundos_cnpj_normalizado_unique
  ON public.fundos ((regexp_replace(cnpj, '[^0-9]', '', 'g')));

CREATE INDEX IF NOT EXISTS fundos_ativo_nome_idx
  ON public.fundos (ativo, nome, id);

-- As mutacoes estruturais usam o mesmo mecanismo de autorizacao curta e de
-- uso unico das demais acoes sensiveis. A lista precisa permanecer fechada no
-- banco e na aplicacao.
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
      'ativar_fundo', 'desativar_fundo'
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
    'ativar_fundo', 'desativar_fundo'
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

CREATE OR REPLACE FUNCTION private.usuario_e_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.profiles p
        JOIN public.usuario_papeis up ON up.usuario_id = p.id
       WHERE p.id = (SELECT auth.uid())
         AND p.status::text = 'ativo'
         AND up.papel::text = 'super_admin'
         AND up.ativo IS TRUE
    );
$$;

CREATE OR REPLACE FUNCTION private.cnpj_valido(p_valor text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := regexp_replace(COALESCE(p_valor, ''), '[^0-9]', '', 'g');
  v_soma integer;
  v_digito integer;
  v_peso integer;
  v_indice integer;
BEGIN
  IF length(v) <> 14 OR v ~ '^([0-9])\1{13}$' THEN
    RETURN false;
  END IF;

  v_soma := 0;
  v_peso := 5;
  FOR v_indice IN 1..12 LOOP
    v_soma := v_soma + substring(v FROM v_indice FOR 1)::integer * v_peso;
    v_peso := v_peso - 1;
    IF v_peso = 1 THEN v_peso := 9; END IF;
  END LOOP;
  v_digito := CASE WHEN v_soma % 11 < 2 THEN 0 ELSE 11 - (v_soma % 11) END;
  IF v_digito <> substring(v FROM 13 FOR 1)::integer THEN RETURN false; END IF;

  v_soma := 0;
  v_peso := 6;
  FOR v_indice IN 1..13 LOOP
    v_soma := v_soma + substring(v FROM v_indice FOR 1)::integer * v_peso;
    v_peso := v_peso - 1;
    IF v_peso = 1 THEN v_peso := 9; END IF;
  END LOOP;
  v_digito := CASE WHEN v_soma % 11 < 2 THEN 0 ELSE 11 - (v_soma % 11) END;
  RETURN v_digito = substring(v FROM 14 FOR 1)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION private.registrar_auditoria_fundo(
  p_tipo_evento text,
  p_fundo_id uuid,
  p_dados_antes jsonb,
  p_dados_depois jsonb
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
    origem,
    dados
  )
  VALUES (
    p_tipo_evento,
    (SELECT auth.uid()),
    'admin_fundos',
    jsonb_build_object(
      'fundo_id', p_fundo_id,
      'dados_antes', COALESCE(p_dados_antes, '{}'::jsonb),
      'dados_depois', COALESCE(p_dados_depois, '{}'::jsonb)
    )
  );
$$;

REVOKE ALL ON FUNCTION private.usuario_e_super_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.cnpj_valido(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.registrar_auditoria_fundo(text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_resumo_fundos()
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
    'ativos', count(*) FILTER (WHERE f.ativo IS TRUE),
    'inativos', count(*) FILTER (WHERE f.ativo IS NOT TRUE)
  )
    INTO v_resultado
    FROM public.fundos f;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_fundos(
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
  v_busca text := NULLIF(trim(COALESCE(p_busca, '')), '');
  v_busca_cnpj text := regexp_replace(COALESCE(p_busca, ''), '[^0-9]', '', 'g');
  v_total bigint;
  v_itens jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('todos', 'ativos', 'inativos') THEN
    RAISE EXCEPTION 'Filtro de status invalido' USING ERRCODE = '22023';
  END IF;
  IF p_pagina < 1 OR p_por_pagina NOT IN (20, 50, 100) THEN
    RAISE EXCEPTION 'Paginacao invalida' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
    INTO v_total
    FROM public.fundos f
   WHERE (p_status = 'todos'
          OR (p_status = 'ativos' AND f.ativo IS TRUE)
          OR (p_status = 'inativos' AND f.ativo IS NOT TRUE))
     AND (v_busca IS NULL
          OR f.nome ILIKE '%' || v_busca || '%'
          OR f.administradora_nome ILIKE '%' || v_busca || '%'
          OR f.gestora_nome ILIKE '%' || v_busca || '%'
          OR (v_busca_cnpj <> '' AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') LIKE '%' || v_busca_cnpj || '%'));

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'nome', item->>'id'), '[]'::jsonb)
    INTO v_itens
    FROM (
      SELECT jsonb_build_object(
        'id', f.id,
        'nome', f.nome,
        'cnpj', f.cnpj,
        'administradora_nome', f.administradora_nome,
        'gestora_nome', f.gestora_nome,
        'ativo', f.ativo,
        'created_at', f.created_at,
        'updated_at', f.updated_at
      ) AS item
        FROM public.fundos f
       WHERE (p_status = 'todos'
              OR (p_status = 'ativos' AND f.ativo IS TRUE)
              OR (p_status = 'inativos' AND f.ativo IS NOT TRUE))
         AND (v_busca IS NULL
              OR f.nome ILIKE '%' || v_busca || '%'
              OR f.administradora_nome ILIKE '%' || v_busca || '%'
              OR f.gestora_nome ILIKE '%' || v_busca || '%'
              OR (v_busca_cnpj <> '' AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') LIKE '%' || v_busca_cnpj || '%'))
       ORDER BY f.nome, f.id
       OFFSET ((p_pagina - 1) * p_por_pagina)
       LIMIT p_por_pagina
    ) pagina;

  RETURN jsonb_build_object(
    'itens', v_itens,
    'total', v_total,
    'pagina', p_pagina,
    'por_pagina', p_por_pagina,
    'total_paginas', GREATEST(1, ceil(v_total::numeric / p_por_pagina)::integer)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_obter_fundo(p_fundo_id uuid)
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
    'id', f.id,
    'nome', f.nome,
    'cnpj', f.cnpj,
    'administradora_nome', f.administradora_nome,
    'administradora_cnpj', f.administradora_cnpj,
    'gestora_nome', f.gestora_nome,
    'gestora_cnpj', f.gestora_cnpj,
    'custodiante_nome', f.custodiante_nome,
    'custodiante_cnpj', f.custodiante_cnpj,
    'administradora_endereco', f.administradora_endereco,
    'administradora_ato_declaratorio', f.administradora_ato_declaratorio,
    'contato_nome', f.contato_nome,
    'contato_email', f.contato_email,
    'ativo', f.ativo,
    'created_at', f.created_at,
    'updated_at', f.updated_at,
    'created_by', f.created_by,
    'created_by_nome', p.nome_completo
  )
    INTO v_resultado
    FROM public.fundos f
    LEFT JOIN public.profiles p ON p.id = f.created_by
   WHERE f.id = p_fundo_id;

  RETURN v_resultado;
END;
$$;

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
   WHERE a.origem = 'admin_fundos'
     AND a.dados->>'fundo_id' = p_fundo_id::text;

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_criar_fundo(
  p_nome text,
  p_cnpj text,
  p_administradora_nome text,
  p_administradora_cnpj text,
  p_gestora_nome text,
  p_gestora_cnpj text,
  p_custodiante_nome text DEFAULT NULL,
  p_custodiante_cnpj text DEFAULT NULL,
  p_administradora_endereco text DEFAULT NULL,
  p_administradora_ato_declaratorio text DEFAULT NULL,
  p_contato_nome text DEFAULT NULL,
  p_contato_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_cnpj text := regexp_replace(COALESCE(p_cnpj, ''), '[^0-9]', '', 'g');
  v_administradora_cnpj text := regexp_replace(COALESCE(p_administradora_cnpj, ''), '[^0-9]', '', 'g');
  v_gestora_cnpj text := regexp_replace(COALESCE(p_gestora_cnpj, ''), '[^0-9]', '', 'g');
  v_custodiante_cnpj text := NULLIF(regexp_replace(COALESCE(p_custodiante_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_depois jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_nome, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_administradora_nome, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_gestora_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do fundo, administradora e gestora sao obrigatorios' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(COALESCE(p_contato_email, '')), '') IS NOT NULL
     AND trim(p_contato_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail de contato invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT private.cnpj_valido(v_cnpj))
     OR NOT (SELECT private.cnpj_valido(v_administradora_cnpj))
     OR NOT (SELECT private.cnpj_valido(v_gestora_cnpj))
     OR (v_custodiante_cnpj IS NOT NULL AND NOT (SELECT private.cnpj_valido(v_custodiante_cnpj))) THEN
    RAISE EXCEPTION 'CNPJ invalido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fundos (
    nome, cnpj, administradora_nome, administradora_cnpj,
    gestora_nome, gestora_cnpj, custodiante_nome, custodiante_cnpj,
    administradora_endereco, administradora_ato_declaratorio,
    contato_nome, contato_email, ativo, created_by, created_at, updated_at
  )
  VALUES (
    trim(p_nome), v_cnpj, trim(p_administradora_nome), v_administradora_cnpj,
    trim(p_gestora_nome), v_gestora_cnpj, NULLIF(trim(COALESCE(p_custodiante_nome, '')), ''), v_custodiante_cnpj,
    NULLIF(trim(COALESCE(p_administradora_endereco, '')), ''), NULLIF(trim(COALESCE(p_administradora_ato_declaratorio, '')), ''),
    NULLIF(trim(COALESCE(p_contato_nome, '')), ''), NULLIF(lower(trim(COALESCE(p_contato_email, ''))), ''),
    false, (SELECT auth.uid()), now(), now()
  )
  RETURNING id INTO v_id;

  SELECT public.admin_obter_fundo(v_id) INTO v_depois;
  PERFORM private.registrar_auditoria_fundo('FUNDO_CRIADO', v_id, NULL, v_depois);
  RETURN v_depois;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_atualizar_fundo(
  p_fundo_id uuid,
  p_updated_at_esperado timestamptz,
  p_nome text,
  p_cnpj text,
  p_administradora_nome text,
  p_administradora_cnpj text,
  p_gestora_nome text,
  p_gestora_cnpj text,
  p_custodiante_nome text DEFAULT NULL,
  p_custodiante_cnpj text DEFAULT NULL,
  p_administradora_endereco text DEFAULT NULL,
  p_administradora_ato_declaratorio text DEFAULT NULL,
  p_contato_nome text DEFAULT NULL,
  p_contato_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_atual public.fundos%ROWTYPE;
  v_antes jsonb;
  v_depois jsonb;
  v_cnpj text := regexp_replace(COALESCE(p_cnpj, ''), '[^0-9]', '', 'g');
  v_administradora_cnpj text := regexp_replace(COALESCE(p_administradora_cnpj, ''), '[^0-9]', '', 'g');
  v_gestora_cnpj text := regexp_replace(COALESCE(p_gestora_cnpj, ''), '[^0-9]', '', 'g');
  v_custodiante_cnpj text := NULLIF(regexp_replace(COALESCE(p_custodiante_cnpj, ''), '[^0-9]', '', 'g'), '');
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_updated_at_esperado IS NULL THEN
    RAISE EXCEPTION 'Versao esperada do cadastro e obrigatoria' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(COALESCE(p_nome, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_administradora_nome, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_gestora_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do fundo, administradora e gestora sao obrigatorios' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(COALESCE(p_contato_email, '')), '') IS NOT NULL
     AND trim(p_contato_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail de contato invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT private.cnpj_valido(v_cnpj))
     OR NOT (SELECT private.cnpj_valido(v_administradora_cnpj))
     OR NOT (SELECT private.cnpj_valido(v_gestora_cnpj))
     OR (v_custodiante_cnpj IS NOT NULL AND NOT (SELECT private.cnpj_valido(v_custodiante_cnpj))) THEN
    RAISE EXCEPTION 'CNPJ invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.fundos WHERE id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_atual.updated_at IS DISTINCT FROM p_updated_at_esperado THEN
    RAISE EXCEPTION 'O fundo foi alterado por outro usuario. Recarregue a pagina.' USING ERRCODE = '40001';
  END IF;
  IF v_atual.nome IS NOT DISTINCT FROM trim(p_nome)
     AND v_atual.cnpj IS NOT DISTINCT FROM v_cnpj
     AND v_atual.administradora_nome IS NOT DISTINCT FROM trim(p_administradora_nome)
     AND v_atual.administradora_cnpj IS NOT DISTINCT FROM v_administradora_cnpj
     AND v_atual.gestora_nome IS NOT DISTINCT FROM trim(p_gestora_nome)
     AND v_atual.gestora_cnpj IS NOT DISTINCT FROM v_gestora_cnpj
     AND v_atual.custodiante_nome IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_custodiante_nome, '')), '')
     AND v_atual.custodiante_cnpj IS NOT DISTINCT FROM v_custodiante_cnpj
     AND v_atual.administradora_endereco IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_administradora_endereco, '')), '')
     AND v_atual.administradora_ato_declaratorio IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_administradora_ato_declaratorio, '')), '')
     AND v_atual.contato_nome IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_contato_nome, '')), '')
     AND v_atual.contato_email IS NOT DISTINCT FROM NULLIF(lower(trim(COALESCE(p_contato_email, ''))), '') THEN
    RETURN public.admin_obter_fundo(p_fundo_id);
  END IF;

  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_antes;
  UPDATE public.fundos
     SET nome = trim(p_nome),
         cnpj = v_cnpj,
         administradora_nome = trim(p_administradora_nome),
         administradora_cnpj = v_administradora_cnpj,
         gestora_nome = trim(p_gestora_nome),
         gestora_cnpj = v_gestora_cnpj,
         custodiante_nome = NULLIF(trim(COALESCE(p_custodiante_nome, '')), ''),
         custodiante_cnpj = v_custodiante_cnpj,
         administradora_endereco = NULLIF(trim(COALESCE(p_administradora_endereco, '')), ''),
         administradora_ato_declaratorio = NULLIF(trim(COALESCE(p_administradora_ato_declaratorio, '')), ''),
         contato_nome = NULLIF(trim(COALESCE(p_contato_nome, '')), ''),
         contato_email = NULLIF(lower(trim(COALESCE(p_contato_email, ''))), '')
   WHERE id = p_fundo_id;

  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_depois;
  IF (v_antes - 'updated_at') IS DISTINCT FROM (v_depois - 'updated_at') THEN
    PERFORM private.registrar_auditoria_fundo('FUNDO_ATUALIZADO', p_fundo_id, v_antes, v_depois);
  END IF;
  RETURN v_depois;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ativar_fundo(
  p_fundo_id uuid,
  p_updated_at_esperado timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_atual public.fundos%ROWTYPE;
  v_antes jsonb;
  v_depois jsonb;
  v_evento text;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_atual FROM public.fundos WHERE id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_atual.ativo IS TRUE THEN RETURN public.admin_obter_fundo(p_fundo_id); END IF;
  IF v_atual.updated_at IS DISTINCT FROM p_updated_at_esperado THEN
    RAISE EXCEPTION 'O fundo foi alterado por outro usuario. Recarregue a pagina.' USING ERRCODE = '40001';
  END IF;
  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_antes;
  UPDATE public.fundos SET ativo = true WHERE id = p_fundo_id;
  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_depois;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.plataforma_auditoria a
     WHERE a.tipo_evento = 'FUNDO_DESATIVADO'
       AND a.dados->>'fundo_id' = p_fundo_id::text
  ) THEN 'FUNDO_REATIVADO' ELSE 'FUNDO_ATIVADO' END INTO v_evento;
  PERFORM private.registrar_auditoria_fundo(v_evento, p_fundo_id, v_antes, v_depois);
  RETURN v_depois;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_fundo(
  p_fundo_id uuid,
  p_updated_at_esperado timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_atual public.fundos%ROWTYPE;
  v_antes jsonb;
  v_depois jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_atual FROM public.fundos WHERE id = p_fundo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_atual.ativo IS NOT TRUE THEN RETURN public.admin_obter_fundo(p_fundo_id); END IF;
  IF v_atual.updated_at IS DISTINCT FROM p_updated_at_esperado THEN
    RAISE EXCEPTION 'O fundo foi alterado por outro usuario. Recarregue a pagina.' USING ERRCODE = '40001';
  END IF;
  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_antes;
  UPDATE public.fundos SET ativo = false WHERE id = p_fundo_id;
  SELECT public.admin_obter_fundo(p_fundo_id) INTO v_depois;
  PERFORM private.registrar_auditoria_fundo('FUNDO_DESATIVADO', p_fundo_id, v_antes, v_depois);
  RETURN v_depois;
END;
$$;

-- O gestor deixa de possuir qualquer mutacao estrutural direta. As leituras
-- continuam limitadas pelas policies multifundo existentes.
DROP POLICY IF EXISTS fundos_gestor_bootstrap_insert ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_authorized_update ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_authorized_delete ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_all ON public.fundos;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.fundos FROM authenticated;
GRANT SELECT ON TABLE public.fundos TO authenticated;

REVOKE ALL ON FUNCTION public.admin_resumo_fundos() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_listar_fundos(text, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_obter_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_listar_auditoria_fundo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_criar_fundo(text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_atualizar_fundo(uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_ativar_fundo(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_desativar_fundo(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_resumo_fundos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_fundos(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obter_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_auditoria_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_criar_fundo(text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_fundo(uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ativar_fundo(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_desativar_fundo(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_criar_fundo(text, text, text, text, text, text, text, text, text, text, text, text) IS
  'Cria fundo estrutural sempre inativo, sem vincular automaticamente o Super Admin a qualquer papel operacional.';
COMMENT ON FUNCTION public.admin_atualizar_fundo(uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text) IS
  'Atualiza somente identidade estrutural do fundo com controle otimista por updated_at.';

NOTIFY pgrst, 'reload schema';

COMMIT;
