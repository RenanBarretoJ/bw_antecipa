BEGIN;

-- Corrige a colisao entre a coluna operacoes.valor_bruto_total e o acumulador
-- local da RPC. A migration anterior ja pode estar aplicada em homologacao.
CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  op record;
  nf record;
  memoria jsonb;
  metodo text;
  data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  fundo_id_operacao uuid;
  v_valor_bruto_total numeric := 0;
  valor_liquido_total numeric := 0;
  desconto_total numeric := 0;
  prazo_ponderado numeric := 0;
  prazo_medio integer := 0;
  prazo_referencia integer := 0;
  vencimento_maximo date;
  nfs_count integer := 0;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa mensal invalida';
  END IF;

  SELECT o.*, cf.fundo_id
  INTO op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  fundo_id_operacao := op.fundo_id;
  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  IF op.status = 'aprovada' THEN
    RETURN jsonb_build_object(
      'operacao_id', op.id,
      'idempotent_replay', true,
      'status', op.status,
      'valor_liquido_desembolso', op.valor_liquido_desembolso,
      'metodo_calculo_financeiro', coalesce(op.metodo_calculo_financeiro, 'LEGADO_MENSAL_DIAS_REAIS_30'),
      'data_base', op.calculo_data_base
    );
  END IF;
  IF op.status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', op.status;
  END IF;
  IF op.contexto_configuracao_status = 'completo' AND (
    op.cedente_fundo_id IS NULL OR op.politica_operacional_versao_id IS NULL OR op.politica_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Operacao sem contexto operacional completo';
  END IF;

  metodo := coalesce(
    op.metodo_calculo_financeiro,
    op.politica_snapshot #>> '{calculo_financeiro,metodo}',
    'LEGADO_MENSAL_DIAS_REAIS_30'
  );
  IF metodo NOT IN ('LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365') THEN
    RAISE EXCEPTION 'Metodo financeiro congelado na operacao e invalido';
  END IF;

  DELETE FROM public.operacao_calculo_nfs WHERE operacao_id = p_operacao_id;

  FOR nf IN
    SELECT n.*
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
    FOR UPDATE OF n
  LOOP
    IF nf.cedente_id <> op.cedente_id
       OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id
       OR nf.fundo_id IS DISTINCT FROM fundo_id_operacao THEN
      RAISE EXCEPTION 'NF fora do contexto da operacao';
    END IF;
    IF nf.status NOT IN ('em_antecipacao', 'aceita') THEN
      RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf;
    END IF;

    memoria := private.calcular_memoria_financeira_nf(
      nf.id, nf.valor_bruto, p_taxa_desconto, data_base, nf.data_vencimento, metodo
    );

    INSERT INTO public.operacao_calculo_nfs (
      operacao_id, nota_fiscal_id, fundo_id, cedente_id, metodo_calculo_financeiro,
      valor_nominal, taxa_mensal, data_base, vencimento_contratual, vencimento_calculo,
      base_calculo, calendario, dias_corridos_reais, dias_uteis, dias_financeiros,
      dias_aplicados, expoente, fator, valor_presente, desconto, regra_arredondamento, versao_motor
    ) VALUES (
      op.id, nf.id, fundo_id_operacao, op.cedente_id, metodo,
      (memoria->>'valor_nominal')::numeric, p_taxa_desconto, data_base,
      (memoria->>'vencimento_contratual')::date, (memoria->>'vencimento_calculo')::date,
      (memoria->>'base')::integer, memoria->>'calendario',
      (memoria->>'dias_corridos_reais')::integer, (memoria->>'dias_uteis')::integer,
      (memoria->>'dias_financeiros')::integer, (memoria->>'dias')::integer,
      (memoria->>'expoente')::numeric, (memoria->>'fator')::numeric,
      (memoria->>'valor_presente')::numeric, (memoria->>'desconto')::numeric,
      memoria->>'arredondamento', (memoria->>'versao_motor')::integer
    );

    UPDATE public.notas_fiscais
    SET taxa_desagio = p_taxa_desconto,
        valor_antecipado = (memoria->>'valor_presente')::numeric
    WHERE id = nf.id;

    v_valor_bruto_total := v_valor_bruto_total + (memoria->>'valor_nominal')::numeric;
    valor_liquido_total := valor_liquido_total + (memoria->>'valor_presente')::numeric;
    desconto_total := desconto_total + (memoria->>'desconto')::numeric;
    prazo_ponderado := prazo_ponderado + ((memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric);
    prazo_referencia := greatest(prazo_referencia, (memoria->>'dias')::integer);
    vencimento_maximo := greatest(vencimento_maximo, nf.data_vencimento);
    nfs_count := nfs_count + 1;
  END LOOP;

  IF nfs_count = 0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.taxas_cedente tc
    WHERE tc.cedente_id = op.cedente_id
      AND tc.taxa_percentual = p_taxa_desconto
      AND prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max
  ) THEN
    RAISE EXCEPTION 'A taxa selecionada nao esta configurada para o prazo da operacao';
  END IF;

  prazo_medio := round(prazo_ponderado / v_valor_bruto_total);

  PERFORM pg_catalog.set_config('app.calculo_aprovacao', 'true', true);

  UPDATE public.operacoes
  SET taxa_desconto = p_taxa_desconto,
      prazo_dias = prazo_medio,
      valor_bruto_total = round(v_valor_bruto_total, 2),
      valor_liquido_desembolso = round(valor_liquido_total, 2),
      data_vencimento = vencimento_maximo,
      metodo_calculo_financeiro = metodo,
      calculo_data_base = data_base,
      calculo_versao_motor = 1,
      calculo_memoria = jsonb_build_object(
        'metodo', metodo,
        'taxa_mensal', p_taxa_desconto,
        'data_base', data_base,
        'valor_bruto_total', round(v_valor_bruto_total, 2),
        'valor_liquido_total', round(valor_liquido_total, 2),
        'desconto_total', round(desconto_total, 2),
        'prazo_medio', prazo_medio,
        'prazo_unidade', CASE metodo
          WHEN 'DIAS_UTEIS_252' THEN 'dias_uteis'
          WHEN 'TRINTA_360' THEN 'dias_financeiros'
          ELSE 'dias_corridos'
        END,
        'vencimento_maximo', vencimento_maximo,
        'quantidade_nfs', nfs_count,
        'previa_valor_liquido_solicitacao', op.valor_liquido_desembolso,
        'diferenca_previa_aprovacao', CASE
          WHEN op.valor_liquido_desembolso IS NULL THEN NULL
          ELSE round(valor_liquido_total - op.valor_liquido_desembolso, 2)
        END,
        'versao_motor', 1,
        'arredondamento', 'ROUND_HALF_UP_2_CASAS'
      ),
      status = 'aprovada',
      aprovado_por = actor_id,
      aprovado_em = now()
  WHERE id = p_operacao_id AND status IN ('solicitada', 'em_analise');

  IF NOT FOUND THEN RAISE EXCEPTION 'A operacao foi alterada concorrentemente'; END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    actor_id, 'OPERACAO_APROVADA', 'operacoes', p_operacao_id,
    jsonb_build_object('status', op.status),
    jsonb_build_object(
      'status', 'aprovada', 'taxa_desconto', p_taxa_desconto,
      'metodo_calculo_financeiro', metodo, 'data_base', data_base,
      'prazo_dias', prazo_medio, 'valor_liquido_desembolso', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'nfs', nfs_count
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'idempotent_replay', false,
    'status', 'aprovada',
    'prazo_dias', prazo_medio,
    'valor_liquido_desembolso', round(valor_liquido_total, 2),
    'desconto_total', round(desconto_total, 2),
    'metodo_calculo_financeiro', metodo,
    'data_base', data_base,
    'nfs', nfs_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric) TO authenticated;

COMMIT;
