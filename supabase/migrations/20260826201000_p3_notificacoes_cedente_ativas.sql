BEGIN;

CREATE OR REPLACE FUNCTION private.notificar_cedente_ativos(
  p_cedente_id uuid,
  p_titulo text,
  p_mensagem text,
  p_tipo text,
  p_dedupe_base text,
  p_somente_admin boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inseridos integer := 0;
BEGIN
  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT destinatarios.user_id,
         p_titulo,
         p_mensagem,
         p_tipo,
         p_dedupe_base || ':' || destinatarios.user_id::text
  FROM (
    SELECT ca.user_id
      FROM public.cedente_acessos ca
      JOIN public.profiles p ON p.id = ca.user_id AND p.status::text = 'ativo'
     WHERE ca.cedente_id = p_cedente_id
       AND ca.status = 'ATIVO'
       AND (NOT p_somente_admin OR ca.perfil = 'ADMIN')
    UNION
    SELECT c.user_id
      FROM public.cedentes c
      JOIN public.profiles p ON p.id = c.user_id AND p.status::text = 'ativo'
     WHERE c.id = p_cedente_id
       AND NOT EXISTS (
         SELECT 1 FROM public.cedente_acessos ca WHERE ca.cedente_id = p_cedente_id
       )
  ) destinatarios
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END;
$function$;

REVOKE ALL ON FUNCTION private.notificar_cedente_ativos(uuid,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.notificar_cedente_ativos(uuid,text,text,text,text,boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION private.p3_substituir_trecho_funcao_normalizado(
  p_assinatura text,
  p_trecho_antigo text,
  p_trecho_novo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_oid regprocedure;
  v_definicao text;
  v_nova_definicao text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(p_assinatura);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P3: funcao nao encontrada: %', p_assinatura;
  END IF;
  v_definicao := pg_catalog.replace(pg_catalog.pg_get_functiondef(v_oid), E'\r\n', E'\n');
  IF position(p_trecho_antigo IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'P3: trecho esperado nao encontrado em %', p_assinatura;
  END IF;
  v_nova_definicao := pg_catalog.replace(v_definicao, p_trecho_antigo, p_trecho_novo);
  EXECUTE v_nova_definicao;
END;
$function$;

REVOKE ALL ON FUNCTION private.p3_substituir_trecho_funcao_normalizado(text,text,text)
  FROM PUBLIC, anon, authenticated;

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.desembolsar_operacao_com_logistica(uuid)',
  $old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT c.user_id, 'Cessao efetivada',
         'A operacao ' || substring(p_operacao_id::text from 1 for 8) || ' foi desembolsada e a cessao foi efetivada.',
         'cessao_efetivada',
         'operacao:' || p_operacao_id::text || ':cessao_efetivada:' || c.user_id::text
  FROM public.cedentes c WHERE c.id = op.cedente_id
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$,
  $new$PERFORM private.notificar_cedente_ativos(
    op.cedente_id,
    'Cessao efetivada',
    'A operacao ' || substring(p_operacao_id::text from 1 for 8) || ' foi desembolsada e a cessao foi efetivada.',
    'cessao_efetivada',
    'operacao:' || p_operacao_id::text || ':cessao_efetivada'
  );$new$
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_aceite_sacado(uuid[],text,text)',
  $old$FOR v_recipient IN
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
    END LOOP;$old$,
  $new$PERFORM private.notificar_cedente_ativos(
      v_nf.cedente_id,
      CASE WHEN p_acao = 'contestar' THEN 'Cessão contestada pelo sacado' ELSE 'Aceite de cessão confirmado' END,
      CASE WHEN p_acao = 'contestar' THEN v_message || '. O gestor foi notificado.' ELSE v_message END,
      CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
      v_dedupe || ':cedente'
    );$new$
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_prazos_entrega(date)',
  'SELECT nfe.*, op.cedente_id, c.user_id',
  'SELECT nfe.*, op.cedente_id'
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_prazos_entrega(date)',
  $old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'CT-e vencido', 'O prazo de CT-e de uma NF antecipada venceu.', 'cte_vencido', 'entrega:' || entrega.id::text || ':cte_vencido')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$,
  $new$PERFORM private.notificar_cedente_ativos(entrega.cedente_id, 'CT-e vencido', 'O prazo de CT-e de uma NF antecipada venceu.', 'cte_vencido', 'entrega:' || entrega.id::text || ':cte_vencido');$new$
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_prazos_entrega(date)',
  $old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'CT-e proximo do prazo', 'O prazo de CT-e vence em 2 dias corridos.', 'cte_prazo_proximo', 'entrega:' || entrega.id::text || ':cte_d8')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$,
  $new$PERFORM private.notificar_cedente_ativos(entrega.cedente_id, 'CT-e proximo do prazo', 'O prazo de CT-e vence em 2 dias corridos.', 'cte_prazo_proximo', 'entrega:' || entrega.id::text || ':cte_d8');$new$
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_prazos_entrega(date)',
  $old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'Canhoto vencido', 'O prazo de canhoto de uma NF antecipada venceu.', 'canhoto_vencido', 'entrega:' || entrega.id::text || ':canhoto_vencido')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$,
  $new$PERFORM private.notificar_cedente_ativos(entrega.cedente_id, 'Canhoto vencido', 'O prazo de canhoto de uma NF antecipada venceu.', 'canhoto_vencido', 'entrega:' || entrega.id::text || ':canhoto_vencido');$new$
);

SELECT private.p3_substituir_trecho_funcao_normalizado(
  'public.processar_prazos_entrega(date)',
  $old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (entrega.user_id, 'Canhoto proximo do prazo', 'O prazo de canhoto vence em 4 dias corridos.', 'canhoto_prazo_proximo', 'entrega:' || entrega.id::text || ':canhoto_d16')
      ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$,
  $new$PERFORM private.notificar_cedente_ativos(entrega.cedente_id, 'Canhoto proximo do prazo', 'O prazo de canhoto vence em 4 dias corridos.', 'canhoto_prazo_proximo', 'entrega:' || entrega.id::text || ':canhoto_d16');$new$
);

DROP FUNCTION private.p3_substituir_trecho_funcao_normalizado(text,text,text);

NOTIFY pgrst, 'reload schema';
COMMIT;
