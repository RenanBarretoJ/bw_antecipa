-- Internal Carteira JSON worker only. No user-facing financial write API or scheduler activation.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

-- Extend the canonical publication catalog, without changing its existing ACL.
-- No capabilities are enabled on existing versions and no scheduler is activated.
CREATE OR REPLACE FUNCTION private.integracao_adapter_capability_suportada(p_adapter_key text,p_capability text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT (p_adapter_key IN ('sinqia_portal_fidc','vortx_vrs')
  AND p_capability IN ('CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES'))
 OR (p_adapter_key='vortx_vrs' AND p_capability='CARTEIRA');
$$;

ALTER TABLE public.importacoes_financeiras DROP CONSTRAINT importacoes_vortx_escopo_check;
ALTER TABLE public.importacoes_financeiras ADD CONSTRAINT importacoes_vortx_escopo_check CHECK (
 provedor<>'VORTX' OR (tipo_base IN ('ESTOQUE','AQUISICOES','CARTEIRA')
 AND fonte_ambiente IS NOT NULL AND fonte_ambiente IN ('homologacao','producao')
 AND fonte_carteira IS NOT NULL AND length(fonte_carteira) BETWEEN 1 AND 120
 AND integracao_fundo_versao_id IS NOT NULL));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('vortx-carteiras','vortx-carteiras',false,20971520,ARRAY['application/json']);
-- No authenticated Storage policy: the original is kept private, not exposed by this release.
CREATE POLICY vortx_carteiras_fronteira_privada ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'vortx-carteiras') WITH CHECK(bucket_id<>'vortx-carteiras');

CREATE TABLE private.vortx_carteira_execucoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lease uuid NOT NULL DEFAULT gen_random_uuid(),
 lease_ate timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 fundo_id uuid NOT NULL REFERENCES public.fundos(id),versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id),
 data_referencia date NOT NULL, contexto jsonb NOT NULL,
 hash_arquivo text NOT NULL CHECK(hash_arquivo ~ '^[0-9a-f]{64}$'),
 tamanho_bytes bigint NOT NULL CHECK(tamanho_bytes BETWEEN 1 AND 20971520),
 storage_path text NOT NULL UNIQUE,
 estado text NOT NULL DEFAULT 'RESERVADA' CHECK(estado IN ('RESERVADA','PERSISTIDA','DUPLICADA','FALHA')),
 importacao_id uuid REFERENCES public.importacoes_financeiras(id),
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),concluida_em timestamptz,
 CHECK((estado IN ('PERSISTIDA','DUPLICADA'))=(importacao_id IS NOT NULL))
);
CREATE INDEX vortx_carteira_execucoes_fundo_idx ON private.vortx_carteira_execucoes(fundo_id,data_referencia);
CREATE INDEX vortx_carteira_execucoes_versao_idx ON private.vortx_carteira_execucoes(versao_id);
CREATE INDEX vortx_carteira_execucoes_importacao_idx ON private.vortx_carteira_execucoes(importacao_id);
ALTER TABLE private.vortx_carteira_execucoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_carteira_execucoes FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.vortx_carteira_cotas (
 importacao_id uuid NOT NULL REFERENCES public.importacoes_financeiras(id),
 fundo_id uuid NOT NULL REFERENCES public.fundos(id),codigo_cota text NOT NULL,
 rotulo text NOT NULL,data_referencia date NOT NULL,
 patrimonio_liquido numeric(20,4) NOT NULL CHECK(patrimonio_liquido>=0 AND patrimonio_liquido<>'NaN'::numeric),
 PRIMARY KEY(importacao_id,codigo_cota)
);
CREATE INDEX vortx_carteira_cotas_fundo_idx ON public.vortx_carteira_cotas(fundo_id,data_referencia);
ALTER TABLE public.vortx_carteira_cotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vortx_carteira_cotas FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vortx_carteira_cotas TO authenticated;
CREATE POLICY vortx_carteira_cotas_leitura ON public.vortx_carteira_cotas FOR SELECT TO authenticated
 USING(private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE TRIGGER vortx_carteira_cotas_imutaveis BEFORE UPDATE OR DELETE ON public.vortx_carteira_cotas
 FOR EACH ROW EXECUTE FUNCTION private.matching_bloquear_mutacao_historica();

CREATE FUNCTION private.vortx_carteira_lista_valida(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->'versao' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(p->'cotas') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR jsonb_array_length(p->'cotas') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'cotas') c WHERE jsonb_typeof(c)<>'object') THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'cotas') c
  WHERE (SELECT count(*) FROM jsonb_object_keys(c))<>2
   OR jsonb_typeof(c->'codigoCarteira') IS DISTINCT FROM 'string'
   OR (c->>'codigoCarteira') !~ '^[A-Za-z0-9._-]{1,100}$'
   OR jsonb_typeof(c->'rotulo') IS DISTINCT FROM 'string' OR length(trim(c->>'rotulo')) NOT BETWEEN 1 AND 100)
 AND (SELECT count(*)=count(DISTINCT c->>'codigoCarteira') FROM jsonb_array_elements(p->'cotas') c);
END;
$$;

CREATE FUNCTION private.vortx_carteira_contexto(p_fundo uuid,p_versao uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE ctx jsonb;
BEGIN
 SELECT jsonb_build_object('fundo_id',f.id,'versao_id',v.id,'ambiente',v.ambiente,
  'cnpj_fundo',regexp_replace(f.cnpj,'[^0-9]','','g'),'codigo_carteira',v.configuracao_nao_sensivel->>'codigo_carteira',
  'cotas_esperadas',v.configuracao_nao_sensivel->'carteira_consolidada') INTO ctx
 FROM public.integracao_fundo_versoes v JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
 JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 WHERE v.id=p_versao AND f.id=p_fundo AND i.provider_key='VORTX' AND i.status='ativa'
 AND v.status='publicada' AND v.vigente_desde<=now() AND v.vigente_ate IS NULL AND v.adapter_key='vortx_vrs'
 -- Only the production Carteira JSON endpoint has a verified transport contract here.
 AND v.ambiente='producao' AND (v.configuracao_nao_sensivel->>'codigo_carteira') ~ '^[A-Za-z0-9._-]{1,100}$'
 AND EXISTS(SELECT 1 FROM public.integracao_fundo_versao_capacidades c WHERE c.integracao_fundo_versao_id=v.id
  AND c.fundo_id=f.id AND c.ambiente=v.ambiente AND c.capability='CARTEIRA'
  AND c.disponivel_desde<=now() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>now()))
 AND EXISTS(SELECT 1 FROM public.integracoes_vortx_vrs_credenciais k WHERE k.fundo_id=f.id
  AND k.ambiente=v.ambiente AND k.status='ativa' AND k.base_url='https://api.vortx.com.br');
 IF ctx IS NULL OR ctx->>'cnpj_fundo' IS NULL OR ctx->>'cnpj_fundo' !~ '^[0-9]{14}$'
 OR NOT private.vortx_carteira_lista_valida(ctx->'cotas_esperadas') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Carteira, cotas ou credencial indisponiveis neste Fundo e versao';
 END IF;
 RETURN ctx;
END;
$$;

-- Private durable manifest is needed to fence an uncertain commit before compensating Storage.
CREATE FUNCTION public.vortx_reservar_carteira(p_fundo_id uuid,p_versao_id uuid,p_referencia date,p_hash text,p_tamanho bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;j private.vortx_carteira_execucoes%ROWTYPE; id_novo uuid:=gen_random_uuid();
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 ctx:=private.vortx_carteira_contexto(p_fundo_id,p_versao_id);
 IF p_referencia IS NULL OR p_referencia>timezone('America/Sao_Paulo',clock_timestamp())::date
 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_tamanho IS NULL OR p_tamanho NOT BETWEEN 1 AND 20971520 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Manifesto de carteira invalido'; END IF;
 INSERT INTO private.vortx_carteira_execucoes(id,fundo_id,versao_id,data_referencia,contexto,hash_arquivo,tamanho_bytes,storage_path)
 VALUES(id_novo,p_fundo_id,p_versao_id,p_referencia,ctx,p_hash,p_tamanho,
  p_fundo_id::text||'/carteira/'||id_novo::text||'/carteira.json') RETURNING * INTO j;
 RETURN to_jsonb(j)-'contexto'||ctx||jsonb_build_object('storage_bucket','vortx-carteiras');
END;
$$;

CREATE FUNCTION public.vortx_concluir_carteira(p_id uuid,p_lease uuid,p_resposta jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_carteira_execucoes%ROWTYPE;ctx jsonb;headers jsonb;g jsonb;r jsonb;esperada jsonb;
 cotas jsonb:='[]';normalizado jsonb;total numeric(20,4):=0;pl numeric(20,4);fingerprint text;
 anterior uuid;duplicada public.importacoes_financeiras%ROWTYPE;linha uuid:=gen_random_uuid();momento timestamptz:=clock_timestamp();
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO j FROM private.vortx_carteira_execucoes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Execucao de carteira indisponivel'; END IF;
 IF j.estado IN ('PERSISTIDA','DUPLICADA') THEN
  RETURN jsonb_build_object('id',j.importacao_id,'estado',j.estado,'duplicada',j.estado='DUPLICADA'); END IF;
 IF j.estado<>'RESERVADA' OR j.lease_ate<=momento THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Execucao de carteira encerrada'; END IF;
 ctx:=private.vortx_carteira_contexto(j.fundo_id,j.versao_id);
 IF ctx IS DISTINCT FROM j.contexto THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Contexto da carteira alterado'; END IF;
 IF p_resposta IS NULL OR jsonb_typeof(p_resposta)<>'array' OR jsonb_array_length(p_resposta) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Resposta de carteira incompleta'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(p_resposta) LOOP
  IF jsonb_typeof(g)<>'object' OR jsonb_typeof(g->'carteiras') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Resposta de carteira invalida'; END IF;
 END LOOP;
 headers:=jsonb_path_query_array(p_resposta,'$[*].carteiras[*]');
 IF jsonb_array_length(headers)<>jsonb_array_length(ctx->'cotas_esperadas'->'cotas')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(headers) h WHERE jsonb_typeof(h)<>'object') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Nem todas as cotas estao disponiveis'; END IF;
 IF (SELECT count(*)<>count(DISTINCT h->>'carteira') FROM jsonb_array_elements(headers) h) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Codigo de cota duplicado'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(headers) ORDER BY value->>'carteira' COLLATE "C" LOOP
  SELECT value INTO esperada FROM jsonb_array_elements(ctx->'cotas_esperadas'->'cotas') WHERE value->>'codigoCarteira'=r->>'carteira';
  IF esperada IS NULL OR jsonb_typeof(r->'carteira') IS DISTINCT FROM 'string'
   OR jsonb_typeof(r->'cnpjFundo') IS DISTINCT FROM 'string'
   OR (r->>'cnpjFundo') !~ '^([0-9]{14}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2})$'
   OR regexp_replace(r->>'cnpjFundo','[^0-9]','','g')<>ctx->>'cnpj_fundo' OR r->>'status' IS DISTINCT FROM 'Ativa'
   OR left(r->>'dataAtual',10) IS DISTINCT FROM j.data_referencia::text
   OR (r->>'dataAtual') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2}))?$'
   OR r->>'pl' IS NULL OR (r->>'pl') !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cota fora do Fundo, data ou contrato esperado'; END IF;
  PERFORM (r->>'dataAtual')::timestamptz;
  pl:=(r->>'pl')::numeric(20,4);total:=total+pl;
  cotas:=cotas||jsonb_build_array(jsonb_build_object('codigoCarteira',r->>'carteira','rotulo',esperada->>'rotulo','patrimonioLiquido',pl::text));
 END LOOP;
 IF total<=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PL consolidado deve ser positivo'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets b JOIN storage.objects o ON o.bucket_id=b.id
  WHERE b.id='vortx-carteiras' AND NOT b.public AND o.name=j.storage_path
   AND (o.metadata->>'size')::bigint=j.tamanho_bytes) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original privado da carteira nao confirmado'; END IF;
 normalizado:=jsonb_build_object('fundo',j.fundo_id,'versao',j.versao_id,'contexto',ctx,
  'referencia',j.data_referencia,'cotas',cotas);
 fingerprint:=encode(extensions.digest(normalizado::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-carteira:'||j.fundo_id::text||':'||j.data_referencia::text,0));
 SELECT * INTO duplicada FROM public.importacoes_financeiras WHERE fundo_id=j.fundo_id AND tipo_base='CARTEIRA'
  AND data_referencia=j.data_referencia AND hash_conteudo=fingerprint;
 IF FOUND THEN
  UPDATE private.vortx_carteira_execucoes SET estado='DUPLICADA',importacao_id=duplicada.id,concluida_em=momento WHERE id=j.id;
  RETURN jsonb_build_object('id',duplicada.id,'estado','DUPLICADA','duplicada',true); END IF;
 IF EXISTS(SELECT 1 FROM public.importacoes_financeiras WHERE fundo_id=j.fundo_id AND tipo_base='CARTEIRA'
  AND data_referencia=j.data_referencia AND status='PUBLICADA' AND provedor<>'VORTX') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Existe PL publicado por outra fonte; conciliacao explicita exigida'; END IF;
 IF (SELECT count(*) FROM public.importacoes_financeiras WHERE fundo_id=j.fundo_id AND tipo_base='CARTEIRA'
  AND data_referencia=j.data_referencia AND provedor='VORTX' AND status='PUBLICADA')>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Mais de um PL vigente nesta data; conciliacao exigida'; END IF;
 INSERT INTO public.importacoes_financeiras(id,fundo_id,provedor,tipo_base,data_referencia,versao_layout,layout_nome,status,completude,
  origem,integracao_fundo_versao_id,fonte_ambiente,fonte_carteira,hash_conteudo,nome_arquivo,mime_type,tamanho_bytes,
  storage_bucket,storage_path,correlation_id,metadados,encoding_detectado,linhas_total,linhas_validas,valor_total)
 VALUES(j.id,j.fundo_id,'VORTX','CARTEIRA',j.data_referencia,'VORTX_CARTEIRA_V1','VORTX_CARTEIRA_JSON_V1','VALIDANDO','COMPLETO_COM_DADOS',
  'CRON',j.versao_id,'producao',ctx->>'codigo_carteira',fingerprint,'carteira.json','application/json',j.tamanho_bytes,
  'vortx-carteiras',j.storage_path,j.id,jsonb_build_object('cotas_esperadas',ctx->'cotas_esperadas','cotas',cotas),'utf-8',1,1,total);
 INSERT INTO public.importacao_arquivos(importacao_id,fundo_id,nome_arquivo,mime_type,tamanho_bytes,hash_conteudo,storage_bucket,storage_path)
 VALUES(j.id,j.fundo_id,'carteira.json','application/json',j.tamanho_bytes,j.hash_arquivo,'vortx-carteiras',j.storage_path);
 -- One technical aggregate row for the canonical snapshot, not a physical CSV line.
 INSERT INTO public.importacao_linhas(id,importacao_id,fundo_id,numero_linha,status,dados_brutos,dados_normalizados)
 VALUES(linha,j.id,j.fundo_id,2,'VALIDA',jsonb_build_object('carteiras',headers),jsonb_build_object('patrimonio_liquido',total::text));
 INSERT INTO public.vortx_carteira_cotas(importacao_id,fundo_id,codigo_cota,rotulo,data_referencia,patrimonio_liquido)
 SELECT j.id,j.fundo_id,c->>'codigoCarteira',c->>'rotulo',j.data_referencia,(c->>'patrimonioLiquido')::numeric FROM jsonb_array_elements(cotas) c;
 SELECT id INTO anterior FROM public.importacoes_financeiras WHERE fundo_id=j.fundo_id AND tipo_base='CARTEIRA'
  AND data_referencia=j.data_referencia AND provedor='VORTX' AND status='PUBLICADA' FOR UPDATE;
 UPDATE public.carteira_snapshots SET vigente=false WHERE importacao_id=anterior;
 UPDATE public.importacoes_financeiras SET status='RETIFICADA',substituida_em=momento WHERE id=anterior;
 INSERT INTO public.carteira_snapshots(importacao_id,linha_id,fundo_id,provedor,data_referencia,documento_fundo,patrimonio_liquido,payload_origem,publicada_em)
 VALUES(j.id,linha,j.fundo_id,'VORTX',j.data_referencia,ctx->>'cnpj_fundo',total,normalizado,momento);
 UPDATE public.importacoes_financeiras SET status='PUBLICADA',publicada_em=momento,finalizada_em=momento,
  validacao_concluida_em=momento,linhas_publicadas=1,substitui_importacao_id=anterior WHERE id=j.id;
 UPDATE private.vortx_carteira_execucoes SET estado='PERSISTIDA',importacao_id=j.id,concluida_em=momento WHERE id=j.id;
 PERFORM private.financeiro_auditar('VORTX_CARTEIRA_PUBLICADA',j.id,j.fundo_id,j.id,
  jsonb_build_object('pl_total',total,'cotas',jsonb_array_length(cotas),'substitui_importacao_id',anterior));
 RETURN jsonb_build_object('id',j.id,'estado','PERSISTIDA','duplicada',false);
END;
$$;

-- The row lock serializes with conclusion. Only a fenced, unreferenced attempt can be removed.
CREATE FUNCTION public.vortx_encerrar_carteira(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_carteira_execucoes%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO j FROM private.vortx_carteira_execucoes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Execucao indisponivel'; END IF;
 IF j.estado='RESERVADA' THEN
  UPDATE private.vortx_carteira_execucoes SET estado='FALHA',concluida_em=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 RETURN jsonb_build_object('estado',j.estado,'id',j.importacao_id,'podeRemoverArquivo',
  j.estado IN ('DUPLICADA','FALHA') AND NOT EXISTS(SELECT 1 FROM public.importacao_arquivos WHERE storage_bucket='vortx-carteiras' AND storage_path=j.storage_path));
END;
$$;

REVOKE ALL ON FUNCTION private.vortx_carteira_lista_valida(jsonb),private.vortx_carteira_contexto(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.vortx_reservar_carteira(uuid,uuid,date,text,bigint),
 public.vortx_concluir_carteira(uuid,uuid,jsonb),public.vortx_encerrar_carteira(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_reservar_carteira(uuid,uuid,date,text,bigint),
 public.vortx_concluir_carteira(uuid,uuid,jsonb),public.vortx_encerrar_carteira(uuid,uuid) TO service_role;
COMMIT;
