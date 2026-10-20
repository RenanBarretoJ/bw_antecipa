-- Forward-only. No backfill, metadata rewrite, new grants, Auth/RLS or inbox-acceptance change.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION private.vortx_callback_correlacionar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.vortx_relatorio_eventos%ROWTYPE; s public.vortx_relatorio_solicitacoes%ROWTYPE; integracao uuid;
BEGIN
 SELECT * INTO e FROM public.vortx_relatorio_eventos WHERE id=p_id AND correlacao='PENDENTE';
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO s FROM public.vortx_relatorio_solicitacoes WHERE ambiente=e.ambiente AND protocolo_externo=e.protocolo_externo;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT integracao_id INTO integracao FROM private.vortx_callback_endpoints WHERE id=e.endpoint_id;
 IF s.fundo_id=e.fundo_id AND s.estado='aceita'
  AND EXISTS(SELECT 1 FROM public.integracao_fundo_versoes WHERE id=s.integracao_versao_id AND integracao_fundo_id=integracao AND ambiente=e.ambiente)
  AND s.pedido->>'codigoCarteira'=e.metadados->>'idCarteira'
  AND s.pedido->>'tipoRelatorio'=e.tipo_relatorio
  AND ((e.tipo_relatorio IN ('PosicaoAtivo','PosicaoParcela')
       AND s.pedido->>'dataReferencia'=e.data_referencia::text)
    OR (e.tipo_relatorio IN ('Inclusao','Exclusao')
       AND s.pedido->>'dataInicio'=e.data_inicio::text AND s.pedido->>'dataFim'=e.data_fim::text)) THEN
  UPDATE public.vortx_relatorio_eventos SET solicitacao_id=s.id,correlacao='CORRELACIONADO' WHERE id=e.id;
 ELSE
  UPDATE public.vortx_relatorio_eventos SET correlacao='CONFLITANTE' WHERE id=e.id;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_correlacionar(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION private.vortx_callback_correlacionar(uuid) IS
 'Exact protocol, environment, integration, wallet, Fund and type remain mandatory. Positions match their point date; movements match their full period. Historical non-pending events remain immutable.';
COMMIT;
