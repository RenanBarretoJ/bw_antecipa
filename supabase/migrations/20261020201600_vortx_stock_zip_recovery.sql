-- Forward-only: retain the failed download as an audit event before an operator retry.
BEGIN;
CREATE INDEX vortx_estoque_processamento_importacao_idx ON private.vortx_estoque_processamentos(importacao_id);
CREATE INDEX vortx_estoque_processamento_parcela_idx ON private.vortx_estoque_processamentos(parcela_evento_id);
CREATE INDEX vortx_estoque_processamento_versao_idx ON private.vortx_estoque_processamentos(versao_id);

CREATE FUNCTION public.vortx_retomar_download_estoque(p_fundo_id uuid,p_correlation_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF p_correlation_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Correlacao obrigatoria'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('vortx-worker:'||p_fundo_id::text,0)) THEN RETURN false; END IF;
 SELECT * INTO j FROM private.vortx_estoque_processamentos p
 WHERE p.fundo_id=p_fundo_id AND p.estado='FALHA' AND p.erro='DOWNLOAD_FALHOU'
  AND p.tentativas BETWEEN 1 AND 2 AND p.importacao_id IS NULL AND p.manifestos='[]'::jsonb
  AND NOT EXISTS(SELECT 1 FROM private.vortx_estoque_blocos b WHERE b.processamento_id=p.id)
  AND private.vortx_par_estoque_autorizado(p.ativo_evento_id,p.parcela_evento_id)
 ORDER BY p.data_referencia DESC,p.criada_em DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM private.financeiro_auditar('VORTX_CALLBACK_ESTOQUE_RETENTATIVA',NULL,j.fundo_id,p_correlation_id,
  jsonb_build_object('processamento_id',j.id,'estado_anterior',j.estado,'erro_anterior',j.erro,
   'tentativa_anterior',j.tentativas,'motivo','ZIP_CSV_SUPORTADO',
   'ativo_evento_id',j.ativo_evento_id,'parcela_evento_id',j.parcela_evento_id));
 UPDATE private.vortx_estoque_processamentos SET estado='PENDENTE',erro=NULL,atualizada_em=clock_timestamp() WHERE id=j.id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_retomar_download_estoque(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_retomar_download_estoque(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.vortx_retomar_download_estoque(uuid,uuid) IS
 'Explicit internal operator recovery after ZIP support; never called by webhook. Only download failures before any upload/staging/import, current authorized pair, original attempt ceiling and immutable audit before state transition.';
COMMIT;
