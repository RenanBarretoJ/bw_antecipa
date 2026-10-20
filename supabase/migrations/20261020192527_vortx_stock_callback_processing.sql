-- Stock processing only. Canonical callbacks/requests remain immutable and unchanged.
BEGIN;
CREATE TABLE private.vortx_estoque_processamentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fundo_id uuid NOT NULL REFERENCES public.fundos(id),
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),
 codigo_carteira text NOT NULL,
 data_referencia date NOT NULL,
 versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id),
 ativo_evento_id uuid NOT NULL REFERENCES public.vortx_relatorio_eventos(id),
 parcela_evento_id uuid NOT NULL REFERENCES public.vortx_relatorio_eventos(id),
 estado text NOT NULL DEFAULT 'PENDENTE' CHECK(estado IN ('PENDENTE','PROCESSANDO','PERSISTIDO','REVISAO','FALHA')),
 tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas BETWEEN 0 AND 3),
 manifestos jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(manifestos)='array' AND jsonb_array_length(manifestos)<=3),
 lease uuid, lease_ate timestamptz,
 importacao_id uuid REFERENCES public.importacoes_financeiras(id),
 erro text CHECK(erro IN ('DOWNLOAD_FALHOU','CONTRATO_INVALIDO','PERSISTENCIA_INDETERMINADA','INTEGRACAO_INDISPONIVEL')),
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(), atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(ativo_evento_id,parcela_evento_id),
 CHECK(ativo_evento_id<>parcela_evento_id),
 CHECK((estado='PROCESSANDO')=(lease IS NOT NULL AND lease_ate IS NOT NULL)),
 CHECK((estado IN ('PERSISTIDO','REVISAO'))=(importacao_id IS NOT NULL))
);
ALTER TABLE private.vortx_estoque_processamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_estoque_processamentos FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX vortx_estoque_processamento_pendente_idx ON private.vortx_estoque_processamentos(fundo_id,criada_em)
 WHERE estado IN ('PENDENTE','PROCESSANDO');
CREATE INDEX vortx_estoque_evento_disponivel_idx ON public.vortx_relatorio_eventos
 (fundo_id,endpoint_id,data_referencia,tipo_relatorio,recebido_em DESC,id DESC)
 WHERE correlacao='CORRELACIONADO' AND status_relatorio='Disponível'
 AND tipo_relatorio IN ('PosicaoAtivo','PosicaoParcela');

-- Definer is necessary for the private ledger: callers have no direct table grants.
-- Every exposed RPC checks the existing machine-worker contract; no user-facing write API.
CREATE FUNCTION private.vortx_par_estoque_autorizado(p_ativo uuid,p_parcela uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS (
 SELECT 1 FROM public.vortx_relatorio_eventos a
 JOIN public.vortx_relatorio_eventos p ON p.id=p_parcela
 JOIN public.vortx_relatorio_solicitacoes sa ON sa.id=a.solicitacao_id
 JOIN public.vortx_relatorio_solicitacoes sp ON sp.id=p.solicitacao_id
 JOIN private.vortx_callback_endpoints e ON e.id=a.endpoint_id AND e.id=p.endpoint_id
 JOIN public.integracao_fundo_versoes v ON v.id=sa.integracao_versao_id AND v.id=sp.integracao_versao_id
 JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id AND i.id=e.integracao_id
 JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
 WHERE a.id=p_ativo AND a.tipo_relatorio='PosicaoAtivo' AND p.tipo_relatorio='PosicaoParcela'
 AND a.correlacao='CORRELACIONADO' AND p.correlacao='CORRELACIONADO'
 AND a.status_relatorio='Disponível' AND p.status_relatorio='Disponível'
 AND a.data_expiracao>now() AND p.data_expiracao>now()
 AND a.data_referencia=p.data_referencia
 AND a.fundo_id=p.fundo_id AND a.fundo_id=f.id AND a.fundo_id=e.fundo_id
 AND sa.fundo_id=f.id AND sp.fundo_id=f.id
 AND a.ambiente=p.ambiente AND a.ambiente=v.ambiente AND a.ambiente=e.ambiente
 AND sa.ambiente=v.ambiente AND sp.ambiente=v.ambiente
 AND sa.estado='aceita' AND sp.estado='aceita'
 AND sa.protocolo_externo=a.protocolo_externo AND sp.protocolo_externo=p.protocolo_externo
 AND sa.pedido->>'tipoRelatorio'='PosicaoAtivo' AND sp.pedido->>'tipoRelatorio'='PosicaoParcela'
 AND sa.pedido->>'dataReferencia'=a.data_referencia::text AND sp.pedido->>'dataReferencia'=p.data_referencia::text
 AND e.ativo AND i.status='ativa' AND i.provider_key='VORTX'
 AND v.status='publicada' AND v.vigente_ate IS NULL AND v.adapter_key='vortx_vrs'
 AND e.codigo_carteira=v.configuracao_nao_sensivel->>'codigo_carteira'
 AND sa.pedido->>'codigoCarteira'=e.codigo_carteira AND sp.pedido->>'codigoCarteira'=e.codigo_carteira
 AND a.metadados->>'idCarteira'=e.codigo_carteira AND p.metadados->>'idCarteira'=e.codigo_carteira
 AND c.fundo_id=f.id AND c.ambiente=v.ambiente AND c.capability='ESTOQUE'
 AND c.disponivel_desde<=now() AND c.disponivel_ate IS NULL
 );
$$;
REVOKE ALL ON FUNCTION private.vortx_par_estoque_autorizado(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.vortx_reservar_processamento_estoque(p_fundo_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidato record; j private.vortx_estoque_processamentos%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF NOT pg_try_advisory_xact_lock(hashtextextended('vortx-worker:'||p_fundo_id::text,0)) THEN RETURN NULL; END IF;
 UPDATE private.vortx_estoque_processamentos SET estado='FALHA',erro='PERSISTENCIA_INDETERMINADA',
  lease=NULL,lease_ate=NULL,atualizada_em=clock_timestamp()
 WHERE fundo_id=p_fundo_id AND estado='PROCESSANDO' AND tentativas>=3 AND lease_ate<clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.vortx_estoque_processamentos WHERE fundo_id=p_fundo_id
   AND estado='PROCESSANDO' AND lease_ate>clock_timestamp()) THEN RETURN NULL; END IF;
 -- Only the newest available event of each type in each scope forms a candidate pair.
 FOR candidato IN
 WITH ultimos AS (
  SELECT DISTINCT ON (e.endpoint_id,e.data_referencia,e.tipo_relatorio,s.integracao_versao_id)
   e.*,s.integracao_versao_id
  FROM public.vortx_relatorio_eventos e JOIN public.vortx_relatorio_solicitacoes s ON s.id=e.solicitacao_id
  WHERE e.fundo_id=p_fundo_id AND e.correlacao='CORRELACIONADO' AND e.status_relatorio='Disponível'
   AND e.tipo_relatorio IN ('PosicaoAtivo','PosicaoParcela')
  ORDER BY e.endpoint_id,e.data_referencia,e.tipo_relatorio,s.integracao_versao_id,e.recebido_em DESC,e.id DESC
 ) SELECT a.id ativo,p.id parcela,a.fundo_id,a.ambiente,a.data_referencia,a.integracao_versao_id,
   a.metadados->>'idCarteira' carteira
 FROM ultimos a JOIN ultimos p ON p.endpoint_id=a.endpoint_id AND p.data_referencia=a.data_referencia
  AND p.integracao_versao_id=a.integracao_versao_id AND p.tipo_relatorio='PosicaoParcela'
 WHERE a.tipo_relatorio='PosicaoAtivo' AND private.vortx_par_estoque_autorizado(a.id,p.id)
 ORDER BY a.data_referencia DESC,a.recebido_em DESC
 LIMIT 20
 LOOP
  INSERT INTO private.vortx_estoque_processamentos(fundo_id,ambiente,codigo_carteira,data_referencia,versao_id,ativo_evento_id,parcela_evento_id)
  VALUES(candidato.fundo_id,candidato.ambiente,candidato.carteira,candidato.data_referencia,
   candidato.integracao_versao_id,candidato.ativo,candidato.parcela)
  ON CONFLICT(ativo_evento_id,parcela_evento_id) DO NOTHING;
  SELECT * INTO j FROM private.vortx_estoque_processamentos
  WHERE ativo_evento_id=candidato.ativo AND parcela_evento_id=candidato.parcela AND tentativas<3
   AND (estado='PENDENTE' OR (estado='PROCESSANDO' AND lease_ate<clock_timestamp()))
  FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
   UPDATE private.vortx_estoque_processamentos SET estado='PROCESSANDO',tentativas=tentativas+1,
    lease=gen_random_uuid(),lease_ate=clock_timestamp()+interval '10 minutes',atualizada_em=clock_timestamp()
   WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j)||jsonb_build_object(
    'ativo',(SELECT to_jsonb(e) FROM public.vortx_relatorio_eventos e WHERE id=j.ativo_evento_id),
    'parcela',(SELECT to_jsonb(e) FROM public.vortx_relatorio_eventos e WHERE id=j.parcela_evento_id));
  END IF;
 END LOOP;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_reservar_processamento_estoque(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_reservar_processamento_estoque(uuid) TO service_role;

CREATE FUNCTION public.vortx_concluir_processamento_estoque(p_id uuid,p_lease uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE; resultado jsonb; reconciliado boolean;
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
 UPDATE private.vortx_estoque_processamentos SET estado=CASE WHEN reconciliado THEN 'PERSISTIDO' ELSE 'REVISAO' END,
  importacao_id=(resultado->>'id')::uuid,lease=NULL,lease_ate=NULL,erro=NULL,atualizada_em=clock_timestamp()
 WHERE id=j.id;
 DELETE FROM private.vortx_estoque_blocos WHERE processamento_id=j.id;
 PERFORM private.financeiro_auditar('VORTX_CALLBACK_ESTOQUE_PROCESSADO',(resultado->>'id')::uuid,j.fundo_id,
  (p_payload->>'correlation_id')::uuid,jsonb_build_object('processamento_id',j.id,
   'ativo_evento_id',j.ativo_evento_id,'parcela_evento_id',j.parcela_evento_id,'reconciliado',reconciliado));
 RETURN resultado||jsonb_build_object('reconciliado',reconciliado);
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_concluir_processamento_estoque(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_concluir_processamento_estoque(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.vortx_falhar_processamento_estoque(p_id uuid,p_lease uuid,p_erro text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE alterados integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF p_erro NOT IN ('DOWNLOAD_FALHOU','CONTRATO_INVALIDO','PERSISTENCIA_INDETERMINADA','INTEGRACAO_INDISPONIVEL') OR p_erro IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Motivo de processamento invalido';
 END IF;
 UPDATE private.vortx_estoque_processamentos SET estado='FALHA',erro=p_erro,lease=NULL,lease_ate=NULL,atualizada_em=clock_timestamp()
 WHERE id=p_id AND estado='PROCESSANDO' AND lease=p_lease AND lease_ate>clock_timestamp();
 GET DIAGNOSTICS alterados=ROW_COUNT;
 RETURN alterados=1;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_falhar_processamento_estoque(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_falhar_processamento_estoque(uuid,uuid,text) TO service_role;
COMMENT ON TABLE private.vortx_estoque_processamentos IS 'Internal stock inbox processing ledger. No signed URLs or raw callback JSON. Persistence is not financial publication.';
CREATE TABLE private.vortx_estoque_blocos (
 processamento_id uuid NOT NULL REFERENCES private.vortx_estoque_processamentos(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK(tipo IN ('ativos','parcelas')),
 ordem integer NOT NULL CHECK(ordem BETWEEN 1 AND 100000),
 linhas jsonb NOT NULL CHECK(jsonb_typeof(linhas)='array'),
 quantidade integer NOT NULL CHECK(quantidade BETWEEN 1 AND 500),
 PRIMARY KEY(processamento_id,tipo,ordem),
 CHECK(jsonb_array_length(linhas)=quantidade),CHECK(octet_length(linhas::text)<=3145728)
);
ALTER TABLE private.vortx_estoque_blocos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_estoque_blocos FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.vortx_estoque_blocos IS 'Bounded transport staging only. Deleted atomically after successful native persistence; original private CSVs, native rows and processing audit are preserved.';

CREATE FUNCTION public.vortx_estagiar_linhas_estoque(p_id uuid,p_lease uuid,p_tipo text,p_ordem integer,p_linhas jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE; anterior jsonb; n integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO j FROM private.vortx_estoque_processamentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.estado<>'PROCESSANDO' OR j.lease IS DISTINCT FROM p_lease OR j.lease_ate<=clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Lease do bloco indisponivel';
 END IF;
 IF p_tipo IS NULL OR p_tipo NOT IN ('ativos','parcelas') OR p_ordem IS NULL OR p_ordem NOT BETWEEN 1 AND 100000
  OR jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Bloco de estoque invalido';
 END IF;
 n:=jsonb_array_length(p_linhas);
 IF n NOT BETWEEN 1 AND 500 OR octet_length(p_linhas::text)>3145728 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Bloco de estoque fora do limite';
 END IF;
 SELECT linhas INTO anterior FROM private.vortx_estoque_blocos WHERE processamento_id=p_id AND tipo=p_tipo AND ordem=p_ordem;
 IF FOUND THEN
  IF anterior IS DISTINCT FROM p_linhas THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Conteudo conflitante no bloco'; END IF;
  RETURN n;
 END IF;
 IF (SELECT coalesce(sum(quantidade),0)+n FROM private.vortx_estoque_blocos WHERE processamento_id=p_id AND tipo=p_tipo)>100000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quantidade de linhas acima do limite';
 END IF;
 INSERT INTO private.vortx_estoque_blocos(processamento_id,tipo,ordem,linhas,quantidade) VALUES(p_id,p_tipo,p_ordem,p_linhas,n);
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_estagiar_linhas_estoque(uuid,uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_estagiar_linhas_estoque(uuid,uuid,text,integer,jsonb) TO service_role;

CREATE FUNCTION private.vortx_validar_payload_estagiado(p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE; tipo_linhas text; total integer; menor integer; maior integer; distintos integer;
BEGIN
 SELECT * INTO j FROM private.vortx_estoque_processamentos WHERE id=(p_payload->>'processamento_id')::uuid FOR UPDATE;
 IF NOT FOUND OR j.estado<>'PROCESSANDO' OR j.lease::text IS DISTINCT FROM p_payload->>'processamento_lease'
 OR j.lease_ate<=clock_timestamp() OR j.fundo_id::text IS DISTINCT FROM p_payload->>'fundo_id'
 OR j.ambiente IS DISTINCT FROM p_payload->>'ambiente' OR j.codigo_carteira IS DISTINCT FROM p_payload->>'codigo_carteira'
 OR j.data_referencia::text IS DISTINCT FROM p_payload->>'data_referencia'
 OR j.versao_id::text IS DISTINCT FROM p_payload->>'integracao_fundo_versao_id' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Escopo do manifesto indisponivel';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.manifestos) m WHERE m->>'lease'=j.lease::text AND m->'payload'=p_payload) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manifesto de arquivos nao reservado';
 END IF;
 FOREACH tipo_linhas IN ARRAY ARRAY['ativos','parcelas'] LOOP
  IF NOT EXISTS(SELECT 1 FROM private.vortx_estoque_blocos WHERE processamento_id=j.id AND tipo=tipo_linhas)
  OR EXISTS(SELECT 1 FROM private.vortx_estoque_blocos WHERE processamento_id=j.id AND tipo=tipo_linhas
    GROUP BY processamento_id,tipo HAVING min(ordem)<>1 OR max(ordem)<>count(*)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Sequencia de blocos incompleta';
  END IF;
  SELECT count(*)::int,min((r->>'numero_linha')::int),max((r->>'numero_linha')::int),count(DISTINCT (r->>'numero_linha')::int)::int
   INTO total,menor,maior,distintos
  FROM private.vortx_estoque_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r
  WHERE processamento_id=j.id AND tipo=tipo_linhas;
  IF total NOT BETWEEN 1 AND 100000 OR total IS DISTINCT FROM (p_payload->>(tipo_linhas||'_total'))::int
    OR menor<>2 OR maior<>total+1 OR distintos<>total THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cobertura das linhas do manifesto incompleta';
  END IF;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_validar_payload_estagiado(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.vortx_linhas_quantidade(p_payload jsonb,p_tipo text) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN p_payload ? 'processamento_id' THEN
  (SELECT coalesce(sum(quantidade),0)::integer FROM private.vortx_estoque_blocos
   WHERE processamento_id=(p_payload->>'processamento_id')::uuid AND tipo=p_tipo)
 ELSE jsonb_array_length(p_payload->p_tipo) END;
$$;
REVOKE ALL ON FUNCTION private.vortx_linhas_quantidade(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.vortx_linhas_importacao(p_payload jsonb,p_tipo text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT r FROM private.vortx_estoque_blocos b CROSS JOIN LATERAL jsonb_array_elements(b.linhas) r
 WHERE p_payload ? 'processamento_id' AND b.processamento_id=(p_payload->>'processamento_id')::uuid AND b.tipo=p_tipo
 UNION ALL
 SELECT r FROM jsonb_array_elements(coalesce(p_payload->p_tipo,'[]'::jsonb)) r WHERE NOT p_payload ? 'processamento_id';
$$;
REVOKE ALL ON FUNCTION private.vortx_linhas_importacao(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.vortx_reservar_manifesto_estoque(p_id uuid,p_lease uuid,p_manifesto jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.vortx_estoque_processamentos%ROWTYPE; anterior jsonb; f jsonb; total integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF jsonb_typeof(p_manifesto) IS DISTINCT FROM 'object' OR octet_length(p_manifesto::text)>16384
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_manifesto) k WHERE k NOT IN
  ('id','correlation_id','fundo_id','integracao_fundo_versao_id','ambiente','codigo_carteira','data_referencia','hash_conteudo',
   'arquivos','processamento_id','processamento_lease','ativos_total','parcelas_total')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Manifesto fora do contrato';
 END IF;
 SELECT * INTO j FROM private.vortx_estoque_processamentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.estado<>'PROCESSANDO' OR j.lease IS DISTINCT FROM p_lease OR j.lease_ate<=clock_timestamp()
 OR p_manifesto->>'processamento_id' IS DISTINCT FROM j.id::text OR p_manifesto->>'processamento_lease' IS DISTINCT FROM j.lease::text
 OR p_manifesto->>'fundo_id' IS DISTINCT FROM j.fundo_id::text OR p_manifesto->>'ambiente' IS DISTINCT FROM j.ambiente
 OR p_manifesto->>'codigo_carteira' IS DISTINCT FROM j.codigo_carteira OR p_manifesto->>'data_referencia' IS DISTINCT FROM j.data_referencia::text
 OR p_manifesto->>'integracao_fundo_versao_id' IS DISTINCT FROM j.versao_id::text THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reserva dos arquivos indisponivel';
 END IF;
 IF jsonb_array_length(p_manifesto->'arquivos') IS DISTINCT FROM 2
  OR coalesce(p_manifesto->>'hash_conteudo','') !~ '^[0-9a-f]{64}$' OR (p_manifesto->>'id') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manifesto dos arquivos invalido';
 END IF;
 total:=0;
 FOR f IN SELECT value FROM jsonb_array_elements(p_manifesto->'arquivos') LOOP
  total:=total+1;
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN
    ('id','ordem','nome_arquivo','tamanho_bytes','hash_conteudo','storage_bucket','storage_path'))
   OR coalesce(f->>'nome_arquivo','') !~ '^[a-zA-Z0-9._-]{1,160}$'
   OR f->>'storage_bucket' IS DISTINCT FROM 'financeiro-importacoes'
   OR f->>'storage_path' IS DISTINCT FROM j.fundo_id::text||'/vortx/'||(p_manifesto->>'id')||'/'||total::text||'.csv'
   OR (f->>'ordem')::integer IS DISTINCT FROM total OR coalesce((f->>'tamanho_bytes')::bigint,0) NOT BETWEEN 1 AND 20971520
   OR coalesce(f->>'hash_conteudo','') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Arquivo do manifesto fora do escopo';
  END IF;
 END LOOP;
 SELECT m->'payload' INTO anterior FROM jsonb_array_elements(j.manifestos) m WHERE m->>'lease'=j.lease::text;
 IF FOUND THEN
  IF anterior IS DISTINCT FROM p_manifesto THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manifesto conflitante'; END IF;
  RETURN true;
 END IF;
 UPDATE private.vortx_estoque_processamentos SET manifestos=manifestos||jsonb_build_array(jsonb_build_object('lease',j.lease,'payload',p_manifesto)),
  atualizada_em=clock_timestamp() WHERE id=j.id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_reservar_manifesto_estoque(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vortx_reservar_manifesto_estoque(uuid,uuid,jsonb) TO service_role;
-- Forward replacement: same authorization, lineage, constraints, audit and deduplication.
-- Only row/count access is generalized to bounded staging; legacy array callers remain supported.
CREATE OR REPLACE FUNCTION public.persistir_estoque_vortx(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_id uuid := (p_payload->>'id')::uuid;
 v_fundo uuid := (p_payload->>'fundo_id')::uuid;
 v_versao uuid := (p_payload->>'integracao_fundo_versao_id')::uuid;
 v_ambiente text := p_payload->>'ambiente';
 v_carteira text := p_payload->>'codigo_carteira';
 v_data date := (p_payload->>'data_referencia')::date;
 v_hash text := p_payload->>'hash_conteudo';
 v_duplicate public.importacoes_financeiras%ROWTYPE;
 v_file jsonb;
 v_divergente boolean;
BEGIN
 IF NOT private.financeiro_chamada_service_role() THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Persistencia Vortx restrita ao worker interno';
 END IF;
 IF p_payload ? 'processamento_id' THEN PERFORM private.vortx_validar_payload_estagiado(p_payload); END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.integracao_fundo_versoes v
   JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
   JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
   JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
   WHERE v.id=v_versao AND i.fundo_id=v_fundo AND i.status='ativa' AND i.provider_key='VORTX' AND v.status='publicada'
     AND v.adapter_key='vortx_vrs' AND v.ambiente=v_ambiente
     AND v.configuracao_nao_sensivel->>'codigo_carteira'=v_carteira
     AND c.fundo_id=v_fundo AND c.ambiente=v_ambiente AND c.capability='ESTOQUE'
     AND c.disponivel_desde<=now() AND c.disponivel_ate IS NULL AND v.vigente_ate IS NULL
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Escopo Vortx nao autorizado ou indisponivel'; END IF;
 IF coalesce(private.vortx_linhas_quantidade(p_payload,'ativos'),0) NOT BETWEEN 1 AND 100000
 OR coalesce(private.vortx_linhas_quantidade(p_payload,'parcelas'),0) NOT BETWEEN 1 AND 100000
 OR coalesce(jsonb_array_length(p_payload->'arquivos'),0)<>2 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='O estoque exige o par completo ativo e parcela';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-stock:'||v_fundo::text||':'||v_hash,0));
 SELECT * INTO v_duplicate FROM public.importacoes_financeiras
 WHERE fundo_id=v_fundo AND tipo_base='ESTOQUE' AND data_referencia=v_data AND hash_conteudo=v_hash;
 IF FOUND THEN
   IF v_duplicate.provedor<>'VORTX' OR v_duplicate.fonte_ambiente<>v_ambiente OR v_duplicate.fonte_carteira<>v_carteira THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Colisao de identidade da importacao';
   END IF;
   RETURN jsonb_build_object('id',v_duplicate.id,'status',v_duplicate.status,'duplicada',true);
 END IF;
 v_file:=p_payload->'arquivos'->0;
 INSERT INTO public.importacoes_financeiras(
   id,fundo_id,provedor,tipo_base,data_referencia,versao_layout,layout_nome,status,completude,
   origem,integracao_fundo_versao_id,fonte_ambiente,fonte_carteira,hash_conteudo,
   nome_arquivo,mime_type,tamanho_bytes,storage_bucket,storage_path,correlation_id,metadados,encoding_detectado
 ) VALUES (
   v_id,v_fundo,'VORTX','ESTOQUE',v_data,'VORTX_ESTOQUE_V1','VORTX_ATIVO_PARCELA_V1','VALIDANDO','COMPLETO_COM_DADOS',
   'CRON',v_versao,v_ambiente,v_carteira,v_hash,
   v_file->>'nome_arquivo','text/csv',(v_file->>'tamanho_bytes')::bigint,'financeiro-importacoes',
   v_file->>'storage_path',(p_payload->>'correlation_id')::uuid,
   jsonb_build_object('origem','VORTX_ATIVO_PARCELA_V1','ativos',private.vortx_linhas_quantidade(p_payload,'ativos'),
     'parcelas',private.vortx_linhas_quantidade(p_payload,'parcelas')),'utf-8'
 );
 FOR v_file IN SELECT value FROM jsonb_array_elements(p_payload->'arquivos') LOOP
   IF v_file->>'storage_bucket' IS DISTINCT FROM 'financeiro-importacoes'
      OR (v_file->>'storage_path') NOT LIKE v_fundo::text||'/vortx/'||v_id::text||'/%'
      OR (v_file->>'tamanho_bytes')::bigint NOT BETWEEN 1 AND 20971520 THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Arquivo Vortx fora do escopo privado';
   END IF;
   INSERT INTO public.importacao_arquivos(id,importacao_id,fundo_id,ordem,nome_arquivo,mime_type,
     tamanho_bytes,hash_conteudo,storage_bucket,storage_path)
   VALUES((v_file->>'id')::uuid,v_id,v_fundo,(v_file->>'ordem')::int,v_file->>'nome_arquivo','text/csv',
     (v_file->>'tamanho_bytes')::bigint,v_file->>'hash_conteudo','financeiro-importacoes',v_file->>'storage_path');
 END LOOP;
 SELECT value INTO STRICT v_file FROM jsonb_array_elements(p_payload->'arquivos') WHERE (value->>'ordem')::int=1;
 INSERT INTO public.vortx_posicao_ativos(importacao_id,fundo_id,arquivo_id,numero_linha,ambiente,codigo_carteira,data_referencia,identidade_ativo,chave_ativo,cedente_documento,cedente_nome,sacado_documento,sacado_nome,tipo_recebivel,valor_nominal,valor_aquisicao,valor_presente,valor_pdd,data_emissao,data_aquisicao,data_vencimento,data_vencimento_original,status_entrada_provedor,dados_brutos,dados_normalizados)
 SELECT v_id,v_fundo,(v_file->>'id')::uuid,(r->>'numero_linha')::int,v_ambiente,v_carteira,v_data,nullif(r->'dados_normalizados'->>'identidade_ativo',''),nullif(r->'dados_normalizados'->>'chave_ativo',''),nullif(r->'dados_normalizados'->>'cedente_documento',''),nullif(r->'dados_normalizados'->>'cedente_nome',''),nullif(r->'dados_normalizados'->>'sacado_documento',''),nullif(r->'dados_normalizados'->>'sacado_nome',''),nullif(r->'dados_normalizados'->>'tipo_recebivel',''),nullif(r->'dados_normalizados'->>'valor_nominal','')::numeric,nullif(r->'dados_normalizados'->>'valor_aquisicao','')::numeric,nullif(r->'dados_normalizados'->>'valor_presente','')::numeric,nullif(r->'dados_normalizados'->>'valor_pdd','')::numeric,nullif(r->'dados_normalizados'->>'data_emissao','')::date,nullif(r->'dados_normalizados'->>'data_aquisicao','')::date,nullif(r->'dados_normalizados'->>'data_vencimento','')::date,nullif(r->'dados_normalizados'->>'data_vencimento_original','')::date,nullif(r->'dados_normalizados'->>'status_entrada_provedor',''),r->'dados_brutos',r->'dados_normalizados'
 FROM private.vortx_linhas_importacao(p_payload,'ativos') r;
 SELECT value INTO STRICT v_file FROM jsonb_array_elements(p_payload->'arquivos') WHERE (value->>'ordem')::int=2;
 INSERT INTO public.vortx_posicao_parcelas(importacao_id,fundo_id,arquivo_id,numero_linha,ambiente,codigo_carteira,data_referencia,identidade_ativo,chave_ativo,cedente_documento,cedente_nome,sacado_documento,sacado_nome,tipo_recebivel,valor_nominal,valor_aquisicao,valor_presente,valor_pdd,data_emissao,data_aquisicao,data_vencimento,data_vencimento_original,status_entrada_provedor,dados_brutos,dados_normalizados,chave_parcela,external_title_key)
 SELECT v_id,v_fundo,(v_file->>'id')::uuid,(r->>'numero_linha')::int,v_ambiente,v_carteira,v_data,nullif(r->'dados_normalizados'->>'identidade_ativo',''),nullif(r->'dados_normalizados'->>'chave_ativo',''),nullif(r->'dados_normalizados'->>'cedente_documento',''),nullif(r->'dados_normalizados'->>'cedente_nome',''),nullif(r->'dados_normalizados'->>'sacado_documento',''),nullif(r->'dados_normalizados'->>'sacado_nome',''),nullif(r->'dados_normalizados'->>'tipo_recebivel',''),nullif(r->'dados_normalizados'->>'valor_nominal','')::numeric,nullif(r->'dados_normalizados'->>'valor_aquisicao','')::numeric,nullif(r->'dados_normalizados'->>'valor_presente','')::numeric,nullif(r->'dados_normalizados'->>'valor_pdd','')::numeric,nullif(r->'dados_normalizados'->>'data_emissao','')::date,nullif(r->'dados_normalizados'->>'data_aquisicao','')::date,nullif(r->'dados_normalizados'->>'data_vencimento','')::date,nullif(r->'dados_normalizados'->>'data_vencimento_original','')::date,nullif(r->'dados_normalizados'->>'status_entrada_provedor',''),r->'dados_brutos',r->'dados_normalizados',nullif(r->'dados_normalizados'->>'chave_parcela',''),nullif(r->'dados_normalizados'->>'external_title_key','')
 FROM private.vortx_linhas_importacao(p_payload,'parcelas') r;

 -- Entry status is historical metadata, never managerial delivery evidence.
 IF EXISTS(SELECT 1 FROM public.vortx_posicao_parcelas p JOIN public.vortx_posicao_ativos a
   USING(importacao_id,identidade_ativo) WHERE p.importacao_id=v_id
   AND (p.sacado_documento<>a.sacado_documento OR p.cedente_documento<>a.cedente_documento
     OR (p.status_entrada_provedor<>'NAO_INFORMADO' AND a.status_entrada_provedor<>'NAO_INFORMADO'
       AND p.status_entrada_provedor<>a.status_entrada_provedor))) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Identidade ou estado de entrada divergente';
 END IF;
 v_divergente := NOT private.vortx_estoque_reconciliado(v_id);
 UPDATE public.importacoes_financeiras SET status='VALIDA',
   linhas_total=private.vortx_linhas_quantidade(p_payload,'ativos')+private.vortx_linhas_quantidade(p_payload,'parcelas'),
   linhas_validas=private.vortx_linhas_quantidade(p_payload,'ativos')+private.vortx_linhas_quantidade(p_payload,'parcelas'),
   valor_total=(SELECT sum(valor_aquisicao) FROM public.vortx_posicao_parcelas WHERE importacao_id=v_id),
   metadados=metadados||jsonb_build_object('reconciliado',NOT v_divergente),
   validacao_concluida_em=clock_timestamp()
 WHERE id=v_id;
 PERFORM private.financeiro_auditar('VORTX_ESTOQUE_PRESERVADO',v_id,v_fundo,
   (p_payload->>'correlation_id')::uuid,jsonb_build_object('reconciliado',NOT v_divergente));
 RETURN jsonb_build_object('id',v_id,'status','VALIDA','duplicada',false,'reconciliado',NOT v_divergente);
END;
$$;
REVOKE ALL ON FUNCTION public.persistir_estoque_vortx(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persistir_estoque_vortx(jsonb) TO service_role;
COMMIT;
