-- Fase 4: roteamento operacional por snapshot e consolidação transacional do aceite.

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notificacoes_usuario_dedupe
  ON public.notificacoes(usuario_id, dedupe_key);

-- A alteração de NF pelo sacado deixa de ser uma operação direta baseada apenas
-- no status. O único caminho permitido é a RPC abaixo, que valida a operação
-- relacionada e serializa NF/operação na mesma transação.
DROP POLICY IF EXISTS notas_fiscais_sacado_aceitar ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_sacado_contestar ON public.notas_fiscais;

CREATE OR REPLACE FUNCTION public.processar_aceite_sacado(
  p_nota_fiscal_ids uuid[],
  p_acao text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sacado_cnpj text;
  v_sacado_nome text;
  v_requested_count integer;
  v_found_count integer;
  v_nf record;
  v_op record;
  v_total integer;
  v_aceitas integer;
  v_operation_ids uuid[] := ARRAY[]::uuid[];
  v_nf_ids uuid[] := ARRAY[]::uuid[];
  v_event text;
  v_title text;
  v_message text;
  v_dedupe text;
  v_recipient uuid;
BEGIN
  IF v_user_id IS NULL OR get_user_role() <> 'sacado' THEN
    RAISE EXCEPTION 'Apenas um sacado autenticado pode executar esta operação.';
  END IF;

  IF p_acao NOT IN ('aceitar', 'contestar') THEN
    RAISE EXCEPTION 'Ação de aceite inválida.';
  END IF;

  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhuma NF foi informada.';
  END IF;

  IF p_acao = 'contestar' AND COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'O motivo da contestação é obrigatório.';
  END IF;

  SELECT s.cnpj, s.razao_social
    INTO v_sacado_cnpj, v_sacado_nome
    FROM public.sacados s
   WHERE s.user_id = v_user_id;
  IF v_sacado_cnpj IS NULL THEN
    RAISE EXCEPTION 'Sacado não encontrado.';
  END IF;

  v_requested_count := (SELECT count(DISTINCT nf_id) FROM unnest(p_nota_fiscal_ids) AS item(nf_id));
  SELECT count(DISTINCT nf.id)
    INTO v_found_count
    FROM public.notas_fiscais nf
    JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    JOIN public.operacoes op ON op.id = onf.operacao_id
   WHERE nf.id = ANY(p_nota_fiscal_ids);
  IF v_requested_count <> v_found_count THEN
    RAISE EXCEPTION 'Todas as NFs precisam estar vinculadas a uma operação.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.operacoes_nfs onf
     WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
     GROUP BY onf.nota_fiscal_id
    HAVING count(DISTINCT onf.operacao_id) <> 1
  ) THEN
    RAISE EXCEPTION 'A NF possui vínculo operacional ambíguo.';
  END IF;

  -- Locks determinísticos evitam corrida no último aceite de uma operação.
  PERFORM 1 FROM public.notas_fiscais WHERE id = ANY(p_nota_fiscal_ids) FOR UPDATE;
  FOR v_op IN
    SELECT op.id, op.cedente_id
      FROM public.operacoes op
     WHERE op.id IN (
       SELECT onf.operacao_id FROM public.operacoes_nfs onf WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
     )
     ORDER BY op.id
     FOR UPDATE
  LOOP
    v_operation_ids := array_append(v_operation_ids, v_op.id);
  END LOOP;

  FOR v_nf IN
    SELECT nf.id, nf.numero_nf, nf.cnpj_destinatario, nf.razao_social_emitente,
           nf.cedente_id, nf.status, onf.operacao_id,
           op.aceite_sacado_exigido, op.aceite_sacado_status, op.status AS operacao_status,
           c.razao_social AS cedente_razao_social
      FROM public.notas_fiscais nf
      JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
      JOIN public.operacoes op ON op.id = onf.operacao_id
      JOIN public.cedentes c ON c.id = op.cedente_id
     WHERE nf.id = ANY(p_nota_fiscal_ids)
     ORDER BY nf.id
  LOOP
    IF v_nf.cnpj_destinatario <> v_sacado_cnpj THEN
      RAISE EXCEPTION 'Esta NF não é destinada ao sacado autenticado.';
    END IF;
    IF COALESCE(v_nf.aceite_sacado_exigido, true) = false
       OR COALESCE(v_nf.aceite_sacado_status, 'pendente') = 'dispensado' THEN
      RAISE EXCEPTION 'Esta operação não exige aceite do sacado.';
    END IF;
    IF v_nf.aceite_sacado_status IS NOT NULL AND v_nf.aceite_sacado_status <> 'pendente' THEN
      RAISE EXCEPTION 'A operação não está aberta para aceite.';
    END IF;
    IF v_nf.operacao_status NOT IN ('solicitada', 'em_analise') THEN
      RAISE EXCEPTION 'A operação não está aberta para aceite.';
    END IF;
    IF v_nf.status <> 'em_antecipacao' THEN
      RAISE EXCEPTION 'Esta NF não pode ser alterada no status atual.';
    END IF;

    IF p_acao = 'aceitar' THEN
      UPDATE public.notas_fiscais
         SET status = 'aceita', aprovacao_sacado_em = now()
       WHERE id = v_nf.id;
      v_event := 'CESSAO_ACEITA';
      v_title := 'Cessão aceita pelo sacado';
      v_message := format('O sacado %s aceitou a cessão da NF %s.', v_sacado_nome, v_nf.numero_nf);
    ELSE
      UPDATE public.notas_fiscais
         SET status = 'contestada', motivo_ajuste = p_motivo
       WHERE id = v_nf.id;
      v_event := 'CESSAO_CONTESTADA';
      v_title := 'ALERTA: Cessão contestada pelo sacado';
      v_message := format('O sacado %s contestou a cessão da NF %s. Motivo: %s', v_sacado_nome, v_nf.numero_nf, p_motivo);
    END IF;

    v_nf_ids := array_append(v_nf_ids, v_nf.id);
    v_dedupe := format('operacao:%s:nf:%s:%s', v_nf.operacao_id, v_nf.id, p_acao);

    INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
    VALUES (v_user_id, 'usuario', 'rpc_sacado', v_event, 'notas_fiscais', v_nf.id,
            jsonb_build_object('sacado_cnpj', v_sacado_cnpj, 'motivo', CASE WHEN p_acao = 'contestar' THEN p_motivo ELSE NULL END));

    FOR v_recipient IN
      SELECT c.user_id FROM public.cedentes c WHERE c.id = v_nf.cedente_id
      UNION
      SELECT ca.user_id FROM public.cedente_acessos ca WHERE ca.cedente_id = v_nf.cedente_id AND ca.ativo = true
    LOOP
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (
        v_recipient,
        CASE WHEN p_acao = 'contestar' THEN 'Cessão contestada pelo sacado' ELSE 'Aceite de cessão confirmado' END,
        CASE WHEN p_acao = 'contestar' THEN v_message || '. O gestor foi notificado.' ELSE v_message END,
        CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
        v_dedupe || ':cedente:' || v_recipient::text
      ) ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
    END LOOP;

    FOR v_recipient IN SELECT p.id FROM public.profiles p WHERE p.role = 'gestor'
    LOOP
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (
        v_recipient,
        v_title,
        CASE WHEN p_acao = 'contestar' THEN v_message ELSE v_message || format(' (emitente: %s).', v_nf.razao_social_emitente) END,
        CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
        v_dedupe || ':gestor:' || v_recipient::text
      ) ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
    END LOOP;
  END LOOP;

  -- Consolidação ocorre sob os locks das operações obtidos acima.
  FOR v_op IN SELECT id, cedente_id FROM public.operacoes WHERE id = ANY(v_operation_ids) ORDER BY id LOOP
    SELECT count(*), count(*) FILTER (WHERE nf.status = 'aceita')
      INTO v_total, v_aceitas
      FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
     WHERE onf.operacao_id = v_op.id;

    IF p_acao = 'contestar' THEN
      UPDATE public.operacoes SET aceite_sacado_status = 'contestado', aceite_sacado_em = now() WHERE id = v_op.id;
    ELSIF v_total > 0 AND v_total = v_aceitas THEN
      UPDATE public.operacoes SET aceite_sacado_status = 'aceito', aceite_sacado_em = now() WHERE id = v_op.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('acao', p_acao, 'nota_fiscal_ids', to_jsonb(v_nf_ids), 'operacao_ids', to_jsonb(v_operation_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.processar_aceite_sacado(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.processar_aceite_sacado(uuid[], text, text) TO authenticated;
