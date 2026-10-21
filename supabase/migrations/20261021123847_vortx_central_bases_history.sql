BEGIN;

-- New read-only projection. The existing history RPC and every mutation remain unchanged.
-- Definer is limited to the same private job ledger as vortx_historico_operacional;
-- the canonical operator guard is mandatory before any query, including the summary.
CREATE FUNCTION private.vortx_central_bases_historico(
 p_fundo_id uuid,p_pagina integer,p_tipo text,p_origem text,p_estado text,p_referencia date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado jsonb;
BEGIN
 IF private.vortx_relatorio_operador(p_fundo_id,false) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso ao Fundo exigido.';
 END IF;
 IF (p_tipo IS NOT NULL AND p_tipo NOT IN ('PosicaoAtivo','PosicaoParcela','Inclusao','Exclusao'))
 OR (p_origem IS NOT NULL AND p_origem NOT IN ('MANUAL','CRON'))
 OR (p_estado IS NOT NULL AND p_estado NOT IN ('registrada','enviando','aceita','recusada','indeterminada','falha_autenticacao')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Filtros inválidos.';
 END IF;
 WITH filtrados AS MATERIALIZED (
  SELECT s.id,s.criada_em FROM public.vortx_relatorio_solicitacoes s
  WHERE s.fundo_id=p_fundo_id AND (p_tipo IS NULL OR s.pedido->>'tipoRelatorio'=p_tipo)
   AND (p_origem IS NULL OR s.origem=p_origem) AND (p_estado IS NULL OR s.estado=p_estado)
   AND (p_referencia IS NULL OR s.pedido->>'dataReferencia'=p_referencia::text)
 ), pagina AS (
  SELECT id,criada_em FROM filtrados ORDER BY criada_em DESC,id DESC
  LIMIT 20 OFFSET(greatest(1,least(10000,COALESCE(p_pagina,1)))-1)*20
 ), ultimos AS (
  SELECT DISTINCT ON (s.pedido->>'tipoRelatorio') s.id,s.criada_em
  FROM public.vortx_relatorio_solicitacoes s WHERE s.fundo_id=p_fundo_id
  ORDER BY s.pedido->>'tipoRelatorio',s.criada_em DESC,s.id DESC
 ), ids AS (SELECT id FROM pagina UNION SELECT id FROM ultimos), projecao AS MATERIALIZED (
  SELECT s.id,s.fundo_id,s.integracao_versao_id,s.ambiente,s.pedido,s.estado,s.protocolo_externo,s.codigo_http,
   s.criada_em,s.envio_iniciado_em,s.concluida_em,s.revisao,s.solicitacao_anterior_id,s.origem,s.data_operacional,
   jsonb_build_object('recebidoEm',e.recebido_em,'arquivoStatus',e.status_relatorio,
    'processamento',j.estado,'downloadEm',j.download_concluido_em,
    'processadoEm',CASE WHEN j.estado IN ('PERSISTIDO','REVISAO') THEN j.atualizada_em END,
    'erro',j.erro,'publicacao',i.status,'publicadoEm',i.publicada_em,
    'ativos',(SELECT count(*) FROM public.vortx_posicao_ativos a WHERE a.importacao_id=j.importacao_id AND a.fundo_id=p_fundo_id),
    'parcelas',(SELECT count(*) FROM public.vortx_posicao_parcelas p WHERE p.importacao_id=j.importacao_id AND p.fundo_id=p_fundo_id),
    'duplicada',j.importacao_id IS NOT NULL AND ((j.manifestos->-1->'payload'->>'id') IS DISTINCT FROM j.importacao_id::text)) acompanhamento
  FROM public.vortx_relatorio_solicitacoes s JOIN ids ON ids.id=s.id
  LEFT JOIN LATERAL(SELECT ev.recebido_em,ev.status_relatorio FROM public.vortx_relatorio_eventos ev
   WHERE ev.solicitacao_id=s.id AND ev.fundo_id=p_fundo_id AND ev.correlacao='CORRELACIONADO'
   ORDER BY ev.recebido_em DESC,ev.id DESC LIMIT 1) e ON true
  LEFT JOIN LATERAL(SELECT job.* FROM private.vortx_estoque_processamentos job
   WHERE job.fundo_id=p_fundo_id AND EXISTS(SELECT 1 FROM public.vortx_relatorio_eventos je
    WHERE je.solicitacao_id=s.id AND je.fundo_id=p_fundo_id AND je.id IN(job.ativo_evento_id,job.parcela_evento_id))
   ORDER BY job.criada_em DESC,job.id DESC LIMIT 1) j ON true
  LEFT JOIN public.importacoes_financeiras i ON i.id=j.importacao_id AND i.fundo_id=p_fundo_id
  WHERE s.fundo_id=p_fundo_id
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtrados),
  'solicitacoes',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.criada_em DESC,q.id DESC) FROM projecao q JOIN pagina p ON p.id=q.id),'[]'::jsonb),
  'resumo',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.criada_em DESC,q.id DESC) FROM projecao q JOIN ultimos u ON u.id=q.id),'[]'::jsonb)) INTO resultado;
 RETURN resultado;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_central_bases_historico(uuid,integer,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_central_bases_historico(uuid,integer,text,text,text,date) TO authenticated;

CREATE FUNCTION public.vortx_central_bases_historico(
 p_fundo_id uuid,p_pagina integer DEFAULT 1,p_tipo text DEFAULT NULL,p_origem text DEFAULT NULL,
 p_estado text DEFAULT NULL,p_referencia date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_central_bases_historico(p_fundo_id,p_pagina,p_tipo,p_origem,p_estado,p_referencia);
$$;
REVOKE ALL ON FUNCTION public.vortx_central_bases_historico(uuid,integer,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_central_bases_historico(uuid,integer,text,text,text,date) TO authenticated;
COMMIT;
