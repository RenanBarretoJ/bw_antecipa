-- Inclusion correlates by its exact request interval, not the provider point-reference.
-- Preserve original callback bytes, all scope/worker fences and existing function ACLs.
BEGIN;

CREATE OR REPLACE FUNCTION private.vortx_inclusao_autorizada(p_evento uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.vortx_relatorio_eventos e
 JOIN public.vortx_relatorio_solicitacoes s ON s.id=e.solicitacao_id
 JOIN private.vortx_callback_endpoints ep ON ep.id=e.endpoint_id
 JOIN public.integracao_fundo_versoes v ON v.id=s.integracao_versao_id
 JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id AND i.id=ep.integracao_id
 JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
 WHERE e.id=p_evento AND e.tipo_relatorio='Inclusao' AND e.status_relatorio='Disponível'
 AND e.correlacao='CORRELACIONADO' AND e.data_expiracao>now() AND ep.ativo
 AND e.fundo_id=f.id AND s.fundo_id=f.id AND ep.fundo_id=f.id
 AND e.ambiente=v.ambiente AND s.ambiente=v.ambiente AND ep.ambiente=v.ambiente
 AND s.estado='aceita' AND s.protocolo_externo=e.protocolo_externo
 AND s.pedido->>'tipoRelatorio'='Inclusao' AND (s.pedido->>'extensaoArquivo')::int=2
 AND s.pedido->>'dataInicio'=e.data_inicio::text AND s.pedido->>'dataFim'=e.data_fim::text
 AND e.data_inicio<=e.data_fim AND i.status='ativa' AND i.provider_key='VORTX'
 AND v.adapter_key='vortx_vrs' AND v.status='publicada' AND v.vigente_ate IS NULL
 AND ep.codigo_carteira=v.configuracao_nao_sensivel->>'codigo_carteira'
 AND s.pedido->>'codigoCarteira'=ep.codigo_carteira AND e.metadados->>'idCarteira'=ep.codigo_carteira
 AND c.fundo_id=f.id AND c.ambiente=v.ambiente AND c.capability='AQUISICOES'
 AND c.disponivel_desde<=now() AND c.disponivel_ate IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.vortx_reservar_processamento_inclusao(p_fundo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;j private.vortx_inclusao_processamentos%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('vortx-inclusion-worker:'||p_fundo_id::text,0)) THEN RETURN NULL; END IF;
 UPDATE private.vortx_inclusao_processamentos SET estado='FALHA',erro='PERSISTENCIA_INDETERMINADA',lease=NULL,lease_ate=NULL
 WHERE fundo_id=p_fundo_id AND estado='PROCESSANDO' AND tentativas>=3 AND lease_ate<clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.vortx_inclusao_processamentos WHERE fundo_id=p_fundo_id AND estado='PROCESSANDO' AND lease_ate>clock_timestamp()) THEN RETURN NULL; END IF;
 FOR e IN SELECT ev.*,s.integracao_versao_id,(s.pedido->>'dataReferencia')::date referencia_pedido FROM public.vortx_relatorio_eventos ev
 JOIN public.vortx_relatorio_solicitacoes s ON s.id=ev.solicitacao_id
 WHERE ev.fundo_id=p_fundo_id AND ev.tipo_relatorio='Inclusao' AND private.vortx_inclusao_autorizada(ev.id)
 AND NOT EXISTS(SELECT 1 FROM private.vortx_inclusao_processamentos done WHERE done.evento_id=ev.id
  AND (done.estado IN ('PERSISTIDO','REVISAO','FALHA') OR done.tentativas>=3))
 AND NOT EXISTS(SELECT 1 FROM public.vortx_relatorio_eventos newer WHERE newer.solicitacao_id=ev.solicitacao_id
  AND newer.correlacao='CORRELACIONADO' AND (newer.recebido_em,newer.id)>(ev.recebido_em,ev.id))
 ORDER BY ev.recebido_em,ev.id LIMIT 20 LOOP
 INSERT INTO private.vortx_inclusao_processamentos(evento_id,fundo_id,versao_id,ambiente,codigo_carteira,data_referencia,data_inicio,data_fim)
 VALUES(e.id,e.fundo_id,e.integracao_versao_id,e.ambiente,e.metadados->>'idCarteira',e.referencia_pedido,e.data_inicio,e.data_fim)
 ON CONFLICT(evento_id) DO NOTHING;
 SELECT * INTO j FROM private.vortx_inclusao_processamentos WHERE evento_id=e.id AND tentativas<3
 AND (estado='PENDENTE' OR (estado='PROCESSANDO' AND lease_ate<clock_timestamp())) FOR UPDATE SKIP LOCKED;
 IF FOUND THEN
 UPDATE private.vortx_inclusao_processamentos SET estado='PROCESSANDO',tentativas=tentativas+1,lease=gen_random_uuid(),
 lease_ate=clock_timestamp()+interval '10 minutes',atualizada_em=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 DELETE FROM private.vortx_inclusao_blocos WHERE processamento_id=j.id;
 RETURN to_jsonb(j)||jsonb_build_object('evento',to_jsonb(e));
 END IF;
 END LOOP;
 RETURN NULL;
END;
$$;

COMMIT;
