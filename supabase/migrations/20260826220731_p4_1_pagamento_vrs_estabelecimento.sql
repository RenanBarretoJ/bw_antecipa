-- P4.1 - PAGAMENTO VRS pela conta estruturada do estabelecimento emissor.
--
-- O backfill e deliberadamente conservador: apenas completa campos nulos quando
-- o COMPE ja e valido ou quando o label legado inicia inequivocamente por
-- "NNN -" e existe uma unica entrada ativa correspondente no catalogo.

BEGIN;

WITH catalogo AS (
  SELECT b.codigo, b.ispb, b.nome
  FROM public.bancos b
  WHERE b.ativo IS TRUE
    AND b.codigo ~ '^[0-9]{3}$'
    AND b.ispb ~ '^[0-9]{8}$'
    AND pg_catalog.btrim(b.nome) <> ''
), candidatos AS (
  SELECT c.id, b.codigo, b.ispb, b.nome
  FROM public.cedentes c
  JOIN catalogo b
    ON b.codigo = CASE
      WHEN pg_catalog.btrim(coalesce(c.banco_codigo, '')) ~ '^[0-9]{3}$'
        THEN pg_catalog.btrim(c.banco_codigo)
      WHEN c.banco_codigo IS NULL
        AND pg_catalog.btrim(coalesce(c.banco, '')) ~ '^[0-9]{3}[[:space:]]*-[[:space:]]*[^[:space:]].*$'
        THEN pg_catalog.substring(pg_catalog.btrim(c.banco), '^([0-9]{3})')
      ELSE NULL
    END
  WHERE (c.banco_codigo IS NULL OR pg_catalog.btrim(c.banco_codigo) = b.codigo)
    AND (c.banco_ispb IS NULL OR pg_catalog.btrim(c.banco_ispb) = b.ispb)
    AND (c.banco_nome IS NULL OR pg_catalog.btrim(c.banco_nome) = b.nome)
)
UPDATE public.cedentes c
SET banco_codigo = coalesce(c.banco_codigo, candidatos.codigo),
    banco_ispb = coalesce(c.banco_ispb, candidatos.ispb),
    banco_nome = coalesce(c.banco_nome, candidatos.nome)
FROM candidatos
WHERE c.id = candidatos.id
  AND (c.banco_codigo IS NULL OR c.banco_ispb IS NULL OR c.banco_nome IS NULL);

WITH catalogo AS (
  SELECT b.codigo, b.ispb, b.nome
  FROM public.bancos b
  WHERE b.ativo IS TRUE
    AND b.codigo ~ '^[0-9]{3}$'
    AND b.ispb ~ '^[0-9]{8}$'
    AND pg_catalog.btrim(b.nome) <> ''
), candidatos AS (
  SELECT cb.id, b.codigo, b.ispb, b.nome
  FROM public.cedente_estabelecimento_contas_bancarias cb
  JOIN catalogo b
    ON b.codigo = CASE
      WHEN pg_catalog.btrim(coalesce(cb.banco_codigo, '')) ~ '^[0-9]{3}$'
        THEN pg_catalog.btrim(cb.banco_codigo)
      WHEN cb.banco_codigo IS NULL
        AND pg_catalog.btrim(coalesce(cb.banco, '')) ~ '^[0-9]{3}[[:space:]]*-[[:space:]]*[^[:space:]].*$'
        THEN pg_catalog.substring(pg_catalog.btrim(cb.banco), '^([0-9]{3})')
      ELSE NULL
    END
  WHERE (cb.banco_codigo IS NULL OR pg_catalog.btrim(cb.banco_codigo) = b.codigo)
    AND (cb.banco_ispb IS NULL OR pg_catalog.btrim(cb.banco_ispb) = b.ispb)
    AND (cb.banco_nome IS NULL OR pg_catalog.btrim(cb.banco_nome) = b.nome)
)
UPDATE public.cedente_estabelecimento_contas_bancarias cb
SET banco_codigo = coalesce(cb.banco_codigo, candidatos.codigo),
    banco_ispb = coalesce(cb.banco_ispb, candidatos.ispb),
    banco_nome = coalesce(cb.banco_nome, candidatos.nome)
FROM candidatos
WHERE cb.id = candidatos.id
  AND (cb.banco_codigo IS NULL OR cb.banco_ispb IS NULL OR cb.banco_nome IS NULL);

CREATE OR REPLACE FUNCTION private.validar_conta_bancaria_estruturada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_banco public.bancos%ROWTYPE;
BEGIN
  NEW.banco_codigo := pg_catalog.btrim(coalesce(NEW.banco_codigo, ''));
  IF NEW.banco_codigo !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'Selecione um banco valido no catalogo.' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO v_banco
  FROM public.bancos b
  WHERE b.codigo = NEW.banco_codigo
    AND b.ativo IS TRUE;

  IF NOT FOUND
     OR coalesce(v_banco.ispb, '') !~ '^[0-9]{8}$'
     OR pg_catalog.btrim(coalesce(v_banco.nome, '')) = '' THEN
    RAISE EXCEPTION 'Banco inexistente, inativo ou sem dados estruturados completos.' USING ERRCODE = '22023';
  END IF;

  IF nullif(pg_catalog.btrim(coalesce(NEW.banco_ispb, '')), '') IS DISTINCT FROM v_banco.ispb
     OR nullif(pg_catalog.btrim(coalesce(NEW.banco_nome, '')), '') IS DISTINCT FROM v_banco.nome THEN
    RAISE EXCEPTION 'Dados bancarios divergem do catalogo vigente.' USING ERRCODE = '22023';
  END IF;

  NEW.banco := v_banco.codigo || ' - ' || v_banco.nome;
  NEW.banco_ispb := v_banco.ispb;
  NEW.banco_nome := v_banco.nome;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validar_conta_bancaria_estruturada
  ON public.cedente_estabelecimento_contas_bancarias;
CREATE TRIGGER validar_conta_bancaria_estruturada
  BEFORE INSERT OR UPDATE OF banco_codigo, banco_ispb, banco_nome
  ON public.cedente_estabelecimento_contas_bancarias
  FOR EACH ROW
  EXECUTE FUNCTION private.validar_conta_bancaria_estruturada();

CREATE OR REPLACE FUNCTION public.salvar_conta_estabelecimento_cedente(
  p_estabelecimento_id uuid,
  p_banco text,
  p_agencia text,
  p_conta text,
  p_tipo_conta text DEFAULT NULL,
  p_principal boolean DEFAULT true,
  p_banco_codigo text DEFAULT NULL,
  p_banco_ispb text DEFAULT NULL,
  p_banco_nome text DEFAULT NULL
)
RETURNS public.cedente_estabelecimento_contas_bancarias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento public.cedente_estabelecimentos%ROWTYPE;
  v_banco public.bancos%ROWTYPE;
  v_result public.cedente_estabelecimento_contas_bancarias%ROWTYPE;
BEGIN
  SELECT * INTO v_estabelecimento
  FROM public.cedente_estabelecimentos
  WHERE id = p_estabelecimento_id;

  IF v_estabelecimento.id IS NULL
     OR NOT private.usuario_e_admin_cedente(v_estabelecimento.cedente_id) THEN
    RAISE EXCEPTION 'Estabelecimento nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_estabelecimento.status IN ('rejeitado', 'suspenso') OR NOT v_estabelecimento.ativo THEN
    RAISE EXCEPTION 'Conta nao pode ser alterada para este estabelecimento' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO v_banco
  FROM public.bancos b
  WHERE b.codigo = pg_catalog.btrim(coalesce(p_banco_codigo, ''))
    AND b.ativo IS TRUE;

  IF NOT FOUND
     OR v_banco.codigo !~ '^[0-9]{3}$'
     OR coalesce(v_banco.ispb, '') !~ '^[0-9]{8}$'
     OR pg_catalog.btrim(coalesce(v_banco.nome, '')) = '' THEN
    RAISE EXCEPTION 'Selecione um banco ativo com COMPE, ISPB e nome validos.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.btrim(coalesce(p_banco_ispb, '')) IS DISTINCT FROM v_banco.ispb
     OR pg_catalog.btrim(coalesce(p_banco_nome, '')) IS DISTINCT FROM v_banco.nome THEN
    RAISE EXCEPTION 'Dados bancarios divergem do catalogo vigente.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estabelecimento_id::text, 0));

  IF p_principal THEN
    UPDATE public.cedente_estabelecimento_contas_bancarias
    SET principal = false
    WHERE estabelecimento_id = p_estabelecimento_id AND principal AND ativo;
  END IF;

  INSERT INTO public.cedente_estabelecimento_contas_bancarias (
    estabelecimento_id, banco, agencia, conta, tipo_conta, principal, criado_por,
    banco_codigo, banco_ispb, banco_nome
  ) VALUES (
    p_estabelecimento_id,
    v_banco.codigo || ' - ' || v_banco.nome,
    pg_catalog.btrim(p_agencia),
    pg_catalog.btrim(p_conta),
    nullif(pg_catalog.btrim(coalesce(p_tipo_conta, '')), ''),
    p_principal,
    auth.uid(),
    v_banco.codigo,
    v_banco.ispb,
    v_banco.nome
  ) RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    auth.uid(), 'usuario', 'cedente_meus_cnpjs', 'CONTA_ESTABELECIMENTO_ALTERADA',
    'cedente_estabelecimento_contas_bancarias', v_result.id,
    jsonb_build_object(
      'cedente_id', v_estabelecimento.cedente_id,
      'estabelecimento_id', p_estabelecimento_id,
      'principal', p_principal,
      'banco_codigo', v_banco.codigo
    )
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.concluir_onboarding_cedente(p_cadastro jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_papel text;
  v_status_perfil text;
  v_cedente public.cedentes%ROWTYPE;
  v_banco public.bancos%ROWTYPE;
  v_cnpj text;
  v_razao_social text;
  v_representante jsonb;
  v_indice bigint;
  v_chaves_invalidas text[];
  v_matriz_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_cadastro IS NULL OR jsonb_typeof(p_cadastro) <> 'object' THEN
    RAISE EXCEPTION 'Cadastro do cedente invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(chave ORDER BY chave) INTO v_chaves_invalidas
  FROM jsonb_object_keys(p_cadastro) AS chave
  WHERE chave <> ALL (ARRAY[
    'cnpj', 'razao_social', 'nome_fantasia', 'cep', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'estado', 'telefone_comercial',
    'email_comercial', 'cnae', 'banco', 'agencia', 'conta', 'tipo_conta',
    'representantes', 'banco_codigo', 'banco_ispb', 'banco_nome'
  ]::text[]);
  IF v_chaves_invalidas IS NOT NULL THEN
    RAISE EXCEPTION 'Campos nao permitidos no cadastro: %', array_to_string(v_chaves_invalidas, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role::text, p.status::text INTO v_papel, v_status_perfil
  FROM public.profiles p WHERE p.id = v_usuario_id;
  IF NOT FOUND OR v_status_perfil IS DISTINCT FROM 'ativo' OR v_papel IS DISTINCT FROM 'cedente' THEN
    RAISE EXCEPTION 'Somente usuario Cedente ativo pode concluir este cadastro.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('onboarding-cedente:' || v_usuario_id::text));
  SELECT c.* INTO v_cedente
  FROM public.cedentes c
  WHERE c.id = (SELECT public.get_user_cedente_id())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acesso por convite obrigatorio para iniciar o cadastro do Cedente.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cedente_acessos ca
    WHERE ca.user_id = v_usuario_id AND ca.cedente_id = v_cedente.id
      AND ca.perfil = 'ADMIN' AND ca.status = 'ATIVO' AND ca.ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'Somente o ADMIN inicial pode concluir o onboarding.' USING ERRCODE = '42501';
  END IF;

  v_cnpj := pg_catalog.regexp_replace(coalesce(p_cadastro->>'cnpj', ''), '[^0-9]', '', 'g');
  v_razao_social := pg_catalog.btrim(coalesce(p_cadastro->>'razao_social', ''));
  IF v_cnpj IS DISTINCT FROM pg_catalog.regexp_replace(v_cedente.cnpj, '[^0-9]', '', 'g') THEN
    RAISE EXCEPTION 'O CNPJ do cadastro deve ser o mesmo do convite.' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT private.cnpj_valido(v_cnpj)) OR pg_catalog.length(v_razao_social) < 3 THEN
    RAISE EXCEPTION 'Dados principais do Cedente invalidos.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_cadastro->'representantes') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cadastro->'representantes') < 1 THEN
    RAISE EXCEPTION 'Informe pelo menos um representante legal.' USING ERRCODE = '22023';
  END IF;
  IF v_cedente.onboarding_concluido_em IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_cedente.id,
      'razao_social', v_cedente.razao_social,
      'criado', false,
      'idempotente', true
    );
  END IF;

  SELECT b.* INTO v_banco
  FROM public.bancos b
  WHERE b.codigo = pg_catalog.btrim(coalesce(p_cadastro->>'banco_codigo', ''))
    AND b.ativo IS TRUE;
  IF NOT FOUND
     OR v_banco.codigo !~ '^[0-9]{3}$'
     OR coalesce(v_banco.ispb, '') !~ '^[0-9]{8}$'
     OR pg_catalog.btrim(coalesce(v_banco.nome, '')) = '' THEN
    RAISE EXCEPTION 'Selecione um banco ativo com COMPE, ISPB e nome validos.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.btrim(coalesce(p_cadastro->>'banco_ispb', '')) IS DISTINCT FROM v_banco.ispb
     OR pg_catalog.btrim(coalesce(p_cadastro->>'banco_nome', '')) IS DISTINCT FROM v_banco.nome THEN
    RAISE EXCEPTION 'Dados bancarios divergem do catalogo vigente.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.btrim(coalesce(p_cadastro->>'agencia', '')) = ''
     OR pg_catalog.btrim(coalesce(p_cadastro->>'conta', '')) = ''
     OR pg_catalog.btrim(coalesce(p_cadastro->>'tipo_conta', '')) = '' THEN
    RAISE EXCEPTION 'Dados da conta bancaria sao obrigatorios.' USING ERRCODE = '22023';
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
  WHERE id = v_cedente.id;

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

    INSERT INTO public.representantes (cedente_id, nome, cpf, rg, cargo, email, telefone, principal)
    VALUES (
      v_cedente.id,
      pg_catalog.btrim(v_representante->>'nome'),
      pg_catalog.regexp_replace(v_representante->>'cpf', '[^0-9]', '', 'g'),
      pg_catalog.btrim(v_representante->>'rg'),
      pg_catalog.btrim(v_representante->>'cargo'),
      pg_catalog.lower(pg_catalog.btrim(v_representante->>'email')),
      pg_catalog.btrim(v_representante->>'telefone'),
      v_indice = 1
    );
  END LOOP;

  SELECT e.id INTO v_matriz_id
  FROM public.cedente_estabelecimentos e
  WHERE e.cedente_id = v_cedente.id AND e.tipo = 'matriz';
  IF v_matriz_id IS NULL THEN
    RAISE EXCEPTION 'Matriz do Cedente nao encontrada.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.cedente_estabelecimento_contas_bancarias (
    estabelecimento_id, banco, agencia, conta, tipo_conta, principal, ativo, criado_por,
    banco_codigo, banco_ispb, banco_nome
  ) VALUES (
    v_matriz_id,
    v_banco.codigo || ' - ' || v_banco.nome,
    pg_catalog.btrim(p_cadastro->>'agencia'),
    pg_catalog.btrim(p_cadastro->>'conta'),
    p_cadastro->>'tipo_conta',
    true,
    true,
    v_usuario_id,
    v_banco.codigo,
    v_banco.ispb,
    v_banco.nome
  );

  RETURN jsonb_build_object(
    'id', v_cedente.id,
    'razao_social', v_razao_social,
    'criado', true,
    'idempotente', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
