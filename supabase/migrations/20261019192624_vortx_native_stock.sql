-- Vortx native positions. Forward-only; legacy rows and historical migrations untouched.
BEGIN;

ALTER TABLE public.importacoes_financeiras
  ADD COLUMN fonte_ambiente text,
  ADD COLUMN fonte_carteira text,
  ADD CONSTRAINT importacoes_vortx_escopo_check CHECK (
    provedor <> 'VORTX' OR (tipo_base = 'ESTOQUE'
      AND fonte_ambiente IS NOT NULL AND fonte_ambiente IN ('homologacao','producao')
      AND fonte_carteira IS NOT NULL AND length(fonte_carteira) BETWEEN 1 AND 120
      AND integracao_fundo_versao_id IS NOT NULL)
  ) NOT VALID;
-- No reinterpretation/backfill of any preexisting Vortx import: fail instead.
ALTER TABLE public.importacoes_financeiras VALIDATE CONSTRAINT importacoes_vortx_escopo_check;
CREATE FUNCTION private.vortx_proteger_escopo_importacao() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.provedor='VORTX' AND ROW(NEW.fundo_id,NEW.provedor,NEW.tipo_base,NEW.data_referencia,
   NEW.fonte_ambiente,NEW.fonte_carteira,NEW.integracao_fundo_versao_id,NEW.hash_conteudo)
   IS DISTINCT FROM ROW(OLD.fundo_id,OLD.provedor,OLD.tipo_base,OLD.data_referencia,
   OLD.fonte_ambiente,OLD.fonte_carteira,OLD.integracao_fundo_versao_id,OLD.hash_conteudo) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Escopo historico Vortx imutavel';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_proteger_escopo_importacao() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER vortx_importacao_escopo_imutavel BEFORE UPDATE ON public.importacoes_financeiras
 FOR EACH ROW EXECUTE FUNCTION private.vortx_proteger_escopo_importacao();
DROP INDEX public.importacoes_publicada_unica_idx;
CREATE UNIQUE INDEX importacoes_publicada_unica_idx
  ON public.importacoes_financeiras(fundo_id,tipo_base,data_referencia)
  WHERE status = 'PUBLICADA' AND provedor <> 'VORTX';
CREATE UNIQUE INDEX importacoes_vortx_publicada_unica_idx
  ON public.importacoes_financeiras(fundo_id,tipo_base,data_referencia,fonte_ambiente,fonte_carteira)
  WHERE status = 'PUBLICADA' AND provedor = 'VORTX';

CREATE TABLE public.vortx_posicao_ativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.importacoes_financeiras(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  arquivo_id uuid NOT NULL REFERENCES public.importacao_arquivos(id) ON DELETE RESTRICT,
  numero_linha integer NOT NULL CHECK (numero_linha > 1),
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao','producao')),
  codigo_carteira text NOT NULL CHECK (length(codigo_carteira) BETWEEN 1 AND 120),
  data_referencia date NOT NULL,
  identidade_ativo text NOT NULL CHECK (identidade_ativo ~ '^[0-9a-f]{64}$'),
  chave_ativo text NOT NULL CHECK (length(chave_ativo) > 0),
  cedente_documento text NOT NULL CHECK (cedente_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  cedente_nome text,
  sacado_documento text NOT NULL CHECK (sacado_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  sacado_nome text,
  tipo_recebivel text NOT NULL,
  valor_nominal numeric(24,4) NOT NULL CHECK (valor_nominal >= 0),
  valor_aquisicao numeric(24,4) NOT NULL CHECK (valor_aquisicao >= 0),
  valor_presente numeric(24,4),
  valor_pdd numeric(24,4),
  data_emissao date,
  data_aquisicao date NOT NULL,
  data_vencimento date NOT NULL,
  data_vencimento_original date NOT NULL,
  status_entrada_provedor text NOT NULL CHECK (status_entrada_provedor IN ('ENTREGUE','EM_TRANSITO','NAO_INFORMADO')),
  dados_brutos jsonb NOT NULL CHECK (jsonb_typeof(dados_brutos) = 'object'),
  dados_normalizados jsonb NOT NULL CHECK (jsonb_typeof(dados_normalizados) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(importacao_id,identidade_ativo),
  UNIQUE(importacao_id,cedente_documento,chave_ativo),
  UNIQUE(importacao_id,arquivo_id,numero_linha)
);
CREATE TABLE public.vortx_posicao_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.importacoes_financeiras(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  arquivo_id uuid NOT NULL REFERENCES public.importacao_arquivos(id) ON DELETE RESTRICT,
  numero_linha integer NOT NULL CHECK (numero_linha > 1),
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao','producao')),
  codigo_carteira text NOT NULL CHECK (length(codigo_carteira) BETWEEN 1 AND 120),
  data_referencia date NOT NULL,
  identidade_ativo text NOT NULL CHECK (identidade_ativo ~ '^[0-9a-f]{64}$'),
  chave_ativo text NOT NULL CHECK (length(chave_ativo) > 0),
  cedente_documento text NOT NULL CHECK (cedente_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  cedente_nome text,
  sacado_documento text NOT NULL CHECK (sacado_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  sacado_nome text,
  tipo_recebivel text NOT NULL,
  valor_nominal numeric(24,4) NOT NULL CHECK (valor_nominal >= 0),
  valor_aquisicao numeric(24,4) NOT NULL CHECK (valor_aquisicao >= 0),
  valor_presente numeric(24,4),
  valor_pdd numeric(24,4),
  data_emissao date,
  data_aquisicao date NOT NULL,
  data_vencimento date NOT NULL,
  data_vencimento_original date NOT NULL,
  status_entrada_provedor text NOT NULL CHECK (status_entrada_provedor IN ('ENTREGUE','EM_TRANSITO','NAO_INFORMADO')),
  dados_brutos jsonb NOT NULL CHECK (jsonb_typeof(dados_brutos) = 'object'),
  dados_normalizados jsonb NOT NULL CHECK (jsonb_typeof(dados_normalizados) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  chave_parcela text NOT NULL CHECK (length(chave_parcela) > 0),
  external_title_key text NOT NULL CHECK (external_title_key ~ '^[0-9a-f]{64}$'),
  UNIQUE(importacao_id,external_title_key),
  UNIQUE(importacao_id,cedente_documento,chave_ativo,chave_parcela),
  UNIQUE(importacao_id,arquivo_id,numero_linha),
  FOREIGN KEY(importacao_id,identidade_ativo)
    REFERENCES public.vortx_posicao_ativos(importacao_id,identidade_ativo) ON DELETE RESTRICT
);
CREATE INDEX vortx_ativos_fundo_data_idx ON public.vortx_posicao_ativos(fundo_id,data_referencia,ambiente,codigo_carteira);
ALTER TABLE public.vortx_posicao_ativos ADD CONSTRAINT vortx_ativos_valores_finitos CHECK (
 valor_nominal<>'NaN'::numeric AND valor_aquisicao<>'NaN'::numeric
 AND valor_presente IS DISTINCT FROM 'NaN'::numeric AND valor_pdd IS DISTINCT FROM 'NaN'::numeric);
ALTER TABLE public.vortx_posicao_parcelas ADD CONSTRAINT vortx_parcelas_valores_finitos CHECK (
 valor_nominal<>'NaN'::numeric AND valor_aquisicao<>'NaN'::numeric
 AND valor_presente IS DISTINCT FROM 'NaN'::numeric AND valor_pdd IS DISTINCT FROM 'NaN'::numeric);
CREATE INDEX vortx_parcelas_fundo_data_idx ON public.vortx_posicao_parcelas(fundo_id,data_referencia,ambiente,codigo_carteira);
CREATE INDEX vortx_parcelas_ativo_idx ON public.vortx_posicao_parcelas(importacao_id,identidade_ativo);
CREATE INDEX vortx_ativos_arquivo_idx ON public.vortx_posicao_ativos(arquivo_id);
CREATE INDEX vortx_parcelas_arquivo_idx ON public.vortx_posicao_parcelas(arquivo_id);

ALTER TABLE public.vortx_posicao_ativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vortx_posicao_parcelas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vortx_posicao_ativos,public.vortx_posicao_parcelas FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vortx_posicao_ativos,public.vortx_posicao_parcelas TO authenticated;
GRANT SELECT,INSERT ON public.vortx_posicao_ativos,public.vortx_posicao_parcelas TO service_role;
CREATE POLICY vortx_ativos_gestor_select ON public.vortx_posicao_ativos FOR SELECT TO authenticated
 USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY vortx_parcelas_gestor_select ON public.vortx_posicao_parcelas FOR SELECT TO authenticated
 USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY vortx_ativos_worker ON public.vortx_posicao_ativos FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY vortx_parcelas_worker ON public.vortx_posicao_parcelas FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION private.vortx_validar_linhagem_posicao() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.importacoes_financeiras i
    JOIN public.importacao_arquivos a ON a.importacao_id=i.id AND a.fundo_id=i.fundo_id
    WHERE i.id=NEW.importacao_id AND i.fundo_id=NEW.fundo_id AND a.id=NEW.arquivo_id
      AND i.provedor='VORTX' AND i.tipo_base='ESTOQUE' AND i.status='VALIDANDO'
      AND i.fonte_ambiente=NEW.ambiente AND i.fonte_carteira=NEW.codigo_carteira
      AND i.data_referencia=NEW.data_referencia
      AND a.ordem=CASE WHEN TG_TABLE_NAME='vortx_posicao_ativos' THEN 1 ELSE 2 END
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Linhagem da posicao Vortx incompativel'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.vortx_validar_linhagem_posicao() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER vortx_ativos_linhagem BEFORE INSERT ON public.vortx_posicao_ativos
 FOR EACH ROW EXECUTE FUNCTION private.vortx_validar_linhagem_posicao();
CREATE TRIGGER vortx_parcelas_linhagem BEFORE INSERT ON public.vortx_posicao_parcelas
 FOR EACH ROW EXECUTE FUNCTION private.vortx_validar_linhagem_posicao();
CREATE TRIGGER vortx_ativos_imutaveis BEFORE UPDATE OR DELETE ON public.vortx_posicao_ativos
 FOR EACH ROW EXECUTE FUNCTION private.matching_bloquear_mutacao_historica();
CREATE TRIGGER vortx_parcelas_imutaveis BEFORE UPDATE OR DELETE ON public.vortx_posicao_parcelas
 FOR EACH ROW EXECUTE FUNCTION private.matching_bloquear_mutacao_historica();

-- Projection is read-only and uses caller RLS, never a physical merge.
CREATE VIEW public.estoque_fontes_leitura WITH (security_invoker=true) AS
 SELECT p.id,p.importacao_id,p.fundo_id,p.provedor,p.data_referencia,
   p.id_recebivel,p.seu_numero,p.numero_documento,p.tipo_recebivel,p.chave_nfe,
   p.cedente_nome,p.cedente_documento,p.sacado_nome,p.sacado_documento,
   p.valor_nominal,p.valor_presente,p.valor_aquisicao,p.valor_pdd,p.data_emissao,
   p.data_vencimento_original,p.data_aquisicao,p.situacao_recebivel,
   p.vigente,p.publicada_em,p.external_title_key,p.payload_origem,
   NULL::text status_entrada_provedor
 FROM public.estoque_posicoes p
 UNION ALL
 SELECT p.id,p.importacao_id,p.fundo_id,'VORTX'::text,p.data_referencia,
   p.external_title_key,NULL::text,NULL::text,p.tipo_recebivel,NULL::text,
   p.cedente_nome,p.cedente_documento,p.sacado_nome,p.sacado_documento,
   p.valor_nominal,p.valor_presente,p.valor_aquisicao,p.valor_pdd,p.data_emissao,
   p.data_vencimento_original,p.data_aquisicao,NULL::text,
   i.status='PUBLICADA',i.publicada_em,p.external_title_key,p.dados_brutos,
   CASE WHEN p.status_entrada_provedor='NAO_INFORMADO' THEN a.status_entrada_provedor
     ELSE p.status_entrada_provedor END
 FROM public.vortx_posicao_parcelas p
 JOIN public.vortx_posicao_ativos a ON a.importacao_id=p.importacao_id AND a.identidade_ativo=p.identidade_ativo
 JOIN public.importacoes_financeiras i ON i.id=p.importacao_id AND i.fundo_id=p.fundo_id
 WHERE i.provedor='VORTX' AND i.status IN ('PUBLICADA','RETIFICADA');
REVOKE ALL ON public.estoque_fontes_leitura FROM PUBLIC,anon;
GRANT SELECT ON public.estoque_fontes_leitura TO authenticated,service_role;

ALTER TABLE public.posicao_logistica_resultados
 ALTER COLUMN estoque_posicao_id DROP NOT NULL,
 ADD COLUMN vortx_posicao_parcela_id uuid REFERENCES public.vortx_posicao_parcelas(id) ON DELETE RESTRICT,
 ADD CONSTRAINT logistica_fonte_exclusiva CHECK(num_nonnulls(estoque_posicao_id,vortx_posicao_parcela_id)=1),
 ADD CONSTRAINT logistica_vortx_execucao_unique UNIQUE(execucao_id,vortx_posicao_parcela_id);
CREATE INDEX logistica_vortx_parcela_idx ON public.posicao_logistica_resultados(vortx_posicao_parcela_id)
 WHERE vortx_posicao_parcela_id IS NOT NULL;

CREATE FUNCTION private.vortx_estoque_reconciliado(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.vortx_posicao_ativos WHERE importacao_id=p_id)
 AND EXISTS(SELECT 1 FROM public.vortx_posicao_parcelas WHERE importacao_id=p_id)
 AND NOT EXISTS(
   SELECT 1 FROM public.vortx_posicao_ativos a
   LEFT JOIN (SELECT identidade_ativo,count(*) n,sum(valor_nominal) nominal,sum(valor_aquisicao) aquisicao,
     sum(valor_presente) presente,sum(valor_pdd) pdd,
     count(*) FILTER(WHERE valor_presente IS NULL OR valor_pdd IS NULL) ausentes
     FROM public.vortx_posicao_parcelas WHERE importacao_id=p_id GROUP BY identidade_ativo) p
     ON p.identidade_ativo=a.identidade_ativo
   WHERE a.importacao_id=p_id AND (p.n IS NULL OR p.ausentes>0
     OR a.valor_presente IS NULL OR a.valor_pdd IS NULL OR p.nominal<>a.valor_nominal
     OR p.aquisicao<>a.valor_aquisicao OR p.presente<>a.valor_presente OR p.pdd<>a.valor_pdd)
 );
$$;
REVOKE ALL ON FUNCTION private.vortx_estoque_reconciliado(uuid) FROM PUBLIC,anon,authenticated;

-- Internal worker contract only: no user-facing write path, no callback transport.
CREATE FUNCTION public.financeiro_possui_historico_fonte_vortx(p_fundo_id uuid,p_ambiente text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.financeiro_chamada_service_role() THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Resolucao de fonte restrita ao leitor interno';
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.integracoes_fundo i
   JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id=i.id
   JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
   WHERE i.fundo_id=p_fundo_id AND i.provider_key='VORTX' AND v.ambiente=p_ambiente
     AND v.publicada_em IS NOT NULL AND c.fundo_id=p_fundo_id
     AND c.ambiente=p_ambiente AND c.capability='ESTOQUE');
END;
$$;
REVOKE ALL ON FUNCTION public.financeiro_possui_historico_fonte_vortx(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_possui_historico_fonte_vortx(uuid,text) TO service_role;

CREATE FUNCTION public.persistir_estoque_vortx(p_payload jsonb) RETURNS jsonb
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
 IF coalesce(jsonb_array_length(p_payload->'ativos'),0) NOT BETWEEN 1 AND 100000
 OR coalesce(jsonb_array_length(p_payload->'parcelas'),0) NOT BETWEEN 1 AND 100000
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
   jsonb_build_object('origem','VORTX_ATIVO_PARCELA_V1','ativos',jsonb_array_length(p_payload->'ativos'),
     'parcelas',jsonb_array_length(p_payload->'parcelas')),'utf-8'
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
 FROM jsonb_array_elements(p_payload->'ativos') r;
 SELECT value INTO STRICT v_file FROM jsonb_array_elements(p_payload->'arquivos') WHERE (value->>'ordem')::int=2;
 INSERT INTO public.vortx_posicao_parcelas(importacao_id,fundo_id,arquivo_id,numero_linha,ambiente,codigo_carteira,data_referencia,identidade_ativo,chave_ativo,cedente_documento,cedente_nome,sacado_documento,sacado_nome,tipo_recebivel,valor_nominal,valor_aquisicao,valor_presente,valor_pdd,data_emissao,data_aquisicao,data_vencimento,data_vencimento_original,status_entrada_provedor,dados_brutos,dados_normalizados,chave_parcela,external_title_key)
 SELECT v_id,v_fundo,(v_file->>'id')::uuid,(r->>'numero_linha')::int,v_ambiente,v_carteira,v_data,nullif(r->'dados_normalizados'->>'identidade_ativo',''),nullif(r->'dados_normalizados'->>'chave_ativo',''),nullif(r->'dados_normalizados'->>'cedente_documento',''),nullif(r->'dados_normalizados'->>'cedente_nome',''),nullif(r->'dados_normalizados'->>'sacado_documento',''),nullif(r->'dados_normalizados'->>'sacado_nome',''),nullif(r->'dados_normalizados'->>'tipo_recebivel',''),nullif(r->'dados_normalizados'->>'valor_nominal','')::numeric,nullif(r->'dados_normalizados'->>'valor_aquisicao','')::numeric,nullif(r->'dados_normalizados'->>'valor_presente','')::numeric,nullif(r->'dados_normalizados'->>'valor_pdd','')::numeric,nullif(r->'dados_normalizados'->>'data_emissao','')::date,nullif(r->'dados_normalizados'->>'data_aquisicao','')::date,nullif(r->'dados_normalizados'->>'data_vencimento','')::date,nullif(r->'dados_normalizados'->>'data_vencimento_original','')::date,nullif(r->'dados_normalizados'->>'status_entrada_provedor',''),r->'dados_brutos',r->'dados_normalizados',nullif(r->'dados_normalizados'->>'chave_parcela',''),nullif(r->'dados_normalizados'->>'external_title_key','')
 FROM jsonb_array_elements(p_payload->'parcelas') r;

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
   linhas_total=jsonb_array_length(p_payload->'ativos')+jsonb_array_length(p_payload->'parcelas'),
   linhas_validas=jsonb_array_length(p_payload->'ativos')+jsonb_array_length(p_payload->'parcelas'),
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

CREATE FUNCTION public.publicar_estoque_vortx(p_importacao_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 i public.importacoes_financeiras%ROWTYPE;
 anterior uuid;
 momento timestamptz:=clock_timestamp();
BEGIN
 IF NOT private.financeiro_chamada_service_role() THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Publicacao Vortx restrita ao worker interno';
 END IF;
 SELECT * INTO i FROM public.importacoes_financeiras WHERE id=p_importacao_id FOR UPDATE;
 IF NOT FOUND OR i.provedor<>'VORTX' OR i.tipo_base<>'ESTOQUE' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Importacao nao e estoque nativo Vortx';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vortx-publicar:'||i.fundo_id::text||':'||
   i.data_referencia::text||':'||i.fonte_ambiente||':'||i.fonte_carteira,0));
 IF i.status='PUBLICADA' THEN RETURN jsonb_build_object('id',i.id,'idempotente',true); END IF;
 IF i.status<>'VALIDA' OR i.completude<>'COMPLETO_COM_DADOS'
   OR i.metadados->>'reconciliado' IS DISTINCT FROM 'true'
   OR NOT private.vortx_estoque_reconciliado(i.id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Posicoes ausentes ou divergentes: publicacao bloqueada';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.integracao_fundo_versoes v JOIN public.integracoes_fundo f
     ON f.id=v.integracao_fundo_id
   JOIN public.fundos fundo ON fundo.id=f.fundo_id AND fundo.ativo
   JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
   WHERE v.id=i.integracao_fundo_versao_id AND f.fundo_id=i.fundo_id
     AND f.status='ativa' AND f.provider_key='VORTX' AND v.status='publicada' AND v.adapter_key='vortx_vrs'
     AND v.ambiente=i.fonte_ambiente AND v.configuracao_nao_sensivel->>'codigo_carteira'=i.fonte_carteira
     AND c.fundo_id=i.fundo_id AND c.ambiente=i.fonte_ambiente AND c.capability='ESTOQUE'
     AND c.disponivel_desde<=now() AND c.disponivel_ate IS NULL AND v.vigente_ate IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Integracao Vortx indisponivel para publicacao';
 END IF;
 SELECT id INTO anterior FROM public.importacoes_financeiras
 WHERE fundo_id=i.fundo_id AND data_referencia=i.data_referencia AND provedor='VORTX'
   AND fonte_ambiente=i.fonte_ambiente AND fonte_carteira=i.fonte_carteira AND status='PUBLICADA';
 UPDATE public.importacoes_financeiras SET status='RETIFICADA',substituida_em=momento WHERE id=anterior;
 UPDATE public.importacoes_financeiras SET status='PUBLICADA',publicada_em=momento,finalizada_em=momento,
   linhas_publicadas=(SELECT count(*) FROM public.vortx_posicao_parcelas WHERE importacao_id=i.id),
   substitui_importacao_id=anterior WHERE id=i.id;
 PERFORM private.financeiro_auditar('VORTX_ESTOQUE_PUBLICADO',i.id,i.fundo_id,i.correlation_id,
   jsonb_build_object('substitui_importacao_id',anterior,'ambiente',i.fonte_ambiente,'carteira',i.fonte_carteira));
 RETURN jsonb_build_object('id',i.id,'status','PUBLICADA','substitui_importacao_id',anterior);
END;
$$;
REVOKE ALL ON FUNCTION public.publicar_estoque_vortx(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publicar_estoque_vortx(uuid) TO service_role;

-- Existing persistence contracts retained; only stock source and namespace are extended.
CREATE OR REPLACE FUNCTION public.publicar_importacao_financeira(p_importacao_id uuid, p_correlation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_importacao public.importacoes_financeiras%ROWTYPE;
  v_anterior_ids uuid[];
  v_anterior_id uuid;
  v_inseridas integer := 0;
  v_agora timestamptz := clock_timestamp();
BEGIN
  PERFORM private.financeiro_autorizar_tecnico();
  SELECT * INTO v_importacao FROM public.importacoes_financeiras WHERE id = p_importacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Importacao financeira nao encontrada'; END IF;

  IF v_importacao.provedor = 'VORTX' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Use o publicador de estoque nativo Vortx';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_importacao.fundo_id::text || ':' || v_importacao.tipo_base || ':' || v_importacao.data_referencia::text, 0));
  IF v_importacao.status = 'PUBLICADA' THEN
    RETURN jsonb_build_object('id', v_importacao.id, 'status', 'PUBLICADA', 'idempotente', true);
  END IF;
  IF v_importacao.status <> 'VALIDA' OR v_importacao.completude = 'INCOMPLETO' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Somente importacao valida e completa pode ser publicada';
  END IF;
  IF v_importacao.completude = 'COMPLETO_VAZIO' AND v_importacao.tipo_base NOT IN ('AQUISICOES', 'LIQUIDACOES') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Esta familia financeira nao permite publicacao vazia';
  END IF;
  IF v_importacao.linhas_invalidas > 0 OR EXISTS (SELECT 1 FROM public.importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status = 'INVALIDA') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Importacao possui linhas invalidas';
  END IF;

  SELECT COALESCE(array_agg(i.id ORDER BY i.publicada_em DESC), ARRAY[]::uuid[]),
         (array_agg(i.id ORDER BY i.publicada_em DESC))[1]
    INTO v_anterior_ids, v_anterior_id
  FROM public.importacoes_financeiras i
  WHERE i.fundo_id = v_importacao.fundo_id
    AND i.tipo_base = v_importacao.tipo_base
    AND i.data_referencia = v_importacao.data_referencia
    AND i.provedor <> 'VORTX'
    AND i.status = 'PUBLICADA'
    AND i.id <> v_importacao.id;

  IF cardinality(v_anterior_ids) > 0 THEN
    UPDATE public.importacoes_financeiras SET status = 'RETIFICADA', substituida_em = v_agora, finalizada_em = COALESCE(finalizada_em, v_agora) WHERE id = ANY(v_anterior_ids);
    UPDATE public.estoque_posicoes SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.aquisicao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.liquidacao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.carteira_snapshots SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
  END IF;

  IF v_importacao.completude = 'COMPLETO_COM_DADOS' THEN
    IF v_importacao.tipo_base = 'ESTOQUE' THEN
      INSERT INTO public.estoque_posicoes (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, external_title_key,
        id_recebivel, seu_numero, numero_documento, tipo_recebivel, chave_nfe,
        cedente_nome, cedente_documento, sacado_nome, sacado_documento,
        valor_nominal, valor_presente, valor_aquisicao, valor_pdd, data_emissao,
        data_vencimento_original, data_aquisicao, situacao_recebivel, payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'external_title_key', l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        l.dados_normalizados->>'cedente_nome', l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_nome', l.dados_normalizados->>'sacado_documento',
        (l.dados_normalizados->>'valor_nominal')::numeric, nullif(l.dados_normalizados->>'valor_presente', '')::numeric,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric, nullif(l.dados_normalizados->>'valor_pdd', '')::numeric,
        nullif(l.dados_normalizados->>'data_emissao', '')::date, nullif(l.dados_normalizados->>'data_vencimento_original', '')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date, l.dados_normalizados->>'situacao_recebivel', l.dados_brutos, v_agora
      FROM public.importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'AQUISICOES' THEN
      INSERT INTO public.aquisicao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, fingerprint_linha, fingerprint_versao,
        id_recebivel, seu_numero, numero_documento, cedente_documento, sacado_documento,
        tipo_recebivel, chave_nfe, valor_compra, valor_vencimento, data_movimento,
        data_vencimento, codigo_movimento, payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'fingerprint_linha', COALESCE(NULLIF(l.dados_normalizados->>'fingerprint_versao', ''), 'RLX_FP_V1'),
        l.dados_normalizados->>'id_recebivel', l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento',
        l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        (l.dados_normalizados->>'valor_compra')::numeric, nullif(l.dados_normalizados->>'valor_vencimento', '')::numeric,
        (l.dados_normalizados->>'data_movimento')::date, nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        l.dados_normalizados->>'codigo_movimento', l.dados_brutos, v_agora
      FROM public.importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'LIQUIDACOES' THEN
      INSERT INTO public.liquidacao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, id_movimento_externo,
        fingerprint_linha, fingerprint_versao, id_recebivel, seu_numero, numero_documento,
        cedente_documento, sacado_documento, tipo_recebivel, id_tipo_movimento,
        tipo_movimento, status_recebivel, data_movimento, data_aquisicao,
        data_vencimento, valor_aquisicao, valor_pago, valor_nominal, juros,
        payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        nullif(l.dados_normalizados->>'id_movimento_externo', ''), l.dados_normalizados->>'fingerprint_linha',
        COALESCE(NULLIF(l.dados_normalizados->>'fingerprint_versao', ''), 'RLX_FP_V1'), l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento', l.dados_normalizados->>'cedente_documento',
        l.dados_normalizados->>'sacado_documento', l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'id_tipo_movimento',
        l.dados_normalizados->>'tipo_movimento', l.dados_normalizados->>'status_recebivel', (l.dados_normalizados->>'data_movimento')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date, nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric, (l.dados_normalizados->>'valor_pago')::numeric,
        nullif(l.dados_normalizados->>'valor_nominal', '')::numeric, nullif(l.dados_normalizados->>'juros', '')::numeric,
        l.dados_brutos, v_agora
      FROM public.importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSE
      INSERT INTO public.carteira_snapshots (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, fundo_externo,
        documento_fundo, versao_externa, patrimonio_liquido, publicada_externamente_em,
        payload_origem, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor, v_importacao.data_referencia,
        l.dados_normalizados->>'fundo_externo', l.dados_normalizados->>'documento_fundo', l.dados_normalizados->>'versao_externa',
        (l.dados_normalizados->>'patrimonio_liquido')::numeric, nullif(l.dados_normalizados->>'publicada_externamente_em', '')::timestamptz,
        l.dados_brutos, v_agora
      FROM public.importacao_linhas l WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    END IF;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
  END IF;

  UPDATE public.importacoes_financeiras
  SET status = 'PUBLICADA', publicada_em = v_agora, substituida_em = NULL,
      linhas_publicadas = v_inseridas, substitui_importacao_id = v_anterior_id,
      finalizada_em = v_agora, erro_sanitizado = NULL
  WHERE id = v_importacao.id;

  IF cardinality(v_anterior_ids) > 0 THEN
    PERFORM private.financeiro_auditar('IMPORTACAO_FINANCEIRA_RETIFICADA', v_importacao.id, v_importacao.fundo_id,
      COALESCE(p_correlation_id, v_importacao.correlation_id),
      jsonb_build_object('tipo_base', v_importacao.tipo_base, 'data_referencia', v_importacao.data_referencia, 'substituiu_importacoes', to_jsonb(v_anterior_ids)));
  END IF;
  PERFORM private.financeiro_auditar('IMPORTACAO_FINANCEIRA_PUBLICADA', v_importacao.id, v_importacao.fundo_id,
    COALESCE(p_correlation_id, v_importacao.correlation_id),
    jsonb_build_object('tipo_base', v_importacao.tipo_base, 'data_referencia', v_importacao.data_referencia, 'completude', v_importacao.completude, 'linhas_publicadas', v_inseridas));

  RETURN jsonb_build_object('id', v_importacao.id, 'status', 'PUBLICADA', 'linhas_publicadas', v_inseridas, 'retificou', cardinality(v_anterior_ids) > 0, 'substitui_importacao_id', v_anterior_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.persistir_posicao_logistica_execucao(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_bootstrap boolean := coalesce((p_payload ->> 'bootstrap')::boolean, false);
  v_estoque_id uuid := nullif(p_payload ->> 'estoque_importacao_id', '')::uuid;
  v_matching_id uuid := nullif(p_payload ->> 'matching_execucao_id', '')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_data_referencia date;
  v_total_estoque integer;
  v_total_payload integer;
  v_reprocessamento boolean;
  v_vortx boolean;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia logistica restrita ao processador interno';
  END IF;

  IF v_bootstrap THEN
    IF v_fundo_id IS NULL OR p_payload ->> 'regra_versao' <> 'RLX_LOGISTICA_V1'
       OR coalesce(p_payload ->> 'assinatura_execucao', '') = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 invalido';
    END IF;
    IF NOT private.financeiro_fundo_virgem(v_fundo_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Bootstrap invalido: fundo possui historico financeiro';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'financeiro-logistica-bootstrap:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
    ));

    SELECT id INTO v_execucao_id
    FROM public.posicao_logistica_execucoes
    WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
    IF FOUND THEN RETURN v_execucao_id; END IF;

    INSERT INTO public.posicao_logistica_execucoes (
      fundo_id, data_referencia, estoque_importacao_id, matching_execucao_id, bootstrap,
      regra_versao, logistica_as_of, fingerprint_logistico, assinatura_execucao, status,
      valor_total_aquisicao, valor_matched, valor_sem_match, valor_entregue, valor_em_transito, valor_indeterminado,
      correlation_id, criado_por, detalhes, finalizado_em
    ) VALUES (
      v_fundo_id, (p_payload ->> 'data_referencia')::date, NULL, NULL, true,
      'RLX_LOGISTICA_V1', (p_payload ->> 'logistica_as_of')::timestamptz,
      p_payload ->> 'fingerprint_logistico', p_payload ->> 'assinatura_execucao', 'CONCLUIDA',
      0, 0, 0, 0, 0, 0,
      (p_payload ->> 'correlation_id')::uuid, nullif(p_payload ->> 'criado_por', '')::uuid,
      coalesce(p_payload -> 'detalhes', '{}'::jsonb), clock_timestamp()
    ) RETURNING id INTO v_execucao_id;

    INSERT INTO public.logs_auditoria (
      tipo_evento, entidade_tipo, entidade_id, dados_depois,
      ator_tipo, origem, ator_identificador, created_at
    ) VALUES (
      'POSICAO_LOGISTICA_BOOTSTRAP', 'posicao_logistica_execucoes', v_execucao_id,
      jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
        'regra_versao', 'RLX_LOGISTICA_V1', 'correlation_id', p_payload ->> 'correlation_id'),
      'sistema', 'financeiro_logistica', p_payload ->> 'criado_por', clock_timestamp()
    );
    RETURN v_execucao_id;
  END IF;

  IF v_fundo_id IS NULL OR v_estoque_id IS NULL OR v_matching_id IS NULL
     OR p_payload ->> 'regra_versao' <> 'RLX_LOGISTICA_V1'
     OR coalesce(p_payload ->> 'assinatura_execucao', '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 invalido';
  END IF;

  SELECT i.data_referencia, i.provedor = 'VORTX' INTO v_data_referencia, v_vortx
  FROM public.importacoes_financeiras i
  WHERE i.id = v_estoque_id AND i.fundo_id = v_fundo_id
    AND i.tipo_base = 'ESTOQUE' AND i.status = 'PUBLICADA';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Estoque publicado incompativel com o fundo';
  END IF;
  IF v_data_referencia IS DISTINCT FROM (p_payload ->> 'data_referencia')::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Data de referencia incompativel com o Estoque publicado';
  END IF;

  SELECT count(*)::integer INTO v_total_estoque
  FROM public.estoque_fontes_leitura p
  WHERE p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id;
  v_total_payload := jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb));
  IF v_total_payload <> v_total_estoque THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.4 nao cobre integralmente o Estoque publicado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'financeiro-logistica:' || v_fundo_id::text || ':' || v_estoque_id::text, 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.posicao_logistica_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matching_execucoes m
    WHERE m.id = v_matching_id AND m.fundo_id = v_fundo_id
      AND m.status = 'CONCLUIDA' AND v_estoque_id = ANY(m.input_import_ids)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Matching incompativel com o estoque publicado';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.posicao_logistica_execucoes e
    WHERE e.fundo_id = v_fundo_id
      AND e.estoque_importacao_id = v_estoque_id
      AND e.matching_execucao_id = v_matching_id
  ) INTO v_reprocessamento;

  INSERT INTO public.posicao_logistica_execucoes (
    fundo_id, data_referencia, estoque_importacao_id, matching_execucao_id,
    regra_versao, logistica_as_of, fingerprint_logistico, assinatura_execucao,
    correlation_id, criado_por, detalhes
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, v_estoque_id, v_matching_id,
    'RLX_LOGISTICA_V1', (p_payload ->> 'logistica_as_of')::timestamptz,
    p_payload ->> 'fingerprint_logistico', p_payload ->> 'assinatura_execucao',
    (p_payload ->> 'correlation_id')::uuid, (p_payload ->> 'criado_por')::uuid,
    coalesce(p_payload -> 'detalhes', '{}'::jsonb)
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.estoque_fontes_leitura p
      WHERE p.id = (v_item ->> 'estoque_posicao_id')::uuid
        AND p.importacao_id = v_estoque_id AND p.fundo_id = v_fundo_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Posicao de estoque fora da base P2.4';
    END IF;
    IF nullif(v_item ->> 'matching_resultado_id', '') IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.matching_resultados r
      WHERE r.id = (v_item ->> 'matching_resultado_id')::uuid
        AND r.execucao_id = v_matching_id AND r.fundo_id = v_fundo_id
        AND r.origem_registro = 'ESTOQUE'
        AND r.origem_registro_id = (v_item ->> 'estoque_posicao_id')::uuid
        AND r.status = v_item ->> 'matching_status'
        AND r.metodo = v_item ->> 'matching_metodo'
        AND r.nota_fiscal_id IS NOT DISTINCT FROM nullif(v_item ->> 'nota_fiscal_id', '')::uuid
        AND r.vinculo_id IS NOT DISTINCT FROM nullif(v_item ->> 'vinculo_id', '')::uuid
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Resultado de matching incompativel com a posicao';
    END IF;
    IF nullif(v_item ->> 'nota_fiscal_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = (v_item ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nota fiscal fora do fundo da posicao P2.4';
    END IF;

    INSERT INTO public.posicao_logistica_resultados (
      execucao_id, fundo_id, estoque_importacao_id, estoque_posicao_id, vortx_posicao_parcela_id,
      matching_resultado_id, matching_status, matching_metodo, status_vinculo,
      vinculo_id, nota_fiscal_id, status_logistico, id_recebivel, seu_numero,
      numero_documento, cedente_nome, cedente_documento, sacado_nome, sacado_documento,
      data_vencimento, valor_nominal, valor_aquisicao, valor_aquisicao_qualidade,
      nf_compartilhada_entre_posicoes, evidencia_familia, documento_id,
      documento_versao_id, documento_analise_id, fundamento, evidencias, detalhes
    ) VALUES (
      v_execucao_id, v_fundo_id, v_estoque_id,
      CASE WHEN NOT v_vortx THEN (v_item ->> 'estoque_posicao_id')::uuid END,
      CASE WHEN v_vortx THEN (v_item ->> 'estoque_posicao_id')::uuid END,
      nullif(v_item ->> 'matching_resultado_id', '')::uuid, v_item ->> 'matching_status',
      v_item ->> 'matching_metodo', v_item ->> 'status_vinculo',
      nullif(v_item ->> 'vinculo_id', '')::uuid, nullif(v_item ->> 'nota_fiscal_id', '')::uuid,
      nullif(v_item ->> 'status_logistico', ''), v_item ->> 'id_recebivel',
      v_item ->> 'seu_numero', v_item ->> 'numero_documento', v_item ->> 'cedente_nome',
      v_item ->> 'cedente_documento', v_item ->> 'sacado_nome', v_item ->> 'sacado_documento',
      nullif(v_item ->> 'data_vencimento', '')::date,
      nullif(v_item ->> 'valor_nominal', '')::numeric,
      nullif(v_item ->> 'valor_aquisicao', '')::numeric,
      v_item ->> 'valor_aquisicao_qualidade',
      coalesce((v_item ->> 'nf_compartilhada_entre_posicoes')::boolean, false),
      nullif(v_item ->> 'evidencia_familia', ''), nullif(v_item ->> 'documento_id', '')::uuid,
      nullif(v_item ->> 'documento_versao_id', '')::uuid,
      nullif(v_item ->> 'documento_analise_id', '')::uuid,
      coalesce(v_item ->> 'fundamento', 'sem_match_financeiro_nf'),
      coalesce(v_item -> 'evidencias', '{}'::jsonb), coalesce(v_item -> 'detalhes', '{}'::jsonb)
    );
  END LOOP;

  UPDATE public.posicao_logistica_execucoes e SET
    status = coalesce(p_payload ->> 'status', 'CONCLUIDA'),
    total_posicoes = a.total,
    posicoes_matched = a.matched,
    posicoes_sem_match = a.sem_match,
    posicoes_entregues = a.entregues,
    posicoes_em_transito = a.em_transito,
    posicoes_indeterminadas = a.indeterminadas,
    posicoes_valor_ausente = a.valor_ausente,
    valor_total_aquisicao = a.valor_total,
    valor_matched = a.valor_matched,
    valor_sem_match = a.valor_sem_match,
    valor_entregue = a.valor_entregue,
    valor_em_transito = a.valor_em_transito,
    valor_indeterminado = a.valor_indeterminado,
    finalizado_em = clock_timestamp()
  FROM (
    SELECT count(*)::int total,
      count(*) FILTER (WHERE status_vinculo = 'MATCHED_FINANCEIRO_NF')::int matched,
      count(*) FILTER (WHERE status_vinculo = 'SEM_MATCH_FINANCEIRO_NF')::int sem_match,
      count(*) FILTER (WHERE status_logistico = 'ENTREGUE')::int entregues,
      count(*) FILTER (WHERE status_logistico = 'EM_TRANSITO')::int em_transito,
      count(*) FILTER (WHERE status_logistico = 'INDETERMINADA')::int indeterminadas,
      count(*) FILTER (WHERE valor_aquisicao IS NULL)::int valor_ausente,
      sum(valor_aquisicao) valor_total,
      sum(valor_aquisicao) FILTER (WHERE status_vinculo = 'MATCHED_FINANCEIRO_NF') valor_matched,
      sum(valor_aquisicao) FILTER (WHERE status_vinculo = 'SEM_MATCH_FINANCEIRO_NF') valor_sem_match,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'ENTREGUE') valor_entregue,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'EM_TRANSITO') valor_em_transito,
      sum(valor_aquisicao) FILTER (WHERE status_logistico = 'INDETERMINADA') valor_indeterminado
    FROM public.posicao_logistica_resultados WHERE execucao_id = v_execucao_id
  ) a WHERE e.id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador, created_at
  ) VALUES (
    CASE
      WHEN coalesce(p_payload ->> 'status', 'CONCLUIDA') = 'BASE_INCOMPLETA'
        THEN 'POSICAO_LOGISTICA_BASE_INCOMPLETA'
      WHEN v_reprocessamento THEN 'POSICAO_LOGISTICA_REPROCESSADA'
      ELSE 'POSICAO_LOGISTICA_EXECUTADA'
    END,
    'posicao_logistica_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'regra_versao', 'RLX_LOGISTICA_V1', 'correlation_id', p_payload ->> 'correlation_id'),
    'sistema', 'financeiro_logistica', p_payload ->> 'criado_por', clock_timestamp()
  );

  RETURN v_execucao_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.financeiro_fundo_virgem(p_fundo_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog' AS $function$
  SELECT NOT (
    EXISTS (
      SELECT 1 FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
      WHERE cf.fundo_id = p_fundo_id
        AND o.status IN ('em_andamento', 'inadimplente', 'liquidada')
        AND o.cessao_efetivada_em IS NOT NULL
    )
    OR EXISTS (SELECT 1 FROM public.estoque_posicoes p WHERE p.fundo_id = p_fundo_id)
    OR EXISTS (SELECT 1 FROM public.aquisicao_movimentos m WHERE m.fundo_id = p_fundo_id)
    OR EXISTS (SELECT 1 FROM public.liquidacao_movimentos m WHERE m.fundo_id = p_fundo_id)
    OR EXISTS (
      SELECT 1 FROM public.vortx_posicao_parcelas p JOIN public.importacoes_financeiras i ON i.id=p.importacao_id
      WHERE p.fundo_id=p_fundo_id AND i.status IN ('PUBLICADA','RETIFICADA')
    )
  );
$function$;

COMMIT;
