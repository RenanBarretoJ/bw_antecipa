-- P0: corrige "permission denied for table cedentes" nas mutacoes do Gestor
-- na tela de detalhe do Cedente (Aprovar/Reprovar Cadastro, Escrow,
-- Coobrigacao) e fecha um RLS_GAP real em solicitacoes_alteracao_cedente
-- (policy antiga liberava qualquer gestor, sem checar vinculo com o fundo).
--
-- public.cedentes, public.representantes e public.contas_escrow ja tinham
-- INSERT/UPDATE/DELETE revogados de authenticated (P2.6.4 e hotfixes
-- anteriores). As Server Actions ainda escreviam direto nessas tabelas.
-- Nenhum GRANT de escrita direta e reaberto; as mutacoes passam a ocorrer
-- por RPCs SECURITY DEFINER estreitas, reaproveitando a mesma regra
-- multifundo ja usada para documentos.

BEGIN;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_cedente(p_cedente_id uuid)
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
      AND cf.status = 'ativo'
      AND private.usuario_tem_acesso_fundo(cf.fundo_id)
  );
$function$;

REVOKE ALL ON FUNCTION private.gestor_tem_acesso_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_cedente(uuid) TO authenticated;

-- 1) Aprovar Cadastro: ativa o cedente e cria a conta escrow na mesma transacao.
CREATE OR REPLACE FUNCTION public.aprovar_cadastro_cedente_gestor(p_cedente_id uuid)
RETURNS TABLE (
  cedente_id uuid,
  status public.cedente_status,
  conta_escrow_identificador text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_status_atual public.cedente_status;
  v_cnpj text;
  v_total_contas bigint;
  v_identificador text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para aprovar cadastro.';
  END IF;

  SELECT c.status, c.cnpj INTO v_status_atual, v_cnpj
  FROM public.cedentes c
  WHERE c.id = p_cedente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(p_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  IF v_status_atual = 'ativo' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cedente ja esta ativo.';
  END IF;

  UPDATE public.cedentes SET status = 'ativo'::public.cedente_status WHERE id = p_cedente_id;

  -- Serializa a geracao do sequencial da conta escrow sem ampliar grants.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('contas_escrow_sequencial'));

  SELECT pg_catalog.count(*) INTO v_total_contas FROM public.contas_escrow;
  v_identificador := 'ESC-' || pg_catalog.regexp_replace(coalesce(v_cnpj, ''), '\D', '', 'g')
    || '-' || pg_catalog.lpad((v_total_contas + 1)::text, 4, '0');

  INSERT INTO public.contas_escrow (cedente_id, identificador, saldo_disponivel, saldo_bloqueado, status)
  VALUES (p_cedente_id, v_identificador, 0, 0, 'ativa'::public.conta_escrow_status);

  RETURN QUERY SELECT p_cedente_id, 'ativo'::public.cedente_status, v_identificador;
END;
$function$;

REVOKE ALL ON FUNCTION public.aprovar_cadastro_cedente_gestor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_cadastro_cedente_gestor(uuid) TO authenticated;

-- 2) Reprovar Cadastro.
CREATE OR REPLACE FUNCTION public.reprovar_cadastro_cedente_gestor(p_cedente_id uuid)
RETURNS TABLE (
  cedente_id uuid,
  status public.cedente_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_status_atual public.cedente_status;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para reprovar cadastro.';
  END IF;

  SELECT c.status INTO v_status_atual
  FROM public.cedentes c
  WHERE c.id = p_cedente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(p_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  IF v_status_atual = 'ativo' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cedente ja esta ativo; reprovacao nao se aplica.';
  END IF;

  UPDATE public.cedentes SET status = 'reprovado'::public.cedente_status WHERE id = p_cedente_id;

  RETURN QUERY SELECT p_cedente_id, 'reprovado'::public.cedente_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.reprovar_cadastro_cedente_gestor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprovar_cadastro_cedente_gestor(uuid) TO authenticated;

-- 3) Habilitar/Desabilitar Escrow.
CREATE OR REPLACE FUNCTION public.alternar_escrow_cedente_gestor(p_cedente_id uuid, p_habilitar boolean)
RETURNS TABLE (
  cedente_id uuid,
  habilitar_escrow boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para alterar configuracao de escrow.';
  END IF;

  IF p_habilitar IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valor de escrow invalido.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cedentes c WHERE c.id = p_cedente_id FOR UPDATE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(p_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  UPDATE public.cedentes SET habilitar_escrow = p_habilitar WHERE id = p_cedente_id;

  RETURN QUERY SELECT p_cedente_id, p_habilitar;
END;
$function$;

REVOKE ALL ON FUNCTION public.alternar_escrow_cedente_gestor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alternar_escrow_cedente_gestor(uuid, boolean) TO authenticated;

-- 4) Habilitar/Desabilitar Coobrigacao.
CREATE OR REPLACE FUNCTION public.alternar_coobrigacao_cedente_gestor(p_cedente_id uuid, p_habilitar boolean)
RETURNS TABLE (
  cedente_id uuid,
  coobrigacao boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para alterar configuracao de coobrigacao.';
  END IF;

  IF p_habilitar IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valor de coobrigacao invalido.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cedentes c WHERE c.id = p_cedente_id FOR UPDATE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(p_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  UPDATE public.cedentes SET coobrigacao = p_habilitar WHERE id = p_cedente_id;

  RETURN QUERY SELECT p_cedente_id, p_habilitar;
END;
$function$;

REVOKE ALL ON FUNCTION public.alternar_coobrigacao_cedente_gestor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alternar_coobrigacao_cedente_gestor(uuid, boolean) TO authenticated;

-- 5) Aprovar alteracao cadastral: aplica os campos propostos (mesma lista
-- permitida em concluir_onboarding_cedente) e substitui os representantes,
-- na mesma transacao. RLS_GAP fechado: exige vinculo do gestor ao fundo do
-- cedente (a policy sac_gestor_all liberava qualquer gestor).
CREATE OR REPLACE FUNCTION public.aprovar_alteracao_cadastral_cedente_gestor(p_solicitacao_id uuid)
RETURNS TABLE (
  solicitacao_id uuid,
  cedente_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cedente_id uuid;
  v_status_atual text;
  v_dados jsonb;
  v_reps_propostos jsonb;
  v_chaves_invalidas text[];
  v_representante jsonb;
  v_indice bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para aprovar alteracao cadastral.';
  END IF;

  SELECT s.cedente_id, s.status, s.dados_propostos, s.representantes_propostos
  INTO v_cedente_id, v_status_atual, v_dados, v_reps_propostos
  FROM public.solicitacoes_alteracao_cedente s
  WHERE s.id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Solicitacao nao encontrada.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(v_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  IF v_status_atual <> 'pendente' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Solicitacao ja foi analisada.';
  END IF;

  SELECT pg_catalog.array_agg(chave ORDER BY chave)
    INTO v_chaves_invalidas
    FROM jsonb_object_keys(coalesce(v_dados, '{}'::jsonb)) AS chave
   WHERE chave <> ALL (ARRAY[
     'cnpj', 'razao_social', 'nome_fantasia', 'cep', 'logradouro',
     'numero', 'complemento', 'bairro', 'cidade', 'estado',
     'telefone_comercial', 'email_comercial', 'cnae', 'banco', 'agencia',
     'conta', 'tipo_conta'
   ]::text[]);

  IF v_chaves_invalidas IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = pg_catalog.format('Campos nao permitidos na alteracao cadastral: %s', pg_catalog.array_to_string(v_chaves_invalidas, ', '));
  END IF;

  UPDATE public.cedentes SET
    cnpj = coalesce(v_dados->>'cnpj', cnpj),
    razao_social = coalesce(v_dados->>'razao_social', razao_social),
    nome_fantasia = coalesce(v_dados->>'nome_fantasia', nome_fantasia),
    cep = coalesce(v_dados->>'cep', cep),
    logradouro = coalesce(v_dados->>'logradouro', logradouro),
    numero = coalesce(v_dados->>'numero', numero),
    complemento = coalesce(v_dados->>'complemento', complemento),
    bairro = coalesce(v_dados->>'bairro', bairro),
    cidade = coalesce(v_dados->>'cidade', cidade),
    estado = coalesce(v_dados->>'estado', estado),
    telefone_comercial = coalesce(v_dados->>'telefone_comercial', telefone_comercial),
    email_comercial = coalesce(v_dados->>'email_comercial', email_comercial),
    cnae = coalesce(v_dados->>'cnae', cnae),
    banco = coalesce(v_dados->>'banco', banco),
    agencia = coalesce(v_dados->>'agencia', agencia),
    conta = coalesce(v_dados->>'conta', conta),
    tipo_conta = coalesce((v_dados->>'tipo_conta')::public.tipo_conta_bancaria, tipo_conta)
  WHERE id = v_cedente_id;

  IF v_reps_propostos IS NOT NULL AND jsonb_array_length(v_reps_propostos) > 0 THEN
    DELETE FROM public.representantes WHERE cedente_id = v_cedente_id;

    FOR v_representante, v_indice IN
      SELECT elemento, ordinalidade
        FROM jsonb_array_elements(v_reps_propostos) WITH ORDINALITY AS item(elemento, ordinalidade)
    LOOP
      INSERT INTO public.representantes (cedente_id, nome, cpf, rg, cargo, email, telefone, principal)
      VALUES (
        v_cedente_id,
        coalesce(v_representante->>'nome', ''),
        coalesce(v_representante->>'cpf', ''),
        coalesce(v_representante->>'rg', ''),
        coalesce(v_representante->>'cargo', ''),
        coalesce(v_representante->>'email', ''),
        coalesce(v_representante->>'telefone', ''),
        v_indice = 1
      );
    END LOOP;
  END IF;

  UPDATE public.solicitacoes_alteracao_cedente
  SET status = 'aprovada', analisado_por = v_actor_id, analisado_em = now()
  WHERE id = p_solicitacao_id;

  RETURN QUERY SELECT p_solicitacao_id, v_cedente_id, 'aprovada'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.aprovar_alteracao_cadastral_cedente_gestor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_alteracao_cadastral_cedente_gestor(uuid) TO authenticated;

-- 6) Reprovar alteracao cadastral. Mesmo fechamento de RLS_GAP do item 5.
CREATE OR REPLACE FUNCTION public.reprovar_alteracao_cadastral_cedente_gestor(p_solicitacao_id uuid, p_motivo text)
RETURNS TABLE (
  solicitacao_id uuid,
  cedente_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cedente_id uuid;
  v_status_atual text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para reprovar alteracao cadastral.';
  END IF;

  IF p_motivo IS NULL OR pg_catalog.length(pg_catalog.btrim(p_motivo)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Motivo da reprovacao e obrigatorio.';
  END IF;

  SELECT s.cedente_id, s.status INTO v_cedente_id, v_status_atual
  FROM public.solicitacoes_alteracao_cedente s
  WHERE s.id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Solicitacao nao encontrada.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(v_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  IF v_status_atual <> 'pendente' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Solicitacao ja foi analisada.';
  END IF;

  UPDATE public.solicitacoes_alteracao_cedente
  SET status = 'reprovada', motivo_reprovacao = p_motivo, analisado_por = v_actor_id, analisado_em = now()
  WHERE id = p_solicitacao_id;

  RETURN QUERY SELECT p_solicitacao_id, v_cedente_id, 'reprovada'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.reprovar_alteracao_cadastral_cedente_gestor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprovar_alteracao_cadastral_cedente_gestor(uuid, text) TO authenticated;

-- Fecha o RLS_GAP: a policy legada "Gestor acessa tudo" nao checava vinculo
-- com o fundo do cedente. UPDATE direto passa a ser bloqueado; a leitura do
-- proprio cedente e do gestor (para listar solicitacoes) continua liberada
-- pela policy existente, que sera substituida por uma versao multifundo.
REVOKE UPDATE ON TABLE public.solicitacoes_alteracao_cedente FROM authenticated;

DROP POLICY IF EXISTS sac_gestor_all ON public.solicitacoes_alteracao_cedente;
CREATE POLICY sac_gestor_select ON public.solicitacoes_alteracao_cedente
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'gestor'
    AND private.gestor_tem_acesso_cedente(cedente_id)
  );

COMMIT;
