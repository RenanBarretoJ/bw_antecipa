-- P0 - corrige o onboarding do cedente apos o hardening de ACL da P2.6.4.
--
-- O cadastro deixa de depender de INSERT direto via Data API. A identidade e o
-- papel sao resolvidos no banco a partir de auth.uid(); cedente e representantes
-- sao persistidos na mesma transacao da funcao.

BEGIN;

CREATE OR REPLACE FUNCTION private.cpf_valido(p_valor text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v text := pg_catalog.regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g');
  v_soma integer := 0;
  v_digito integer;
  v_indice integer;
BEGIN
  IF pg_catalog.length(v) <> 11 OR v ~ '^([0-9])\1{10}$' THEN
    RETURN false;
  END IF;

  FOR v_indice IN 1..9 LOOP
    v_soma := v_soma + pg_catalog.substring(v, v_indice, 1)::integer * (11 - v_indice);
  END LOOP;
  v_digito := 11 - (v_soma % 11);
  IF v_digito >= 10 THEN v_digito := 0; END IF;
  IF v_digito <> pg_catalog.substring(v, 10, 1)::integer THEN RETURN false; END IF;

  v_soma := 0;
  FOR v_indice IN 1..10 LOOP
    v_soma := v_soma + pg_catalog.substring(v, v_indice, 1)::integer * (12 - v_indice);
  END LOOP;
  v_digito := 11 - (v_soma % 11);
  IF v_digito >= 10 THEN v_digito := 0; END IF;
  RETURN v_digito = pg_catalog.substring(v, 11, 1)::integer;
END;
$function$;

REVOKE ALL ON FUNCTION private.cpf_valido(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente(
  p_cadastro jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_papel text;
  v_status_perfil text;
  v_cedente_id uuid;
  v_cnpj text;
  v_razao_social text;
  v_existente record;
  v_representante jsonb;
  v_indice bigint;
  v_chaves_invalidas text[];
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.' USING ERRCODE = '42501';
  END IF;

  IF p_cadastro IS NULL OR jsonb_typeof(p_cadastro) <> 'object' THEN
    RAISE EXCEPTION 'Cadastro do cedente invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(chave ORDER BY chave)
    INTO v_chaves_invalidas
    FROM jsonb_object_keys(p_cadastro) AS chave
   WHERE chave <> ALL (ARRAY[
     'cnpj', 'razao_social', 'nome_fantasia', 'cep', 'logradouro',
     'numero', 'complemento', 'bairro', 'cidade', 'estado',
     'telefone_comercial', 'email_comercial', 'cnae', 'banco', 'agencia',
     'conta', 'tipo_conta', 'representantes'
   ]::text[]);

  IF v_chaves_invalidas IS NOT NULL THEN
    RAISE EXCEPTION 'Campos nao permitidos no cadastro: %', array_to_string(v_chaves_invalidas, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role::text, p.status::text
    INTO v_papel, v_status_perfil
    FROM public.profiles p
   WHERE p.id = v_usuario_id;

  IF NOT FOUND OR v_status_perfil IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'Perfil autenticado nao esta ativo.' USING ERRCODE = '42501';
  END IF;

  IF v_papel IS DISTINCT FROM 'cedente' THEN
    RAISE EXCEPTION 'Somente usuarios cedentes podem concluir este cadastro.' USING ERRCODE = '42501';
  END IF;

  -- Serializa tentativas concorrentes do mesmo usuario sem ampliar grants.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_usuario_id::text));

  v_cnpj := pg_catalog.regexp_replace(coalesce(p_cadastro->>'cnpj', ''), '[^0-9]', '', 'g');
  v_razao_social := pg_catalog.btrim(coalesce(p_cadastro->>'razao_social', ''));

  IF NOT (SELECT private.cnpj_valido(v_cnpj)) THEN
    RAISE EXCEPTION 'CNPJ do cedente invalido.' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.length(v_razao_social) < 3 THEN
    RAISE EXCEPTION 'Razao social do cedente invalida.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_cadastro->'representantes') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cadastro->'representantes') < 1 THEN
    RAISE EXCEPTION 'Informe pelo menos um representante legal.' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.cnpj, c.razao_social
    INTO v_existente
    FROM public.cedentes c
   WHERE c.user_id = v_usuario_id
   ORDER BY c.created_at, c.id
   LIMIT 1;

  IF FOUND THEN
    IF pg_catalog.regexp_replace(coalesce(v_existente.cnpj, ''), '[^0-9]', '', 'g') <> v_cnpj THEN
      RAISE EXCEPTION 'O usuario autenticado ja possui cadastro com outro CNPJ.' USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'id', v_existente.id,
      'razao_social', v_existente.razao_social,
      'criado', false,
      'idempotente', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cedentes c
     WHERE pg_catalog.regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
       AND c.user_id IS DISTINCT FROM v_usuario_id
  ) THEN
    RAISE EXCEPTION 'CNPJ ja cadastrado para outro usuario.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.cedentes (
    user_id, cnpj, razao_social, nome_fantasia, cep, logradouro, numero,
    complemento, bairro, cidade, estado, telefone_comercial, email_comercial,
    cnae, banco, agencia, conta, tipo_conta, status, fundo_id
  )
  VALUES (
    v_usuario_id,
    v_cnpj,
    v_razao_social,
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'nome_fantasia', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cep', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'logradouro', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'numero', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'complemento', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'bairro', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cidade', '')), ''),
    nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_cadastro->>'estado', ''))), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'telefone_comercial', '')), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_cadastro->>'email_comercial', ''))), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'cnae', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'agencia', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'conta', '')), ''),
    (p_cadastro->>'tipo_conta')::public.tipo_conta_bancaria,
    'pendente'::public.cedente_status,
    NULL
  )
  RETURNING id INTO v_cedente_id;

  FOR v_representante, v_indice IN
    SELECT elemento, ordinalidade
      FROM jsonb_array_elements(p_cadastro->'representantes')
           WITH ORDINALITY AS item(elemento, ordinalidade)
  LOOP
    IF jsonb_typeof(v_representante) <> 'object'
       OR pg_catalog.length(pg_catalog.btrim(coalesce(v_representante->>'nome', ''))) < 3
       OR NOT (SELECT private.cpf_valido(v_representante->>'cpf'))
       OR pg_catalog.btrim(coalesce(v_representante->>'rg', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'cargo', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'email', '')) = ''
       OR pg_catalog.btrim(coalesce(v_representante->>'telefone', '')) = '' THEN
      RAISE EXCEPTION 'Representante legal invalido na posicao %.', v_indice USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.representantes (
      cedente_id, nome, cpf, rg, cargo, email, telefone, principal
    )
    VALUES (
      v_cedente_id,
      pg_catalog.btrim(v_representante->>'nome'),
      pg_catalog.regexp_replace(v_representante->>'cpf', '[^0-9]', '', 'g'),
      pg_catalog.btrim(v_representante->>'rg'),
      pg_catalog.btrim(v_representante->>'cargo'),
      pg_catalog.lower(pg_catalog.btrim(v_representante->>'email')),
      pg_catalog.btrim(v_representante->>'telefone'),
      v_indice = 1
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_cedente_id,
    'razao_social', v_razao_social,
    'criado', true,
    'idempotente', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente(jsonb) TO authenticated;

-- Mantem o contrato de menor privilegio criado pela canonicalizacao: o cliente
-- nao volta a escrever diretamente nas tabelas cadastrais.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cedentes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.representantes FROM authenticated;
REVOKE ALL ON TABLE public.cedentes, public.representantes FROM anon;

COMMENT ON FUNCTION public.concluir_onboarding_cedente(jsonb) IS
  'Conclui de forma atomica e idempotente o cadastro do proprio cedente autenticado; nao aceita user_id nem fundo_id do cliente.';

NOTIFY pgrst, 'reload schema';

COMMIT;
