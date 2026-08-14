-- P2.6 - Gate de risco, decisao operacional e central consolidada.
-- Incremental sobre P2.2-P2.5.1. Nao reingere bases externas e nao altera historicos.

BEGIN;

ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS gate_risco_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_inclusivo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tratamento_pl_indisponivel text NOT NULL DEFAULT 'BLOQUEAR',
  ADD COLUMN IF NOT EXISTS tratamento_indeterminada text NOT NULL DEFAULT 'REVISAO_MANUAL',
  ADD COLUMN IF NOT EXISTS tratamento_sem_match text NOT NULL DEFAULT 'BLOQUEAR',
  ADD COLUMN IF NOT EXISTS tratamento_operacao_nao_incorporada text NOT NULL DEFAULT 'BLOQUEAR',
  ADD COLUMN IF NOT EXISTS tratamento_liquidacao_parcial text NOT NULL DEFAULT 'SINALIZAR';

ALTER TABLE public.politica_operacional_versoes
  DROP CONSTRAINT IF EXISTS politica_gate_risco_configuracao_check;
ALTER TABLE public.politica_operacional_versoes
  ADD CONSTRAINT politica_gate_risco_configuracao_check CHECK (
    limite_inclusivo IS TRUE
    AND tratamento_pl_indisponivel = 'BLOQUEAR'
    AND tratamento_indeterminada = 'REVISAO_MANUAL'
    AND tratamento_sem_match = 'BLOQUEAR'
    AND tratamento_operacao_nao_incorporada = 'BLOQUEAR'
    AND tratamento_liquidacao_parcial = 'SINALIZAR'
    AND (gate_risco_ativo IS FALSE OR (
      controle_exposicao_logistica_ativo IS TRUE
      AND limite_exposicao_em_transito_pct > 0
      AND limite_exposicao_em_transito_pct <= 100
    ))
  );

CREATE OR REPLACE FUNCTION public.validar_versao_publicada()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publicada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Versao publicada de politica nao pode ser excluida';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publicada_em IS NOT NULL AND (
    NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
    OR NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
    OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.tipo_ativo_financeiro IS DISTINCT FROM OLD.tipo_ativo_financeiro
    OR NEW.exigir_status_logistico_pre_cessao IS DISTINCT FROM OLD.exigir_status_logistico_pre_cessao
    OR NEW.controle_exposicao_logistica_ativo IS DISTINCT FROM OLD.controle_exposicao_logistica_ativo
    OR NEW.limite_exposicao_em_transito_pct IS DISTINCT FROM OLD.limite_exposicao_em_transito_pct
    OR NEW.gate_risco_ativo IS DISTINCT FROM OLD.gate_risco_ativo
    OR NEW.limite_inclusivo IS DISTINCT FROM OLD.limite_inclusivo
    OR NEW.tratamento_pl_indisponivel IS DISTINCT FROM OLD.tratamento_pl_indisponivel
    OR NEW.tratamento_indeterminada IS DISTINCT FROM OLD.tratamento_indeterminada
    OR NEW.tratamento_sem_match IS DISTINCT FROM OLD.tratamento_sem_match
    OR NEW.tratamento_operacao_nao_incorporada IS DISTINCT FROM OLD.tratamento_operacao_nao_incorporada
    OR NEW.tratamento_liquidacao_parcial IS DISTINCT FROM OLD.tratamento_liquidacao_parcial
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.regras IS DISTINCT FROM OLD.regras
    OR NEW.parametros IS DISTINCT FROM OLD.parametros
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN RAISE EXCEPTION 'Versao publicada de politica e imutavel'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.publicada_em IS NULL)
     AND NEW.metodo_calculo_financeiro IS NULL THEN
    RAISE EXCEPTION 'Selecione o metodo de calculo financeiro antes de publicar';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id AND other.publicada_em IS NOT NULL
      AND pg_catalog.tstzrange(other.vigente_desde, coalesce(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && pg_catalog.tstzrange(NEW.vigente_desde, coalesce(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validar_versao_publicada() FROM PUBLIC;

CREATE TABLE public.risco_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  escopo text NOT NULL CHECK (escopo IN ('FUNDO','OPERACAO')),
  origem text NOT NULL CHECK (origem IN ('CENTRAL_RISCO','APROVACAO_OPERACAO')),
  regra_versao text NOT NULL DEFAULT 'GATE_RISCO_V1' CHECK (regra_versao = 'GATE_RISCO_V1'),
  politica_operacional_versao_id uuid REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  exposicao_execucao_id uuid REFERENCES public.exposicao_execucoes(id) ON DELETE RESTRICT,
  data_operacional date NOT NULL,
  logistica_as_of timestamptz,
  overlay_as_of timestamptz NOT NULL,
  operacao_updated_at_snapshot timestamptz,
  taxa_desconto_snapshot numeric(18,9),
  aplicavel boolean NOT NULL,
  status_tecnico text NOT NULL CHECK (status_tecnico IN ('CONCLUIDA','NAO_APLICAVEL','AVALIACAO_RISCO_INDISPONIVEL')),
  decisao text CHECK (decisao IN ('APTO','REVISAO_MANUAL','BLOQUEADO')),
  limite_pct numeric(18,9),
  limite_inclusivo boolean NOT NULL DEFAULT true CHECK (limite_inclusivo),
  patrimonio_liquido_d2 numeric(24,4),
  exposicao_atual_valor numeric(24,4), exposicao_atual_pct numeric(30,12),
  operacao_valor_aquisicao numeric(24,4), operacao_valor_em_transito numeric(24,4),
  operacao_valor_indeterminado numeric(24,4), exposicao_projetada_valor numeric(24,4),
  exposicao_projetada_pct numeric(30,12),
  quantidade_indeterminada integer NOT NULL DEFAULT 0 CHECK (quantidade_indeterminada >= 0),
  quantidade_sem_match integer NOT NULL DEFAULT 0 CHECK (quantidade_sem_match >= 0),
  quantidade_valor_aquisicao_ausente integer NOT NULL DEFAULT 0 CHECK (quantidade_valor_aquisicao_ausente >= 0),
  quantidade_operacao_nao_incorporada integer NOT NULL DEFAULT 0 CHECK (quantidade_operacao_nao_incorporada >= 0),
  liquidacao_parcial_presente boolean NOT NULL DEFAULT false,
  assinatura_inputs text NOT NULL CHECK (assinatura_inputs ~ '^[0-9a-f]{64}$'),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalhes) = 'object'),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  iniciado_em timestamptz NOT NULL DEFAULT clock_timestamp(), finalizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT risco_execucao_escopo_check CHECK ((escopo='FUNDO' AND operacao_id IS NULL) OR (escopo='OPERACAO' AND operacao_id IS NOT NULL)),
  CONSTRAINT risco_execucao_decisao_check CHECK (
    (aplicavel IS FALSE AND status_tecnico='NAO_APLICAVEL' AND decisao IS NULL)
    OR (aplicavel IS TRUE AND decisao IS NOT NULL)
  )
);
CREATE UNIQUE INDEX risco_execucoes_idempotencia_idx ON public.risco_execucoes
  (fundo_id, coalesce(operacao_id,'00000000-0000-0000-0000-000000000000'::uuid), regra_versao, assinatura_inputs);
CREATE INDEX risco_execucoes_central_idx ON public.risco_execucoes (fundo_id,created_at DESC,decisao,status_tecnico);
CREATE INDEX risco_execucoes_operacao_idx ON public.risco_execucoes (operacao_id,created_at DESC) WHERE operacao_id IS NOT NULL;

CREATE TABLE public.risco_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risco_execucao_id uuid NOT NULL REFERENCES public.risco_execucoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  codigo text NOT NULL CHECK (codigo IN (
    'EXPOSICAO_ACIMA_LIMITE','PL_D2_INDISPONIVEL','PL_D2_INVALIDO','POSICAO_SEM_MATCH','EXPOSICAO_INDETERMINADA',
    'OPERACAO_NAO_INCORPORADA_ESTOQUE','VALOR_AQUISICAO_INDISPONIVEL','VALOR_AQUISICAO_OPERACAO_INDISPONIVEL',
    'LIQUIDACAO_PARCIAL_PRESENTE','NO_LIMITE','AVALIACAO_RISCO_INDISPONIVEL'
  )),
  severidade text NOT NULL CHECK (severidade IN ('INFORMATIVO','REVISAO','BLOQUEIO')),
  valor_numerico numeric(30,12), valor_monetario numeric(24,4), quantidade integer CHECK (quantidade IS NULL OR quantidade >= 0),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalhes)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT risco_motivos_execucao_codigo_unique UNIQUE (risco_execucao_id,codigo)
);
CREATE INDEX risco_motivos_central_idx ON public.risco_motivos (fundo_id,codigo,created_at DESC);

CREATE TABLE public.risco_revisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), risco_execucao_id uuid NOT NULL REFERENCES public.risco_execucoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT, operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','LIBERADA','RECUSADA','EXPIRADA')),
  assinatura_inputs text NOT NULL CHECK (assinatura_inputs ~ '^[0-9a-f]{64}$'), justificativa text,
  revisado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT, revisado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT risco_revisao_execucao_unique UNIQUE (risco_execucao_id),
  CONSTRAINT risco_revisao_final_check CHECK (
    (status='PENDENTE' AND justificativa IS NULL AND revisado_por IS NULL AND revisado_em IS NULL)
    OR (status<>'PENDENTE' AND char_length(pg_catalog.btrim(justificativa)) BETWEEN 5 AND 1000 AND revisado_por IS NOT NULL AND revisado_em IS NOT NULL)
  )
);
CREATE INDEX risco_revisoes_pendentes_idx ON public.risco_revisoes (fundo_id,created_at DESC) WHERE status='PENDENTE';

ALTER TABLE public.operacoes
  ADD COLUMN IF NOT EXISTS risco_execucao_id uuid REFERENCES public.risco_execucoes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS risco_revisao_id uuid REFERENCES public.risco_revisoes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS risco_decisao_snapshot text CHECK (risco_decisao_snapshot IN ('NAO_APLICAVEL','APTO','REVISAO_MANUAL')),
  ADD COLUMN IF NOT EXISTS risco_assinatura_inputs text CHECK (risco_assinatura_inputs IS NULL OR risco_assinatura_inputs ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS risco_avaliado_em timestamptz;

CREATE OR REPLACE FUNCTION private.risco_bloquear_mutacao_historica()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Historico de risco e imutavel'; END; $$;
REVOKE ALL ON FUNCTION private.risco_bloquear_mutacao_historica() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER risco_execucoes_imutaveis BEFORE UPDATE OR DELETE ON public.risco_execucoes FOR EACH ROW EXECUTE FUNCTION private.risco_bloquear_mutacao_historica();
CREATE TRIGGER risco_motivos_imutaveis BEFORE UPDATE OR DELETE ON public.risco_motivos FOR EACH ROW EXECUTE FUNCTION private.risco_bloquear_mutacao_historica();

CREATE OR REPLACE FUNCTION private.risco_proteger_revisao()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Revisao de risco nao pode ser excluida'; END IF;
  IF OLD.status<>'PENDENTE' OR NEW.risco_execucao_id IS DISTINCT FROM OLD.risco_execucao_id OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
     OR NEW.operacao_id IS DISTINCT FROM OLD.operacao_id OR NEW.assinatura_inputs IS DISTINCT FROM OLD.assinatura_inputs OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.status NOT IN ('LIBERADA','RECUSADA','EXPIRADA') THEN RAISE EXCEPTION 'Transicao de revisao invalida'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.risco_proteger_revisao() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER risco_revisoes_protegidas BEFORE UPDATE OR DELETE ON public.risco_revisoes FOR EACH ROW EXECUTE FUNCTION private.risco_proteger_revisao();

ALTER TABLE public.risco_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risco_motivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risco_revisoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY risco_execucoes_gestor_select ON public.risco_execucoes FOR SELECT TO authenticated USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY risco_motivos_gestor_select ON public.risco_motivos FOR SELECT TO authenticated USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY risco_revisoes_gestor_select ON public.risco_revisoes FOR SELECT TO authenticated USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
REVOKE ALL ON TABLE public.risco_execucoes,public.risco_motivos,public.risco_revisoes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.risco_execucoes,public.risco_motivos,public.risco_revisoes TO authenticated;
GRANT ALL ON TABLE public.risco_execucoes,public.risco_motivos,public.risco_revisoes TO service_role;

CREATE OR REPLACE FUNCTION public.simular_memoria_financeira_operacao(p_operacao_id uuid,p_taxa_desconto numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_op record; v_nf record; v_memoria jsonb; v_metodo text; v_data_base date := (pg_catalog.timezone('America/Sao_Paulo',pg_catalog.now()))::date;
  v_itens jsonb := '[]'::jsonb; v_total numeric := 0; v_ausentes integer := 0; v_count integer := 0;
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Simulacao financeira restrita ao processador interno'; END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto<0 THEN RAISE EXCEPTION 'Taxa mensal invalida'; END IF;
  SELECT o.*,cf.fundo_id INTO v_op FROM public.operacoes o JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id WHERE o.id=p_operacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF v_op.status NOT IN ('solicitada','em_analise') THEN RAISE EXCEPTION 'Operacao nao elegivel para simulacao de risco'; END IF;
  v_metodo := coalesce(v_op.metodo_calculo_financeiro,v_op.politica_snapshot #>> '{calculo_financeiro,metodo}','LEGADO_MENSAL_DIAS_REAIS_30');
  FOR v_nf IN SELECT n.* FROM public.operacoes_nfs onf JOIN public.notas_fiscais n ON n.id=onf.nota_fiscal_id WHERE onf.operacao_id=p_operacao_id ORDER BY n.id LOOP
    v_memoria := private.calcular_memoria_financeira_nf(v_nf.id,v_nf.valor_bruto,p_taxa_desconto,v_data_base,v_nf.data_vencimento,v_metodo);
    IF nullif(v_memoria->>'valor_presente','') IS NULL THEN v_ausentes:=v_ausentes+1; ELSE v_total:=v_total+(v_memoria->>'valor_presente')::numeric; END IF;
    v_itens:=v_itens||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('nota_fiscal_id',v_nf.id,'valor_aquisicao',v_memoria->>'valor_presente'));
    v_count:=v_count+1;
  END LOOP;
  IF v_count=0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;
  RETURN pg_catalog.jsonb_build_object('operacao_id',v_op.id,'fundo_id',v_op.fundo_id,'operacao_updated_at',v_op.updated_at,'status',v_op.status,
    'taxa_desconto',p_taxa_desconto,'metodo',v_metodo,'data_base',v_data_base,'valor_aquisicao_total',v_total,
    'quantidade_valor_ausente',v_ausentes,'itens',v_itens);
END; $$;
REVOKE ALL ON FUNCTION public.simular_memoria_financeira_operacao(uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simular_memoria_financeira_operacao(uuid,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.persistir_risco_execucao(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_fundo uuid:=nullif(p_payload->>'fundo_id','')::uuid; v_operacao uuid:=nullif(p_payload->>'operacao_id','')::uuid;
  v_motivo jsonb; v_decisao text:=nullif(p_payload->>'decisao',''); v_aplicavel boolean:=coalesce((p_payload->>'aplicavel')::boolean,false);
BEGIN
  IF NOT private.financeiro_chamada_service_role() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Persistencia de risco restrita ao processador interno'; END IF;
  IF v_fundo IS NULL OR p_payload->>'regra_versao'<>'GATE_RISCO_V1' OR coalesce(p_payload->>'assinatura_inputs','')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payload de risco invalido'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('risco:'||v_fundo::text||':'||coalesce(v_operacao::text,'FUNDO'),0));
  SELECT id INTO v_id FROM public.risco_execucoes WHERE fundo_id=v_fundo AND operacao_id IS NOT DISTINCT FROM v_operacao AND regra_versao='GATE_RISCO_V1' AND assinatura_inputs=p_payload->>'assinatura_inputs';
  IF FOUND THEN RETURN v_id; END IF;
  IF v_operacao IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.operacoes o JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id WHERE o.id=v_operacao AND cf.fundo_id=v_fundo) THEN RAISE EXCEPTION 'Operacao fora do fundo da avaliacao'; END IF;
  IF nullif(p_payload->>'exposicao_execucao_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.exposicao_execucoes e WHERE e.id=(p_payload->>'exposicao_execucao_id')::uuid AND e.fundo_id=v_fundo) THEN RAISE EXCEPTION 'Snapshot de exposicao fora do fundo'; END IF;
  INSERT INTO public.risco_execucoes(fundo_id,operacao_id,escopo,origem,politica_operacional_versao_id,exposicao_execucao_id,data_operacional,logistica_as_of,overlay_as_of,
    operacao_updated_at_snapshot,taxa_desconto_snapshot,aplicavel,status_tecnico,decisao,limite_pct,patrimonio_liquido_d2,exposicao_atual_valor,exposicao_atual_pct,
    operacao_valor_aquisicao,operacao_valor_em_transito,operacao_valor_indeterminado,exposicao_projetada_valor,exposicao_projetada_pct,quantidade_indeterminada,
    quantidade_sem_match,quantidade_valor_aquisicao_ausente,quantidade_operacao_nao_incorporada,liquidacao_parcial_presente,assinatura_inputs,detalhes,correlation_id,criado_por)
  VALUES(v_fundo,v_operacao,p_payload->>'escopo',p_payload->>'origem',nullif(p_payload->>'politica_operacional_versao_id','')::uuid,nullif(p_payload->>'exposicao_execucao_id','')::uuid,
    (p_payload->>'data_operacional')::date,nullif(p_payload->>'logistica_as_of','')::timestamptz,(p_payload->>'overlay_as_of')::timestamptz,nullif(p_payload->>'operacao_updated_at_snapshot','')::timestamptz,
    nullif(p_payload->>'taxa_desconto_snapshot','')::numeric,v_aplicavel,p_payload->>'status_tecnico',v_decisao,nullif(p_payload->>'limite_pct','')::numeric,
    nullif(p_payload->>'patrimonio_liquido_d2','')::numeric,nullif(p_payload->>'exposicao_atual_valor','')::numeric,nullif(p_payload->>'exposicao_atual_pct','')::numeric,
    nullif(p_payload->>'operacao_valor_aquisicao','')::numeric,nullif(p_payload->>'operacao_valor_em_transito','')::numeric,nullif(p_payload->>'operacao_valor_indeterminado','')::numeric,
    nullif(p_payload->>'exposicao_projetada_valor','')::numeric,nullif(p_payload->>'exposicao_projetada_pct','')::numeric,coalesce((p_payload->>'quantidade_indeterminada')::integer,0),
    coalesce((p_payload->>'quantidade_sem_match')::integer,0),coalesce((p_payload->>'quantidade_valor_aquisicao_ausente')::integer,0),
    coalesce((p_payload->>'quantidade_operacao_nao_incorporada')::integer,0),coalesce((p_payload->>'liquidacao_parcial_presente')::boolean,false),
    p_payload->>'assinatura_inputs',coalesce(p_payload->'detalhes','{}'::jsonb),(p_payload->>'correlation_id')::uuid,nullif(p_payload->>'criado_por','')::uuid)
  RETURNING id INTO v_id;
  FOR v_motivo IN SELECT value FROM pg_catalog.jsonb_array_elements(coalesce(p_payload->'motivos','[]'::jsonb)) LOOP
    INSERT INTO public.risco_motivos(risco_execucao_id,fundo_id,codigo,severidade,valor_numerico,valor_monetario,quantidade,detalhes)
    VALUES(v_id,v_fundo,v_motivo->>'codigo',v_motivo->>'severidade',nullif(v_motivo->>'valor_numerico','')::numeric,nullif(v_motivo->>'valor_monetario','')::numeric,
      nullif(v_motivo->>'quantidade','')::integer,coalesce(v_motivo->'detalhes','{}'::jsonb));
  END LOOP;
  IF v_decisao='REVISAO_MANUAL' AND v_operacao IS NOT NULL THEN INSERT INTO public.risco_revisoes(risco_execucao_id,fundo_id,operacao_id,assinatura_inputs) VALUES(v_id,v_fundo,v_operacao,p_payload->>'assinatura_inputs'); END IF;
  INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois,created_at)
  VALUES(nullif(p_payload->>'criado_por','')::uuid,'RISCO_AVALIADO',CASE WHEN v_operacao IS NULL THEN 'fundos' ELSE 'operacoes' END,
    coalesce(v_operacao,v_fundo),pg_catalog.jsonb_build_object('risco_execucao_id',v_id,'fundo_id',v_fundo,'operacao_id',v_operacao,'decisao',v_decisao,'status_tecnico',p_payload->>'status_tecnico','correlation_id',p_payload->>'correlation_id'),clock_timestamp());
  IF v_decisao='BLOQUEADO' THEN INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES(nullif(p_payload->>'criado_por','')::uuid,'RISCO_BLOQUEADO',CASE WHEN v_operacao IS NULL THEN 'fundos' ELSE 'operacoes' END,coalesce(v_operacao,v_fundo),pg_catalog.jsonb_build_object('risco_execucao_id',v_id,'fundo_id',v_fundo));
  ELSIF v_decisao='REVISAO_MANUAL' THEN INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES(nullif(p_payload->>'criado_por','')::uuid,'RISCO_REVISAO_SOLICITADA',CASE WHEN v_operacao IS NULL THEN 'fundos' ELSE 'operacoes' END,coalesce(v_operacao,v_fundo),pg_catalog.jsonb_build_object('risco_execucao_id',v_id,'fundo_id',v_fundo)); END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.persistir_risco_execucao(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persistir_risco_execucao(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.decidir_revisao_risco(p_revisao_id uuid,p_decisao text,p_justificativa text,p_correlation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rev public.risco_revisoes%ROWTYPE; v_actor uuid:=auth.uid(); v_event text;
BEGIN
  IF v_actor IS NULL OR p_decisao NOT IN ('LIBERADA','RECUSADA') OR char_length(pg_catalog.btrim(p_justificativa)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Decisao ou justificativa de revisao invalida'; END IF;
  SELECT * INTO v_rev FROM public.risco_revisoes WHERE id=p_revisao_id FOR UPDATE;
  IF NOT FOUND OR v_rev.status<>'PENDENTE' THEN RAISE EXCEPTION 'Revisao pendente nao encontrada'; END IF;
  IF NOT private.financeiro_gestor_tem_acesso_fundo(v_rev.fundo_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Gestor sem acesso ativo ao fundo'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=v_actor AND up.papel::text='gestor' AND up.ativo) AND public.get_user_role()::text<>'gestor' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Super Admin puro nao pode decidir risco operacional'; END IF;
  IF NOT private.financeiro_autorizacao_consumida('revisar_risco_operacao') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Confirmacao TOTP fresca obrigatoria'; END IF;
  IF EXISTS(SELECT 1 FROM public.risco_execucoes newer WHERE newer.operacao_id=v_rev.operacao_id AND newer.created_at>(SELECT created_at FROM public.risco_execucoes WHERE id=v_rev.risco_execucao_id)) THEN
    UPDATE public.risco_revisoes SET status='EXPIRADA',justificativa='Avaliacao substituida por uma execucao mais recente',revisado_por=v_actor,revisado_em=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_rev.id;
    INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES(v_actor,'RISCO_REVISAO_EXPIRADA','operacoes',v_rev.operacao_id,pg_catalog.jsonb_build_object('fundo_id',v_rev.fundo_id,'risco_revisao_id',v_rev.id,'correlation_id',p_correlation_id));
    RETURN false;
  END IF;
  UPDATE public.risco_revisoes SET status=p_decisao,justificativa=pg_catalog.btrim(p_justificativa),revisado_por=v_actor,revisado_em=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_rev.id;
  v_event:=CASE p_decisao WHEN 'LIBERADA' THEN 'RISCO_REVISAO_LIBERADA' ELSE 'RISCO_REVISAO_RECUSADA' END;
  INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES(v_actor,v_event,'operacoes',v_rev.operacao_id,pg_catalog.jsonb_build_object('fundo_id',v_rev.fundo_id,'risco_revisao_id',v_rev.id,'correlation_id',p_correlation_id));
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.decidir_revisao_risco(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decidir_revisao_risco(uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.aprovar_operacao_com_risco_atomica(p_operacao_id uuid,p_taxa_desconto numeric,p_risco_execucao_id uuid,p_assinatura_inputs text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_op record; v_risco public.risco_execucoes%ROWTYPE; v_revisao public.risco_revisoes%ROWTYPE; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR (
    public.get_user_role()::text<>'gestor'
    AND NOT EXISTS(SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=auth.uid() AND up.papel::text='gestor' AND up.ativo)
  ) THEN RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('aprovar-risco:'||p_operacao_id::text,0));
  SELECT o.*,cf.fundo_id INTO v_op FROM public.operacoes o JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id WHERE o.id=p_operacao_id FOR UPDATE OF o;
  IF NOT FOUND OR v_op.status NOT IN ('solicitada','em_analise') THEN RAISE EXCEPTION 'Operacao nao elegivel ou alterada concorrentemente'; END IF;
  IF NOT private.financeiro_gestor_tem_acesso_fundo(v_op.fundo_id) THEN RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao'; END IF;
  SELECT * INTO v_risco FROM public.risco_execucoes WHERE id=p_risco_execucao_id AND operacao_id=p_operacao_id AND fundo_id=v_op.fundo_id;
  IF NOT FOUND OR v_risco.assinatura_inputs<>p_assinatura_inputs OR v_risco.regra_versao<>'GATE_RISCO_V1' THEN RAISE EXCEPTION 'Avaliacao de risco invalida para a operacao'; END IF;
  IF v_risco.operacao_updated_at_snapshot IS DISTINCT FROM v_op.updated_at OR v_risco.taxa_desconto_snapshot IS DISTINCT FROM p_taxa_desconto THEN RAISE EXCEPTION 'A avaliacao de risco expirou porque a operacao foi alterada'; END IF;
  IF v_risco.aplicavel AND v_risco.decisao='BLOQUEADO' THEN RAISE EXCEPTION 'Operacao bloqueada pelo gate de risco'; END IF;
  IF v_risco.aplicavel AND v_risco.decisao='REVISAO_MANUAL' THEN
    SELECT * INTO v_revisao FROM public.risco_revisoes WHERE risco_execucao_id=v_risco.id AND assinatura_inputs=v_risco.assinatura_inputs;
    IF NOT FOUND OR v_revisao.status<>'LIBERADA' THEN RAISE EXCEPTION 'Operacao depende de revisao manual liberada'; END IF;
  ELSIF v_risco.aplicavel AND v_risco.decisao<>'APTO' THEN RAISE EXCEPTION 'Decisao de risco nao autoriza aprovacao'; END IF;
  v_result:=public.aprovar_operacao_atomica_financeiro_v1(p_operacao_id,p_taxa_desconto);
  UPDATE public.operacoes SET risco_execucao_id=v_risco.id,risco_revisao_id=v_revisao.id,
    risco_decisao_snapshot=CASE WHEN v_risco.aplicavel THEN v_risco.decisao ELSE 'NAO_APLICAVEL' END,
    risco_assinatura_inputs=v_risco.assinatura_inputs,risco_avaliado_em=v_risco.finalizado_em WHERE id=p_operacao_id;
  RETURN v_result||pg_catalog.jsonb_build_object('risco_execucao_id',v_risco.id,'risco_decisao',CASE WHEN v_risco.aplicavel THEN v_risco.decisao ELSE 'NAO_APLICAVEL' END);
END; $$;
REVOKE ALL ON FUNCTION public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_com_risco_atomica(uuid,numeric,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid,numeric) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
  IF pg_catalog.to_regprocedure('public.aprovar_operacao_atomica(uuid,numeric,numeric)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid,numeric,numeric) FROM PUBLIC,anon,authenticated';
  END IF;
END $$;

ALTER TABLE public.autorizacoes_acoes_sensiveis DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (action_type=ANY(ARRAY[
  'alterar_senha','alterar_email','regenerar_recovery_codes','encerrar_outras_sessoes','reset_mfa_administrativo','cadastrar_credencial_integracao',
  'rotacionar_credencial_integracao','ativar_credencial_integracao','revogar_credencial_integracao','criar_fundo','atualizar_fundo_estrutural','ativar_fundo',
  'desativar_fundo','convidar_usuario_admin','vincular_gestor_fundo','revogar_gestor_fundo','reativar_gestor_fundo','desativar_usuario','reativar_usuario',
  'conceder_super_admin','revogar_super_admin','criar_integracao_versao','publicar_integracao','desativar_integracao','testar_integracao','atualizar_cnab',
  'atualizar_codigo_originador','publicar_base_financeira','confirmar_match_manual','revogar_match_manual','revisar_risco_operacao'
]));

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(p_action_type text,p_nonce_hash text)
RETURNS TABLE(expira_em timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user_id uuid:=auth.uid(); v_session_id uuid; v_agora timestamptz:=clock_timestamp();
BEGIN
  BEGIN v_session_id:=nullif(auth.jwt()->>'session_id','')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sessao Supabase invalida'; END;
  IF p_action_type IS NULL OR p_action_type NOT IN ('alterar_senha','alterar_email','regenerar_recovery_codes','encerrar_outras_sessoes','reset_mfa_administrativo','cadastrar_credencial_integracao','rotacionar_credencial_integracao','ativar_credencial_integracao','revogar_credencial_integracao','criar_fundo','atualizar_fundo_estrutural','ativar_fundo','desativar_fundo','convidar_usuario_admin','vincular_gestor_fundo','revogar_gestor_fundo','reativar_gestor_fundo','desativar_usuario','reativar_usuario','conceder_super_admin','revogar_super_admin','criar_integracao_versao','publicar_integracao','desativar_integracao','testar_integracao','atualizar_cnab','atualizar_codigo_originador','publicar_base_financeira','confirmar_match_manual','revogar_match_manual','revisar_risco_operacao')
     OR p_nonce_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Tipo de acao sensivel ou nonce invalido'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.obter_sessao_mfa_atual() estado WHERE estado.status='valid' AND estado.session_id=v_session_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sessao MFA de 24 horas invalida'; END IF;
  INSERT INTO public.autorizacoes_acoes_sensiveis(user_id,session_id,action_type,nonce_hash,criada_em,expira_em) VALUES(v_user_id,v_session_id,p_action_type,p_nonce_hash,v_agora,v_agora+interval '5 minutes');
  RETURN QUERY SELECT v_agora+interval '5 minutes';
END; $$;
REVOKE ALL ON FUNCTION public.criar_autorizacao_acao_sensivel(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.criar_autorizacao_acao_sensivel(text,text) TO authenticated;

COMMENT ON TABLE public.risco_execucoes IS 'Snapshots imutaveis das avaliacoes do gate GATE_RISCO_V1.';
COMMENT ON TABLE public.risco_motivos IS 'Motivos cumulativos e imutaveis que fundamentam cada decisao de risco.';
COMMENT ON TABLE public.risco_revisoes IS 'Workflow da excecao REVISAO_MANUAL; nao altera o resultado original.';
NOTIFY pgrst,'reload schema';
COMMIT;
