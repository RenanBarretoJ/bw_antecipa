-- P0 - Cadastro de Cedente: CNPJ, CEP, Bancos e Filiais.
--
-- 1) Catalogo canonico de bancos (fonte inicial: seed estatico identico ao
--    array bancosBrasileiros hoje hardcoded na UI; sincronizavel depois via
--    BrasilAPI por acao administrativa dedicada).
-- 2) cedente_estabelecimentos ganha os campos cadastrais completos que hoje
--    só existem em cedentes (Matriz), para permitir persistir os dados de
--    CNPJ/CEP consultados também para Filiais.
-- 3) cedentes e cedente_estabelecimento_contas_bancarias ganham colunas
--    estruturadas de banco (codigo/ispb/nome), aditivas -- a coluna texto
--    legada "banco" e mantida para nao quebrar historico.
-- 4) cadastrar_filial_cedente, salvar_conta_estabelecimento_cedente e
--    concluir_onboarding_cedente sao estendidas via CREATE OR REPLACE
--    FUNCTION com novos parametros DEFAULT NULL no final -- compatibilidade
--    total com chamadas existentes.

BEGIN;

-- =========================================================================
-- 1) Catalogo canonico de bancos
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.bancos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  ispb text,
  nome text NOT NULL,
  nome_completo text,
  ativo boolean NOT NULL DEFAULT true,
  fonte text NOT NULL DEFAULT 'seed',
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bancos_codigo_key UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS bancos_ispb_idx ON public.bancos (ispb) WHERE ispb IS NOT NULL;
CREATE INDEX IF NOT EXISTS bancos_nome_idx ON public.bancos (nome);

CREATE OR REPLACE FUNCTION private.bancos_atualizar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bancos_set_updated_at ON public.bancos;
CREATE TRIGGER bancos_set_updated_at
  BEFORE UPDATE ON public.bancos
  FOR EACH ROW EXECUTE FUNCTION private.bancos_atualizar_updated_at();

ALTER TABLE public.bancos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bancos_select_authenticated ON public.bancos;
CREATE POLICY bancos_select_authenticated ON public.bancos
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.bancos FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.bancos TO authenticated;
GRANT ALL ON TABLE public.bancos TO service_role;

-- Seed identico ao array bancosBrasileiros (src/lib/validations/cedente.ts),
-- para nao depender de rede durante a migration. Sync futuro via BrasilAPI
-- (fonte='brasilapi') faz upsert por codigo sem apagar este seed.
INSERT INTO public.bancos (codigo, nome, fonte) VALUES
  ('001', 'Banco do Brasil', 'seed'),
  ('003', 'Banco da Amazônia (BASA)', 'seed'),
  ('004', 'Banco do Nordeste (BNB)', 'seed'),
  ('021', 'Banestes', 'seed'),
  ('033', 'Santander', 'seed'),
  ('037', 'Banpará', 'seed'),
  ('041', 'Banrisul', 'seed'),
  ('047', 'Banese', 'seed'),
  ('070', 'BRB', 'seed'),
  ('077', 'Banco Inter', 'seed'),
  ('084', 'Uniprime', 'seed'),
  ('085', 'Ailos', 'seed'),
  ('097', 'Cresol', 'seed'),
  ('102', 'XP Investimentos', 'seed'),
  ('104', 'Caixa Economica Federal', 'seed'),
  ('121', 'Agibank', 'seed'),
  ('133', 'Cresol Confederação', 'seed'),
  ('136', 'Unicred', 'seed'),
  ('197', 'Stone', 'seed'),
  ('208', 'BTG Pactual', 'seed'),
  ('212', 'Banco Original', 'seed'),
  ('218', 'BS2', 'seed'),
  ('237', 'Bradesco', 'seed'),
  ('260', 'Nu Pagamentos (Nubank)', 'seed'),
  ('290', 'PagBank (PagSeguro)', 'seed'),
  ('318', 'Banco BMG', 'seed'),
  ('323', 'Mercado Pago', 'seed'),
  ('336', 'C6 Bank', 'seed'),
  ('341', 'Itau Unibanco', 'seed'),
  ('380', 'PicPay', 'seed'),
  ('389', 'Mercantil do Brasil', 'seed'),
  ('399', 'HSBC', 'seed'),
  ('403', 'Cora', 'seed'),
  ('422', 'Safra', 'seed'),
  ('461', 'Asaas', 'seed'),
  ('623', 'Banco Pan', 'seed'),
  ('633', 'Rendimento', 'seed'),
  ('634', 'Triangulo', 'seed'),
  ('637', 'Sofisa', 'seed'),
  ('643', 'Pine', 'seed'),
  ('655', 'Votorantim', 'seed'),
  ('707', 'Daycoval', 'seed'),
  ('735', 'Neon', 'seed'),
  ('745', 'Citibank', 'seed'),
  ('746', 'Modal', 'seed'),
  ('748', 'Sicredi', 'seed'),
  ('751', 'Scotiabank', 'seed'),
  ('752', 'BNP Paribas', 'seed'),
  ('756', 'Sicoob', 'seed')
ON CONFLICT (codigo) DO NOTHING;

-- =========================================================================
-- 2) cedente_estabelecimentos: dados cadastrais completos (Matriz e Filial)
-- =========================================================================

ALTER TABLE public.cedente_estabelecimentos
  ADD COLUMN IF NOT EXISTS cnae_principal text,
  ADD COLUMN IF NOT EXISTS situacao_cadastral text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS uf text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS dados_consultados_em timestamptz,
  ADD COLUMN IF NOT EXISTS dados_consultados_fonte text;

-- =========================================================================
-- 3) Colunas estruturadas de banco (aditivas -- "banco" texto permanece)
-- =========================================================================

ALTER TABLE public.cedentes
  ADD COLUMN IF NOT EXISTS banco_codigo text,
  ADD COLUMN IF NOT EXISTS banco_ispb text,
  ADD COLUMN IF NOT EXISTS banco_nome text;

ALTER TABLE public.cedente_estabelecimento_contas_bancarias
  ADD COLUMN IF NOT EXISTS banco_codigo text,
  ADD COLUMN IF NOT EXISTS banco_ispb text,
  ADD COLUMN IF NOT EXISTS banco_nome text;

-- =========================================================================
-- 4) cadastrar_filial_cedente -- acrescenta dados cadastrais completos
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(
  p_cnpj text,
  p_razao_social text,
  p_nome_fantasia text DEFAULT NULL,
  p_cnae_principal text DEFAULT NULL,
  p_situacao_cadastral text DEFAULT NULL,
  p_cep text DEFAULT NULL,
  p_logradouro text DEFAULT NULL,
  p_numero text DEFAULT NULL,
  p_complemento text DEFAULT NULL,
  p_bairro text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_uf text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_dados_consultados_fonte text DEFAULT NULL
)
RETURNS public.cedente_estabelecimentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cedente_id uuid;
  v_permite_cadastro_filiais boolean;
  v_matriz public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimentos%ROWTYPE;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
BEGIN
  v_cedente_id := public.get_user_cedente_id();
  IF (SELECT auth.uid()) IS NULL OR v_cedente_id IS NULL THEN RAISE EXCEPTION 'Cedente autenticado nao encontrado'; END IF;
  IF NOT private.usuario_tem_acesso_cedente(v_cedente_id) THEN RAISE EXCEPTION 'Acesso negado ao Cedente'; END IF;

  SELECT c.permite_cadastro_filiais INTO v_permite_cadastro_filiais
  FROM public.cedentes c WHERE c.id = v_cedente_id;
  IF NOT coalesce(v_permite_cadastro_filiais, false) THEN
    RAISE EXCEPTION 'O cadastro de novas Filiais nao esta habilitado para este Cedente.';
  END IF;

  IF NOT private.cnpj_valido(v_cnpj) THEN RAISE EXCEPTION 'CNPJ da filial e invalido'; END IF;
  IF length(trim(coalesce(p_razao_social, ''))) < 3 THEN RAISE EXCEPTION 'Razao social da filial e obrigatoria'; END IF;

  SELECT e.* INTO v_matriz
  FROM public.cedente_estabelecimentos e
  JOIN public.cedentes c ON c.id = e.cedente_id
  WHERE e.cedente_id = v_cedente_id AND e.tipo = 'matriz'
    AND e.status = 'aprovado' AND e.ativo AND c.status::text = 'ativo';
  IF v_matriz.id IS NULL THEN RAISE EXCEPTION 'A Matriz precisa estar aprovada antes do cadastro de Filiais'; END IF;

  SELECT * INTO v_result
  FROM public.cedente_estabelecimentos
  WHERE cnpj = v_cnpj;
  IF v_result.id IS NOT NULL THEN
    IF v_result.cedente_id <> v_cedente_id OR v_result.tipo <> 'filial' THEN
      RAISE EXCEPTION 'CNPJ ja cadastrado para outro Cedente';
    END IF;
    RETURN v_result;
  END IF;

  IF private.raiz_cnpj(v_cnpj) <> private.raiz_cnpj(v_matriz.cnpj) THEN
    RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.';
  END IF;

  INSERT INTO public.cedente_estabelecimentos (
    cedente_id, cnpj, razao_social, nome_fantasia, tipo, matriz_estabelecimento_id, status, ativo,
    cnae_principal, situacao_cadastral, cep, logradouro, numero, complemento, bairro, cidade, uf,
    email, telefone, dados_consultados_em, dados_consultados_fonte
  ) VALUES (
    v_cedente_id, v_cnpj, trim(p_razao_social), nullif(trim(coalesce(p_nome_fantasia, '')), ''),
    'filial', v_matriz.id, 'pendente', true,
    nullif(trim(coalesce(p_cnae_principal, '')), ''),
    nullif(trim(coalesce(p_situacao_cadastral, '')), ''),
    nullif(trim(coalesce(p_cep, '')), ''),
    nullif(trim(coalesce(p_logradouro, '')), ''),
    nullif(trim(coalesce(p_numero, '')), ''),
    nullif(trim(coalesce(p_complemento, '')), ''),
    nullif(trim(coalesce(p_bairro, '')), ''),
    nullif(trim(coalesce(p_cidade, '')), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    nullif(trim(coalesce(p_telefone, '')), ''),
    CASE WHEN nullif(trim(coalesce(p_dados_consultados_fonte, '')), '') IS NOT NULL THEN now() ELSE NULL END,
    nullif(trim(coalesce(p_dados_consultados_fonte, '')), '')
  )
  RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    auth.uid(), 'usuario', 'cedente_meus_cnpjs', 'ESTABELECIMENTO_SUBMETIDO',
    'cedente_estabelecimentos', v_result.id,
    jsonb_build_object('cedente_id', v_cedente_id, 'estabelecimento_id', v_result.id, 'tipo', 'filial', 'status', v_result.status)
  );
  RETURN v_result;
END;
$function$;

-- =========================================================================
-- 5) salvar_conta_estabelecimento_cedente -- banco estruturado (aditivo)
-- =========================================================================

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
  v_result public.cedente_estabelecimento_contas_bancarias%ROWTYPE;
BEGIN
  SELECT * INTO v_estabelecimento FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_estabelecimento.id IS NULL OR NOT private.usuario_tem_acesso_cedente(v_estabelecimento.cedente_id) THEN
    RAISE EXCEPTION 'Estabelecimento nao encontrado';
  END IF;
  IF v_estabelecimento.status IN ('rejeitado', 'suspenso') OR NOT v_estabelecimento.ativo THEN
    RAISE EXCEPTION 'Conta nao pode ser alterada para este estabelecimento';
  END IF;

  -- Serializa a substituicao da conta principal do mesmo estabelecimento.
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
    p_estabelecimento_id, trim(p_banco), trim(p_agencia), trim(p_conta), nullif(trim(coalesce(p_tipo_conta, '')), ''), p_principal, auth.uid(),
    nullif(trim(coalesce(p_banco_codigo, '')), ''),
    nullif(trim(coalesce(p_banco_ispb, '')), ''),
    nullif(trim(coalesce(p_banco_nome, '')), '')
  ) RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (auth.uid(), 'usuario', 'cedente_meus_cnpjs', 'CONTA_ESTABELECIMENTO_ALTERADA',
    'cedente_estabelecimento_contas_bancarias', v_result.id,
    jsonb_build_object('cedente_id', v_estabelecimento.cedente_id, 'estabelecimento_id', p_estabelecimento_id, 'principal', p_principal));
  RETURN v_result;
END;
$function$;

-- =========================================================================
-- 6) concluir_onboarding_cedente -- banco estruturado no cadastro da Matriz
-- =========================================================================

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
     'conta', 'tipo_conta', 'representantes',
     'banco_codigo', 'banco_ispb', 'banco_nome'
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
    cnae, banco, agencia, conta, tipo_conta, status, fundo_id,
    banco_codigo, banco_ispb, banco_nome
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
    NULL,
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_codigo', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_ispb', '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_cadastro->>'banco_nome', '')), '')
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

-- =========================================================================
-- 7) Sync administrativo do catalogo de bancos (BrasilAPI) -- upsert idempotente
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sincronizar_bancos_super_admin(p_bancos jsonb)
RETURNS TABLE (total_recebido integer, total_upsertado integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_papel text;
  v_status_perfil text;
  v_item jsonb;
  v_codigo text;
  v_total_recebido integer := 0;
  v_total_upsertado integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role::text, p.status::text INTO v_papel, v_status_perfil
    FROM public.profiles p WHERE p.id = auth.uid();

  IF NOT FOUND OR v_status_perfil IS DISTINCT FROM 'ativo' OR v_papel IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Apenas Super Admin pode sincronizar o catalogo de bancos.' USING ERRCODE = '42501';
  END IF;

  IF p_bancos IS NULL OR jsonb_typeof(p_bancos) <> 'array' THEN
    RAISE EXCEPTION 'Lista de bancos invalida.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bancos)
  LOOP
    v_total_recebido := v_total_recebido + 1;
    v_codigo := nullif(pg_catalog.btrim(coalesce(v_item->>'codigo', '')), '');
    IF v_codigo IS NULL OR pg_catalog.btrim(coalesce(v_item->>'nome', '')) = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.bancos (codigo, ispb, nome, nome_completo, ativo, fonte, sincronizado_em)
    VALUES (
      v_codigo,
      nullif(pg_catalog.btrim(coalesce(v_item->>'ispb', '')), ''),
      pg_catalog.btrim(v_item->>'nome'),
      nullif(pg_catalog.btrim(coalesce(v_item->>'nome_completo', '')), ''),
      true,
      'brasilapi',
      now()
    )
    ON CONFLICT (codigo) DO UPDATE SET
      ispb = EXCLUDED.ispb,
      nome = EXCLUDED.nome,
      nome_completo = EXCLUDED.nome_completo,
      fonte = 'brasilapi',
      sincronizado_em = now();

    v_total_upsertado := v_total_upsertado + 1;
  END LOOP;

  RETURN QUERY SELECT v_total_recebido, v_total_upsertado;
END;
$function$;

REVOKE ALL ON FUNCTION public.sincronizar_bancos_super_admin(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_bancos_super_admin(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
