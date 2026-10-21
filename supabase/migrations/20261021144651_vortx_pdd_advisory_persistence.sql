BEGIN;

-- Temporary, versioned business decision: PDD differences do not prevent persistence.
-- Full reconciliation/publication, native immutability, ACLs and RLS are unchanged.
-- TODO(VORTX_PDD_ADVISORY_V1): replace only after the provider confirms PDD semantics.
CREATE FUNCTION private.vortx_estoque_reconciliado_financeiro(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.vortx_posicao_ativos WHERE importacao_id=p_id)
 AND EXISTS(SELECT 1 FROM public.vortx_posicao_parcelas WHERE importacao_id=p_id)
 AND NOT EXISTS(
  SELECT 1 FROM public.vortx_posicao_ativos a
  LEFT JOIN (SELECT identidade_ativo,count(*) n,sum(valor_nominal) nominal,
   sum(valor_aquisicao) aquisicao,sum(valor_presente) presente,
   count(*) FILTER(WHERE valor_nominal IS NULL OR valor_aquisicao IS NULL OR valor_presente IS NULL) ausentes
   FROM public.vortx_posicao_parcelas WHERE importacao_id=p_id GROUP BY identidade_ativo) p
   ON p.identidade_ativo=a.identidade_ativo
  WHERE a.importacao_id=p_id AND (p.n IS NULL OR p.ausentes>0
   OR a.valor_nominal IS NULL OR a.valor_aquisicao IS NULL OR a.valor_presente IS NULL
   OR p.nominal<>a.valor_nominal OR p.aquisicao<>a.valor_aquisicao OR p.presente<>a.valor_presente)
 );
$$;
REVOKE ALL ON FUNCTION private.vortx_estoque_reconciliado_financeiro(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.vortx_concluir_processamento_estoque(p_id uuid,p_lease uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE; resultado jsonb; reconciliado boolean; financeiro boolean; pdd_pendente boolean;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO j FROM private.vortx_estoque_processamentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.estado<>'PROCESSANDO' OR j.lease IS DISTINCT FROM p_lease OR j.lease_ate<=clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Execucao de estoque indisponivel';
 END IF;
 IF NOT private.vortx_par_estoque_autorizado(j.ativo_evento_id,j.parcela_evento_id)
 OR p_payload->>'fundo_id' IS DISTINCT FROM j.fundo_id::text
 OR p_payload->>'ambiente' IS DISTINCT FROM j.ambiente
 OR p_payload->>'codigo_carteira' IS DISTINCT FROM j.codigo_carteira
 OR p_payload->>'data_referencia' IS DISTINCT FROM j.data_referencia::text
 OR p_payload->>'integracao_fundo_versao_id' IS DISTINCT FROM j.versao_id::text THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Escopo do processamento incompativel';
 END IF;
 IF p_payload ? 'processamento_id' AND (p_payload->>'processamento_id' IS DISTINCT FROM j.id::text
   OR p_payload->>'processamento_lease' IS DISTINCT FROM j.lease::text) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Manifesto de blocos incompativel';
 END IF;
 -- Native rows, private original lineage, job completion and audit commit together.
 resultado:=public.persistir_estoque_vortx(p_payload);
 SELECT private.vortx_estoque_reconciliado((resultado->>'id')::uuid) INTO reconciliado;
 financeiro:=private.vortx_estoque_reconciliado_financeiro((resultado->>'id')::uuid);
 pdd_pendente:=financeiro AND NOT reconciliado;
 UPDATE public.importacoes_financeiras SET metadados=metadados||jsonb_build_object(
  'politica_conferencia_persistencia','VORTX_PDD_ADVISORY_V1',
  'financeiro_conferido',financeiro,'pdd_pendente',pdd_pendente)
 WHERE id=(resultado->>'id')::uuid AND fundo_id=j.fundo_id;
 UPDATE private.vortx_estoque_processamentos SET estado=CASE WHEN financeiro THEN 'PERSISTIDO' ELSE 'REVISAO' END,
  importacao_id=(resultado->>'id')::uuid,lease=NULL,lease_ate=NULL,erro=NULL,atualizada_em=clock_timestamp()
 WHERE id=j.id;
 DELETE FROM private.vortx_estoque_blocos WHERE processamento_id=j.id;
 PERFORM private.financeiro_auditar('VORTX_CALLBACK_ESTOQUE_PROCESSADO',(resultado->>'id')::uuid,j.fundo_id,
  (p_payload->>'correlation_id')::uuid,jsonb_build_object('processamento_id',j.id,
   'ativo_evento_id',j.ativo_evento_id,'parcela_evento_id',j.parcela_evento_id,'reconciliado',reconciliado,'financeiro_conferido',financeiro,'pdd_pendente',pdd_pendente,
   'politica_conferencia_persistencia','VORTX_PDD_ADVISORY_V1'));
 RETURN resultado||jsonb_build_object('reconciliado',reconciliado,
  'reconciliadoFinanceiro',financeiro,'pddPendente',pdd_pendente);
END;
$$;

CREATE OR REPLACE FUNCTION private.vortx_central_bases_historico(
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
    'pddPendente',COALESCE((i.metadados->>'pdd_pendente')::boolean,false),
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

-- Reclassify only completed, unpublished Vortx jobs whose ONLY discrepancy is PDD.
-- Keep native values, full reconciliado=false, manifests, callbacks and processing timestamps.
-- A new audit event records the decision; prior historical audit events remain untouched.
DO $$
DECLARE r record; momento timestamptz:=clock_timestamp();
BEGIN
 FOR r IN
  SELECT j.id,j.fundo_id,j.importacao_id,j.estado,j.atualizada_em
  FROM private.vortx_estoque_processamentos j
  JOIN public.importacoes_financeiras i ON i.id=j.importacao_id AND i.fundo_id=j.fundo_id
  WHERE j.estado='REVISAO' AND i.provedor='VORTX' AND i.tipo_base='ESTOQUE'
   AND i.status='VALIDA' AND i.publicada_em IS NULL
   AND private.vortx_estoque_reconciliado_financeiro(i.id)
   AND NOT private.vortx_estoque_reconciliado(i.id)
  ORDER BY j.id FOR UPDATE OF j,i
 LOOP
  UPDATE public.importacoes_financeiras SET metadados=metadados||jsonb_build_object(
   'politica_conferencia_persistencia','VORTX_PDD_ADVISORY_V1',
   'financeiro_conferido',true,'pdd_pendente',true,'pdd_reclassificado_em',momento)
  WHERE id=r.importacao_id AND fundo_id=r.fundo_id;
  UPDATE private.vortx_estoque_processamentos SET estado='PERSISTIDO' WHERE id=r.id;
  PERFORM private.financeiro_auditar('VORTX_PDD_CONFERENCIA_ADIADA',r.importacao_id,r.fundo_id,
   pg_catalog.gen_random_uuid(),jsonb_build_object('processamento_id',r.id,
    'estado_anterior',r.estado,'estado_novo','PERSISTIDO',
    'processado_em_original',r.atualizada_em,'reclassificado_em',momento,
    'reconciliado',false,'pdd_pendente',true,'publicado',false,
    'politica_conferencia_persistencia','VORTX_PDD_ADVISORY_V1'));
 END LOOP;
END;
$$;

COMMIT;
