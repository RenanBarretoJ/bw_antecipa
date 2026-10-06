-- Additive UI surface. R1 signatures, history and policies remain unchanged.
CREATE FUNCTION public.listar_notificacoes_filtradas(
  p_scope text, p_fundo_id uuid, p_filtro text DEFAULT 'todas',
  p_limit integer DEFAULT 20, p_cursor_em timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
) RETURNS SETOF public.notificacoes
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM private.validar_escopo_leitura_notificacoes(p_scope,p_fundo_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40
    OR (p_cursor_em IS NULL) <> (p_cursor_id IS NULL)
    OR p_filtro IS NULL OR p_filtro NOT IN
      ('todas','nao_lidas','lidas','operacoes','documentos','logistica','integracoes','alertas') THEN
    RAISE EXCEPTION 'NOTIFICACAO_FILTRO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT n.* FROM public.notificacoes n
  WHERE n.usuario_id = (SELECT auth.uid()) AND n.scope_type = p_scope
    AND (n.fundo_id = p_fundo_id OR (p_scope = 'GLOBAL' AND n.fundo_id IS NULL))
    AND (p_cursor_em IS NULL OR (n.created_at,n.id) < (p_cursor_em,p_cursor_id))
    AND CASE p_filtro
      WHEN 'todas' THEN true
      WHEN 'nao_lidas' THEN NOT n.lida
      WHEN 'lidas' THEN n.lida
      WHEN 'operacoes' THEN n.tipo ~ '^(operacao_|antecipacao_|cessao_|desembolso|liquidacao|pagamento_|vencimento_|inadimplencia)'
      WHEN 'documentos' THEN n.tipo ~ '^(documento_|nf_|nota_fiscal_|boleto_|cadastro_|alteracao_cadastral|estabelecimento_)'
      WHEN 'logistica' THEN n.tipo ~ '(cte|canhoto|entrega|logistica|postergacao)'
      WHEN 'integracoes' THEN n.tipo ~ '(integracao|intake|cnab|custodiante|transportadora|webhook)'
      WHEN 'alertas' THEN n.tipo ~ '(alerta|erro|falha|vencid|vencimento|inadimpl|prazo|pendencia|seguranca|mfa_)'
      ELSE false END
  ORDER BY n.created_at DESC,n.id DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.listar_notificacoes_filtradas(text,uuid,text,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.listar_notificacoes_filtradas(text,uuid,text,integer,timestamptz,uuid) TO authenticated;

-- An old notification is not a permanent capability. Recheck its current entity
-- and exact recipient before returning a deep-link context. No caller-supplied URL.
CREATE FUNCTION public.obter_destino_notificacao(p_id uuid,p_scope text,p_fundo_id uuid)
RETURNS TABLE(entidade_tipo text,entidade_id uuid,cedente_id uuid,fundo_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_notif public.notificacoes%ROWTYPE; v_context record;
BEGIN
  PERFORM private.validar_escopo_leitura_notificacoes(p_scope,p_fundo_id);
  SELECT n.* INTO v_notif FROM public.notificacoes n
    WHERE n.id=p_id AND n.usuario_id=(SELECT auth.uid()) AND n.scope_type=p_scope
      AND (n.fundo_id=p_fundo_id OR (p_scope='GLOBAL' AND n.fundo_id IS NULL));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICACAO_ACESSO_NEGADO' USING ERRCODE='42501'; END IF;
  IF p_scope='GLOBAL' THEN
    IF v_notif.tipo NOT IN ('mfa_reset_administrativo','seguranca_senha_alterada') THEN
      RAISE EXCEPTION 'NOTIFICACAO_DESTINO_NEGADO' USING ERRCODE='42501';
    END IF;
    RETURN QUERY SELECT 'seguranca'::text,NULL::uuid,NULL::uuid,NULL::uuid;
    RETURN;
  END IF;
  SELECT * INTO v_context FROM private.notificacao_contexto_entidade(v_notif.entidade_tipo,v_notif.entidade_id);
  IF v_context.fundo_id IS DISTINCT FROM p_fundo_id OR NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['gestor','cedente','sacado','consultor']) d(destino)
    CROSS JOIN LATERAL private.notificacao_destinatarios_entidade(v_notif.entidade_tipo,v_notif.entidade_id,d.destino,false) r
    WHERE r.usuario_id=(SELECT auth.uid())
  ) THEN RAISE EXCEPTION 'NOTIFICACAO_DESTINO_NEGADO' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT v_notif.entidade_tipo,v_notif.entidade_id,v_context.cedente_id,v_context.fundo_id;
END;
$$;
REVOKE ALL ON FUNCTION public.obter_destino_notificacao(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obter_destino_notificacao(uuid,text,uuid) TO authenticated;
COMMENT ON FUNCTION public.obter_destino_notificacao(uuid,text,uuid) IS
  'Own notification only; validates active actor, explicit scope, canonical entity and current exact recipient. Does not mutate context or history.';
