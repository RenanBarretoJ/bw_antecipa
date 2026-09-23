-- C3 - Cadastro e gestao de Cedentes pelo Consultor.
-- A entidade Cedente deixa de depender de um usuario Auth proprio. O Consultor
-- permanece como ator real, recebe somente gestao delegada e nao herda o poder
-- operacional do C2 antes da aprovacao do Gestor.

BEGIN;

-- 1) Entidade empresarial independente de credencial Auth.
ALTER TABLE public.cedentes
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.cedentes
  DROP CONSTRAINT IF EXISTS cedentes_user_id_fkey;

ALTER TABLE public.cedentes
  ADD CONSTRAINT cedentes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cedentes.user_id IS
  'Usuario Cedente proprietario legado, quando existir. A entidade pode ser criada e gerida por Consultor sem login proprio.';

-- Pendente representa gestao cadastral antes da aprovacao. Inativo continua
-- sendo revogacao e nunca concede gestao nem operacao.
ALTER TABLE public.consultor_cedente
  DROP CONSTRAINT IF EXISTS consultor_cedente_status_check;

ALTER TABLE public.consultor_cedente
  ADD CONSTRAINT consultor_cedente_status_check
  CHECK (status IN ('pendente', 'ativo', 'inativo'));

CREATE INDEX IF NOT EXISTS idx_consultor_cedente_gestao
  ON public.consultor_cedente (consultor_id, status, cedente_id)
  WHERE status IN ('pendente', 'ativo');

-- Consultores legados ja vinculados a Cedentes recebem o vinculo explicito
-- usuario x fundo sem reativar associacoes previamente revogadas. Para novos
-- Consultores, o provisionamento deve criar usuario_fundos antes de liberar C3.
WITH candidatos AS (
  SELECT DISTINCT
    cc.consultor_id,
    cf.fundo_id,
    row_number() OVER (
      PARTITION BY cc.consultor_id
      ORDER BY f.nome, f.id
    ) AS ordem,
    NOT EXISTS (
      SELECT 1
      FROM public.usuario_fundos existente
      WHERE existente.usuario_id = cc.consultor_id
        AND existente.status = 'ativo'
        AND existente.principal IS TRUE
    ) AS sem_principal
  FROM public.consultor_cedente cc
  JOIN public.profiles p ON p.id = cc.consultor_id
  JOIN public.cedente_fundos cf ON cf.cedente_id = cc.cedente_id
  JOIN public.fundos f ON f.id = cf.fundo_id
  WHERE p.role::text = 'consultor'
    AND p.status::text = 'ativo'
    AND cc.status = 'ativo'
    AND cf.status = 'ativo'
    AND coalesce(f.ativo, true) = true
)
INSERT INTO public.usuario_fundos (
  usuario_id, fundo_id, perfil_no_fundo, status, principal
)
SELECT
  consultor_id, fundo_id, 'operador', 'ativo', sem_principal AND ordem = 1
FROM candidatos
ON CONFLICT (usuario_id, fundo_id) DO NOTHING;

-- 2) O fundo disponivel para criacao vem do vinculo explicito do Consultor
-- em usuario_fundos. Isso permite o primeiro Cedente no fundo sem depender de
-- uma carteira preexistente e impede a exposicao do catalogo global.
CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role::text = 'consultor'
        AND p.status::text = 'ativo'
    )
    AND EXISTS (
      SELECT 1
      FROM public.usuario_fundos uf
      JOIN public.fundos f ON f.id = uf.fundo_id
      WHERE uf.usuario_id = (SELECT auth.uid())
        AND uf.fundo_id = p_fundo_id
        AND uf.status = 'ativo'
        AND coalesce(f.ativo, true) = true
    );
$$;

COMMENT ON FUNCTION private.consultor_tem_acesso_fundo(uuid) IS
  'Consultor ativo possui acesso ao fundo somente por vinculo explicito ativo em usuario_fundos.';

-- Gestao cadastral e operacao sao capacidades diferentes.
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
        AND EXISTS (
          SELECT 1 FROM public.consultor_cedente cc
          WHERE cc.consultor_id = (SELECT auth.uid())
            AND cc.cedente_id = p_cedente_id
            AND cc.status IN ('pendente', 'ativo')
        )
      )
      OR (
        (SELECT public.get_user_role()) = 'gestor'
        AND (SELECT private.gestor_tem_acesso_cedente(p_cedente_id))
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.usuario_pode_gerenciar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.usuario_pode_gerenciar_cedente(p_cedente_id);
$$;

CREATE OR REPLACE FUNCTION private.usuario_pode_operar_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cedentes c
    WHERE c.id = p_cedente_id
      AND c.status = 'ativo'::public.cedente_status
      AND EXISTS (
        SELECT 1
        FROM public.cedente_fundos cf
        JOIN public.fundos f ON f.id = cf.fundo_id
        WHERE cf.cedente_id = c.id
          AND cf.status = 'ativo'
          AND coalesce(f.ativo, true) = true
      )
      AND (
        (
          (SELECT public.get_user_role()) = 'cedente'
          AND public.get_user_cedente_id() = c.id
        )
        OR (
          (SELECT public.get_user_role()) = 'consultor'
          AND (SELECT private.consultor_tem_acesso_cedente(c.id))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.usuario_pode_gerenciar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.usuario_pode_operar_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.usuario_pode_gerenciar_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.usuario_pode_gerenciar_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.usuario_pode_operar_cedente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.usuario_pode_gerenciar_cedente(uuid) TO authenticated;

-- 3) Fundos elegiveis e carteira C3 server-side.
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
    AND (SELECT private.consultor_tem_acesso_fundo(f.id))
  ORDER BY f.nome, f.id;
$$;

CREATE OR REPLACE FUNCTION public.listar_fundos_criacao_cedente_consultor()
RETURNS TABLE (id uuid, nome text, cnpj text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.listar_fundos_criacao_cedente_consultor();
$$;

CREATE OR REPLACE FUNCTION private.listar_cedentes_gerenciados_consultor(
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
AS $$
  WITH parametros AS (
    SELECT
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(coalesce(p_termo, '')))) AS termo,
      pg_catalog.regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      greatest(1, least(coalesce(p_limite, 10), 50)) AS limite,
      greatest(0, coalesce(p_offset, 0)) AS deslocamento
  ), base AS (
    SELECT
      c.id,
      c.razao_social,
      c.nome_fantasia,
      c.cnpj,
      c.status::text AS status,
      cc.status AS vinculo_status,
      cf.fundo_id,
      f.nome AS fundo_nome,
      c.onboarding_concluido_em,
      (
        SELECT count(*)
        FROM public.documentos d
        WHERE d.cedente_id = c.id AND d.status <> 'aprovado'::public.documento_status
      ) AS documentos_pendentes
    FROM public.consultor_cedente cc
    JOIN public.cedentes c ON c.id = cc.cedente_id
    JOIN public.cedente_fundos cf ON cf.cedente_id = c.id AND cf.status = 'ativo'
    JOIN public.fundos f ON f.id = cf.fundo_id
    CROSS JOIN parametros p
    WHERE cc.consultor_id = (SELECT auth.uid())
      AND cc.status IN ('pendente', 'ativo')
      AND (SELECT public.get_user_role()) = 'consultor'
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

CREATE OR REPLACE FUNCTION public.listar_cedentes_gerenciados_consultor(
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
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.listar_cedentes_gerenciados_consultor(p_termo, p_limite, p_offset);
$$;

REVOKE ALL ON FUNCTION private.listar_fundos_criacao_cedente_consultor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_fundos_criacao_cedente_consultor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.listar_cedentes_gerenciados_consultor(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_cedentes_gerenciados_consultor(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.listar_fundos_criacao_cedente_consultor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_fundos_criacao_cedente_consultor() TO authenticated;
GRANT EXECUTE ON FUNCTION private.listar_cedentes_gerenciados_consultor(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_cedentes_gerenciados_consultor(text, integer, integer) TO authenticated;

-- 4) Criacao transacional Cedente + Fundo + Consultor + auditoria.
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
  v_cnpj text := pg_catalog.regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_razao_social text := pg_catalog.btrim(coalesce(p_razao_social, ''));
  v_nome_fantasia text := nullif(pg_catalog.btrim(coalesce(p_nome_fantasia, '')), '');
  v_cedente_id uuid;
  v_cedente_fundo_id uuid;
  v_vinculo_id uuid;
BEGIN
  IF v_actor_id IS NULL OR (SELECT public.get_user_role()) <> 'consultor' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente Consultor autenticado pode cadastrar Cedente.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor_id AND p.role::text = 'consultor' AND p.status::text = 'ativo'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Consultor inativo ou nao autorizado.';
  END IF;
  IF p_fundo_id IS NULL OR NOT (SELECT private.consultor_tem_acesso_fundo(p_fundo_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Fundo nao autorizado para este Consultor.';
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
    v_cedente_id, p_fundo_id, 'ativo', now(), 'C3 - criado pelo Consultor'
  ) RETURNING id INTO v_cedente_fundo_id;

  INSERT INTO public.consultor_cedente (
    consultor_id, cedente_id, comissao_percentual, status
  ) VALUES (
    v_actor_id, v_cedente_id, 0, 'pendente'
  ) RETURNING id INTO v_vinculo_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, ator_identificador, origem,
    tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id, 'usuario', v_actor_id::text, 'consultor_c3',
    'CEDENTE_CRIADO_POR_CONSULTOR', 'cedentes', v_cedente_id,
    pg_catalog.jsonb_build_object(
      'actor_role', 'CONSULTOR', 'cedente_id', v_cedente_id,
      'fundo_id', p_fundo_id, 'cedente_fundo_id', v_cedente_fundo_id,
      'consultor_cedente_id', v_vinculo_id, 'vinculo_status', 'pendente'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'cedente_id', v_cedente_id,
    'cedente_fundo_id', v_cedente_fundo_id,
    'consultor_cedente_id', v_vinculo_id,
    'status', 'pendente'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.criar_cedente_consultor(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_cedente_consultor(uuid, text, text, text) TO authenticated;

-- 5) Onboarding delegado. Mantem o mesmo schema/validacoes do Cedente e troca
-- somente a resolucao do ator/entidade por cedenteId explicito e autorizado.
CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente_delegado(
  p_cedente_id uuid,
  p_cadastro jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cedente public.cedentes%ROWTYPE;
  v_banco public.bancos%ROWTYPE;
  v_cnpj text;
  v_razao_social text;
  v_representante jsonb;
  v_indice bigint;
  v_chaves_invalidas text[];
  v_matriz_id uuid;
BEGIN
  IF v_actor_id IS NULL OR (SELECT public.get_user_role()) <> 'consultor'
     OR NOT (SELECT private.usuario_pode_gerenciar_cedente(p_cedente_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Consultor sem permissao para gerir este Cedente.';
  END IF;
  IF p_cadastro IS NULL OR pg_catalog.jsonb_typeof(p_cadastro) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cadastro do Cedente invalido.';
  END IF;

  SELECT pg_catalog.array_agg(chave ORDER BY chave) INTO v_chaves_invalidas
  FROM pg_catalog.jsonb_object_keys(p_cadastro) AS chave
  WHERE chave <> ALL (ARRAY[
    'cnpj', 'razao_social', 'nome_fantasia', 'cep', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'estado', 'telefone_comercial',
    'email_comercial', 'cnae', 'banco', 'agencia', 'conta', 'tipo_conta',
    'representantes', 'banco_codigo', 'banco_ispb', 'banco_nome'
  ]::text[]);
  IF v_chaves_invalidas IS NOT NULL THEN
    RAISE EXCEPTION 'Campos nao permitidos no cadastro: %', pg_catalog.array_to_string(v_chaves_invalidas, ', ')
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('onboarding-cedente:' || p_cedente_id::text));
  SELECT c.* INTO v_cedente FROM public.cedentes c WHERE c.id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.'; END IF;
  IF v_cedente.status = 'bloqueado'::public.cedente_status THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cadastro de Cedente bloqueado.';
  END IF;

  v_cnpj := pg_catalog.regexp_replace(coalesce(p_cadastro->>'cnpj', ''), '[^0-9]', '', 'g');
  v_razao_social := pg_catalog.btrim(coalesce(p_cadastro->>'razao_social', ''));
  IF v_cnpj IS DISTINCT FROM pg_catalog.regexp_replace(v_cedente.cnpj, '[^0-9]', '', 'g') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O CNPJ do cadastro deve ser o mesmo da criacao.';
  END IF;
  IF NOT (SELECT private.cnpj_valido(v_cnpj)) OR pg_catalog.length(v_razao_social) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados principais do Cedente invalidos.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_cadastro->'representantes') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_cadastro->'representantes') < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe pelo menos um representante legal.';
  END IF;
  IF v_cedente.onboarding_concluido_em IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('id', v_cedente.id, 'razao_social', v_cedente.razao_social, 'criado', false, 'idempotente', true);
  END IF;

  SELECT b.* INTO v_banco
  FROM public.bancos b
  WHERE b.codigo = pg_catalog.btrim(coalesce(p_cadastro->>'banco_codigo', '')) AND b.ativo IS TRUE;
  IF NOT FOUND OR v_banco.codigo !~ '^[0-9]{3}$' OR coalesce(v_banco.ispb, '') !~ '^[0-9]{8}$'
     OR pg_catalog.btrim(coalesce(v_banco.nome, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selecione um banco ativo com COMPE, ISPB e nome validos.';
  END IF;
  IF pg_catalog.btrim(coalesce(p_cadastro->>'banco_ispb', '')) IS DISTINCT FROM v_banco.ispb
     OR pg_catalog.btrim(coalesce(p_cadastro->>'banco_nome', '')) IS DISTINCT FROM v_banco.nome THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados bancarios divergem do catalogo vigente.';
  END IF;
  IF pg_catalog.btrim(coalesce(p_cadastro->>'agencia', '')) = ''
     OR pg_catalog.btrim(coalesce(p_cadastro->>'conta', '')) = ''
     OR pg_catalog.btrim(coalesce(p_cadastro->>'tipo_conta', '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados da conta bancaria sao obrigatorios.';
  END IF;

  UPDATE public.cedentes SET
    razao_social = v_razao_social,
    nome_fantasia = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'nome_fantasia', '')), ''),
    cep = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cep', '')), ''),
    logradouro = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'logradouro', '')), ''),
    numero = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'numero', '')), ''),
    complemento = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'complemento', '')), ''),
    bairro = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'bairro', '')), ''),
    cidade = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cidade', '')), ''),
    estado = nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_cadastro->>'estado', ''))), ''),
    telefone_comercial = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'telefone_comercial', '')), ''),
    email_comercial = nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_cadastro->>'email_comercial', ''))), ''),
    cnae = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cnae', '')), ''),
    banco = v_banco.codigo || ' - ' || v_banco.nome,
    agencia = pg_catalog.btrim(p_cadastro->>'agencia'),
    conta = pg_catalog.btrim(p_cadastro->>'conta'),
    tipo_conta = (p_cadastro->>'tipo_conta')::public.tipo_conta_bancaria,
    banco_codigo = v_banco.codigo,
    banco_ispb = v_banco.ispb,
    banco_nome = v_banco.nome,
    onboarding_concluido_em = now()
  WHERE id = p_cedente_id;

  UPDATE public.cedente_estabelecimentos SET
    razao_social = v_razao_social,
    nome_fantasia = nullif(pg_catalog.btrim(coalesce(p_cadastro->>'nome_fantasia', '')), '')
  WHERE cedente_id = p_cedente_id AND tipo = 'matriz';

  FOR v_representante, v_indice IN
    SELECT elemento, ordinalidade
    FROM pg_catalog.jsonb_array_elements(p_cadastro->'representantes')
      WITH ORDINALITY AS item(elemento, ordinalidade)
  LOOP
    IF pg_catalog.jsonb_typeof(v_representante) <> 'object'
       OR pg_catalog.length(pg_catalog.btrim(coalesce(v_representante->>'nome', ''))) < 3
       OR NOT (SELECT private.cpf_valido(v_representante->>'cpf'))
       OR pg_catalog.btrim(coalesce(v_representante->>'rg', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'cargo', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'email', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'telefone', '')) = '' THEN
      RAISE EXCEPTION 'Representante legal invalido na posicao %.', v_indice USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.representantes (cedente_id, nome, cpf, rg, cargo, email, telefone, principal)
    VALUES (
      p_cedente_id, pg_catalog.btrim(v_representante->>'nome'),
      pg_catalog.regexp_replace(v_representante->>'cpf', '[^0-9]', '', 'g'),
      pg_catalog.btrim(v_representante->>'rg'), pg_catalog.btrim(v_representante->>'cargo'),
      pg_catalog.lower(pg_catalog.btrim(v_representante->>'email')),
      pg_catalog.btrim(v_representante->>'telefone'), v_indice = 1
    );
  END LOOP;

  SELECT e.id INTO v_matriz_id FROM public.cedente_estabelecimentos e
  WHERE e.cedente_id = p_cedente_id AND e.tipo = 'matriz';
  IF v_matriz_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Matriz do Cedente nao encontrada.'; END IF;

  INSERT INTO public.cedente_estabelecimento_contas_bancarias (
    estabelecimento_id, titular_estabelecimento_id, banco, agencia, conta,
    tipo_conta, principal, ativo, criado_por, banco_codigo, banco_ispb, banco_nome
  ) VALUES (
    v_matriz_id, v_matriz_id, v_banco.codigo || ' - ' || v_banco.nome,
    pg_catalog.btrim(p_cadastro->>'agencia'), pg_catalog.btrim(p_cadastro->>'conta'),
    p_cadastro->>'tipo_conta', true, true, v_actor_id,
    v_banco.codigo, v_banco.ispb, v_banco.nome
  );

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, ator_identificador, origem,
    tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id, 'usuario', v_actor_id::text, 'consultor_c3',
    'CEDENTE_CADASTRO_CONCLUIDO_POR_CONSULTOR', 'cedentes', p_cedente_id,
    pg_catalog.jsonb_build_object('actor_role', 'CONSULTOR', 'cedente_id', p_cedente_id)
  );

  RETURN pg_catalog.jsonb_build_object('id', p_cedente_id, 'razao_social', v_razao_social, 'criado', true, 'idempotente', false);
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente_delegado(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente_delegado(uuid, jsonb) TO authenticated;

-- 6) Alteracao pos-onboarding com ator delegado real.
CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente_delegada(
  p_cedente_id uuid,
  p_dados_atuais jsonb,
  p_dados_propostos jsonb,
  p_representantes_atuais jsonb DEFAULT '[]'::jsonb,
  p_representantes_propostos jsonb DEFAULT '[]'::jsonb
)
RETURNS public.solicitacoes_alteracao_cedente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_result public.solicitacoes_alteracao_cedente%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR (SELECT public.get_user_role()) <> 'consultor'
     OR NOT (SELECT private.usuario_pode_gerenciar_cedente(p_cedente_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Consultor sem permissao para gerir este Cedente.';
  END IF;
  IF p_dados_propostos IS NULL OR pg_catalog.jsonb_typeof(p_dados_propostos) <> 'object'
     OR p_dados_atuais IS NULL OR pg_catalog.jsonb_typeof(p_dados_atuais) <> 'object'
     OR (p_representantes_propostos IS NOT NULL AND pg_catalog.jsonb_typeof(p_representantes_propostos) <> 'array')
     OR (p_representantes_atuais IS NOT NULL AND pg_catalog.jsonb_typeof(p_representantes_atuais) <> 'array') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dados da solicitacao invalidos.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.solicitacoes_alteracao_cedente s
    WHERE s.cedente_id = p_cedente_id AND s.status = 'pendente'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Ja existe uma solicitacao de alteracao aguardando aprovacao.';
  END IF;

  INSERT INTO public.solicitacoes_alteracao_cedente (
    cedente_id, dados_atuais, dados_propostos, representantes_atuais, representantes_propostos
  ) VALUES (
    p_cedente_id, p_dados_atuais, p_dados_propostos,
    coalesce(p_representantes_atuais, '[]'::jsonb), coalesce(p_representantes_propostos, '[]'::jsonb)
  ) RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, ator_identificador, origem,
    tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    v_actor_id, 'usuario', v_actor_id::text, 'consultor_c3',
    'ALTERACAO_CADASTRAL_SOLICITADA', 'cedentes', p_cedente_id,
    p_dados_atuais,
    p_dados_propostos || pg_catalog.jsonb_build_object('actor_role', 'CONSULTOR', 'cedente_id', p_cedente_id)
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_alteracao_cadastral_cedente_delegada(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_alteracao_cadastral_cedente_delegada(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;

-- 7) RLS de gestao. A policy operacional C2 permanece inalterada; estas
-- policies apenas liberam cadastro/documentos para vinculo pendente ou ativo.
DROP POLICY IF EXISTS representantes_consultor_select ON public.representantes;

CREATE POLICY cedentes_consultor_manage_select
  ON public.cedentes FOR SELECT TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(cedentes.id)));

CREATE POLICY representantes_manager_select
  ON public.representantes FOR SELECT TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(representantes.cedente_id)));
CREATE POLICY representantes_manager_insert
  ON public.representantes FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.usuario_pode_gerenciar_cedente(representantes.cedente_id)));
CREATE POLICY representantes_manager_update
  ON public.representantes FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(representantes.cedente_id)))
  WITH CHECK ((SELECT private.usuario_pode_gerenciar_cedente(representantes.cedente_id)));
CREATE POLICY representantes_manager_delete
  ON public.representantes FOR DELETE TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(representantes.cedente_id)));

CREATE POLICY documentos_manager_select
  ON public.documentos FOR SELECT TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(documentos.cedente_id)));
CREATE POLICY documentos_manager_insert
  ON public.documentos FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.usuario_pode_gerenciar_cedente(documentos.cedente_id)));
CREATE POLICY documentos_manager_update
  ON public.documentos FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(documentos.cedente_id)))
  WITH CHECK ((SELECT private.usuario_pode_gerenciar_cedente(documentos.cedente_id)));

CREATE POLICY cedente_fundos_manager_select
  ON public.cedente_fundos FOR SELECT TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(cedente_fundos.cedente_id)));

DROP POLICY IF EXISTS documento_upload_intents_select_own ON public.documento_upload_intents;
CREATE POLICY documento_upload_intents_select_own
  ON public.documento_upload_intents FOR SELECT TO authenticated
  USING (
    usuario_id = (SELECT auth.uid())
    AND (SELECT private.usuario_pode_gerenciar_cedente(documento_upload_intents.cedente_id))
  );

CREATE POLICY solicitacoes_alteracao_cedente_manager_select
  ON public.solicitacoes_alteracao_cedente FOR SELECT TO authenticated
  USING ((SELECT private.usuario_pode_gerenciar_cedente(solicitacoes_alteracao_cedente.cedente_id)));

-- Storage privado: o caminho deve pertencer ao CNPJ de um Cedente que o ator
-- realmente pode gerir. O cedenteId recebido no browser nunca decide sozinho.
CREATE POLICY storage_docs_manager_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND EXISTS (
      SELECT 1 FROM public.cedentes c
      WHERE pg_catalog.regexp_replace(c.cnpj, '\\D', '', 'g') =
            pg_catalog.regexp_replace(coalesce((storage.foldername(name))[1], ''), '\\D', '', 'g')
        AND (SELECT private.usuario_pode_gerenciar_cedente(c.id))
    )
  );

CREATE POLICY storage_docs_manager_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND EXISTS (
      SELECT 1 FROM public.cedentes c
      WHERE pg_catalog.regexp_replace(c.cnpj, '\\D', '', 'g') =
            pg_catalog.regexp_replace(coalesce((storage.foldername(name))[1], ''), '\\D', '', 'g')
        AND (SELECT private.usuario_pode_gerenciar_cedente(c.id))
    )
  );

CREATE POLICY storage_docs_manager_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND EXISTS (
      SELECT 1 FROM public.cedentes c
      WHERE pg_catalog.regexp_replace(c.cnpj, '\\D', '', 'g') =
            pg_catalog.regexp_replace(coalesce((storage.foldername(name))[1], ''), '\\D', '', 'g')
        AND (SELECT private.usuario_pode_gerenciar_cedente(c.id))
    )
  )
  WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND EXISTS (
      SELECT 1 FROM public.cedentes c
      WHERE pg_catalog.regexp_replace(c.cnpj, '\\D', '', 'g') =
            pg_catalog.regexp_replace(coalesce((storage.foldername(name))[1], ''), '\\D', '', 'g')
        AND (SELECT private.usuario_pode_gerenciar_cedente(c.id))
    )
  );

-- 8) FINALIZE P9 passa a usar o intent persistido e can_manage. O transporte,
-- limite, owner, metadata, retry, cleanup e versionamento permanecem iguais.
CREATE OR REPLACE FUNCTION public.finalizar_documento_upload_intent(p_intent_id uuid)
RETURNS TABLE(documento_id uuid, versao integer, status public.documento_status, storage_path text, novo_registro boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.get_user_role();
  v_intent public.documento_upload_intents%ROWTYPE;
  v_objeto record;
  v_cedente_cnpj text;
  v_prefixo text;
  v_versao integer;
  v_existente public.documentos%ROWTYPE;
  v_documento public.documentos%ROWTYPE;
  v_ultimo public.documentos%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria'; END IF;
  SELECT * INTO v_intent FROM public.documento_upload_intents WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.usuario_id IS DISTINCT FROM v_actor_id
     OR NOT (SELECT private.usuario_pode_gerenciar_cedente(v_intent.cedente_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Upload nao autorizado';
  END IF;
  IF v_intent.status = 'FINALIZED' THEN
    RETURN QUERY SELECT d.id, d.versao, d.status, d.url_arquivo, false
      FROM public.documentos d WHERE d.id = v_intent.documento_versao_id
        AND d.cedente_id = v_intent.cedente_id AND d.url_arquivo = v_intent.storage_path;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Versao finalizada inconsistente'; END IF;
    RETURN;
  END IF;
  IF v_intent.status IN ('CLEANUP_PENDING','CLEANED','EXPIRED') OR now() >= v_intent.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Upload expirado ou em limpeza';
  END IF;

  SELECT c.cnpj INTO v_cedente_cnpj FROM public.cedentes c WHERE c.id = v_intent.cedente_id;
  IF v_cedente_cnpj IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado'; END IF;
  IF v_intent.representante_id IS NULL THEN
    v_prefixo := v_cedente_cnpj || '/' || v_intent.tipo_documento::text || '/';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.representantes r
      WHERE r.id = v_intent.representante_id AND r.cedente_id = v_intent.cedente_id
    ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Representante nao autorizado'; END IF;
    v_prefixo := v_cedente_cnpj || '/representantes/' || v_intent.representante_id::text || '/';
  END IF;
  IF pg_catalog.left(v_intent.storage_path, pg_catalog.length(v_prefixo)) <> v_prefixo THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caminho de Storage nao autorizado';
  END IF;

  SELECT o.owner_id, o.metadata INTO v_objeto FROM storage.objects o
  WHERE o.bucket_id = v_intent.storage_bucket AND o.name = v_intent.storage_path;
  IF NOT FOUND OR v_objeto.owner_id IS DISTINCT FROM v_actor_id::text
    OR pg_catalog.lower(coalesce(v_objeto.metadata->>'mimetype','')) <> v_intent.mime_type
    OR coalesce(v_objeto.metadata->>'size','') !~ '^[0-9]+$'
    OR (v_objeto.metadata->>'size')::bigint <> v_intent.tamanho_esperado THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Objeto nao corresponde ao intent';
  END IF;

  SELECT d.* INTO v_existente FROM public.documentos d WHERE d.url_arquivo = v_intent.storage_path;
  IF FOUND THEN
    IF v_existente.cedente_id IS DISTINCT FROM v_intent.cedente_id
       OR v_existente.tipo IS DISTINCT FROM v_intent.tipo_documento
       OR v_existente.representante_id IS DISTINCT FROM v_intent.representante_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Caminho ja vinculado a outro contexto';
    END IF;
    UPDATE public.documento_upload_intents SET status='FINALIZED', documento_id=v_existente.id,
      documento_versao_id=v_existente.id, finalized_at=coalesce(finalized_at, now()), updated_at=now()
      WHERE id=p_intent_id;
    RETURN QUERY SELECT v_existente.id, v_existente.versao, v_existente.status, v_existente.url_arquivo, false;
    RETURN;
  END IF;

  SELECT d.* INTO v_ultimo FROM public.documentos d
  WHERE d.cedente_id = v_intent.cedente_id
    AND d.tipo = v_intent.tipo_documento
    AND d.representante_id IS NOT DISTINCT FROM v_intent.representante_id
  ORDER BY d.versao DESC LIMIT 1;
  IF FOUND AND v_ultimo.status NOT IN ('aguardando_envio'::public.documento_status, 'reprovado'::public.documento_status)
     AND v_ultimo.atualizacao_solicitada_em IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Documento nao permite novo envio';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_intent.cedente_id::text || ':' || v_intent.tipo_documento::text || ':' || coalesce(v_intent.representante_id::text, 'empresa'), 0
  ));
  SELECT coalesce(max(d.versao), 0) + 1 INTO v_versao FROM public.documentos d
  WHERE d.cedente_id = v_intent.cedente_id AND d.tipo = v_intent.tipo_documento
    AND d.representante_id IS NOT DISTINCT FROM v_intent.representante_id;

  INSERT INTO public.documentos (cedente_id, tipo, versao, status, url_arquivo, nome_arquivo, representante_id)
  VALUES (v_intent.cedente_id, v_intent.tipo_documento, v_versao, 'enviado'::public.documento_status,
    v_intent.storage_path, v_intent.nome_original, v_intent.representante_id)
  RETURNING * INTO v_documento;

  UPDATE public.documento_upload_intents i SET status='FINALIZED', documento_id=v_documento.id,
    documento_versao_id=v_documento.id, uploaded_at=coalesce(i.uploaded_at, now()),
    finalized_at=now(), updated_at=now(), last_error_code=null WHERE i.id=p_intent_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, ator_identificador, tipo_evento, entidade_tipo, entidade_id, dados_depois, origem
  ) VALUES (
    v_actor_id, 'usuario', v_actor_id::text, 'DOCUMENTO_ENVIADO', 'documentos', v_documento.id,
    pg_catalog.jsonb_build_object(
      'actor_role', pg_catalog.upper(coalesce(v_actor_role, '')), 'cedente_id', v_intent.cedente_id,
      'upload_intent_id', p_intent_id, 'tipo', v_intent.tipo_documento,
      'versao', v_documento.versao, 'nome_arquivo', v_intent.nome_original
    ), 'upload_intent'
  );
  RETURN QUERY SELECT v_documento.id, v_documento.versao, v_documento.status, v_documento.url_arquivo, true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalizar_documento_upload_intent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_documento_upload_intent(uuid) TO authenticated;

-- 9) A aprovacao do Gestor ativa o vinculo pendente na mesma transacao que
-- muda o Cedente para ativo. C2 passa a enxerga-lo sem alteracao em seu filtro.
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
    UPDATE public.consultor_cedente cc
    SET status = 'ativo'
    WHERE cc.cedente_id = NEW.id AND cc.status = 'pendente';
    GET DIAGNOSTICS v_ativados = ROW_COUNT;
    IF v_ativados > 0 THEN
      INSERT INTO public.logs_auditoria (
        usuario_id, ator_tipo, ator_identificador, origem,
        tipo_evento, entidade_tipo, entidade_id, dados_depois
      ) VALUES (
        auth.uid(), 'usuario', auth.uid()::text, 'gestor_aprovacao_c3',
        'VINCULO_CONSULTOR_ATIVADO_APOS_APROVACAO', 'cedentes', NEW.id,
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

DROP TRIGGER IF EXISTS cedentes_ativar_vinculo_consultor_c3 ON public.cedentes;
CREATE TRIGGER cedentes_ativar_vinculo_consultor_c3
  AFTER UPDATE OF status ON public.cedentes
  FOR EACH ROW EXECUTE FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao();

REVOKE ALL ON FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao() FROM PUBLIC, anon, authenticated;

COMMIT;
