-- P2.5 - PL D-2, exposicao conhecida em transito e overlay intraday.
-- Camada analitica: nao aprova, bloqueia, cede ou altera operacoes.

ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS controle_exposicao_logistica_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_exposicao_em_transito_pct numeric(18,9);

ALTER TABLE public.politica_operacional_versoes
  DROP CONSTRAINT IF EXISTS politica_exposicao_limite_check;
ALTER TABLE public.politica_operacional_versoes
  ADD CONSTRAINT politica_exposicao_limite_check CHECK (
    (NOT controle_exposicao_logistica_ativo AND limite_exposicao_em_transito_pct IS NULL)
    OR
    (controle_exposicao_logistica_ativo AND limite_exposicao_em_transito_pct > 0 AND limite_exposicao_em_transito_pct <= 100)
  );

CREATE TABLE public.rlx_exposicao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  data_operacional date NOT NULL,
  data_referencia_estoque date NOT NULL,
  data_referencia_pl date NOT NULL,
  posicao_logistica_execucao_id uuid REFERENCES public.rlx_posicao_logistica_execucoes(id) ON DELETE RESTRICT,
  carteira_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  carteira_snapshot_id uuid REFERENCES public.rlx_carteira_snapshots(id) ON DELETE RESTRICT,
  politica_operacional_versao_id uuid REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  logistica_as_of timestamptz,
  overlay_as_of timestamptz NOT NULL,
  regra_versao text NOT NULL DEFAULT 'RLX_EXPOSICAO_V1' CHECK (regra_versao = 'RLX_EXPOSICAO_V1'),
  limite_referencia_pct numeric(18,9),
  assinatura_execucao text NOT NULL CHECK (length(assinatura_execucao) = 64),
  status text NOT NULL CHECK (status IN (
    'CALCULADA','NAO_APLICAVEL','PL_D2_INDISPONIVEL','PL_D2_INVALIDO',
    'POSICAO_LOGISTICA_INDISPONIVEL','BASE_INCOMPATIVEL'
  )),
  quantidade_posicao integer NOT NULL DEFAULT 0 CHECK (quantidade_posicao >= 0),
  quantidade_entregue integer NOT NULL DEFAULT 0 CHECK (quantidade_entregue >= 0),
  quantidade_em_transito_estoque integer NOT NULL DEFAULT 0 CHECK (quantidade_em_transito_estoque >= 0),
  quantidade_indeterminada integer NOT NULL DEFAULT 0 CHECK (quantidade_indeterminada >= 0),
  quantidade_sem_match integer NOT NULL DEFAULT 0 CHECK (quantidade_sem_match >= 0),
  quantidade_valor_aquisicao_ausente integer NOT NULL DEFAULT 0 CHECK (quantidade_valor_aquisicao_ausente >= 0),
  quantidade_overlay integer NOT NULL DEFAULT 0 CHECK (quantidade_overlay >= 0),
  quantidade_ja_incorporada integer NOT NULL DEFAULT 0 CHECK (quantidade_ja_incorporada >= 0),
  quantidade_nao_incorporada integer NOT NULL DEFAULT 0 CHECK (quantidade_nao_incorporada >= 0),
  valor_posicao_total numeric(24,4),
  valor_entregue numeric(24,4),
  valor_em_transito_estoque numeric(24,4),
  valor_indeterminado numeric(24,4),
  valor_sem_match numeric(24,4),
  overlay_total numeric(24,4),
  overlay_em_transito numeric(24,4),
  overlay_entregue numeric(24,4),
  overlay_indeterminado numeric(24,4),
  operacoes_ja_incorporadas_valor numeric(24,4),
  operacoes_nao_incorporadas_valor numeric(24,4),
  exposicao_em_transito_total numeric(24,4),
  patrimonio_liquido_d2 numeric(24,4),
  percentual_exposicao numeric(30,12),
  classificacao_limite text CHECK (classificacao_limite IN ('ABAIXO_LIMITE','NO_LIMITE','ACIMA_LIMITE')),
  flags_qualidade text[] NOT NULL DEFAULT '{}'::text[],
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalhes) = 'object'),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  iniciado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_exposicao_execucoes_assinatura_unique UNIQUE (fundo_id, assinatura_execucao),
  CONSTRAINT rlx_exposicao_resultado_calculado_check CHECK (
    status <> 'CALCULADA' OR (
      posicao_logistica_execucao_id IS NOT NULL AND carteira_importacao_id IS NOT NULL
      AND carteira_snapshot_id IS NOT NULL AND patrimonio_liquido_d2 > 0
      AND limite_referencia_pct IS NOT NULL AND percentual_exposicao IS NOT NULL
      AND classificacao_limite IS NOT NULL
    )
  )
);

CREATE TABLE public.rlx_exposicao_overlay_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.rlx_exposicao_execucoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  operacao_economica_em timestamptz NOT NULL,
  valor_aquisicao numeric(24,4),
  status_logistico text NOT NULL CHECK (status_logistico IN ('ENTREGUE','EM_TRANSITO','INDETERMINADA')),
  ja_incorporado_estoque boolean NOT NULL DEFAULT false,
  incluido_no_numerador boolean NOT NULL DEFAULT false,
  motivo text NOT NULL CHECK (motivo IN (
    'INCLUIDA_EM_TRANSITO','JA_INCORPORADO_ESTOQUE','OPERACAO_NAO_INCORPORADA',
    'ENTREGUE','INDETERMINADA','VALOR_AUSENTE'
  )),
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidencias) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_exposicao_overlay_item_unique UNIQUE (execucao_id, operacao_id, nota_fiscal_id),
  CONSTRAINT rlx_exposicao_overlay_inclusao_check CHECK (
    incluido_no_numerador = (motivo = 'INCLUIDA_EM_TRANSITO')
    AND (NOT incluido_no_numerador OR (status_logistico = 'EM_TRANSITO' AND valor_aquisicao IS NOT NULL AND NOT ja_incorporado_estoque))
  )
);

CREATE INDEX rlx_exposicao_execucoes_lista_idx ON public.rlx_exposicao_execucoes
  (fundo_id, data_operacional DESC, created_at DESC);
CREATE INDEX rlx_exposicao_execucoes_fontes_idx ON public.rlx_exposicao_execucoes
  (fundo_id, posicao_logistica_execucao_id, carteira_importacao_id);
CREATE INDEX rlx_exposicao_overlay_lista_idx ON public.rlx_exposicao_overlay_itens
  (fundo_id, execucao_id, motivo, created_at DESC);
CREATE INDEX rlx_exposicao_overlay_nf_idx ON public.rlx_exposicao_overlay_itens (fundo_id, nota_fiscal_id);

CREATE OR REPLACE FUNCTION private.rlx_p2_5_bloquear_mutacao_historica()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Historico P2.5 e imutavel';
END;
$$;
CREATE TRIGGER rlx_exposicao_execucoes_imutaveis BEFORE UPDATE OR DELETE ON public.rlx_exposicao_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_5_bloquear_mutacao_historica();
CREATE TRIGGER rlx_exposicao_overlay_imutavel BEFORE UPDATE OR DELETE ON public.rlx_exposicao_overlay_itens
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_5_bloquear_mutacao_historica();

ALTER TABLE public.rlx_exposicao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_exposicao_overlay_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY rlx_exposicao_execucoes_gestor_select ON public.rlx_exposicao_execucoes
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_exposicao_overlay_gestor_select ON public.rlx_exposicao_overlay_itens
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));

REVOKE ALL ON TABLE public.rlx_exposicao_execucoes, public.rlx_exposicao_overlay_itens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rlx_exposicao_execucoes, public.rlx_exposicao_overlay_itens TO authenticated;
GRANT ALL ON TABLE public.rlx_exposicao_execucoes, public.rlx_exposicao_overlay_itens TO service_role;

CREATE OR REPLACE FUNCTION public.rlx_persistir_exposicao_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_item jsonb;
  v_status text := p_payload ->> 'status';
  v_posicao_id uuid := nullif(p_payload ->> 'posicao_logistica_execucao_id', '')::uuid;
  v_carteira_importacao_id uuid := nullif(p_payload ->> 'carteira_importacao_id', '')::uuid;
  v_carteira_snapshot_id uuid := nullif(p_payload ->> 'carteira_snapshot_id', '')::uuid;
  v_reprocessamento boolean;
BEGIN
  IF NOT private.rlx_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia P2.5 restrita ao processador interno';
  END IF;
  IF v_fundo_id IS NULL OR p_payload ->> 'regra_versao' <> 'RLX_EXPOSICAO_V1'
     OR coalesce(p_payload ->> 'assinatura_execucao', '') !~ '^[0-9a-f]{64}$'
     OR v_status NOT IN ('CALCULADA','NAO_APLICAVEL','PL_D2_INDISPONIVEL','PL_D2_INVALIDO','POSICAO_LOGISTICA_INDISPONIVEL','BASE_INCOMPATIVEL') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload P2.5 invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'rlx-exposicao:' || v_fundo_id::text || ':' || (p_payload ->> 'data_operacional') || ':RLX_EXPOSICAO_V1', 0
  ));
  SELECT id INTO v_execucao_id FROM public.rlx_exposicao_execucoes
   WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF v_posicao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rlx_posicao_logistica_execucoes e
     WHERE e.id=v_posicao_id AND e.fundo_id=v_fundo_id AND e.status='CONCLUIDA'
       AND e.data_referencia=(p_payload->>'data_referencia_estoque')::date
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Snapshot P2.4 incompativel'; END IF;
  IF v_carteira_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rlx_carteira_snapshots c JOIN public.rlx_importacoes_financeiras i ON i.id=c.importacao_id
     WHERE c.id=v_carteira_snapshot_id AND c.importacao_id=v_carteira_importacao_id AND c.fundo_id=v_fundo_id
       AND c.data_referencia=(p_payload->>'data_referencia_pl')::date AND c.vigente
       AND i.status='PUBLICADA' AND i.tipo_base='CARTEIRA' AND i.completude='COMPLETO_COM_DADOS'
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PL D-2 incompativel'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.rlx_exposicao_execucoes e WHERE e.fundo_id=v_fundo_id AND e.data_operacional=(p_payload->>'data_operacional')::date)
    INTO v_reprocessamento;
  INSERT INTO public.rlx_exposicao_execucoes (
    fundo_id,data_operacional,data_referencia_estoque,data_referencia_pl,posicao_logistica_execucao_id,
    carteira_importacao_id,carteira_snapshot_id,politica_operacional_versao_id,logistica_as_of,overlay_as_of,
    regra_versao,limite_referencia_pct,assinatura_execucao,status,
    quantidade_posicao,quantidade_entregue,quantidade_em_transito_estoque,quantidade_indeterminada,
    quantidade_sem_match,quantidade_valor_aquisicao_ausente,quantidade_overlay,quantidade_ja_incorporada,
    quantidade_nao_incorporada,valor_posicao_total,valor_entregue,valor_em_transito_estoque,
    valor_indeterminado,valor_sem_match,overlay_total,overlay_em_transito,overlay_entregue,
    overlay_indeterminado,operacoes_ja_incorporadas_valor,operacoes_nao_incorporadas_valor,
    exposicao_em_transito_total,patrimonio_liquido_d2,percentual_exposicao,classificacao_limite,
    flags_qualidade,detalhes,correlation_id,criado_por
  ) VALUES (
    v_fundo_id,(p_payload->>'data_operacional')::date,(p_payload->>'data_referencia_estoque')::date,
    (p_payload->>'data_referencia_pl')::date,v_posicao_id,v_carteira_importacao_id,v_carteira_snapshot_id,
    nullif(p_payload->>'politica_operacional_versao_id','')::uuid,nullif(p_payload->>'logistica_as_of','')::timestamptz,
    (p_payload->>'overlay_as_of')::timestamptz,'RLX_EXPOSICAO_V1',nullif(p_payload->>'limite_referencia_pct','')::numeric,
    p_payload->>'assinatura_execucao',v_status,coalesce((p_payload->>'quantidade_posicao')::int,0),
    coalesce((p_payload->>'quantidade_entregue')::int,0),coalesce((p_payload->>'quantidade_em_transito_estoque')::int,0),
    coalesce((p_payload->>'quantidade_indeterminada')::int,0),coalesce((p_payload->>'quantidade_sem_match')::int,0),
    coalesce((p_payload->>'quantidade_valor_aquisicao_ausente')::int,0),coalesce((p_payload->>'quantidade_overlay')::int,0),
    coalesce((p_payload->>'quantidade_ja_incorporada')::int,0),coalesce((p_payload->>'quantidade_nao_incorporada')::int,0),
    nullif(p_payload->>'valor_posicao_total','')::numeric,nullif(p_payload->>'valor_entregue','')::numeric,
    nullif(p_payload->>'valor_em_transito_estoque','')::numeric,nullif(p_payload->>'valor_indeterminado','')::numeric,
    nullif(p_payload->>'valor_sem_match','')::numeric,nullif(p_payload->>'overlay_total','')::numeric,
    nullif(p_payload->>'overlay_em_transito','')::numeric,nullif(p_payload->>'overlay_entregue','')::numeric,
    nullif(p_payload->>'overlay_indeterminado','')::numeric,nullif(p_payload->>'operacoes_ja_incorporadas_valor','')::numeric,
    nullif(p_payload->>'operacoes_nao_incorporadas_valor','')::numeric,nullif(p_payload->>'exposicao_em_transito_total','')::numeric,
    nullif(p_payload->>'patrimonio_liquido_d2','')::numeric,nullif(p_payload->>'percentual_exposicao','')::numeric,
    nullif(p_payload->>'classificacao_limite',''),ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'flags_qualidade','[]'::jsonb))),
    coalesce(p_payload->'detalhes','{}'::jsonb),(p_payload->>'correlation_id')::uuid,nullif(p_payload->>'criado_por','')::uuid
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'overlay_itens','[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.operacoes_nfs onf
      JOIN public.operacoes o ON o.id=onf.operacao_id
      JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id
      WHERE onf.operacao_id=(v_item->>'operacao_id')::uuid AND onf.nota_fiscal_id=(v_item->>'nota_fiscal_id')::uuid
        AND cf.fundo_id=v_fundo_id
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Operacao/NF fora do fundo P2.5'; END IF;
    IF nullif(v_item->>'valor_aquisicao','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.operacao_calculo_nfs c WHERE c.operacao_id=(v_item->>'operacao_id')::uuid
       AND c.nota_fiscal_id=(v_item->>'nota_fiscal_id')::uuid AND c.fundo_id=v_fundo_id
       AND c.valor_presente=(v_item->>'valor_aquisicao')::numeric
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Valor de aquisicao overlay nao canonico'; END IF;
    INSERT INTO public.rlx_exposicao_overlay_itens (
      execucao_id,fundo_id,operacao_id,nota_fiscal_id,operacao_economica_em,valor_aquisicao,status_logistico,
      ja_incorporado_estoque,incluido_no_numerador,motivo,evidencias
    ) VALUES (
      v_execucao_id,v_fundo_id,(v_item->>'operacao_id')::uuid,(v_item->>'nota_fiscal_id')::uuid,
      (v_item->>'operacao_economica_em')::timestamptz,nullif(v_item->>'valor_aquisicao','')::numeric,
      v_item->>'status_logistico',coalesce((v_item->>'ja_incorporado_estoque')::boolean,false),
      coalesce((v_item->>'incluido_no_numerador')::boolean,false),v_item->>'motivo',coalesce(v_item->'evidencias','{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.logs_auditoria (tipo_evento,entidade_tipo,entidade_id,dados_depois,ator_tipo,origem,ator_identificador,created_at)
  VALUES (
    CASE WHEN v_status='PL_D2_INDISPONIVEL' THEN 'RLX_EXPOSICAO_PL_INDISPONIVEL'
         WHEN v_reprocessamento THEN 'RLX_EXPOSICAO_RECALCULADA' ELSE 'RLX_EXPOSICAO_CALCULADA' END,
    'rlx_exposicao_execucoes',v_execucao_id,
    jsonb_build_object('fundo_id',v_fundo_id,'data_operacional',p_payload->>'data_operacional','status',v_status,
      'regra_versao','RLX_EXPOSICAO_V1','correlation_id',p_payload->>'correlation_id'),
    'sistema','rlx_p2_5',p_payload->>'criado_por',clock_timestamp()
  );
  RETURN v_execucao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rlx_persistir_exposicao_execucao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlx_persistir_exposicao_execucao(jsonb) TO service_role;
