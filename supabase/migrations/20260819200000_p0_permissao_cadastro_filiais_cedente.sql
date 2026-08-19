-- P0/P1: permissao por Cedente para cadastrar novas Filiais. Ate aqui,
-- qualquer Cedente com Matriz aprovada podia cadastrar Filiais livremente;
-- a Gestora precisa controlar isso individualmente por Cedente.
--
-- Campo canonico em public.cedentes (mesmo padrao de habilitar_escrow e
-- coobrigacao: booleano simples, alternado por RPC SECURITY DEFINER
-- dedicada, auditado pela camada TypeScript via registrarLog -- nao ha
-- necessidade de nova tabela nem de estender cedente_estabelecimentos).
-- Todo Cedente (novo ou existente) comeca com false, conforme
-- especificado; a Gestora habilita explicitamente quando decidir.
--
-- Esta permissao controla apenas "pode cadastrar NOVA Filial?" -- nao
-- altera status de Matriz/Filial, effective_originacao_allowed,
-- documentos, conta bancaria, historico ou operacoes/NFs existentes.

BEGIN;

ALTER TABLE public.cedentes
  ADD COLUMN permite_cadastro_filiais boolean NOT NULL DEFAULT false;

-- Habilitar/Desabilitar Cadastro de Filiais (mesmo padrao de
-- alternar_escrow_cedente_gestor / alternar_coobrigacao_cedente_gestor).
CREATE OR REPLACE FUNCTION public.alternar_cadastro_filiais_cedente_gestor(p_cedente_id uuid, p_habilitar boolean)
RETURNS TABLE (
  cedente_id uuid,
  permite_cadastro_filiais boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria para alterar permissao de cadastro de filiais.';
  END IF;

  IF p_habilitar IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valor de permissao invalido.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cedentes c WHERE c.id = p_cedente_id FOR UPDATE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Cedente nao encontrado.';
  END IF;

  IF NOT private.gestor_tem_acesso_cedente(p_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem vinculo ativo com o fundo deste cedente.';
  END IF;

  UPDATE public.cedentes SET permite_cadastro_filiais = p_habilitar WHERE id = p_cedente_id;

  RETURN QUERY SELECT p_cedente_id, p_habilitar;
END;
$function$;

REVOKE ALL ON FUNCTION public.alternar_cadastro_filiais_cedente_gestor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alternar_cadastro_filiais_cedente_gestor(uuid, boolean) TO authenticated;

-- Gate server-side em cadastrar_filial_cedente: aborta antes de qualquer
-- INSERT quando a permissao estiver desabilitada. Nao depende da UI.
CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(
  p_cnpj text,
  p_razao_social text,
  p_nome_fantasia text DEFAULT NULL
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

  -- Unicidade global e checada antes da raiz: um CNPJ ja pertencente a
  -- outro Cedente (ou a Matriz/Filial ja existente deste) deve continuar
  -- respondendo com a mensagem de conflito estabelecida, independente da
  -- raiz -- o problema ali nao e "raiz errada", e "CNPJ ja em uso".
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
    cedente_id, cnpj, razao_social, nome_fantasia, tipo, matriz_estabelecimento_id, status, ativo
  ) VALUES (
    v_cedente_id, v_cnpj, trim(p_razao_social), nullif(trim(coalesce(p_nome_fantasia, '')), ''),
    'filial', v_matriz.id, 'pendente', true
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

COMMIT;
