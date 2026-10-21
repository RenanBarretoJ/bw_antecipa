-- Operational report access is separate from callback/credential administration.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION private.vortx_relatorio_operador(p_fundo_id uuid,p_mutar boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_fundo_id IS NOT NULL AND (SELECT auth.uid()) IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.usuario_fundos u ON u.usuario_id=p.id
  JOIN public.fundos f ON f.id=u.fundo_id AND f.ativo
  WHERE p.id=(SELECT auth.uid()) AND p.status::text='ativo' AND u.fundo_id=p_fundo_id AND u.status='ativo'
  AND ((SELECT private.usuario_e_super_admin()) OR
   ((p.role::text='gestor' OR EXISTS(SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=p.id AND up.papel::text='gestor' AND up.ativo))
    AND (NOT p_mutar OR lower(u.perfil_no_fundo::text) IN ('gestor','administrador')))))
 AND EXISTS(SELECT 1 FROM public.obter_sessao_mfa_atual() m WHERE m.status='valid')
 AND (SELECT auth.jwt()->>'aal')='aal2';
$$;
REVOKE ALL ON FUNCTION private.vortx_relatorio_operador(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_operador(uuid,boolean) TO authenticated;
-- Platform login MFA remains mandatory; report requests no longer consume a sensitive-action TOTP/nonce.
ALTER POLICY vortx_relatorio_leitura_administrativa ON public.vortx_relatorio_solicitacoes
 USING(private.vortx_relatorio_operador(fundo_id,false));

ALTER TABLE public.vortx_relatorio_solicitacoes
 ADD COLUMN origem text NOT NULL DEFAULT 'MANUAL' CHECK(origem IN ('MANUAL','CRON')),
 ADD COLUMN data_operacional date,
 ALTER COLUMN solicitada_por DROP NOT NULL,
 ALTER COLUMN session_id DROP NOT NULL,
 ADD CONSTRAINT vortx_relatorio_ator_origem CHECK(
  (origem='MANUAL' AND solicitada_por IS NOT NULL AND session_id IS NOT NULL AND data_operacional IS NULL)
  OR (origem='CRON' AND solicitada_por IS NULL AND session_id IS NULL AND data_operacional IS NOT NULL));
GRANT SELECT(origem,data_operacional) ON public.vortx_relatorio_solicitacoes TO authenticated;
ALTER TABLE private.vortx_estoque_processamentos ADD COLUMN download_concluido_em timestamptz;

CREATE FUNCTION private.vortx_relatorio_reservar_operacional(
 p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,
 p_referencia date,p_extensao integer,p_lease_hash text,p_anterior uuid,p_sistema boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_versao public.integracao_fundo_versoes%ROWTYPE;
 v_row public.vortx_relatorio_solicitacoes%ROWTYPE;
 v_anterior public.vortx_relatorio_solicitacoes%ROWTYPE;
 v_carteira text; v_capability text; v_pedido jsonb; v_hash text;
 v_criada boolean:=false; v_revisao integer:=1;
 v_hoje date:=timezone('America/Sao_Paulo',clock_timestamp())::date;
BEGIN
 IF p_sistema THEN
  PERFORM private.vortx_callback_exigir_worker();
  IF p_anterior IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Rotina nao cria revisoes automaticas.'; END IF;
 ELSIF private.vortx_relatorio_operador(p_fundo_id,true) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Gestor com vinculo operacional exigido.';
 END IF;
 IF p_tipo IS NULL OR p_tipo NOT IN ('Inclusao','Exclusao','PosicaoAtivo','PosicaoParcela')
  OR p_inicio IS NULL OR p_fim IS NULL OR p_referencia IS NULL OR p_extensao IS NULL
  OR p_extensao NOT IN (1,2) OR p_fim<=p_inicio
  OR greatest(p_inicio,p_fim,p_referencia)>v_hoje
  OR p_lease_hash IS NULL OR p_lease_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Parametros de relatorio invalidos.';
 END IF;
 SELECT v.* INTO v_versao FROM public.integracao_fundo_versoes v
  JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
  JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
  WHERE v.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.status='ativa'
   AND v.status='publicada' AND v.vigente_ate IS NULL AND v.adapter_key='vortx_vrs';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Versao Vortx publicada deste Fundo nao encontrada.'; END IF;
 v_carteira:=trim(v_versao.configuracao_nao_sensivel->>'codigo_carteira');
 IF v_carteira IS NULL OR v_carteira !~ '^[A-Za-z0-9._-]{1,100}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Codigo de carteira VRS nao configurado.';
 END IF;
 v_capability:=CASE p_tipo WHEN 'Inclusao' THEN 'AQUISICOES' WHEN 'Exclusao' THEN 'LIQUIDACOES' ELSE 'ESTOQUE' END;
 IF NOT EXISTS(SELECT 1 FROM public.integracao_fundo_versao_capacidades c
  WHERE c.integracao_fundo_versao_id=v_versao.id AND c.fundo_id=p_fundo_id
   AND c.ambiente=v_versao.ambiente AND c.capability=v_capability
   AND c.disponivel_desde<=clock_timestamp() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>clock_timestamp())) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Relatorio nao habilitado nesta versao da integracao.';
 END IF;
 v_pedido:=jsonb_build_object('codigoCarteira',v_carteira,'dataInicio',to_char(p_inicio,'YYYY-MM-DD'),
  'dataFim',to_char(p_fim,'YYYY-MM-DD'),'dataReferencia',to_char(p_referencia,'YYYY-MM-DD'),
  'tipoRelatorio',p_tipo,'extensaoArquivo',p_extensao);
 v_hash:=encode(pg_catalog.sha256(convert_to(v_pedido::text,'UTF8')),'hex');
 -- Normal submission and explicit repetition serialize on the same immutable identity.
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-report:'||p_fundo_id::text||':'||v_versao.id::text||':'||v_versao.ambiente||':'||v_hash,0));
 IF p_anterior IS NOT NULL THEN
  SELECT * INTO v_anterior FROM public.vortx_relatorio_solicitacoes WHERE id=p_anterior FOR UPDATE;
  IF NOT FOUND OR v_anterior.fundo_id<>p_fundo_id OR v_anterior.integracao_versao_id<>v_versao.id
   OR v_anterior.ambiente<>v_versao.ambiente OR v_anterior.hash_pedido<>v_hash OR v_anterior.pedido IS DISTINCT FROM v_pedido THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pedido anterior nao corresponde ao contexto autorizado.';
  END IF;
  SELECT * INTO v_row FROM public.vortx_relatorio_solicitacoes WHERE solicitacao_anterior_id=p_anterior;
  IF NOT FOUND AND v_anterior.estado IN ('registrada','enviando') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirme a conclusao do envio anterior antes de solicitar novamente.';
  END IF;
  v_revisao:=v_anterior.revisao+1;
 ELSE
  SELECT * INTO v_row FROM public.vortx_relatorio_solicitacoes
   WHERE fundo_id=p_fundo_id AND integracao_versao_id=v_versao.id AND ambiente=v_versao.ambiente AND hash_pedido=v_hash
   ORDER BY revisao DESC LIMIT 1;
 END IF;
 IF v_row.id IS NOT NULL AND v_row.pedido IS DISTINCT FROM v_pedido THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflito na identidade da solicitacao.';
 END IF;
 IF v_row.id IS NULL THEN
  INSERT INTO public.vortx_relatorio_solicitacoes(fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,solicitada_por,session_id,lease_hash,revisao,solicitacao_anterior_id,origem,data_operacional)
   VALUES(p_fundo_id,v_versao.id,v_versao.ambiente,v_pedido,v_hash,CASE WHEN p_sistema THEN NULL ELSE auth.uid() END,CASE WHEN p_sistema THEN NULL ELSE (auth.jwt()->>'session_id')::uuid END,p_lease_hash,v_revisao,p_anterior,CASE WHEN p_sistema THEN 'CRON' ELSE 'MANUAL' END,CASE WHEN p_sistema THEN v_hoje END)
   RETURNING * INTO v_row;
  v_criada:=true;
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
   VALUES('CREDENCIAL_USADA',CASE WHEN p_sistema THEN NULL ELSE auth.uid() END,CASE WHEN p_sistema THEN 'cron' ELSE 'usuario' END,'vortx_relatorios','info','vortx_relatorio_solicitacoes',v_row.id,
    jsonb_build_object('fundo_id',p_fundo_id,'etapa',CASE WHEN p_sistema THEN 'ROTINA_REGISTRADA' WHEN p_anterior IS NULL THEN 'RESERVADA' ELSE 'RESSOLICITADA' END,
     'tipo_relatorio',p_tipo,'hash_pedido',v_hash,'revisao',v_revisao,'solicitacao_anterior_id',p_anterior,
     'estado_anterior',v_anterior.estado));
 END IF;
 RETURN jsonb_build_object('criada',v_criada,'solicitacao',to_jsonb(v_row)-'lease_hash'-'session_id');
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_relatorio_reservar_operacional(uuid,uuid,text,date,date,date,integer,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_reservar_operacional(uuid,uuid,text,date,date,date,integer,text,uuid,boolean) TO authenticated,service_role;
CREATE FUNCTION private.vortx_relatorio_transicionar_operacional(p_id uuid,p_lease text,p_estado text,p_protocolo uuid,p_http integer,p_sistema boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.vortx_relatorio_solicitacoes%rowtype;
BEGIN
  SELECT * INTO v_row FROM public.vortx_relatorio_solicitacoes s WHERE s.id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pedido indisponivel.'; END IF;
  IF p_sistema THEN
    PERFORM private.vortx_callback_exigir_worker();
    IF v_row.origem<>'CRON' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pedido nao pertence a rotina.'; END IF;
  ELSIF private.vortx_relatorio_operador(v_row.fundo_id,true) IS NOT TRUE
    OR v_row.origem<>'MANUAL' OR v_row.solicitada_por IS DISTINCT FROM auth.uid()
    OR v_row.session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pedido indisponivel para esta sessao.';
  END IF;
  IF p_lease IS NULL OR length(p_lease)<>64
    OR v_row.lease_hash IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(p_lease,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Lease do pedido indisponivel.';
  END IF;
  IF p_estado IS NULL OR NOT ((v_row.estado='registrada' AND p_estado IN ('enviando','falha_autenticacao'))
    OR (v_row.estado='enviando' AND p_estado IN ('aceita','recusada','indeterminada'))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Transicao de solicitacao nao permitida.';
  END IF;
  IF p_estado='enviando' AND clock_timestamp()>v_row.criada_em+interval '2 minutes' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Autorizacao de envio expirada; nao reenviar automaticamente.';
  END IF;
  -- Revalidar apos o login externo: desativacao ou troca de contexto impede o POST.
  IF p_estado='enviando' AND NOT EXISTS (
    SELECT 1 FROM public.integracao_fundo_versoes v JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
      JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
      JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
    WHERE v.id=v_row.integracao_versao_id AND i.fundo_id=v_row.fundo_id AND i.status='ativa'
      AND v.status='publicada' AND v.vigente_ate IS NULL AND v.adapter_key='vortx_vrs' AND v.ambiente=v_row.ambiente
      AND trim(v.configuracao_nao_sensivel->>'codigo_carteira')=v_row.pedido->>'codigoCarteira'
      AND c.fundo_id=v_row.fundo_id AND c.ambiente=v_row.ambiente
      AND c.capability=CASE v_row.pedido->>'tipoRelatorio' WHEN 'Inclusao' THEN 'AQUISICOES' WHEN 'Exclusao' THEN 'LIQUIDACOES' ELSE 'ESTOQUE' END
      AND c.disponivel_desde<=clock_timestamp() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>clock_timestamp())
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='A integracao mudou apos a reserva; envio nao autorizado.';
  END IF;
  UPDATE public.vortx_relatorio_solicitacoes SET estado=p_estado,protocolo_externo=p_protocolo,codigo_http=p_http,
    envio_iniciado_em=CASE WHEN p_estado='enviando' THEN clock_timestamp() ELSE envio_iniciado_em END,
    concluida_em=CASE WHEN p_estado IN ('aceita','recusada','indeterminada','falha_autenticacao') THEN clock_timestamp() ELSE NULL END
    WHERE id=p_id RETURNING * INTO v_row;
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
    VALUES ('CREDENCIAL_USADA',CASE WHEN p_sistema THEN NULL ELSE auth.uid() END,CASE WHEN p_sistema THEN 'cron' ELSE 'usuario' END,'vortx_relatorios','info','vortx_relatorio_solicitacoes',v_row.id,
      jsonb_build_object('fundo_id',v_row.fundo_id,'estado',p_estado,'codigo_http',p_http));
  RETURN to_jsonb(v_row)-'lease_hash'-'session_id';
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_relatorio_transicionar_operacional(uuid,text,text,uuid,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_transicionar_operacional(uuid,text,text,uuid,integer,boolean) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.vortx_relatorio_reservar_revisao(
 p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,p_referencia date,
 p_extensao integer,p_nonce_hash text,p_lease_hash text,p_anterior uuid
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_relatorio_reservar_operacional(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,p_extensao,p_lease_hash,p_anterior,false);
$$;
CREATE OR REPLACE FUNCTION private.vortx_relatorio_transicionar(p_id uuid,p_lease text,p_estado text,p_protocolo uuid,p_http integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_relatorio_transicionar_operacional(p_id,p_lease,p_estado,p_protocolo,p_http,false);
$$;

-- Machine wrappers follow the existing callback worker pattern: private schema stays
-- inaccessible to the service role; the core verifies its signed JWT role explicitly.
CREATE FUNCTION public.vortx_rotina_reservar(p_fundo_id uuid,p_versao_id uuid,p_tipo text,
 p_inicio date,p_fim date,p_referencia date,p_lease_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.vortx_relatorio_reservar_operacional(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,2,p_lease_hash,NULL,true);
$$;
CREATE FUNCTION public.vortx_rotina_transicionar(p_id uuid,p_lease text,p_estado text,p_protocolo uuid DEFAULT NULL,p_http integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.vortx_relatorio_transicionar_operacional(p_id,p_lease,p_estado,p_protocolo,p_http,true);
$$;
REVOKE ALL ON FUNCTION public.vortx_rotina_reservar(uuid,uuid,text,date,date,date,text),
 public.vortx_rotina_transicionar(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_rotina_reservar(uuid,uuid,text,date,date,date,text),
 public.vortx_rotina_transicionar(uuid,text,text,uuid,integer) TO service_role;
CREATE FUNCTION public.vortx_solicitar_relatorio(p_fundo_id uuid,p_versao_id uuid,p_tipo text,
 p_inicio date,p_fim date,p_referencia date,p_extensao integer,p_lease_hash text,p_anterior uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_relatorio_reservar_operacional(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,p_extensao,p_lease_hash,p_anterior,false);
$$;
REVOKE ALL ON FUNCTION public.vortx_solicitar_relatorio(uuid,uuid,text,date,date,date,integer,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_solicitar_relatorio(uuid,uuid,text,date,date,date,integer,text,uuid) TO authenticated;

-- Minimal context only: no credential references, ciphertext or callback secrets.
CREATE FUNCTION private.vortx_contexto_operacional(p_fundo_id uuid,p_sistema boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_sistema THEN PERFORM private.vortx_callback_exigir_worker();
 ELSIF private.vortx_relatorio_operador(p_fundo_id,false) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso ao Fundo exigido.';
 END IF;
 RETURN (SELECT jsonb_build_object('fundo',jsonb_build_object('id',f.id,'nome',f.nome,'cnpj',f.cnpj),
  'podeSolicitar',CASE WHEN p_sistema THEN true ELSE private.vortx_relatorio_operador(f.id,true) END,
  'versoes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'versao',v.versao,'ambiente',v.ambiente,
   'carteira',trim(v.configuracao_nao_sensivel->>'codigo_carteira'),
   'capabilities',COALESCE((SELECT jsonb_agg(c.capability) FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id=v.id AND c.fundo_id=f.id AND c.ambiente=v.ambiente
     AND c.disponivel_desde<=now() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>now())),'[]'::jsonb)))
   FROM public.integracoes_fundo i JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id=i.id
   WHERE i.fundo_id=f.id AND i.provider_key='VORTX' AND i.status='ativa'
    AND v.status='publicada' AND v.vigente_ate IS NULL AND v.adapter_key='vortx_vrs'
    AND trim(v.configuracao_nao_sensivel->>'codigo_carteira') ~ '^[A-Za-z0-9._-]{1,100}$'),'[]'::jsonb))
  FROM public.fundos f WHERE f.id=p_fundo_id AND f.ativo);
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_contexto_operacional(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_contexto_operacional(uuid,boolean) TO authenticated,service_role;
CREATE FUNCTION public.vortx_contexto_relatorios(p_fundo_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.vortx_contexto_operacional(p_fundo_id,false); $$;
CREATE FUNCTION public.vortx_contexto_rotina(p_fundo_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.vortx_contexto_operacional(p_fundo_id,true); $$;
REVOKE ALL ON FUNCTION public.vortx_contexto_relatorios(uuid),public.vortx_contexto_rotina(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_contexto_relatorios(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_contexto_rotina(uuid) TO service_role;

CREATE FUNCTION public.vortx_marcar_download_estoque(p_id uuid,p_lease uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 UPDATE private.vortx_estoque_processamentos SET download_concluido_em=COALESCE(download_concluido_em,clock_timestamp())
 WHERE id=p_id AND estado='PROCESSANDO' AND lease=p_lease AND lease_ate>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Lease do processamento indisponivel.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_marcar_download_estoque(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_marcar_download_estoque(uuid,uuid) TO service_role;

-- A bounded, authorized projection of private processing; no raw event or signed URL reaches the operator.
CREATE FUNCTION private.vortx_historico_operacional(p_fundo_id uuid,p_pagina integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF private.vortx_relatorio_operador(p_fundo_id,false) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso ao Fundo exigido.';
 END IF;
 RETURN jsonb_build_object('total',(SELECT count(*) FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id),
 'solicitacoes',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.criada_em DESC,q.id DESC) FROM (
  SELECT s.id,s.fundo_id,s.integracao_versao_id,s.ambiente,s.pedido,s.estado,s.protocolo_externo,s.codigo_http,
   s.criada_em,s.envio_iniciado_em,s.concluida_em,s.revisao,s.solicitacao_anterior_id,s.origem,s.data_operacional,
   jsonb_build_object('recebidoEm',e.recebido_em,'arquivoStatus',e.status_relatorio,
    'processamento',j.estado,'downloadEm',j.download_concluido_em,
    'processadoEm',CASE WHEN j.estado IN ('PERSISTIDO','REVISAO') THEN j.atualizada_em END,
    'erro',j.erro,'publicacao',i.status,'publicadoEm',i.publicada_em,
    'ativos',(SELECT count(*) FROM public.vortx_posicao_ativos a WHERE a.importacao_id=j.importacao_id AND a.fundo_id=p_fundo_id),
    'parcelas',(SELECT count(*) FROM public.vortx_posicao_parcelas p WHERE p.importacao_id=j.importacao_id AND p.fundo_id=p_fundo_id),
    'duplicada',j.importacao_id IS NOT NULL AND ((j.manifestos->-1->'payload'->>'id') IS DISTINCT FROM j.importacao_id::text)) acompanhamento
  FROM (SELECT * FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id
    ORDER BY criada_em DESC,id DESC LIMIT 20 OFFSET(greatest(1,least(10000,COALESCE(p_pagina,1)))-1)*20) s
  LEFT JOIN LATERAL(SELECT ev.id,ev.recebido_em,ev.status_relatorio FROM public.vortx_relatorio_eventos ev
   WHERE ev.solicitacao_id=s.id AND ev.fundo_id=p_fundo_id AND ev.correlacao='CORRELACIONADO'
   ORDER BY ev.recebido_em DESC,ev.id DESC LIMIT 1) e ON true
  LEFT JOIN LATERAL(SELECT job.* FROM private.vortx_estoque_processamentos job
   WHERE job.fundo_id=p_fundo_id AND EXISTS(SELECT 1 FROM public.vortx_relatorio_eventos je
    WHERE je.solicitacao_id=s.id AND je.fundo_id=p_fundo_id AND je.id IN(job.ativo_evento_id,job.parcela_evento_id))
   ORDER BY job.criada_em DESC,job.id DESC LIMIT 1) j ON true
  LEFT JOIN public.importacoes_financeiras i ON i.id=j.importacao_id AND i.fundo_id=p_fundo_id
 ) q),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_historico_operacional(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_historico_operacional(uuid,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_listar_relatorios_vortx(p_fundo_id uuid,p_pagina integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_historico_operacional(p_fundo_id,p_pagina);
$$;
COMMIT;
