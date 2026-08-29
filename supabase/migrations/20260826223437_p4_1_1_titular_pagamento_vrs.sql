-- P4.1.1 - titular explicito da conta usada no PAGAMENTO VRS.
--
-- O titular referencia um estabelecimento do mesmo Cedente. A coluna permanece
-- anulavel para que registros historicos ambiguos sejam tratados como pendencia
-- cadastral bloqueante, sem inventar titularidade.

BEGIN;

ALTER TABLE public.cedente_estabelecimento_contas_bancarias
  ADD COLUMN titular_estabelecimento_id uuid;

ALTER TABLE public.cedente_estabelecimento_contas_bancarias
  ADD CONSTRAINT estabelecimento_contas_titular_fkey
  FOREIGN KEY (titular_estabelecimento_id)
  REFERENCES public.cedente_estabelecimentos(id)
  ON DELETE RESTRICT;

CREATE INDEX estabelecimento_contas_titular_idx
  ON public.cedente_estabelecimento_contas_bancarias(titular_estabelecimento_id)
  WHERE titular_estabelecimento_id IS NOT NULL;

-- Backfill conservador:
-- 1. conta da Matriz -> titular Matriz;
-- 2. conta da Filial igual a uma unica conta principal ativa da Matriz -> Matriz;
-- 3. conta da Filial sem correspondencia na Matriz -> propria Filial;
-- 4. correspondencia ambigua -> permanece NULL e bloqueia a remessa.
WITH candidatos AS (
  SELECT
    cb.id AS conta_id,
    CASE
      WHEN proprietario.tipo = 'matriz' THEN proprietario.id
      WHEN proprietario.tipo = 'filial' AND coalesce(matriz_correspondente.quantidade, 0) = 1
        THEN matriz_correspondente.estabelecimento_id
      WHEN proprietario.tipo = 'filial' AND coalesce(matriz_correspondente.quantidade, 0) = 0
        THEN proprietario.id
      ELSE NULL
    END AS titular_estabelecimento_id
  FROM public.cedente_estabelecimento_contas_bancarias cb
  JOIN public.cedente_estabelecimentos proprietario
    ON proprietario.id = cb.estabelecimento_id
  LEFT JOIN LATERAL (
    SELECT
      (pg_catalog.array_agg(matriz.id ORDER BY matriz.id))[1] AS estabelecimento_id,
      pg_catalog.count(*)::integer AS quantidade
    FROM public.cedente_estabelecimentos matriz
    JOIN public.cedente_estabelecimento_contas_bancarias conta_matriz
      ON conta_matriz.estabelecimento_id = matriz.id
     AND conta_matriz.principal IS TRUE
     AND conta_matriz.ativo IS TRUE
    WHERE matriz.cedente_id = proprietario.cedente_id
      AND matriz.tipo = 'matriz'
      AND conta_matriz.banco_codigo IS NOT DISTINCT FROM cb.banco_codigo
      AND conta_matriz.banco_ispb IS NOT DISTINCT FROM cb.banco_ispb
      AND pg_catalog.btrim(conta_matriz.agencia) = pg_catalog.btrim(cb.agencia)
      AND pg_catalog.btrim(conta_matriz.conta) = pg_catalog.btrim(cb.conta)
  ) matriz_correspondente ON true
  WHERE cb.titular_estabelecimento_id IS NULL
)
UPDATE public.cedente_estabelecimento_contas_bancarias cb
SET titular_estabelecimento_id = candidatos.titular_estabelecimento_id
FROM candidatos
WHERE cb.id = candidatos.conta_id
  AND candidatos.titular_estabelecimento_id IS NOT NULL
  AND cb.titular_estabelecimento_id IS NULL;

CREATE OR REPLACE FUNCTION private.validar_titular_conta_estabelecimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_proprietario public.cedente_estabelecimentos%ROWTYPE;
  v_titular public.cedente_estabelecimentos%ROWTYPE;
  v_cnpj_normalizado text;
BEGIN
  IF NEW.titular_estabelecimento_id IS NULL THEN
    RAISE EXCEPTION 'Selecione explicitamente o titular da conta bancaria.' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_proprietario
  FROM public.cedente_estabelecimentos e
  WHERE e.id = NEW.estabelecimento_id;

  SELECT e.* INTO v_titular
  FROM public.cedente_estabelecimentos e
  WHERE e.id = NEW.titular_estabelecimento_id;

  IF v_proprietario.id IS NULL OR v_titular.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento proprietario ou titular nao encontrado.' USING ERRCODE = '22023';
  END IF;
  IF v_titular.cedente_id IS DISTINCT FROM v_proprietario.cedente_id THEN
    RAISE EXCEPTION 'O titular da conta deve pertencer ao mesmo Cedente.' USING ERRCODE = '22023';
  END IF;

  v_cnpj_normalizado := pg_catalog.regexp_replace(coalesce(v_titular.cnpj, ''), '[^0-9]', '', 'g');
  IF v_titular.cnpj IS DISTINCT FROM v_cnpj_normalizado
     OR NOT private.cnpj_valido(v_cnpj_normalizado)
     OR pg_catalog.btrim(coalesce(v_titular.razao_social, '')) = '' THEN
    RAISE EXCEPTION 'O titular da conta possui CNPJ ou razao social invalidos.' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validar_titular_conta_estabelecimento
  ON public.cedente_estabelecimento_contas_bancarias;
CREATE TRIGGER validar_titular_conta_estabelecimento
  BEFORE INSERT OR UPDATE OF
    estabelecimento_id,
    titular_estabelecimento_id,
    banco_codigo,
    banco_ispb,
    banco_nome,
    agencia,
    conta
  ON public.cedente_estabelecimento_contas_bancarias
  FOR EACH ROW
  EXECUTE FUNCTION private.validar_titular_conta_estabelecimento();

DROP FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text);

CREATE FUNCTION public.salvar_conta_estabelecimento_cedente(
  p_estabelecimento_id uuid,
  p_banco text,
  p_agencia text,
  p_conta text,
  p_tipo_conta text DEFAULT NULL,
  p_principal boolean DEFAULT true,
  p_banco_codigo text DEFAULT NULL,
  p_banco_ispb text DEFAULT NULL,
  p_banco_nome text DEFAULT NULL,
  p_titular_estabelecimento_id uuid DEFAULT NULL
)
RETURNS public.cedente_estabelecimento_contas_bancarias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento public.cedente_estabelecimentos%ROWTYPE;
  v_titular public.cedente_estabelecimentos%ROWTYPE;
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

  SELECT * INTO v_titular
  FROM public.cedente_estabelecimentos
  WHERE id = p_titular_estabelecimento_id;
  IF v_titular.id IS NULL OR v_titular.cedente_id IS DISTINCT FROM v_estabelecimento.cedente_id THEN
    RAISE EXCEPTION 'O titular da conta deve pertencer ao mesmo Cedente.' USING ERRCODE = '22023';
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
    estabelecimento_id, titular_estabelecimento_id,
    banco, agencia, conta, tipo_conta, principal, criado_por,
    banco_codigo, banco_ispb, banco_nome
  ) VALUES (
    p_estabelecimento_id,
    v_titular.id,
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
      'titular_estabelecimento_id', v_titular.id,
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
    estabelecimento_id, titular_estabelecimento_id,
    banco, agencia, conta, tipo_conta, principal, ativo, criado_por,
    banco_codigo, banco_ispb, banco_nome
  ) VALUES (
    v_matriz_id,
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

REVOKE ALL ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text,uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
