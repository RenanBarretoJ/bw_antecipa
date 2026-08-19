-- P0: o Cedente podia cadastrar uma Filial com CNPJ de raiz diferente da
-- Matriz (ex.: Matriz 07.312.248/xxxx-xx, Filial 12.345.678/xxxx-xx) --
-- cadastrar_filial_cedente so validava CNPJ valido + unicidade global,
-- nunca a raiz (8 primeiras posicoes) contra a Matriz do mesmo Cedente.
--
-- private.raiz_cnpj() normaliza removendo apenas pontuacao (mantendo
-- letras) e compara em uppercase -- pronta para o CNPJ alfanumerico da
-- Receita Federal, mesmo que hoje private.cnpj_valido() e a constraint
-- cedente_estabelecimentos_cnpj_formato_check ainda exijam 14 digitos
-- numericos (fora de escopo deste P0: alterar essas duas pecas seria uma
-- mudanca muito maior, que afeta Matriz/Cedente/Representante).
--
-- Duas camadas, como pedido:
-- A. cadastrar_filial_cedente (RPC) -- mensagem clara antes do INSERT.
-- B. private.validar_cedente_estabelecimento (trigger BEFORE INSERT/UPDATE
--    em cedente_estabelecimentos) -- guarda estrutural para qualquer outro
--    caminho de escrita, presente ou futuro.

BEGIN;

CREATE OR REPLACE FUNCTION private.raiz_cnpj(p_cnpj text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT substring(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')) FROM 1 FOR 8);
$function$;

REVOKE ALL ON FUNCTION private.raiz_cnpj(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.validar_cedente_estabelecimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_matriz public.cedente_estabelecimentos%ROWTYPE;
BEGIN
  NEW.cnpj := regexp_replace(coalesce(NEW.cnpj, ''), '\D', '', 'g');
  IF NOT private.cnpj_valido(NEW.cnpj) THEN
    RAISE EXCEPTION 'CNPJ do estabelecimento e invalido';
  END IF;

  IF NEW.tipo = 'filial' THEN
    SELECT * INTO v_matriz
    FROM public.cedente_estabelecimentos
    WHERE id = NEW.matriz_estabelecimento_id;
    IF v_matriz.id IS NULL OR v_matriz.tipo <> 'matriz' OR v_matriz.cedente_id <> NEW.cedente_id THEN
      RAISE EXCEPTION 'A filial deve apontar para a Matriz do mesmo Cedente';
    END IF;
    IF private.raiz_cnpj(NEW.cnpj) <> private.raiz_cnpj(v_matriz.cnpj) THEN
      RAISE EXCEPTION 'O CNPJ informado nao pertence a mesma raiz da Matriz deste Cedente.';
    END IF;
  ELSIF NEW.matriz_estabelecimento_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Matriz nao pode apontar para outro estabelecimento';
  END IF;

  RETURN NEW;
END;
$function$;

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
  v_matriz public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimentos%ROWTYPE;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
BEGIN
  v_cedente_id := public.get_user_cedente_id();
  IF (SELECT auth.uid()) IS NULL OR v_cedente_id IS NULL THEN RAISE EXCEPTION 'Cedente autenticado nao encontrado'; END IF;
  IF NOT private.usuario_tem_acesso_cedente(v_cedente_id) THEN RAISE EXCEPTION 'Acesso negado ao Cedente'; END IF;
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
