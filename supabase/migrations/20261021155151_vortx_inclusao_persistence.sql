-- Inclusion is a provider observation, not a new portal cession or evidence of disbursement.
BEGIN;
ALTER TABLE public.importacoes_financeiras DROP CONSTRAINT importacoes_vortx_escopo_check;
ALTER TABLE public.importacoes_financeiras ADD CONSTRAINT importacoes_vortx_escopo_check CHECK (
 provedor<>'VORTX' OR (tipo_base IN ('ESTOQUE','AQUISICOES')
 AND fonte_ambiente IS NOT NULL AND fonte_ambiente IN ('homologacao','producao')
 AND fonte_carteira IS NOT NULL AND length(fonte_carteira) BETWEEN 1 AND 120
 AND integracao_fundo_versao_id IS NOT NULL));

CREATE TABLE private.vortx_inclusao_processamentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 evento_id uuid NOT NULL UNIQUE REFERENCES public.vortx_relatorio_eventos(id),
 fundo_id uuid NOT NULL REFERENCES public.fundos(id),
 versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id),
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),
 codigo_carteira text NOT NULL, data_referencia date NOT NULL, data_inicio date NOT NULL, data_fim date NOT NULL,
 estado text NOT NULL DEFAULT 'PENDENTE' CHECK(estado IN ('PENDENTE','PROCESSANDO','PERSISTIDO','REVISAO','FALHA')),
 tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas BETWEEN 0 AND 3),
 lease uuid,lease_ate timestamptz,importacao_id uuid REFERENCES public.importacoes_financeiras(id),
 manifestos jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(manifestos)='array' AND jsonb_array_length(manifestos)<=3),
 download_concluido_em timestamptz,processado_em timestamptz,
 erro text CHECK(erro IN ('DOWNLOAD_FALHOU','CONTRATO_INVALIDO','PERSISTENCIA_INDETERMINADA')),
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(data_inicio<=data_fim),
 CHECK((estado='PROCESSANDO')=(lease IS NOT NULL AND lease_ate IS NOT NULL)),
 CHECK((estado IN ('PERSISTIDO','REVISAO'))=(importacao_id IS NOT NULL))
);
CREATE INDEX vortx_inclusao_pendente_idx ON private.vortx_inclusao_processamentos(fundo_id,criada_em) WHERE estado IN ('PENDENTE','PROCESSANDO');
CREATE INDEX vortx_inclusao_versao_idx ON private.vortx_inclusao_processamentos(versao_id);
CREATE INDEX vortx_inclusao_importacao_idx ON private.vortx_inclusao_processamentos(importacao_id);
CREATE TABLE private.vortx_inclusao_blocos (
 processamento_id uuid NOT NULL REFERENCES private.vortx_inclusao_processamentos(id),
 ordem integer NOT NULL CHECK(ordem BETWEEN 1 AND 100000),linhas jsonb NOT NULL,
 CHECK(jsonb_typeof(linhas)='array' AND jsonb_array_length(linhas) BETWEEN 1 AND 500 AND octet_length(linhas::text)<=2097152),
 PRIMARY KEY(processamento_id,ordem)
);
ALTER TABLE private.vortx_inclusao_processamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.vortx_inclusao_blocos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_inclusao_processamentos,private.vortx_inclusao_blocos FROM PUBLIC,anon,authenticated,service_role;

-- Same movement and same economics are shared even across overlapping report periods.
-- A changed observation is a new immutable version, never a silent overwrite.
CREATE TABLE public.vortx_inclusoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fundo_id uuid NOT NULL REFERENCES public.fundos(id),
 primeira_importacao_id uuid NOT NULL REFERENCES public.importacoes_financeiras(id),
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),codigo_carteira text NOT NULL,
 identidade_movimento text NOT NULL CHECK(identidade_movimento ~ '^[0-9a-f]{64}$'),
 hash_registro text NOT NULL CHECK(hash_registro ~ '^[0-9a-f]{64}$'),
 cedente_documento text NOT NULL CHECK(cedente_documento ~ '^([0-9]{11}|[0-9]{14})$'),
 sacado_documento text NOT NULL CHECK(sacado_documento ~ '^([0-9]{11}|[0-9]{14})$'),
 chave_ativo text NOT NULL CHECK(length(chave_ativo) BETWEEN 1 AND 500),
 chave_parcela text NOT NULL CHECK(length(chave_parcela) BETWEEN 1 AND 500),
 tipo_recebivel text NOT NULL CHECK(length(tipo_recebivel) BETWEEN 1 AND 500),
 data_recebimento_remessa date NOT NULL,data_vencimento date NOT NULL,
 valor_nominal numeric(24,4) NOT NULL CHECK(valor_nominal>=0 AND valor_nominal<>'NaN'::numeric),
 valor_aquisicao numeric(24,4) NOT NULL CHECK(valor_aquisicao>=0 AND valor_aquisicao<>'NaN'::numeric),
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(fundo_id,ambiente,codigo_carteira,identidade_movimento,hash_registro)
);
CREATE INDEX vortx_inclusoes_importacao_idx ON public.vortx_inclusoes(primeira_importacao_id);
CREATE INDEX vortx_inclusoes_fundo_data_idx ON public.vortx_inclusoes(fundo_id,data_recebimento_remessa);
CREATE TABLE public.vortx_inclusao_linhas (
 importacao_id uuid NOT NULL REFERENCES public.importacoes_financeiras(id),
 arquivo_id uuid NOT NULL REFERENCES public.importacao_arquivos(id),
 fundo_id uuid NOT NULL REFERENCES public.fundos(id),
 inclusao_id uuid NOT NULL REFERENCES public.vortx_inclusoes(id),
 numero_linha integer NOT NULL CHECK(numero_linha>1),
 dados_brutos jsonb NOT NULL CHECK(jsonb_typeof(dados_brutos)='object'),
 dados_normalizados jsonb NOT NULL CHECK(jsonb_typeof(dados_normalizados)='object'),
 PRIMARY KEY(importacao_id,numero_linha),UNIQUE(importacao_id,inclusao_id)
);
CREATE INDEX vortx_inclusao_linhas_arquivo_idx ON public.vortx_inclusao_linhas(arquivo_id);
CREATE INDEX vortx_inclusao_linhas_movimento_idx ON public.vortx_inclusao_linhas(inclusao_id);
CREATE INDEX vortx_inclusao_linhas_fundo_idx ON public.vortx_inclusao_linhas(fundo_id,importacao_id);
ALTER TABLE public.vortx_inclusoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vortx_inclusao_linhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vortx_inclusoes,public.vortx_inclusao_linhas FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vortx_inclusoes,public.vortx_inclusao_linhas TO authenticated;
CREATE POLICY vortx_inclusoes_gestor ON public.vortx_inclusoes FOR SELECT TO authenticated USING(private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY vortx_inclusao_linhas_gestor ON public.vortx_inclusao_linhas FOR SELECT TO authenticated USING(private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE TRIGGER vortx_inclusoes_imutaveis BEFORE UPDATE OR DELETE ON public.vortx_inclusoes FOR EACH ROW EXECUTE FUNCTION private.matching_bloquear_mutacao_historica();
CREATE TRIGGER vortx_inclusao_linhas_imutaveis BEFORE UPDATE OR DELETE ON public.vortx_inclusao_linhas FOR EACH ROW EXECUTE FUNCTION private.matching_bloquear_mutacao_historica();

CREATE FUNCTION private.vortx_validar_linhagem_inclusao() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.importacoes_financeiras%ROWTYPE;v public.vortx_inclusoes%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='vortx_inclusoes' THEN
 SELECT * INTO i FROM public.importacoes_financeiras WHERE id=NEW.primeira_importacao_id;
 IF NOT FOUND OR i.status<>'VALIDANDO' OR i.provedor<>'VORTX' OR i.tipo_base<>'AQUISICOES'
 OR i.fundo_id<>NEW.fundo_id OR i.fonte_ambiente<>NEW.ambiente OR i.fonte_carteira<>NEW.codigo_carteira THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Linhagem de inclusao incompativel'; END IF;
 ELSE
 SELECT * INTO i FROM public.importacoes_financeiras WHERE id=NEW.importacao_id;
 SELECT * INTO v FROM public.vortx_inclusoes WHERE id=NEW.inclusao_id;
 IF i.id IS NULL OR v.id IS NULL OR i.status<>'VALIDANDO' OR i.provedor<>'VORTX' OR i.tipo_base<>'AQUISICOES'
 OR i.fundo_id<>NEW.fundo_id OR v.fundo_id<>NEW.fundo_id OR i.fonte_ambiente<>v.ambiente OR i.fonte_carteira<>v.codigo_carteira
 OR NOT EXISTS(SELECT 1 FROM public.importacao_arquivos a WHERE a.id=NEW.arquivo_id AND a.importacao_id=i.id AND a.fundo_id=i.fundo_id) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Origem da linha de inclusao incompativel'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_validar_linhagem_inclusao() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER vortx_inclusoes_linhagem BEFORE INSERT ON public.vortx_inclusoes FOR EACH ROW EXECUTE FUNCTION private.vortx_validar_linhagem_inclusao();
CREATE TRIGGER vortx_inclusao_linhas_linhagem BEFORE INSERT ON public.vortx_inclusao_linhas FOR EACH ROW EXECUTE FUNCTION private.vortx_validar_linhagem_inclusao();

CREATE FUNCTION private.vortx_inclusao_autorizada(p_evento uuid) RETURNS boolean
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
 AND s.pedido->>'dataReferencia'=e.data_referencia::text
 AND s.pedido->>'dataInicio'=e.data_inicio::text AND s.pedido->>'dataFim'=e.data_fim::text
 AND e.data_inicio<=e.data_fim AND i.status='ativa' AND i.provider_key='VORTX'
 AND v.adapter_key='vortx_vrs' AND v.status='publicada' AND v.vigente_ate IS NULL
 AND ep.codigo_carteira=v.configuracao_nao_sensivel->>'codigo_carteira'
 AND s.pedido->>'codigoCarteira'=ep.codigo_carteira AND e.metadados->>'idCarteira'=ep.codigo_carteira
 AND c.fundo_id=f.id AND c.ambiente=v.ambiente AND c.capability='AQUISICOES'
 AND c.disponivel_desde<=now() AND c.disponivel_ate IS NULL);
$$;
REVOKE ALL ON FUNCTION private.vortx_inclusao_autorizada(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.vortx_inclusao_execucao(p_id uuid,p_lease uuid) RETURNS private.vortx_inclusao_processamentos
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j private.vortx_inclusao_processamentos%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO j FROM private.vortx_inclusao_processamentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.estado<>'PROCESSANDO' OR j.lease IS DISTINCT FROM p_lease OR j.lease_ate<=clock_timestamp()
 OR NOT private.vortx_inclusao_autorizada(j.evento_id) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Execucao de inclusao indisponivel'; END IF;
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_inclusao_execucao(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- All definer RPCs below are machine-only. No operator table writes or RLS bypass are introduced.
CREATE FUNCTION public.vortx_reservar_processamento_inclusao(p_fundo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;j private.vortx_inclusao_processamentos%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('vortx-inclusion-worker:'||p_fundo_id::text,0)) THEN RETURN NULL; END IF;
 UPDATE private.vortx_inclusao_processamentos SET estado='FALHA',erro='PERSISTENCIA_INDETERMINADA',lease=NULL,lease_ate=NULL
 WHERE fundo_id=p_fundo_id AND estado='PROCESSANDO' AND tentativas>=3 AND lease_ate<clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.vortx_inclusao_processamentos WHERE fundo_id=p_fundo_id AND estado='PROCESSANDO' AND lease_ate>clock_timestamp()) THEN RETURN NULL; END IF;
 FOR e IN SELECT ev.*,s.integracao_versao_id FROM public.vortx_relatorio_eventos ev
 JOIN public.vortx_relatorio_solicitacoes s ON s.id=ev.solicitacao_id
 WHERE ev.fundo_id=p_fundo_id AND ev.tipo_relatorio='Inclusao' AND private.vortx_inclusao_autorizada(ev.id)
 AND NOT EXISTS(SELECT 1 FROM private.vortx_inclusao_processamentos done WHERE done.evento_id=ev.id
  AND (done.estado IN ('PERSISTIDO','REVISAO','FALHA') OR done.tentativas>=3))
 AND NOT EXISTS(SELECT 1 FROM public.vortx_relatorio_eventos newer WHERE newer.solicitacao_id=ev.solicitacao_id
  AND newer.correlacao='CORRELACIONADO' AND (newer.recebido_em,newer.id)>(ev.recebido_em,ev.id))
 ORDER BY ev.recebido_em,ev.id LIMIT 20 LOOP
 INSERT INTO private.vortx_inclusao_processamentos(evento_id,fundo_id,versao_id,ambiente,codigo_carteira,data_referencia,data_inicio,data_fim)
 VALUES(e.id,e.fundo_id,e.integracao_versao_id,e.ambiente,e.metadados->>'idCarteira',e.data_referencia,e.data_inicio,e.data_fim)
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
REVOKE ALL ON FUNCTION public.vortx_reservar_processamento_inclusao(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_reservar_processamento_inclusao(uuid) TO service_role;

CREATE FUNCTION public.vortx_manifesto_inclusao(p_id uuid,p_lease uuid,p_manifesto jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_inclusao_processamentos%ROWTYPE;f jsonb;old_manifest jsonb;
BEGIN
 j:=private.vortx_inclusao_execucao(p_id,p_lease);
 f:=p_manifesto->'arquivo';
 IF jsonb_typeof(p_manifesto) IS DISTINCT FROM 'object' OR octet_length(p_manifesto::text)>16384
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_manifesto) k WHERE k NOT IN ('id','fundo_id','ambiente','codigo_carteira','versao_id','data_referencia','data_inicio','data_fim','hash_conteudo','linhas_total','arquivo'))
 OR p_manifesto->>'fundo_id' IS DISTINCT FROM j.fundo_id::text
 OR p_manifesto->>'ambiente' IS DISTINCT FROM j.ambiente OR p_manifesto->>'codigo_carteira' IS DISTINCT FROM j.codigo_carteira
 OR p_manifesto->>'versao_id' IS DISTINCT FROM j.versao_id::text
 OR p_manifesto->>'data_referencia' IS DISTINCT FROM j.data_referencia::text
 OR p_manifesto->>'data_inicio' IS DISTINCT FROM j.data_inicio::text OR p_manifesto->>'data_fim' IS DISTINCT FROM j.data_fim::text
 OR coalesce(p_manifesto->>'hash_conteudo','') !~ '^[0-9a-f]{64}$'
 OR coalesce((p_manifesto->>'linhas_total')::int,-1) NOT BETWEEN 0 AND 100000
 OR jsonb_typeof(f) IS DISTINCT FROM 'object' OR (p_manifesto->>'id')::uuid IS NULL OR (f->>'id')::uuid IS NULL
 OR f->>'storage_bucket' IS DISTINCT FROM 'financeiro-importacoes'
 OR f->>'storage_path' IS DISTINCT FROM j.fundo_id::text||'/vortx/'||(p_manifesto->>'id')||'/inclusao.csv'
 OR coalesce((f->>'tamanho_bytes')::int,0) NOT BETWEEN 1 AND 20971520
 OR coalesce(f->>'hash_conteudo','') !~ '^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manifesto de inclusao incompativel'; END IF;
 SELECT m->'payload' INTO old_manifest FROM jsonb_array_elements(j.manifestos) m WHERE m->>'lease'=j.lease::text;
 IF FOUND THEN
 IF old_manifest IS DISTINCT FROM p_manifesto THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manifesto conflitante'; END IF;
 RETURN true; END IF;
 UPDATE private.vortx_inclusao_processamentos SET manifestos=manifestos||jsonb_build_array(jsonb_build_object('lease',j.lease,'payload',p_manifesto)),
 download_concluido_em=clock_timestamp() WHERE id=j.id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_manifesto_inclusao(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_manifesto_inclusao(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.vortx_estagiar_inclusao(p_id uuid,p_lease uuid,p_ordem integer,p_linhas jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_inclusao_processamentos%ROWTYPE;anterior jsonb;
BEGIN
 j:=private.vortx_inclusao_execucao(p_id,p_lease);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.manifestos) m WHERE m->>'lease'=j.lease::text)
 OR p_ordem IS NULL OR p_ordem NOT BETWEEN 1 AND 100000 OR jsonb_typeof(p_linhas) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_linhas) NOT BETWEEN 1 AND 500 OR octet_length(p_linhas::text)>2097152 THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bloco de inclusao invalido'; END IF;
 SELECT linhas INTO anterior FROM private.vortx_inclusao_blocos WHERE processamento_id=j.id AND ordem=p_ordem;
 IF FOUND THEN
 IF anterior IS DISTINCT FROM p_linhas THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bloco conflitante'; END IF;
 RETURN jsonb_array_length(anterior); END IF;
 IF (SELECT coalesce(sum(jsonb_array_length(linhas)),0) FROM private.vortx_inclusao_blocos WHERE processamento_id=j.id)+jsonb_array_length(p_linhas)>100000 THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Limite de linhas excedido'; END IF;
 INSERT INTO private.vortx_inclusao_blocos VALUES(j.id,p_ordem,p_linhas);
 RETURN jsonb_array_length(p_linhas);
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_estagiar_inclusao(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_estagiar_inclusao(uuid,uuid,integer,jsonb) TO service_role;

CREATE FUNCTION private.vortx_inclusao_conflitos(p_importacao uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT count(*)::int FROM public.vortx_inclusao_linhas l JOIN public.vortx_inclusoes v ON v.id=l.inclusao_id
 WHERE l.importacao_id=p_importacao AND EXISTS(SELECT 1 FROM public.vortx_inclusoes other
 WHERE other.fundo_id=v.fundo_id AND other.ambiente=v.ambiente AND other.codigo_carteira=v.codigo_carteira
 AND other.identidade_movimento=v.identidade_movimento AND other.hash_registro<>v.hash_registro);
$$;
REVOKE ALL ON FUNCTION private.vortx_inclusao_conflitos(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.vortx_concluir_inclusao(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_inclusao_processamentos%ROWTYPE;m jsonb;f jsonb;existing public.importacoes_financeiras%ROWTYPE;
 total integer;unicos integer;minimo integer;maximo integer;id_import uuid;conflitos integer;resultado jsonb;
BEGIN
 j:=private.vortx_inclusao_execucao(p_id,p_lease);
 SELECT value->'payload' INTO STRICT m FROM jsonb_array_elements(j.manifestos) WHERE value->>'lease'=j.lease::text;
 f:=m->'arquivo';id_import:=(m->>'id')::uuid;
 SELECT count(*)::int,count(DISTINCT (r->>'numero_linha')::int)::int,min((r->>'numero_linha')::int),max((r->>'numero_linha')::int)
 INTO total,unicos,minimo,maximo FROM private.vortx_inclusao_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r WHERE processamento_id=j.id;
 IF total<>(m->>'linhas_total')::int OR total<>unicos OR (total>0 AND (minimo<>2 OR maximo<>total+1))
 OR EXISTS(SELECT 1 FROM private.vortx_inclusao_blocos WHERE processamento_id=j.id GROUP BY processamento_id HAVING min(ordem)<>1 OR max(ordem)<>count(*)) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cobertura de inclusao incompleta'; END IF;
 -- Never trust normalized caller fields for scope or finite financial values.
 IF EXISTS(SELECT 1 FROM private.vortx_inclusao_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r
 WHERE processamento_id=j.id AND (jsonb_typeof(r->'dados_brutos') IS DISTINCT FROM 'object'
 OR jsonb_typeof(r->'dados_normalizados') IS DISTINCT FROM 'object'
 OR r->'dados_normalizados'->>'fundo_id' IS DISTINCT FROM j.fundo_id::text
 OR r->'dados_normalizados'->>'codigo_carteira' IS DISTINCT FROM j.codigo_carteira
 OR r->'dados_normalizados'->>'data_referencia' IS DISTINCT FROM j.data_referencia::text
 OR coalesce(r->'dados_normalizados'->>'cedente_documento','') !~ '^([0-9]{11}|[0-9]{14})$'
 OR coalesce(r->'dados_normalizados'->>'sacado_documento','') !~ '^([0-9]{11}|[0-9]{14})$'
 OR coalesce(length(r->'dados_normalizados'->>'chave_ativo'),0) NOT BETWEEN 1 AND 500
 OR coalesce(length(r->'dados_normalizados'->>'chave_parcela'),0) NOT BETWEEN 1 AND 500
 OR coalesce(length(r->'dados_normalizados'->>'tipo_recebivel'),0) NOT BETWEEN 1 AND 500
 OR coalesce(r->'dados_normalizados'->>'valor_nominal','') !~ '^\d{1,16}\.\d{4}$'
 OR coalesce(r->'dados_normalizados'->>'valor_aquisicao','') !~ '^\d{1,16}\.\d{4}$'
 OR coalesce(r->'dados_normalizados'->>'data_movimento','') !~ '^\d{4}-\d{2}-\d{2}$'
 OR coalesce(r->'dados_normalizados'->>'data_vencimento','') !~ '^\d{4}-\d{2}-\d{2}$'
 OR (r->'dados_normalizados'->>'data_movimento')::date NOT BETWEEN j.data_inicio AND j.data_fim)) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Linha de inclusao fora do contrato'; END IF;
 IF EXISTS(SELECT 1 FROM private.vortx_inclusao_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r WHERE processamento_id=j.id
 GROUP BY r->'dados_normalizados'->>'cedente_documento',r->'dados_normalizados'->>'chave_ativo',r->'dados_normalizados'->>'chave_parcela',r->'dados_normalizados'->>'data_movimento' HAVING count(*)>1) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movimento duplicado no arquivo'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-inclusion:'||j.fundo_id::text||j.ambiente||j.codigo_carteira,0));
 SELECT * INTO existing FROM public.importacoes_financeiras WHERE fundo_id=j.fundo_id AND tipo_base='AQUISICOES'
 AND data_referencia=j.data_referencia AND hash_conteudo=m->>'hash_conteudo';
 IF FOUND THEN
 IF existing.provedor<>'VORTX' OR existing.fonte_ambiente<>j.ambiente OR existing.fonte_carteira<>j.codigo_carteira THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Colisao de importacao'; END IF;
 id_import:=existing.id;conflitos:=private.vortx_inclusao_conflitos(id_import);
 ELSE
 INSERT INTO public.importacoes_financeiras(id,fundo_id,provedor,tipo_base,data_referencia,versao_layout,layout_nome,status,completude,
 origem,integracao_fundo_versao_id,fonte_ambiente,fonte_carteira,hash_conteudo,nome_arquivo,mime_type,tamanho_bytes,storage_bucket,storage_path,correlation_id,metadados,encoding_detectado)
 VALUES(id_import,j.fundo_id,'VORTX','AQUISICOES',j.data_referencia,'VORTX_INCLUSAO_V1','VORTX_INCLUSAO_V1','VALIDANDO',
 CASE WHEN total=0 THEN 'COMPLETO_VAZIO' ELSE 'COMPLETO_COM_DADOS' END,'CRON',j.versao_id,j.ambiente,j.codigo_carteira,m->>'hash_conteudo',
 'inclusao.csv','text/csv',(f->>'tamanho_bytes')::int,'financeiro-importacoes',f->>'storage_path',j.id,
 jsonb_build_object('data_inicio',j.data_inicio,'data_fim',j.data_fim,'sem_movimento',total=0),'utf-8');
 INSERT INTO public.importacao_arquivos(id,importacao_id,fundo_id,ordem,nome_arquivo,mime_type,tamanho_bytes,hash_conteudo,storage_bucket,storage_path)
 VALUES((f->>'id')::uuid,id_import,j.fundo_id,1,'inclusao.csv','text/csv',(f->>'tamanho_bytes')::int,f->>'hash_conteudo','financeiro-importacoes',f->>'storage_path');
 WITH linhas AS MATERIALIZED (
 SELECT r,d,encode(sha256(convert_to(jsonb_build_array(j.fundo_id,j.ambiente,j.codigo_carteira,d->>'cedente_documento',d->>'chave_ativo',d->>'chave_parcela',d->>'data_movimento')::text,'UTF8')),'hex') identidade,
 encode(sha256(convert_to(jsonb_build_array(d->>'sacado_documento',d->>'tipo_recebivel',d->>'valor_nominal',d->>'valor_aquisicao',d->>'data_vencimento')::text,'UTF8')),'hex') hash
 FROM private.vortx_inclusao_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r CROSS JOIN LATERAL (SELECT r->'dados_normalizados' d) x WHERE processamento_id=j.id
 ), inseridos AS (
 INSERT INTO public.vortx_inclusoes(fundo_id,primeira_importacao_id,ambiente,codigo_carteira,identidade_movimento,hash_registro,cedente_documento,sacado_documento,chave_ativo,chave_parcela,tipo_recebivel,data_recebimento_remessa,data_vencimento,valor_nominal,valor_aquisicao)
 SELECT j.fundo_id,id_import,j.ambiente,j.codigo_carteira,identidade,hash,d->>'cedente_documento',d->>'sacado_documento',d->>'chave_ativo',d->>'chave_parcela',d->>'tipo_recebivel',
 (d->>'data_movimento')::date,(d->>'data_vencimento')::date,(d->>'valor_nominal')::numeric,(d->>'valor_aquisicao')::numeric FROM linhas
 ON CONFLICT(fundo_id,ambiente,codigo_carteira,identidade_movimento,hash_registro) DO NOTHING RETURNING id,identidade_movimento,hash_registro
 ), movimentos AS (SELECT * FROM inseridos UNION ALL SELECT id,identidade_movimento,hash_registro FROM public.vortx_inclusoes WHERE fundo_id=j.fundo_id AND ambiente=j.ambiente AND codigo_carteira=j.codigo_carteira)
 INSERT INTO public.vortx_inclusao_linhas(importacao_id,arquivo_id,fundo_id,inclusao_id,numero_linha,dados_brutos,dados_normalizados)
 SELECT id_import,(f->>'id')::uuid,j.fundo_id,mv.id,(l.r->>'numero_linha')::int,l.r->'dados_brutos',l.d FROM linhas l JOIN movimentos mv ON mv.identidade_movimento=l.identidade AND mv.hash_registro=l.hash;
 SELECT count(*)::int INTO conflitos FROM public.vortx_inclusao_linhas l JOIN public.vortx_inclusoes v ON v.id=l.inclusao_id
 WHERE l.importacao_id=id_import AND EXISTS(SELECT 1 FROM public.vortx_inclusoes other WHERE other.fundo_id=v.fundo_id AND other.ambiente=v.ambiente AND other.codigo_carteira=v.codigo_carteira AND other.identidade_movimento=v.identidade_movimento AND other.hash_registro<>v.hash_registro);
 UPDATE public.importacoes_financeiras SET status='VALIDA',linhas_total=total,linhas_validas=total,
 valor_total=(SELECT coalesce(sum(v.valor_aquisicao),0) FROM public.vortx_inclusao_linhas l JOIN public.vortx_inclusoes v ON v.id=l.inclusao_id WHERE l.importacao_id=id_import),
 metadados=metadados||jsonb_build_object('conflitos',conflitos),validacao_concluida_em=clock_timestamp() WHERE id=id_import;
 END IF;
 UPDATE private.vortx_inclusao_processamentos SET estado=CASE WHEN conflitos>0 THEN 'REVISAO' ELSE 'PERSISTIDO' END,
 importacao_id=id_import,lease=NULL,lease_ate=NULL,erro=NULL,processado_em=clock_timestamp(),atualizada_em=clock_timestamp() WHERE id=j.id;
 DELETE FROM private.vortx_inclusao_blocos WHERE processamento_id=j.id;
 PERFORM private.financeiro_auditar('VORTX_INCLUSAO_PRESERVADA',id_import,j.fundo_id,j.id,jsonb_build_object('processamento_id',j.id,'evento_id',j.evento_id,'linhas',total,'conflitos',conflitos));
 resultado:=jsonb_build_object('id',id_import,'estado',CASE WHEN conflitos>0 THEN 'REVISAO' ELSE 'PERSISTIDO' END,'duplicada',existing.id IS NOT NULL,'inclusoes',total,'conflitos',conflitos);
 RETURN resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_concluir_inclusao(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_concluir_inclusao(uuid,uuid) TO service_role;

CREATE FUNCTION public.vortx_falhar_inclusao(p_id uuid,p_lease uuid,p_erro text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF p_erro IS NULL OR p_erro NOT IN ('DOWNLOAD_FALHOU','CONTRATO_INVALIDO','PERSISTENCIA_INDETERMINADA') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Motivo invalido'; END IF;
 UPDATE private.vortx_inclusao_processamentos SET estado='FALHA',erro=p_erro,lease=NULL,lease_ate=NULL,atualizada_em=clock_timestamp()
 WHERE id=p_id AND lease=p_lease AND estado='PROCESSANDO' AND lease_ate>clock_timestamp();
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_falhar_inclusao(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_falhar_inclusao(uuid,uuid,text) TO service_role;

-- Enrich only Inclusion rows; retain the existing stock/PDD projection and pagination.
CREATE FUNCTION private.vortx_anexar_inclusoes_historico(p_historico jsonb,p_fundo uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE chave text;linhas jsonb;
BEGIN
 IF private.vortx_relatorio_operador(p_fundo,false) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso ao Fundo exigido'; END IF;
 FOREACH chave IN ARRAY ARRAY['solicitacoes','resumo'] LOOP
 SELECT coalesce(jsonb_agg(CASE WHEN r->'pedido'->>'tipoRelatorio'='Inclusao' AND j.id IS NOT NULL THEN
 r||jsonb_build_object('acompanhamento',(r->'acompanhamento')||jsonb_build_object('processamento',j.estado,
 'downloadEm',j.download_concluido_em,'processadoEm',j.processado_em,'erro',j.erro,'publicacao',i.status,'publicadoEm',i.publicada_em,
 'inclusoes',coalesce(i.linhas_total,0),'conflitos',private.vortx_inclusao_conflitos(i.id),
 'duplicada',j.importacao_id IS NOT NULL AND (j.manifestos->-1->'payload'->>'id') IS DISTINCT FROM j.importacao_id::text)) ELSE r END ORDER BY ord),'[]')
 INTO linhas FROM jsonb_array_elements(p_historico->chave) WITH ORDINALITY x(r,ord)
 LEFT JOIN LATERAL(SELECT job.* FROM private.vortx_inclusao_processamentos job JOIN public.vortx_relatorio_eventos e ON e.id=job.evento_id
 WHERE job.fundo_id=p_fundo AND e.fundo_id=p_fundo AND e.solicitacao_id=(r->>'id')::uuid ORDER BY job.criada_em DESC,job.id DESC LIMIT 1) j ON true
 LEFT JOIN public.importacoes_financeiras i ON i.id=j.importacao_id AND i.fundo_id=p_fundo;
 p_historico:=jsonb_set(p_historico,ARRAY[chave],linhas);
 END LOOP;
 RETURN p_historico;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_anexar_inclusoes_historico(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_anexar_inclusoes_historico(jsonb,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.vortx_central_bases_historico(p_fundo_id uuid,p_pagina integer DEFAULT 1,p_tipo text DEFAULT NULL,p_origem text DEFAULT NULL,p_estado text DEFAULT NULL,p_referencia date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.vortx_anexar_inclusoes_historico(private.vortx_central_bases_historico(p_fundo_id,p_pagina,p_tipo,p_origem,p_estado,p_referencia),p_fundo_id);
$$;
REVOKE ALL ON FUNCTION public.vortx_central_bases_historico(uuid,integer,text,text,text,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_central_bases_historico(uuid,integer,text,text,text,date) TO authenticated;
COMMIT;
