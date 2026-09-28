-- C2.1-R2 hotfix: a taxa proposta pelo Consultor e livre.
-- As taxas cadastradas pelo Gestor permanecem como referencias e continuam
-- governando o fluxo direto do Cedente. A proposta segue validada pelo formato,
-- valor nao negativo, escopo organizacional, motor financeiro e decisao do Gestor.

BEGIN;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  p_cedente_id uuid,
  p_cedente_fundo_id uuid,
  p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid,
  p_politica_versao integer,
  p_politica_snapshot jsonb,
  p_politica_snapshot_hash text,
  p_aceite_sacado_exigido boolean,
  p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[],
  p_taxa_proposta_consultor numeric,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_consultor_id uuid;
  v_metodo text;
  v_data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  v_item record;
  v_memoria jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_valor_bruto_total numeric := 0;
  v_valor_liquido_total numeric := 0;
  v_desconto_total numeric := 0;
  v_prazo_ponderado numeric := 0;
  v_prazo_medio integer := 0;
  v_prazo_referencia integer := 0;
  v_data_vencimento date;
  v_quantidade_itens integer := 0;
  v_quantidade_nfs integer := 0;
  v_snapshot jsonb;
  v_resultado jsonb;
  v_operacao_id uuid;
  v_operacao record;
  v_actor_nome text;
BEGIN
  IF v_actor_id IS NULL OR public.get_user_role()::text <> 'consultor' THEN
    RAISE EXCEPTION 'Somente Consultor autenticado pode propor taxa';
  END IF;
  IF p_taxa_proposta_consultor IS NULL OR p_taxa_proposta_consultor < 0 THEN
    RAISE EXCEPTION 'Taxa proposta invalida';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma NF';
  END IF;

  v_consultor_id := private.consultor_organizacao_ativa_do_usuario(v_actor_id);
  IF v_consultor_id IS NULL
     OR NOT private.consultor_usuario_pode_operar_cedente(v_actor_id, p_cedente_id) THEN
    RAISE EXCEPTION 'Consultor sem vinculo organizacional ativo com o Cedente informado';
  END IF;

  SELECT pov.metodo_calculo_financeiro
  INTO v_metodo
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundos cf
    ON cf.id = p_cedente_fundo_id
   AND cf.cedente_id = p_cedente_id
   AND cf.fundo_id = po.fundo_id
  WHERE pov.id = p_politica_operacional_versao_id
    AND po.id = p_politica_operacional_id
    AND pov.versao = p_politica_versao
  LIMIT 1;

  IF v_metodo IS NULL THEN
    RAISE EXCEPTION 'Versao da politica financeira nao pertence ao contexto informado';
  END IF;

  FOR v_item IN
    SELECT
      nf.id AS nota_fiscal_id,
      NULL::uuid AS parcela_id,
      nf.valor_bruto AS valor_nominal,
      nf.data_vencimento AS vencimento
    FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.nota_fiscal_parcelas p
        WHERE p.nota_fiscal_id = nf.id
      )

    UNION ALL

    SELECT
      nf.id AS nota_fiscal_id,
      p.id AS parcela_id,
      p.valor_nominal,
      p.data_vencimento AS vencimento
    FROM public.nota_fiscal_parcelas p
    JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
    WHERE p_parcela_ids IS NOT NULL
      AND p.id = ANY(p_parcela_ids)
      AND nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
    ORDER BY nota_fiscal_id, parcela_id NULLS FIRST
  LOOP
    v_memoria := private.calcular_memoria_financeira_nf(
      v_item.nota_fiscal_id,
      v_item.valor_nominal,
      p_taxa_proposta_consultor,
      v_data_base,
      v_item.vencimento,
      v_metodo
    );

    v_itens := v_itens || pg_catalog.jsonb_build_array(
      v_memoria || pg_catalog.jsonb_build_object('parcela_id', v_item.parcela_id)
    );
    v_valor_bruto_total := v_valor_bruto_total + (v_memoria->>'valor_nominal')::numeric;
    v_valor_liquido_total := v_valor_liquido_total + (v_memoria->>'valor_presente')::numeric;
    v_desconto_total := v_desconto_total + (v_memoria->>'desconto')::numeric;
    v_prazo_ponderado := v_prazo_ponderado
      + ((v_memoria->>'dias')::integer * (v_memoria->>'valor_nominal')::numeric);
    v_prazo_referencia := greatest(v_prazo_referencia, (v_memoria->>'dias')::integer);
    v_data_vencimento := greatest(v_data_vencimento, v_item.vencimento);
    v_quantidade_itens := v_quantidade_itens + 1;
  END LOOP;

  IF v_quantidade_itens = 0 OR v_valor_bruto_total <= 0 THEN
    RAISE EXCEPTION 'A selecao nao possui itens financeiros validos';
  END IF;

  SELECT count(DISTINCT item.nf_id)
  INTO v_quantidade_nfs
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);


  v_prazo_medio := pg_catalog.round(v_prazo_ponderado / v_valor_bruto_total);
  v_snapshot := pg_catalog.jsonb_build_object(
    'tipo', 'proposta_consultor',
    'taxa_mensal', p_taxa_proposta_consultor,
    'metodo', v_metodo,
    'data_base', v_data_base,
    'valor_nominal', pg_catalog.round(v_valor_bruto_total, 2),
    'desagio_estimado', pg_catalog.round(v_desconto_total, 2),
    'valor_liquido_estimado', pg_catalog.round(v_valor_liquido_total, 2),
    'prazo_medio', v_prazo_medio,
    'prazo_referencia', v_prazo_referencia,
    'quantidade_nfs', v_quantidade_nfs,
    'quantidade_itens', v_quantidade_itens,
    'itens', v_itens,
    'versao_motor', 1,
    'arredondamento', 'ROUND_HALF_UP_2_CASAS'
  );

  v_resultado := public.solicitar_operacao_antecipacao_atomica(
    p_cedente_id,
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    p_nota_fiscal_ids,
    pg_catalog.round(v_valor_bruto_total, 2),
    p_taxa_proposta_consultor,
    v_prazo_medio,
    pg_catalog.round(v_valor_liquido_total, 2),
    v_data_vencimento,
    p_idempotency_key,
    p_parcela_ids
  );

  v_operacao_id := (v_resultado->>'operacao_id')::uuid;
  IF coalesce((v_resultado->>'idempotent_replay')::boolean, false) THEN
    SELECT * INTO v_operacao
    FROM public.operacoes
    WHERE id = v_operacao_id;

    IF v_operacao.taxa_proposta_consultor IS DISTINCT FROM p_taxa_proposta_consultor
       OR v_operacao.taxa_proposta_por IS DISTINCT FROM v_actor_id
       OR v_operacao.taxa_proposta_consultor_id IS DISTINCT FROM v_consultor_id THEN
      RAISE EXCEPTION 'Replay idempotente diverge da proposta original';
    END IF;

    RETURN v_resultado || pg_catalog.jsonb_build_object(
      'taxa_proposta_consultor', v_operacao.taxa_proposta_consultor
    );
  END IF;

  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'true', true);
  UPDATE public.operacoes
  SET taxa_proposta_consultor = p_taxa_proposta_consultor,
      taxa_proposta_por = v_actor_id,
      taxa_proposta_consultor_id = v_consultor_id,
      taxa_proposta_em = pg_catalog.now(),
      calculo_proposta_memoria = v_snapshot
  WHERE id = v_operacao_id
    AND taxa_proposta_consultor IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel preservar a proposta do Consultor';
  END IF;
  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'false', true);

  SELECT p.nome_completo INTO v_actor_nome
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id,
    'TAXA_PROPOSTA_CONSULTOR',
    'operacoes',
    v_operacao_id,
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor,
      'calculo_proposta_memoria', v_snapshot
    )
  );

  INSERT INTO public.eventos_dominio (
    fundo_id, cedente_id, cedente_fundo_id, operacao_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    correlation_id, origem_evento, origem_registro_id
  )
  SELECT
    cf.fundo_id,
    p_cedente_id,
    p_cedente_fundo_id,
    v_operacao_id,
    'taxa_proposta_consultor',
    'operacao',
    v_actor_id,
    coalesce(v_actor_nome, 'Consultor'),
    'consultor',
    'c2_1_r2',
    'Taxa proposta pelo Consultor na solicitacao da operacao.',
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor
    ),
    'interno',
    'operacao:' || v_operacao_id::text,
    'c2_1_r2',
    v_operacao_id::text || ':proposta'
  FROM public.cedente_fundos cf
  WHERE cf.id = p_cedente_fundo_id;

  RETURN v_resultado || pg_catalog.jsonb_build_object(
    'taxa_proposta_consultor', p_taxa_proposta_consultor
  );
END;
$$;


COMMENT ON FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, text, uuid[]
) IS 'Cria solicitacao atomica do Consultor com taxa proposta livre, memoria canonica, autoria e idempotencia.';

COMMIT;
