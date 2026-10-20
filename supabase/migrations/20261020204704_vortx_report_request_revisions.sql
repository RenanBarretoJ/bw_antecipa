-- Explicit operator requests are new immutable generations, not automatic retries.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

ALTER TABLE public.vortx_relatorio_solicitacoes
 ADD COLUMN revisao integer NOT NULL DEFAULT 1 CHECK(revisao>0),
 ADD COLUMN solicitacao_anterior_id uuid REFERENCES public.vortx_relatorio_solicitacoes(id) ON DELETE RESTRICT,
 ADD CONSTRAINT vortx_relatorio_revisao_raiz CHECK((revisao=1)=(solicitacao_anterior_id IS NULL)),
 ADD CONSTRAINT vortx_relatorio_um_sucessor UNIQUE(solicitacao_anterior_id);
ALTER TABLE public.vortx_relatorio_solicitacoes DROP CONSTRAINT vortx_relatorio_pedido_unico;
ALTER TABLE public.vortx_relatorio_solicitacoes ADD CONSTRAINT vortx_relatorio_pedido_unico
 UNIQUE(fundo_id,ambiente,integracao_versao_id,hash_pedido,revisao);
GRANT SELECT(revisao,solicitacao_anterior_id) ON public.vortx_relatorio_solicitacoes TO authenticated;

-- Same canonical authorization, capability, session and transactional nonce boundary.
-- Definer remains private because API roles cannot write the underlying table.
CREATE FUNCTION private.vortx_relatorio_reservar_revisao(
 p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,
 p_referencia date,p_extensao integer,p_nonce_hash text,p_lease_hash text,p_anterior uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_versao public.integracao_fundo_versoes%ROWTYPE;
 v_row public.vortx_relatorio_solicitacoes%ROWTYPE;
 v_anterior public.vortx_relatorio_solicitacoes%ROWTYPE;
 v_carteira text; v_capability text; v_pedido jsonb; v_hash text;
 v_criada boolean:=false; v_revisao integer:=1;
 v_hoje date:=timezone('America/Sao_Paulo',clock_timestamp())::date;
BEGIN
 IF private.vortx_relatorio_pode_acessar(p_fundo_id) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso administrativo com MFA e vinculo ao Fundo exigido.';
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
  WHERE v.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.status='ativa'
   AND v.status='publicada' AND v.adapter_key='vortx_vrs';
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
 IF public.consumir_autorizacao_acao_sensivel('testar_conexao_vortx_vrs',p_nonce_hash) IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Autorizacao MFA expirada ou ja utilizada.';
 END IF;
 INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,dados)
  SELECT e,auth.uid(),'usuario','vortx_relatorios','info',
   jsonb_build_object('fundo_id',p_fundo_id,'action_type','testar_conexao_vortx_vrs','session_id',auth.jwt()->>'session_id')
  FROM unnest(ARRAY['MFA_ACAO_SENSIVEL_VALIDADA','AUTORIZACAO_SENSIVEL_CONSUMIDA']) e;
 IF v_row.id IS NULL THEN
  INSERT INTO public.vortx_relatorio_solicitacoes(fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,solicitada_por,session_id,lease_hash,revisao,solicitacao_anterior_id)
   VALUES(p_fundo_id,v_versao.id,v_versao.ambiente,v_pedido,v_hash,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_lease_hash,v_revisao,p_anterior)
   RETURNING * INTO v_row;
  v_criada:=true;
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
   VALUES('CREDENCIAL_USADA',auth.uid(),'usuario','vortx_relatorios','info','vortx_relatorio_solicitacoes',v_row.id,
    jsonb_build_object('fundo_id',p_fundo_id,'etapa',CASE WHEN p_anterior IS NULL THEN 'RESERVADA' ELSE 'RESSOLICITADA' END,
     'tipo_relatorio',p_tipo,'hash_pedido',v_hash,'revisao',v_revisao,'solicitacao_anterior_id',p_anterior,
     'estado_anterior',v_anterior.estado));
 END IF;
 RETURN jsonb_build_object('criada',v_criada,'solicitacao',to_jsonb(v_row)-'lease_hash'-'session_id');
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_relatorio_reservar_revisao(uuid,uuid,text,date,date,date,integer,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_reservar_revisao(uuid,uuid,text,date,date,date,integer,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.vortx_relatorio_reservar(
 p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,
 p_referencia date,p_extensao integer,p_nonce_hash text,p_lease_hash text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_relatorio_reservar_revisao(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,p_extensao,p_nonce_hash,p_lease_hash,NULL);
$$;
CREATE FUNCTION public.admin_ressolicitar_relatorio_vortx(
 p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,
 p_referencia date,p_extensao integer,p_nonce_hash text,p_lease_hash text,p_anterior uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_anterior IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Pedido anterior obrigatorio.'; END IF;
 RETURN private.vortx_relatorio_reservar_revisao(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,p_extensao,p_nonce_hash,p_lease_hash,p_anterior);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ressolicitar_relatorio_vortx(uuid,uuid,text,date,date,date,integer,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_ressolicitar_relatorio_vortx(uuid,uuid,text,date,date,date,integer,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_listar_relatorios_vortx(p_fundo_id uuid,p_pagina integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('total',(SELECT count(id) FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id),
  'solicitacoes',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.criada_em DESC,q.id DESC) FROM (
   SELECT id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,estado,protocolo_externo,codigo_http,solicitada_por,
    criada_em,envio_iniciado_em,concluida_em,revisao,solicitacao_anterior_id
   FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id
   ORDER BY criada_em DESC,id DESC LIMIT 20 OFFSET(greatest(1,least(10000,coalesce(p_pagina,1)))-1)*20
  ) q),'[]'::jsonb));
$$;
COMMIT;
