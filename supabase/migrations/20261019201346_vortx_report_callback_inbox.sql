-- Durable receipt only. No download, remittance, import or financial publication.
BEGIN;

CREATE TABLE private.vortx_callback_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
 integracao_id uuid NOT NULL REFERENCES public.integracoes_fundo(id) ON DELETE RESTRICT,
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),
 codigo_carteira text NOT NULL UNIQUE CHECK(codigo_carteira ~ '^[A-Za-z0-9._-]{1,100}$'),
 segredo_hash text NOT NULL UNIQUE CHECK(segredo_hash ~ '^[0-9a-f]{64}$'),
 revisao integer NOT NULL DEFAULT 1 CHECK(revisao>0),
 ativo boolean NOT NULL DEFAULT true,
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 rotacionada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 revogada_em timestamptz
);
CREATE INDEX vortx_callback_endpoint_fundo_idx ON private.vortx_callback_endpoints(fundo_id);
CREATE INDEX vortx_callback_endpoint_integracao_idx ON private.vortx_callback_endpoints(integracao_id);
ALTER TABLE private.vortx_callback_endpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_callback_endpoints FROM PUBLIC,anon,authenticated,service_role;

-- Fixed global key plus one key per configured endpoint: untrusted IDs do not grow this table.
CREATE TABLE private.vortx_callback_limites (
 chave text PRIMARY KEY,
 inicio timestamptz NOT NULL,
 quantidade integer NOT NULL CHECK(quantidade>0)
);
ALTER TABLE private.vortx_callback_limites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_callback_limites FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.vortx_relatorio_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES private.vortx_callback_endpoints(id) ON DELETE RESTRICT,
 fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),
 solicitacao_id uuid REFERENCES public.vortx_relatorio_solicitacoes(id) ON DELETE RESTRICT,
 protocolo_externo uuid NOT NULL,
 tipo_relatorio text NOT NULL CHECK(tipo_relatorio IN ('Inclusao','Exclusao','PosicaoAtivo','PosicaoParcela')),
 status_relatorio text NOT NULL CHECK(status_relatorio IN ('Em geração','Disponível','Expirado')),
 data_referencia date NOT NULL,
 data_inicio date NOT NULL,
 data_fim date NOT NULL CHECK(data_fim>=data_inicio),
 data_expiracao timestamptz,
 correlacao text NOT NULL DEFAULT 'PENDENTE' CHECK(correlacao IN ('PENDENTE','CORRELACIONADO','CONFLITANTE')),
 metadados jsonb NOT NULL CHECK(jsonb_typeof(metadados)='object'),
 hash_evento text NOT NULL CHECK(hash_evento ~ '^[0-9a-f]{64}$'),
 payload_criptografado text NOT NULL CHECK(length(payload_criptografado) BETWEEN 32 AND 40000 AND payload_criptografado LIKE 'v1:%'),
 chave_versao text NOT NULL CHECK(length(chave_versao) BETWEEN 1 AND 80),
 recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT vortx_callback_evento_unico UNIQUE(endpoint_id,hash_evento),
 CONSTRAINT vortx_callback_vinculo_check CHECK((correlacao='CORRELACIONADO')=(solicitacao_id IS NOT NULL))
);
CREATE INDEX vortx_callback_evento_protocolo_idx ON public.vortx_relatorio_eventos(ambiente,protocolo_externo) WHERE correlacao='PENDENTE';
CREATE INDEX vortx_callback_evento_fundo_idx ON public.vortx_relatorio_eventos(fundo_id,recebido_em DESC,id DESC);
CREATE INDEX vortx_callback_evento_solicitacao_idx ON public.vortx_relatorio_eventos(solicitacao_id) WHERE solicitacao_id IS NOT NULL;
ALTER TABLE public.vortx_relatorio_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vortx_relatorio_eventos FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT(id,fundo_id,ambiente,solicitacao_id,protocolo_externo,tipo_relatorio,status_relatorio,
 data_referencia,data_inicio,data_fim,data_expiracao,correlacao,recebido_em)
 ON public.vortx_relatorio_eventos TO authenticated;
GRANT SELECT ON public.vortx_relatorio_eventos TO service_role;
CREATE POLICY vortx_callback_evento_admin_leitura ON public.vortx_relatorio_eventos FOR SELECT TO authenticated
 USING(private.vortx_relatorio_pode_acessar(fundo_id));
CREATE POLICY vortx_callback_evento_worker_leitura ON public.vortx_relatorio_eventos FOR SELECT TO service_role USING(true);

CREATE FUNCTION private.vortx_callback_exigir_worker() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Callback restrito ao worker interno';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_exigir_worker() FROM PUBLIC,anon,authenticated,service_role;

-- Administrative server tooling only; no public operational action is introduced.
CREATE FUNCTION public.vortx_configurar_callback(p_fundo_id uuid,p_versao_id uuid,p_segredo_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.integracao_fundo_versoes%ROWTYPE; carteira text; integracao uuid; e private.vortx_callback_endpoints%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF p_segredo_hash IS NULL OR p_segredo_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Segredo de callback invalido';
 END IF;
 SELECT iv.* INTO v FROM public.integracao_fundo_versoes iv
 JOIN public.integracoes_fundo i ON i.id=iv.integracao_fundo_id
 JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 WHERE iv.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.status='ativa'
  AND i.provider_key='VORTX' AND iv.status='publicada' AND iv.adapter_key='vortx_vrs';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Integracao Vortx indisponivel'; END IF;
 integracao:=v.integracao_fundo_id;
 carteira:=trim(v.configuracao_nao_sensivel->>'codigo_carteira');
 IF carteira IS NULL OR carteira !~ '^[A-Za-z0-9._-]{1,100}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Carteira Vortx invalida';
 END IF;
 INSERT INTO private.vortx_callback_endpoints(fundo_id,integracao_id,ambiente,codigo_carteira,segredo_hash)
 VALUES(p_fundo_id,integracao,v.ambiente,carteira,p_segredo_hash)
 ON CONFLICT(codigo_carteira) DO UPDATE SET segredo_hash=excluded.segredo_hash,
  revisao=private.vortx_callback_endpoints.revisao+1,ativo=true,revogada_em=NULL,rotacionada_em=clock_timestamp()
 WHERE private.vortx_callback_endpoints.fundo_id=excluded.fundo_id
  AND private.vortx_callback_endpoints.ambiente=excluded.ambiente
  AND private.vortx_callback_endpoints.integracao_id=excluded.integracao_id
 RETURNING * INTO e;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Carteira ja vinculada a outro contexto de callback'; END IF;
 INSERT INTO public.seguranca_eventos(tipo_evento,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
 VALUES('VORTX_CALLBACK_CONFIGURADO','sistema','vortx_callback','info','vortx_callback_endpoints',e.id,
  jsonb_build_object('fundo_id',e.fundo_id,'ambiente',e.ambiente,'revisao',e.revisao));
 RETURN jsonb_build_object('id',e.id,'revisao',e.revisao);
END;
$$;

CREATE FUNCTION public.vortx_revogar_callback(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 UPDATE private.vortx_callback_endpoints SET ativo=false,revogada_em=clock_timestamp(),revisao=revisao+1 WHERE id=p_id;
 INSERT INTO public.seguranca_eventos(tipo_evento,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
 VALUES('VORTX_CALLBACK_REVOGADO','sistema','vortx_callback','info','vortx_callback_endpoints',p_id,'{}');
END;
$$;

CREATE FUNCTION private.vortx_callback_limitar(p_chave text,p_limite integer) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer; agora timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO private.vortx_callback_limites(chave,inicio,quantidade) VALUES(p_chave,agora,1)
 ON CONFLICT(chave) DO UPDATE SET
  quantidade=CASE WHEN private.vortx_callback_limites.inicio<=agora-interval '1 minute' THEN 1 ELSE private.vortx_callback_limites.quantidade+1 END,
  inicio=CASE WHEN private.vortx_callback_limites.inicio<=agora-interval '1 minute' THEN agora ELSE private.vortx_callback_limites.inicio END
 RETURNING quantidade INTO n;
 RETURN n<=p_limite;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_limitar(text,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.vortx_autorizar_callback(p_id uuid,p_segredo_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.vortx_callback_endpoints%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF NOT private.vortx_callback_limitar('GLOBAL',600) THEN RETURN jsonb_build_object('status','RATE_LIMITED'); END IF;
 SELECT * INTO e FROM private.vortx_callback_endpoints WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','UNAUTHORIZED'); END IF;
 IF NOT private.vortx_callback_limitar(e.id::text,120) THEN RETURN jsonb_build_object('status','RATE_LIMITED'); END IF;
 IF NOT e.ativo OR e.segredo_hash IS DISTINCT FROM p_segredo_hash
  OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=e.fundo_id AND ativo)
  OR NOT EXISTS(SELECT 1 FROM public.integracoes_fundo WHERE id=e.integracao_id AND fundo_id=e.fundo_id AND status='ativa' AND provider_key='VORTX') THEN
  RETURN jsonb_build_object('status','UNAUTHORIZED');
 END IF;
 RETURN jsonb_build_object('status','AUTHORIZED','endpointId',e.id,'fundoId',e.fundo_id,
  'ambiente',e.ambiente,'codigoCarteira',e.codigo_carteira,'revisao',e.revisao);
END;
$$;

CREATE FUNCTION private.vortx_callback_correlacionar(p_id uuid) RETURNS void
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
  AND s.pedido->>'dataReferencia'=e.data_referencia::text
  AND s.pedido->>'dataInicio'=e.data_inicio::text AND s.pedido->>'dataFim'=e.data_fim::text THEN
  UPDATE public.vortx_relatorio_eventos SET solicitacao_id=s.id,correlacao='CORRELACIONADO' WHERE id=e.id;
 ELSE
  UPDATE public.vortx_relatorio_eventos SET correlacao='CONFLITANTE' WHERE id=e.id;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_correlacionar(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.vortx_callback_proteger_evento() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Evento de callback imutavel'; END IF;
 IF (to_jsonb(NEW)-'solicitacao_id'-'correlacao') IS DISTINCT FROM (to_jsonb(OLD)-'solicitacao_id'-'correlacao')
  OR OLD.correlacao<>'PENDENTE' OR NEW.correlacao NOT IN ('CORRELACIONADO','CONFLITANTE') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Evento de callback imutavel';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_proteger_evento() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER vortx_callback_evento_imutavel BEFORE UPDATE OR DELETE ON public.vortx_relatorio_eventos
 FOR EACH ROW EXECUTE FUNCTION private.vortx_callback_proteger_evento();

CREATE FUNCTION public.vortx_receber_callback(p_id uuid,p_segredo_hash text,p_revisao integer,
 p_metadados jsonb,p_hash_evento text,p_ciphertext text,p_chave_versao text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.vortx_callback_endpoints%ROWTYPE; evento public.vortx_relatorio_eventos%ROWTYPE; hash text; criada boolean;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO e FROM private.vortx_callback_endpoints WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT e.ativo OR e.segredo_hash IS DISTINCT FROM p_segredo_hash OR e.revisao IS DISTINCT FROM p_revisao
  OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=e.fundo_id AND ativo)
  OR NOT EXISTS(SELECT 1 FROM public.integracoes_fundo WHERE id=e.integracao_id AND fundo_id=e.fundo_id AND status='ativa' AND provider_key='VORTX') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Callback nao autorizado';
 END IF;
 IF jsonb_typeof(p_metadados) IS DISTINCT FROM 'object'
  OR p_metadados->>'idCarteira' IS DISTINCT FROM e.codigo_carteira
  OR coalesce(p_metadados->>'tipoRelatorio','') NOT IN ('Inclusao','Exclusao','PosicaoAtivo','PosicaoParcela')
  OR coalesce(p_metadados->>'statusRelatorio','') NOT IN ('Em geração','Disponível','Expirado')
  OR (SELECT count(*) FROM jsonb_object_keys(p_metadados))<>9
  OR (p_metadados-ARRAY['idRelatorio','idCarteira','tipoRelatorio','statusRelatorio','dataReferencia','dataInicio','dataFim','dataExpiracao','urlHash'])<>'{}'::jsonb
  OR p_metadados->>'idRelatorio' IS NULL OR p_metadados->>'dataReferencia' IS NULL
  OR p_metadados->>'dataInicio' IS NULL OR p_metadados->>'dataFim' IS NULL
  OR (p_metadados->>'urlHash' IS NOT NULL AND p_metadados->>'urlHash' !~ '^[0-9a-f]{64}$')
  OR (p_metadados->>'statusRelatorio'='Disponível' AND (p_metadados->>'urlHash' IS NULL OR p_metadados->>'dataExpiracao' IS NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Metadados do callback invalidos';
 END IF;
 hash:=encode(sha256(convert_to(concat_ws('|','VORTX_RELATORIO_CALLBACK_V1',e.id::text,
  p_metadados->>'idRelatorio',p_metadados->>'idCarteira',p_metadados->>'tipoRelatorio',p_metadados->>'statusRelatorio',
  p_metadados->>'dataReferencia',p_metadados->>'dataInicio',p_metadados->>'dataFim',
  coalesce(p_metadados->>'dataExpiracao',''),coalesce(p_metadados->>'urlHash','')),'UTF8')),'hex');
 IF hash IS DISTINCT FROM p_hash_evento THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Identidade do evento incompativel'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-callback-protocolo:'||e.ambiente||':'||(p_metadados->>'idRelatorio'),0));
 INSERT INTO public.vortx_relatorio_eventos(endpoint_id,fundo_id,ambiente,protocolo_externo,tipo_relatorio,status_relatorio,
  data_referencia,data_inicio,data_fim,data_expiracao,metadados,hash_evento,payload_criptografado,chave_versao)
 VALUES(e.id,e.fundo_id,e.ambiente,(p_metadados->>'idRelatorio')::uuid,p_metadados->>'tipoRelatorio',p_metadados->>'statusRelatorio',
  (p_metadados->>'dataReferencia')::date,(p_metadados->>'dataInicio')::date,(p_metadados->>'dataFim')::date,
  (p_metadados->>'dataExpiracao')::timestamptz,p_metadados,hash,p_ciphertext,p_chave_versao)
 ON CONFLICT(endpoint_id,hash_evento) DO NOTHING RETURNING * INTO evento;
 criada:=FOUND;
 IF NOT criada THEN
  SELECT * INTO STRICT evento FROM public.vortx_relatorio_eventos WHERE endpoint_id=e.id AND hash_evento=hash;
  IF evento.metadados IS DISTINCT FROM p_metadados THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conflito na identidade do evento'; END IF;
 END IF;
 PERFORM private.vortx_callback_correlacionar(evento.id);
 IF criada THEN
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
  VALUES('VORTX_CALLBACK_RECEBIDO','integracao','vortx_callback','info','vortx_relatorio_eventos',evento.id,
   jsonb_build_object('fundo_id',e.fundo_id,'ambiente',e.ambiente,'tipo_relatorio',evento.tipo_relatorio));
 END IF;
 RETURN jsonb_build_object('recebido',true,'duplicado',NOT criada);
END;
$$;

CREATE FUNCTION private.vortx_callback_apos_protocolo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE evento uuid;
BEGIN
 IF NEW.protocolo_externo IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-callback-protocolo:'||NEW.ambiente||':'||NEW.protocolo_externo::text,0));
 FOR evento IN SELECT id FROM public.vortx_relatorio_eventos
  WHERE ambiente=NEW.ambiente AND protocolo_externo=NEW.protocolo_externo AND correlacao='PENDENTE' LOOP
  PERFORM private.vortx_callback_correlacionar(evento);
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_callback_apos_protocolo() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER vortx_callback_correlacao_apos_protocolo AFTER INSERT OR UPDATE OF protocolo_externo,estado
 ON public.vortx_relatorio_solicitacoes FOR EACH ROW EXECUTE FUNCTION private.vortx_callback_apos_protocolo();

REVOKE ALL ON FUNCTION public.vortx_configurar_callback(uuid,uuid,text),public.vortx_revogar_callback(uuid),
 public.vortx_autorizar_callback(uuid,text),public.vortx_receber_callback(uuid,text,integer,jsonb,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_configurar_callback(uuid,uuid,text),public.vortx_revogar_callback(uuid),
 public.vortx_autorizar_callback(uuid,text),public.vortx_receber_callback(uuid,text,integer,jsonb,text,text,text)
 TO service_role;
COMMENT ON TABLE public.vortx_relatorio_eventos IS 'Inbox de callbacks Vortx. URLs somente em ciphertext; recebimento/correlacao nao representam download ou importacao. Sem publicacao automatica.';
COMMIT;
