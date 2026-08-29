BEGIN;

-- UI/Operacional: parcelas na NF e na Operacao.
--
-- Ate aqui, registrar_parcelas_nota_fiscal so permite o registro inicial
-- (nega explicitamente se a NF ja tem parcelas) -- nao existe nenhuma RPC
-- para corrigir vencimento/valor de uma parcela ja registrada. Esta
-- migration adiciona exatamente essa correcao, restrita ao Cedente dono
-- da NF, apenas enquanto a NF esta em rascunho, com o mesmo padrao de
-- guarda das RPCs irmas (registrar_parcelas_nota_fiscal, registrar_
-- documento_boleto_parcela): SECURITY DEFINER, checagem explicita de
-- papel/dono, tolerancia monetaria contra o valor bruto, e um guard novo
-- que bloqueia editar uma parcela que already tem boleto aprovado
-- (documento_requisito_instancias.status = 'satisfeito').
--
-- Numero da parcela permanece imutavel (nao esta na lista de campos
-- editaveis) -- nota_fiscal_parcelas_unique exige unicidade por NF e
-- renumerar nao e necessario para corrigir vencimento/valor.

DO $$
BEGIN
  IF to_regclass('public.nota_fiscal_parcelas') IS NULL
     OR to_regclass('public.documento_requisito_instancias') IS NULL THEN
    RAISE EXCEPTION 'Dependencias de parcelas por NF nao foram aplicadas';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nf public.notas_fiscais%ROWTYPE;
  v_item jsonb;
  v_parcela_id uuid;
  v_existente public.nota_fiscal_parcelas%ROWTYPE;
  v_soma numeric(15,2);
  v_tolerancia numeric(15,2);
  v_count_existentes integer;
  v_max_vencimento date;
  v_atualizadas integer := 0;
  v_ids_vistos uuid[] := '{}';
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT public.get_user_role()) <> 'cedente' THEN
    RAISE EXCEPTION 'Somente o cedente dono da NF pode editar parcelas';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf.id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;
  IF v_nf.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF v_nf.status::text <> 'rascunho' THEN
    RAISE EXCEPTION 'Parcelas so podem ser editadas enquanto a NF esta em rascunho';
  END IF;

  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Lista de parcelas invalida';
  END IF;

  SELECT count(*) INTO v_count_existentes
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  IF v_count_existentes = 0 THEN
    RAISE EXCEPTION 'Nota fiscal nao possui parcelas registradas';
  END IF;
  IF jsonb_array_length(p_parcelas) <> v_count_existentes THEN
    RAISE EXCEPTION 'A edicao deve informar todas as % parcelas existentes, sem adicionar ou remover', v_count_existentes;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NOT (v_item ? 'id' AND v_item ? 'valor_nominal' AND v_item ? 'data_vencimento') THEN
      RAISE EXCEPTION 'Parcela com campos obrigatorios ausentes';
    END IF;
    v_parcela_id := (v_item->>'id')::uuid;
    IF v_parcela_id = ANY(v_ids_vistos) THEN
      RAISE EXCEPTION 'Parcela duplicada na edicao: %', v_parcela_id;
    END IF;
    v_ids_vistos := v_ids_vistos || v_parcela_id;

    SELECT * INTO v_existente
    FROM public.nota_fiscal_parcelas
    WHERE id = v_parcela_id AND nota_fiscal_id = p_nota_fiscal_id
    FOR UPDATE;
    IF v_existente.id IS NULL THEN
      RAISE EXCEPTION 'Parcela nao pertence a esta nota fiscal';
    END IF;
    IF v_existente.status <> 'disponivel' THEN
      RAISE EXCEPTION 'Parcela numero % nao pode ser editada (status atual: %)', v_existente.numero_parcela, v_existente.status;
    END IF;

    -- Guarda D: nao permitir que uma parcela com boleto ja aprovado fique
    -- inconsistente (valor/vencimento do boleto x valor/vencimento da
    -- parcela) apos a edicao. So bloqueia quando o valor/vencimento desta
    -- parcela especifica esta de fato mudando -- a RPC exige o payload
    -- completo (todas as parcelas existentes) a cada chamada, entao uma
    -- parcela com boleto aprovado, passada sem alteracao apenas para
    -- completar o payload, nao pode travar a edicao das DEMAIS parcelas.
    IF (
      (v_item->>'valor_nominal')::numeric IS DISTINCT FROM v_existente.valor_nominal
      OR (v_item->>'data_vencimento')::date IS DISTINCT FROM v_existente.data_vencimento
    ) AND EXISTS (
      SELECT 1 FROM public.documento_requisito_instancias
      WHERE parcela_id = v_parcela_id
        AND tipo_documento_codigo_snapshot = 'boleto'
        AND status = 'satisfeito'
    ) THEN
      RAISE EXCEPTION 'Parcela numero % ja tem boleto aprovado; nao e possivel editar valor/vencimento', v_existente.numero_parcela;
    END IF;

    IF (v_item->>'valor_nominal')::numeric <= 0 THEN
      RAISE EXCEPTION 'Valor nominal invalido para a parcela numero %', v_existente.numero_parcela;
    END IF;

    UPDATE public.nota_fiscal_parcelas
    SET valor_nominal = (v_item->>'valor_nominal')::numeric,
        data_vencimento = (v_item->>'data_vencimento')::date
    WHERE id = v_parcela_id;
    v_atualizadas := v_atualizadas + 1;
  END LOOP;

  SELECT sum(valor_nominal) INTO v_soma
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  v_tolerancia := greatest(v_count_existentes * 0.01, 0.01);
  IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN
    RAISE EXCEPTION 'Soma das parcelas (%) nao corresponde ao valor bruto da nota fiscal (%)', v_soma, v_nf.valor_bruto;
  END IF;

  SELECT max(data_vencimento) INTO v_max_vencimento
  FROM public.nota_fiscal_parcelas
  WHERE nota_fiscal_id = p_nota_fiscal_id;
  UPDATE public.notas_fiscais SET data_vencimento = v_max_vencimento WHERE id = p_nota_fiscal_id;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'parcelas_atualizadas', v_atualizadas,
    'soma', v_soma,
    'vencimento_agregado', v_max_vencimento
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editar_parcelas_nota_fiscal(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_parcelas_nota_fiscal(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.editar_parcelas_nota_fiscal(uuid, jsonb) IS
  'Corrige valor_nominal/data_vencimento de parcelas ja registradas de uma NF, restrito ao cedente dono enquanto a NF esta em rascunho. Nega se a parcela nao estiver disponivel ou ja tiver boleto aprovado. Atualiza notas_fiscais.data_vencimento para o novo MAX apos a edicao.';

COMMIT;
