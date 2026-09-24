BEGIN;

-- A remocao anterior era executada diretamente pela Server Action com o
-- client authenticated. operacoes_nfs possui somente policies SELECT para o
-- gestor, portanto o DELETE era filtrado pelo RLS sem erro e a action seguia
-- atualizando a NF e registrando sucesso. Centralizar a mutacao em uma RPC
-- SECURITY DEFINER permite validar autorizacao, conferir ROW_COUNT e manter
-- vinculo, parcelas, memoria e totais na mesma transacao.
CREATE OR REPLACE FUNCTION public.remover_nf_operacao_gestor_atomica(
  p_operacao_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.get_user_role();
  v_op record;
  v_nf record;
  v_nf_restante record;
  v_parcela record;
  v_memoria jsonb;
  v_metodo text;
  v_data_base date;
  v_tem_parcelas boolean;
  v_quantidade_restante integer := 0;
  v_aceitas integer := 0;
  v_contestadas integer := 0;
  v_vinculos_removidos integer := 0;
  v_parcelas_liberadas integer := 0;
  v_valor_bruto numeric(18,2) := 0;
  v_valor_liquido numeric(18,2) := 0;
  v_aceite_status text;
  v_aceite_em timestamptz;
  v_operacao_cancelada boolean := false;
BEGIN
  IF v_actor_id IS NULL OR v_actor_role IS DISTINCT FROM 'gestor' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Apenas gestores autenticados podem remover NFs da operacao';
  END IF;

  SELECT o.*, cf.fundo_id
    INTO v_op
    FROM public.operacoes o
    JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
   WHERE o.id = p_operacao_id
   FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;
  IF NOT private.usuario_tem_acesso_fundo(v_op.fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Gestor sem acesso ao fundo desta operacao';
  END IF;
  IF v_op.status::text NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Nao e possivel remover NFs de uma operacao com status "%"', v_op.status;
  END IF;

  SELECT nf.id, nf.numero_nf, nf.status, nf.valor_bruto
    INTO v_nf
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
   WHERE onf.operacao_id = p_operacao_id
     AND onf.nota_fiscal_id = p_nota_fiscal_id
   FOR UPDATE OF onf, nf;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF nao encontrada nesta operacao';
  END IF;

  WITH parcelas_da_nf AS (
    SELECT parcela_id
      FROM public.operacoes_nf_parcelas
     WHERE operacao_id = p_operacao_id
       AND nota_fiscal_id = p_nota_fiscal_id
  )
  UPDATE public.nota_fiscal_parcelas parcela
     SET status = 'disponivel'
   WHERE parcela.id IN (SELECT parcela_id FROM parcelas_da_nf);
  GET DIAGNOSTICS v_parcelas_liberadas = ROW_COUNT;

  DELETE FROM public.operacoes_nf_parcelas
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;

  DELETE FROM public.operacao_calculo_nfs
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;

  DELETE FROM public.operacoes_nfs
   WHERE operacao_id = p_operacao_id
     AND nota_fiscal_id = p_nota_fiscal_id;
  GET DIAGNOSTICS v_vinculos_removidos = ROW_COUNT;

  IF v_vinculos_removidos <> 1 THEN
    RAISE EXCEPTION 'Falha ao remover o vinculo da NF da operacao';
  END IF;

  UPDATE public.notas_fiscais
     SET status = 'aprovada',
         aprovacao_sacado_em = NULL,
         valor_antecipado = NULL
   WHERE id = p_nota_fiscal_id;

  SELECT count(*),
         count(*) FILTER (WHERE nf.status::text = 'aceita'),
         count(*) FILTER (WHERE nf.status::text = 'contestada'),
         max(nf.aprovacao_sacado_em)
    INTO v_quantidade_restante, v_aceitas, v_contestadas, v_aceite_em
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
   WHERE onf.operacao_id = p_operacao_id;

  IF v_quantidade_restante = 0 THEN
    UPDATE public.operacoes
       SET status = 'cancelada'
     WHERE id = p_operacao_id;
    v_operacao_cancelada := true;
  ELSE
    v_metodo := coalesce(
      v_op.metodo_calculo_financeiro,
      v_op.politica_snapshot #>> '{calculo_financeiro,metodo}',
      'LEGADO_MENSAL_DIAS_REAIS_30'
    );
    v_data_base := coalesce(
      v_op.calculo_data_base,
      (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date
    );

    FOR v_nf_restante IN
      SELECT nf.*
        FROM public.operacoes_nfs onf
        JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
       WHERE onf.operacao_id = p_operacao_id
       ORDER BY nf.id
    LOOP
      SELECT EXISTS (
        SELECT 1
          FROM public.operacoes_nf_parcelas onp
         WHERE onp.operacao_id = p_operacao_id
           AND onp.nota_fiscal_id = v_nf_restante.id
      ) INTO v_tem_parcelas;

      IF v_tem_parcelas THEN
        FOR v_parcela IN
          SELECT parcela.valor_nominal, parcela.data_vencimento
            FROM public.operacoes_nf_parcelas onp
            JOIN public.nota_fiscal_parcelas parcela ON parcela.id = onp.parcela_id
           WHERE onp.operacao_id = p_operacao_id
             AND onp.nota_fiscal_id = v_nf_restante.id
           ORDER BY parcela.numero_parcela
        LOOP
          v_valor_bruto := v_valor_bruto + v_parcela.valor_nominal;
          IF v_op.taxa_desconto IS NOT NULL THEN
            v_memoria := private.calcular_memoria_financeira_nf(
              v_nf_restante.id,
              v_parcela.valor_nominal,
              v_op.taxa_desconto,
              v_data_base,
              v_parcela.data_vencimento,
              v_metodo
            );
            v_valor_liquido := v_valor_liquido + (v_memoria->>'valor_presente')::numeric;
          END IF;
        END LOOP;
      ELSE
        v_valor_bruto := v_valor_bruto + v_nf_restante.valor_bruto;
        IF v_op.taxa_desconto IS NOT NULL THEN
          v_memoria := private.calcular_memoria_financeira_nf(
            v_nf_restante.id,
            v_nf_restante.valor_bruto,
            v_op.taxa_desconto,
            v_data_base,
            v_nf_restante.data_vencimento,
            v_metodo
          );
          v_valor_liquido := v_valor_liquido + (v_memoria->>'valor_presente')::numeric;
        END IF;
      END IF;
    END LOOP;

    IF v_op.aceite_sacado_exigido IS FALSE OR v_op.aceite_sacado_status = 'dispensado' THEN
      v_aceite_status := 'dispensado';
      v_aceite_em := NULL;
    ELSIF v_contestadas > 0 THEN
      v_aceite_status := 'contestado';
      v_aceite_em := NULL;
    ELSIF v_aceitas = v_quantidade_restante THEN
      v_aceite_status := 'aceito';
    ELSE
      v_aceite_status := 'pendente';
      v_aceite_em := NULL;
    END IF;

    UPDATE public.operacoes
       SET valor_bruto_total = round(v_valor_bruto, 2),
           valor_liquido_desembolso = CASE
             WHEN v_op.taxa_desconto IS NULL THEN NULL
             ELSE round(v_valor_liquido, 2)
           END,
           aceite_sacado_status = v_aceite_status,
           aceite_sacado_em = v_aceite_em
     WHERE id = p_operacao_id;
  END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id,
    ator_tipo,
    origem,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois
  ) VALUES (
    v_actor_id,
    'usuario',
    'rpc_gestor',
    'NF_REMOVIDA_OPERACAO',
    'operacoes',
    p_operacao_id,
    pg_catalog.jsonb_build_object(
      'nf_removida', v_nf.numero_nf,
      'valor_bruto_total', v_op.valor_bruto_total,
      'valor_liquido_desembolso', v_op.valor_liquido_desembolso,
      'aceite_sacado_status', v_op.aceite_sacado_status
    ),
    pg_catalog.jsonb_build_object(
      'nf_removida', v_nf.numero_nf,
      'operacao_cancelada', v_operacao_cancelada,
      'quantidade_nfs', v_quantidade_restante,
      'novo_valor_bruto', CASE WHEN v_operacao_cancelada THEN 0 ELSE round(v_valor_bruto, 2) END,
      'novo_valor_liquido', CASE
        WHEN v_operacao_cancelada OR v_op.taxa_desconto IS NULL THEN NULL
        ELSE round(v_valor_liquido, 2)
      END,
      'parcelas_liberadas', v_parcelas_liberadas,
      'aceite_sacado_status', CASE WHEN v_operacao_cancelada THEN v_op.aceite_sacado_status ELSE v_aceite_status END
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'operacao_id', p_operacao_id,
    'cedente_id', v_op.cedente_id,
    'nota_fiscal_id', p_nota_fiscal_id,
    'numero_nf', v_nf.numero_nf,
    'operacao_cancelada', v_operacao_cancelada,
    'quantidade_nfs', v_quantidade_restante,
    'novo_valor_bruto', CASE WHEN v_operacao_cancelada THEN 0 ELSE round(v_valor_bruto, 2) END,
    'novo_valor_liquido', CASE
      WHEN v_operacao_cancelada OR v_op.taxa_desconto IS NULL THEN NULL
      ELSE round(v_valor_liquido, 2)
    END,
    'parcelas_liberadas', v_parcelas_liberadas,
    'aceite_sacado_status', CASE WHEN v_operacao_cancelada THEN v_op.aceite_sacado_status ELSE v_aceite_status END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) IS
  'Remove uma NF de operacao pre-aprovacao de forma atomica, libera parcelas, limpa memoria, recalcula totais e recompõe o aceite agregado. Valida gestor e acesso ao fundo internamente.';

COMMIT;
