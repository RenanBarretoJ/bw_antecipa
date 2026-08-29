BEGIN;

DO $$
BEGIN
  IF to_regclass('public.rlx_importacoes_financeiras') IS NULL
     OR to_regclass('public.rlx_estoque_posicoes') IS NULL
     OR to_regclass('public.notas_fiscais') IS NULL
     OR to_regprocedure('private.rlx_gestor_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.rlx_chamada_service_role()') IS NULL THEN
    RAISE EXCEPTION 'P2.3 requer o schema P2.2 e seus helpers de autorizacao';
  END IF;
END $$;

CREATE TABLE public.rlx_matching_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  data_referencia date NOT NULL,
  regra_versao text NOT NULL DEFAULT 'RLX_MATCH_V1',
  input_import_ids uuid[] NOT NULL,
  assinatura_execucao text NOT NULL,
  status text NOT NULL DEFAULT 'PROCESSANDO'
    CHECK (status IN ('PROCESSANDO', 'CONCLUIDA', 'FALHA')),
  total_registros integer NOT NULL DEFAULT 0 CHECK (total_registros >= 0),
  matched integer NOT NULL DEFAULT 0 CHECK (matched >= 0),
  ambiguos integer NOT NULL DEFAULT 0 CHECK (ambiguos >= 0),
  nao_conciliados integer NOT NULL DEFAULT 0 CHECK (nao_conciliados >= 0),
  conflitos integer NOT NULL DEFAULT 0 CHECK (conflitos >= 0),
  valor_total numeric(24, 2) NOT NULL DEFAULT 0,
  valor_matched numeric(24, 2) NOT NULL DEFAULT 0,
  valor_ambiguo numeric(24, 2) NOT NULL DEFAULT 0,
  valor_nao_conciliado numeric(24, 2) NOT NULL DEFAULT 0,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_em timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_por uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_matching_execucoes_inputs_check CHECK (cardinality(input_import_ids) > 0),
  CONSTRAINT rlx_matching_execucoes_regra_check CHECK (regra_versao = 'RLX_MATCH_V1'),
  CONSTRAINT rlx_matching_execucoes_assinatura_unique UNIQUE (fundo_id, assinatura_execucao)
);

CREATE TABLE public.rlx_titulo_nf_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  provedor text NOT NULL,
  identidade_externa text NOT NULL,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id),
  status text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'REVOGADO')),
  origem text NOT NULL CHECK (origem IN ('AUTOMATICO', 'MANUAL')),
  metodo text NOT NULL CHECK (metodo IN ('CHAVE_NFE', 'SEU_NUMERO', 'COMPOSTO', 'ID_RECEBIVEL', 'MANUAL')),
  regra_versao text NOT NULL DEFAULT 'RLX_MATCH_V1',
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_count integer NOT NULL DEFAULT 1 CHECK (candidate_count >= 1),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  criado_por uuid REFERENCES public.profiles(id),
  confirmado_em timestamptz,
  confirmado_por uuid REFERENCES public.profiles(id),
  revogado_em timestamptz,
  revogado_por uuid REFERENCES public.profiles(id),
  motivo_revogacao text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT rlx_titulo_nf_vinculos_revogacao_check CHECK (
    (status = 'ATIVO' AND revogado_em IS NULL AND revogado_por IS NULL AND motivo_revogacao IS NULL)
    OR
    (status = 'REVOGADO' AND revogado_em IS NOT NULL AND revogado_por IS NOT NULL AND length(btrim(motivo_revogacao)) >= 5)
  )
);

CREATE UNIQUE INDEX rlx_titulo_nf_vinculos_identidade_ativa_uidx
  ON public.rlx_titulo_nf_vinculos (fundo_id, provedor, identidade_externa)
  WHERE status = 'ATIVO';
CREATE INDEX rlx_titulo_nf_vinculos_nf_idx
  ON public.rlx_titulo_nf_vinculos (fundo_id, nota_fiscal_id, status);

CREATE TABLE public.rlx_titulo_nf_vinculo_chaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vinculo_id uuid NOT NULL REFERENCES public.rlx_titulo_nf_vinculos(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  provedor text NOT NULL,
  tipo_chave text NOT NULL
    CHECK (tipo_chave IN ('CHAVE_NFE', 'ID_RECEBIVEL', 'SEU_NUMERO', 'EXTERNAL_TITLE_KEY', 'DOCUMENTO', 'NOSSO_NUMERO')),
  valor_normalizado text NOT NULL CHECK (length(btrim(valor_normalizado)) > 0),
  fonte text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_titulo_nf_vinculo_chaves_unique UNIQUE (vinculo_id, tipo_chave, valor_normalizado)
);

CREATE INDEX rlx_titulo_nf_chave_escopo_idx
  ON public.rlx_titulo_nf_vinculo_chaves (fundo_id, provedor, tipo_chave, valor_normalizado);
CREATE INDEX rlx_titulo_nf_chave_lookup_idx
  ON public.rlx_titulo_nf_vinculo_chaves (fundo_id, provedor, tipo_chave, valor_normalizado, vinculo_id);

CREATE TABLE public.rlx_matching_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.rlx_matching_execucoes(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  provedor text NOT NULL,
  origem_registro text NOT NULL CHECK (origem_registro IN ('ESTOQUE', 'AQUISICAO', 'LIQUIDACAO')),
  origem_registro_id uuid NOT NULL,
  identidade_externa text NOT NULL,
  id_recebivel text,
  seu_numero text,
  chave_nfe text,
  numero_documento text,
  cedente_documento text,
  cedente_nome text,
  sacado_documento text,
  sacado_nome text,
  data_vencimento date,
  valor_referencia numeric(24, 2),
  tipo_recebivel text,
  status text NOT NULL CHECK (status IN ('MATCH_FORTE', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO')),
  metodo text NOT NULL CHECK (metodo IN ('CHAVE_NFE', 'SEU_NUMERO', 'COMPOSTO', 'ID_RECEBIVEL', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO')),
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id),
  vinculo_id uuid REFERENCES public.rlx_titulo_nf_vinculos(id),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_matching_resultados_origem_unique UNIQUE (execucao_id, origem_registro, origem_registro_id),
  CONSTRAINT rlx_matching_resultados_match_check CHECK (
    (status = 'MATCH_FORTE' AND nota_fiscal_id IS NOT NULL AND vinculo_id IS NOT NULL AND candidate_count = 1)
    OR
    (status <> 'MATCH_FORTE' AND vinculo_id IS NULL)
  )
);

CREATE INDEX rlx_matching_resultados_listagem_idx
  ON public.rlx_matching_resultados (fundo_id, execucao_id, status, metodo, criado_em DESC);
CREATE INDEX rlx_matching_resultados_nf_idx
  ON public.rlx_matching_resultados (fundo_id, nota_fiscal_id);
CREATE INDEX rlx_matching_resultados_identidade_idx
  ON public.rlx_matching_resultados (fundo_id, provedor, identidade_externa);

CREATE TABLE public.rlx_matching_candidatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matching_resultado_id uuid NOT NULL REFERENCES public.rlx_matching_resultados(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id),
  ordem integer NOT NULL CHECK (ordem > 0),
  metodo text NOT NULL,
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_matching_candidatos_unique UNIQUE (matching_resultado_id, nota_fiscal_id)
);

CREATE INDEX rlx_matching_candidatos_resultado_idx
  ON public.rlx_matching_candidatos (matching_resultado_id, ordem);

CREATE TABLE public.rlx_conciliacao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  data_referencia date NOT NULL,
  regra_versao text NOT NULL DEFAULT 'RLX_RECON_V1',
  estoque_d2_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id),
  estoque_d1_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id),
  aquisicoes_d1_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id),
  liquidacoes_d1_importacao_id uuid REFERENCES public.rlx_importacoes_financeiras(id),
  matching_execucao_id uuid REFERENCES public.rlx_matching_execucoes(id),
  assinatura_execucao text NOT NULL,
  status text NOT NULL DEFAULT 'PROCESSANDO'
    CHECK (status IN ('PROCESSANDO', 'CONCLUIDA', 'BASE_INCOMPLETA', 'FALHA')),
  contagens jsonb NOT NULL DEFAULT '{}'::jsonb,
  valores_agregados jsonb NOT NULL DEFAULT '{}'::jsonb,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizado_em timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_por uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_conciliacao_execucoes_regra_check CHECK (regra_versao = 'RLX_RECON_V1'),
  CONSTRAINT rlx_conciliacao_execucoes_assinatura_unique UNIQUE (fundo_id, assinatura_execucao)
);

CREATE INDEX rlx_conciliacao_execucoes_data_idx
  ON public.rlx_conciliacao_execucoes (fundo_id, data_referencia DESC, created_at DESC);

CREATE TABLE public.rlx_conciliacao_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id uuid NOT NULL REFERENCES public.rlx_conciliacao_execucoes(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  identidade_externa text NOT NULL,
  provedor text NOT NULL,
  vinculo_id uuid REFERENCES public.rlx_titulo_nf_vinculos(id),
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id),
  presente_d2 boolean NOT NULL DEFAULT false,
  presente_d1 boolean NOT NULL DEFAULT false,
  valor_aquisicao_d2 numeric(24, 2),
  valor_aquisicao_d1 numeric(24, 2),
  aquisicoes_count integer NOT NULL DEFAULT 0 CHECK (aquisicoes_count >= 0),
  aquisicoes_valor numeric(24, 2) NOT NULL DEFAULT 0,
  liquidacoes_count integer NOT NULL DEFAULT 0 CHECK (liquidacoes_count >= 0),
  liquidacoes_valor_pago numeric(24, 2) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN (
    'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA', 'ENTRADA_SEM_AQUISICAO',
    'SAIDA_REFLETIDA', 'SAIDA_NAO_REFLETIDA', 'SAIDA_SEM_LIQUIDACAO', 'LIQUIDADO_AINDA_NO_ESTOQUE',
    'DIVERGENCIA_VALOR', 'NAO_CONCILIADO', 'BASE_INCOMPLETA', 'RETIFICACAO_ESTOQUE',
    'RETIFICACAO_AQUISICAO', 'LIQUIDACAO_REPETIDA_MESMO_DIA', 'LIQUIDACAO_PARCIAL_SALDO',
    'DIA_SEM_MOVIMENTO', 'ARQUIVO_DUPLICADO_HASH'
  )),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rlx_conciliacao_resultados_identidade_unique UNIQUE (execucao_id, identidade_externa)
);

CREATE INDEX rlx_conciliacao_resultados_listagem_idx
  ON public.rlx_conciliacao_resultados (fundo_id, execucao_id, status, criado_em DESC);
CREATE INDEX rlx_conciliacao_resultados_nf_idx
  ON public.rlx_conciliacao_resultados (fundo_id, nota_fiscal_id);

CREATE OR REPLACE FUNCTION private.rlx_p2_3_bloquear_mutacao_historica()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Resultados historicos P2.3 sao imutaveis';
END;
$$;

CREATE OR REPLACE FUNCTION private.rlx_p2_3_finalizar_execucao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Execucoes historicas P2.3 nao podem ser excluidas';
  END IF;
  IF OLD.status <> 'PROCESSANDO' OR NEW.status = 'PROCESSANDO'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
     OR NEW.data_referencia IS DISTINCT FROM OLD.data_referencia
     OR NEW.regra_versao IS DISTINCT FROM OLD.regra_versao
     OR NEW.assinatura_execucao IS DISTINCT FROM OLD.assinatura_execucao
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Execucao P2.3 finalizada e imutavel';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.rlx_p2_3_autorizacao_consumida(p_action_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.autorizacoes_acoes_sensiveis a
    WHERE a.user_id = auth.uid()
      AND a.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      AND a.action_type = p_action_type
      AND a.consumida_em IS NOT NULL
      AND a.consumida_em >= clock_timestamp() - interval '2 minutes'
  );
$$;

REVOKE ALL ON FUNCTION private.rlx_p2_3_autorizacao_consumida(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.rlx_p2_3_autorizacao_consumida(text) TO service_role;

CREATE OR REPLACE FUNCTION private.rlx_p2_3_proteger_vinculo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Vinculos financeiros nao podem ser excluidos';
  END IF;
  IF OLD.status = 'REVOGADO' OR NEW.status <> 'REVOGADO'
     OR NEW.nota_fiscal_id IS DISTINCT FROM OLD.nota_fiscal_id
     OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
     OR NEW.provedor IS DISTINCT FROM OLD.provedor
     OR NEW.identidade_externa IS DISTINCT FROM OLD.identidade_externa
     OR NEW.origem IS DISTINCT FROM OLD.origem
     OR NEW.metodo IS DISTINCT FROM OLD.metodo THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Somente a revogacao auditada do vinculo e permitida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rlx_matching_execucoes_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_matching_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_finalizar_execucao();
CREATE TRIGGER rlx_matching_resultados_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_matching_resultados
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_bloquear_mutacao_historica();
CREATE TRIGGER rlx_matching_candidatos_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_matching_candidatos
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_bloquear_mutacao_historica();
CREATE TRIGGER rlx_conciliacao_execucoes_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_conciliacao_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_finalizar_execucao();
CREATE TRIGGER rlx_conciliacao_resultados_imutaveis
  BEFORE UPDATE OR DELETE ON public.rlx_conciliacao_resultados
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_bloquear_mutacao_historica();
CREATE TRIGGER rlx_titulo_nf_vinculos_protegidos
  BEFORE UPDATE OR DELETE ON public.rlx_titulo_nf_vinculos
  FOR EACH ROW EXECUTE FUNCTION private.rlx_p2_3_proteger_vinculo();

ALTER TABLE public.rlx_matching_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_titulo_nf_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_titulo_nf_vinculo_chaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_matching_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_matching_candidatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_conciliacao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_conciliacao_resultados ENABLE ROW LEVEL SECURITY;

CREATE POLICY rlx_matching_execucoes_gestor_select ON public.rlx_matching_execucoes
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_titulo_nf_vinculos_gestor_select ON public.rlx_titulo_nf_vinculos
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_titulo_nf_chaves_gestor_select ON public.rlx_titulo_nf_vinculo_chaves
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_matching_resultados_gestor_select ON public.rlx_matching_resultados
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_matching_candidatos_gestor_select ON public.rlx_matching_candidatos
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_conciliacao_execucoes_gestor_select ON public.rlx_conciliacao_execucoes
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_conciliacao_resultados_gestor_select ON public.rlx_conciliacao_resultados
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));

REVOKE ALL ON TABLE
  public.rlx_matching_execucoes,
  public.rlx_titulo_nf_vinculos,
  public.rlx_titulo_nf_vinculo_chaves,
  public.rlx_matching_resultados,
  public.rlx_matching_candidatos,
  public.rlx_conciliacao_execucoes,
  public.rlx_conciliacao_resultados
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.rlx_matching_execucoes,
  public.rlx_titulo_nf_vinculos,
  public.rlx_titulo_nf_vinculo_chaves,
  public.rlx_matching_resultados,
  public.rlx_matching_candidatos,
  public.rlx_conciliacao_execucoes,
  public.rlx_conciliacao_resultados
TO authenticated;

GRANT ALL ON TABLE
  public.rlx_matching_execucoes,
  public.rlx_titulo_nf_vinculos,
  public.rlx_titulo_nf_vinculo_chaves,
  public.rlx_matching_resultados,
  public.rlx_matching_candidatos,
  public.rlx_conciliacao_execucoes,
  public.rlx_conciliacao_resultados
TO service_role;

CREATE OR REPLACE FUNCTION public.rlx_persistir_matching_execucao(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
AS $$
DECLARE
  v_fundo_id uuid := (p_payload ->> 'fundo_id')::uuid;
  v_execucao_id uuid;
  v_resultado_id uuid;
  v_vinculo_id uuid;
  v_existente public.rlx_titulo_nf_vinculos%ROWTYPE;
  v_item jsonb;
  v_candidate jsonb;
  v_chave jsonb;
  v_status text;
  v_metodo text;
  v_total integer := 0;
  v_matched integer := 0;
  v_ambiguos integer := 0;
  v_nao_conciliados integer := 0;
  v_conflitos integer := 0;
  v_valor_total numeric(24,2) := 0;
  v_valor_matched numeric(24,2) := 0;
  v_valor_ambiguo numeric(24,2) := 0;
  v_valor_nao_conciliado numeric(24,2) := 0;
BEGIN
  IF NOT private.rlx_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia de matching restrita ao processador interno';
  END IF;
  IF v_fundo_id IS NULL OR jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payload de matching invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'rlx-matching:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
  ));

  SELECT id INTO v_execucao_id
  FROM public.rlx_matching_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF (
    SELECT count(*)
    FROM public.rlx_importacoes_financeiras i
    WHERE i.id = ANY(ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'input_import_ids')::uuid))
      AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
  ) <> jsonb_array_length(p_payload -> 'input_import_ids') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs de matching nao estao publicados no fundo informado';
  END IF;

  INSERT INTO public.rlx_matching_execucoes (
    fundo_id, data_referencia, regra_versao, input_import_ids, assinatura_execucao,
    correlation_id, criado_por, detalhes
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, p_payload ->> 'regra_versao',
    ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'input_import_ids')::uuid),
    p_payload ->> 'assinatura_execucao', (p_payload ->> 'correlation_id')::uuid,
    nullif(p_payload ->> 'criado_por', '')::uuid,
    jsonb_build_object('processamento', 'RPC_TRANSACIONAL', 'imutavel', true)
  ) RETURNING id INTO v_execucao_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload -> 'resultados')
  LOOP
    v_total := v_total + 1;
    v_status := v_item ->> 'status';
    v_metodo := v_item ->> 'metodo';
    v_vinculo_id := NULL;
    v_valor_total := v_valor_total + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);

    IF v_status = 'MATCH_FORTE' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.notas_fiscais nf
        WHERE nf.id = (v_item ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NF candidata fora do fundo da execucao';
      END IF;

      SELECT * INTO v_existente
      FROM public.rlx_titulo_nf_vinculos
      WHERE fundo_id = v_fundo_id AND provedor = v_item ->> 'provedor'
        AND identidade_externa = v_item ->> 'identidade_externa' AND status = 'ATIVO';

      IF FOUND AND v_existente.nota_fiscal_id <> (v_item ->> 'nota_fiscal_id')::uuid THEN
        v_status := 'CONFLITO';
        v_metodo := 'CONFLITO';
      ELSIF FOUND THEN
        v_vinculo_id := v_existente.id;
      ELSE
        INSERT INTO public.rlx_titulo_nf_vinculos (
          fundo_id, provedor, identidade_externa, nota_fiscal_id, origem, metodo,
          regra_versao, evidencias, candidate_count, criado_por, correlation_id
        ) VALUES (
          v_fundo_id, v_item ->> 'provedor', v_item ->> 'identidade_externa',
          (v_item ->> 'nota_fiscal_id')::uuid, 'AUTOMATICO', v_metodo,
          p_payload ->> 'regra_versao', coalesce(v_item -> 'evidencias', '{}'::jsonb), 1,
          nullif(p_payload ->> 'criado_por', '')::uuid, (p_payload ->> 'correlation_id')::uuid
        ) RETURNING id INTO v_vinculo_id;

        FOR v_chave IN SELECT value FROM jsonb_array_elements(coalesce(v_item -> 'chaves', '[]'::jsonb))
        LOOP
          INSERT INTO public.rlx_titulo_nf_vinculo_chaves (
            vinculo_id, fundo_id, provedor, tipo_chave, valor_normalizado, fonte
          ) VALUES (
            v_vinculo_id, v_fundo_id, v_item ->> 'provedor', v_chave ->> 'tipo',
            v_chave ->> 'valor', 'MATCH_AUTOMATICO'
          ) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END IF;

    IF v_status = 'MATCH_FORTE' THEN
      v_matched := v_matched + 1;
      v_valor_matched := v_valor_matched + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    ELSIF v_status = 'AMBIGUO' THEN
      v_ambiguos := v_ambiguos + 1;
      v_valor_ambiguo := v_valor_ambiguo + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    ELSIF v_status = 'CONFLITO' THEN
      v_conflitos := v_conflitos + 1;
    ELSE
      v_nao_conciliados := v_nao_conciliados + 1;
      v_valor_nao_conciliado := v_valor_nao_conciliado + coalesce(nullif(v_item ->> 'valor_referencia', '')::numeric, 0);
    END IF;

    INSERT INTO public.rlx_matching_resultados (
      execucao_id, fundo_id, provedor, origem_registro, origem_registro_id,
      identidade_externa, id_recebivel, seu_numero, chave_nfe, numero_documento,
      cedente_documento, cedente_nome, sacado_documento, sacado_nome,
      data_vencimento, valor_referencia, tipo_recebivel, status, metodo,
      nota_fiscal_id, vinculo_id, candidate_count, evidencias
    ) VALUES (
      v_execucao_id, v_fundo_id, v_item ->> 'provedor', v_item ->> 'origem_registro',
      (v_item ->> 'origem_registro_id')::uuid, v_item ->> 'identidade_externa',
      nullif(v_item ->> 'id_recebivel', ''), nullif(v_item ->> 'seu_numero', ''),
      nullif(v_item ->> 'chave_nfe', ''), nullif(v_item ->> 'numero_documento', ''),
      nullif(v_item ->> 'cedente_documento', ''), nullif(v_item ->> 'cedente_nome', ''),
      nullif(v_item ->> 'sacado_documento', ''), nullif(v_item ->> 'sacado_nome', ''),
      nullif(v_item ->> 'data_vencimento', '')::date,
      nullif(v_item ->> 'valor_referencia', '')::numeric, nullif(v_item ->> 'tipo_recebivel', ''),
      v_status, v_metodo,
      CASE WHEN v_status = 'MATCH_FORTE' THEN (v_item ->> 'nota_fiscal_id')::uuid ELSE NULL END,
      v_vinculo_id,
      CASE WHEN v_status = 'MATCH_FORTE' THEN 1 ELSE jsonb_array_length(coalesce(v_item -> 'candidatos', '[]'::jsonb)) END,
      coalesce(v_item -> 'evidencias', '{}'::jsonb) ||
        CASE WHEN v_status = 'CONFLITO' THEN jsonb_build_object('vinculo_ativo_conflitante', v_existente.id) ELSE '{}'::jsonb END
    ) RETURNING id INTO v_resultado_id;

    FOR v_candidate IN SELECT value FROM jsonb_array_elements(coalesce(v_item -> 'candidatos', '[]'::jsonb))
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notas_fiscais nf
        WHERE nf.id = (v_candidate ->> 'nota_fiscal_id')::uuid AND nf.fundo_id = v_fundo_id
      ) THEN
        INSERT INTO public.rlx_matching_candidatos (
          matching_resultado_id, fundo_id, nota_fiscal_id, ordem, metodo, evidencias
        ) VALUES (
          v_resultado_id, v_fundo_id, (v_candidate ->> 'nota_fiscal_id')::uuid,
          coalesce((v_candidate ->> 'ordem')::integer, 1), v_candidate ->> 'metodo',
          coalesce(v_candidate -> 'evidencias', '{}'::jsonb)
        ) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.rlx_matching_execucoes SET
    status = 'CONCLUIDA', total_registros = v_total, matched = v_matched,
    ambiguos = v_ambiguos, nao_conciliados = v_nao_conciliados, conflitos = v_conflitos,
    valor_total = v_valor_total, valor_matched = v_valor_matched,
    valor_ambiguo = v_valor_ambiguo, valor_nao_conciliado = v_valor_nao_conciliado,
    finalizado_em = clock_timestamp()
  WHERE id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    nullif(p_payload ->> 'criado_por', '')::uuid, 'MATCHING_EXECUTADO',
    'rlx_matching_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'total', v_total, 'matched', v_matched, 'ambiguos', v_ambiguos,
      'nao_conciliados', v_nao_conciliados, 'conflitos', v_conflitos,
      'correlation_id', p_payload ->> 'correlation_id'),
    'usuario', 'gestor_conciliacao', p_payload ->> 'criado_por'
  );
  RETURN v_execucao_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rlx_persistir_conciliacao_execucao(p_payload jsonb)
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
  v_inputs uuid[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb))::uuid);
BEGIN
  IF NOT private.rlx_chamada_service_role() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Persistencia de conciliacao restrita ao processador interno';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'rlx-conciliacao:' || v_fundo_id::text || ':' || (p_payload ->> 'data_referencia'), 0
  ));
  SELECT id INTO v_execucao_id FROM public.rlx_conciliacao_execucoes
  WHERE fundo_id = v_fundo_id AND assinatura_execucao = p_payload ->> 'assinatura_execucao';
  IF FOUND THEN RETURN v_execucao_id; END IF;

  IF v_status <> 'BASE_INCOMPLETA' AND (
    SELECT count(*) FROM public.rlx_importacoes_financeiras i
    WHERE i.id = ANY(v_inputs) AND i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'
      AND i.completude IN ('COMPLETO_COM_DADOS', 'COMPLETO_VAZIO')
  ) <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Inputs publicados/completos da conciliacao sao invalidos';
  END IF;

  INSERT INTO public.rlx_conciliacao_execucoes (
    fundo_id, data_referencia, regra_versao, estoque_d2_importacao_id,
    estoque_d1_importacao_id, aquisicoes_d1_importacao_id, liquidacoes_d1_importacao_id,
    matching_execucao_id, assinatura_execucao, correlation_id, criado_por, detalhes
  ) VALUES (
    v_fundo_id, (p_payload ->> 'data_referencia')::date, p_payload ->> 'regra_versao',
    nullif(p_payload ->> 'estoque_d2_importacao_id', '')::uuid,
    nullif(p_payload ->> 'estoque_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'aquisicoes_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'liquidacoes_d1_importacao_id', '')::uuid,
    nullif(p_payload ->> 'matching_execucao_id', '')::uuid,
    p_payload ->> 'assinatura_execucao', (p_payload ->> 'correlation_id')::uuid,
    nullif(p_payload ->> 'criado_por', '')::uuid, coalesce(p_payload -> 'detalhes', '{}'::jsonb)
  ) RETURNING id INTO v_execucao_id;

  IF v_status <> 'BASE_INCOMPLETA' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb))
    LOOP
      INSERT INTO public.rlx_conciliacao_resultados (
        execucao_id, fundo_id, identidade_externa, provedor, vinculo_id, nota_fiscal_id,
        presente_d2, presente_d1, valor_aquisicao_d2, valor_aquisicao_d1,
        aquisicoes_count, aquisicoes_valor, liquidacoes_count, liquidacoes_valor_pago,
        status, detalhes
      ) VALUES (
        v_execucao_id, v_fundo_id, v_item ->> 'identidade_externa', v_item ->> 'provedor',
        nullif(v_item ->> 'vinculo_id', '')::uuid, nullif(v_item ->> 'nota_fiscal_id', '')::uuid,
        coalesce((v_item ->> 'presente_d2')::boolean, false),
        coalesce((v_item ->> 'presente_d1')::boolean, false),
        nullif(v_item ->> 'valor_aquisicao_d2', '')::numeric,
        nullif(v_item ->> 'valor_aquisicao_d1', '')::numeric,
        coalesce((v_item ->> 'aquisicoes_count')::integer, 0),
        coalesce((v_item ->> 'aquisicoes_valor')::numeric, 0),
        coalesce((v_item ->> 'liquidacoes_count')::integer, 0),
        coalesce((v_item ->> 'liquidacoes_valor_pago')::numeric, 0),
        v_item ->> 'status', coalesce(v_item -> 'detalhes', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  UPDATE public.rlx_conciliacao_execucoes SET
    status = v_status, contagens = coalesce(p_payload -> 'contagens', '{}'::jsonb),
    valores_agregados = coalesce(p_payload -> 'valores_agregados', '{}'::jsonb),
    finalizado_em = clock_timestamp()
  WHERE id = v_execucao_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    nullif(p_payload ->> 'criado_por', '')::uuid,
    CASE WHEN v_status = 'BASE_INCOMPLETA' THEN 'CONCILIACAO_BASE_INCOMPLETA' ELSE 'CONCILIACAO_EXECUTADA' END,
    'rlx_conciliacao_execucoes', v_execucao_id,
    jsonb_build_object('fundo_id', v_fundo_id, 'data_referencia', p_payload ->> 'data_referencia',
      'status', v_status, 'contagens', p_payload -> 'contagens',
      'correlation_id', p_payload ->> 'correlation_id'),
    'usuario', 'gestor_conciliacao', p_payload ->> 'criado_por'
  );
  RETURN v_execucao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rlx_persistir_matching_execucao(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rlx_persistir_conciliacao_execucao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlx_persistir_matching_execucao(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rlx_persistir_conciliacao_execucao(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rlx_confirmar_match_manual(
  p_matching_resultado_id uuid,
  p_nota_fiscal_id uuid,
  p_motivo text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE
  v_resultado public.rlx_matching_resultados%ROWTYPE;
  v_vinculo_id uuid;
  v_user_id uuid := auth.uid();
  v_chave record;
BEGIN
  SELECT * INTO v_resultado
  FROM public.rlx_matching_resultados
  WHERE id = p_matching_resultado_id;

  IF NOT FOUND OR NOT private.rlx_gestor_tem_acesso_fundo(v_resultado.fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Resultado de matching indisponivel para o fundo ativo';
  END IF;
  IF v_resultado.status NOT IN ('AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Somente excecoes de matching podem ser associadas manualmente';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe um motivo com pelo menos 5 caracteres';
  END IF;
  IF NOT private.rlx_p2_3_autorizacao_consumida('confirmar_match_manual') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Confirmacao TOTP fresca obrigatoria';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = p_nota_fiscal_id AND nf.fundo_id = v_resultado.fundo_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A nota fiscal nao pertence ao fundo do resultado';
  END IF;

  SELECT id INTO v_vinculo_id
  FROM public.rlx_titulo_nf_vinculos
  WHERE fundo_id = v_resultado.fundo_id
    AND provedor = v_resultado.provedor
    AND identidade_externa = v_resultado.identidade_externa
    AND status = 'ATIVO'
    AND origem = 'MANUAL'
    AND nota_fiscal_id = p_nota_fiscal_id;
  IF FOUND THEN RETURN v_vinculo_id; END IF;

  IF EXISTS (
    SELECT 1 FROM public.rlx_titulo_nf_vinculos
    WHERE fundo_id = v_resultado.fundo_id
      AND provedor = v_resultado.provedor
      AND identidade_externa = v_resultado.identidade_externa
      AND status = 'ATIVO' AND origem = 'MANUAL'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Ja existe vinculo manual ativo para este titulo';
  END IF;

  UPDATE public.rlx_titulo_nf_vinculos
  SET status = 'REVOGADO', revogado_em = clock_timestamp(), revogado_por = v_user_id,
      motivo_revogacao = 'Substituido por associacao manual confirmada'
  WHERE fundo_id = v_resultado.fundo_id
    AND provedor = v_resultado.provedor
    AND identidade_externa = v_resultado.identidade_externa
    AND status = 'ATIVO' AND origem = 'AUTOMATICO';

  INSERT INTO public.rlx_titulo_nf_vinculos (
    fundo_id, provedor, identidade_externa, nota_fiscal_id, origem, metodo,
    evidencias, candidate_count, criado_por, confirmado_em, confirmado_por, correlation_id
  ) VALUES (
    v_resultado.fundo_id, v_resultado.provedor, v_resultado.identidade_externa,
    p_nota_fiscal_id, 'MANUAL', 'MANUAL',
    jsonb_build_object('matching_resultado_id', v_resultado.id, 'motivo', btrim(p_motivo)),
    1, v_user_id, clock_timestamp(), v_user_id, p_correlation_id
  ) RETURNING id INTO v_vinculo_id;

  FOR v_chave IN
    SELECT * FROM (VALUES
      ('ID_RECEBIVEL', v_resultado.id_recebivel),
      ('SEU_NUMERO', v_resultado.seu_numero),
      ('CHAVE_NFE', v_resultado.chave_nfe),
      ('EXTERNAL_TITLE_KEY', v_resultado.identidade_externa),
      ('DOCUMENTO', v_resultado.numero_documento)
    ) AS x(tipo, valor)
    WHERE valor IS NOT NULL AND length(btrim(valor)) > 0
  LOOP
    INSERT INTO public.rlx_titulo_nf_vinculo_chaves (
      vinculo_id, fundo_id, provedor, tipo_chave, valor_normalizado, fonte
    ) VALUES (
      v_vinculo_id, v_resultado.fundo_id, v_resultado.provedor,
      v_chave.tipo, btrim(v_chave.valor), 'MATCH_MANUAL'
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    v_user_id, 'MATCH_MANUAL_CONFIRMADO', 'rlx_titulo_nf_vinculos', v_vinculo_id,
    jsonb_build_object('matching_resultado_id', v_resultado.id, 'status', v_resultado.status),
    jsonb_build_object('fundo_id', v_resultado.fundo_id, 'nota_fiscal_id', p_nota_fiscal_id,
      'identidade_externa', v_resultado.identidade_externa, 'correlation_id', p_correlation_id),
    'usuario', 'gestor_conciliacao', v_user_id::text
  );
  RETURN v_vinculo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rlx_revogar_match_manual(
  p_vinculo_id uuid,
  p_motivo text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
DECLARE
  v_vinculo public.rlx_titulo_nf_vinculos%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_vinculo FROM public.rlx_titulo_nf_vinculos WHERE id = p_vinculo_id FOR UPDATE;
  IF NOT FOUND OR NOT private.rlx_gestor_tem_acesso_fundo(v_vinculo.fundo_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vinculo indisponivel para o fundo ativo';
  END IF;
  IF v_vinculo.origem <> 'MANUAL' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Somente vinculo manual pode ser revogado por esta acao';
  END IF;
  IF v_vinculo.status = 'REVOGADO' THEN RETURN true; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe um motivo com pelo menos 5 caracteres';
  END IF;
  IF NOT private.rlx_p2_3_autorizacao_consumida('revogar_match_manual') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Confirmacao TOTP fresca obrigatoria';
  END IF;

  UPDATE public.rlx_titulo_nf_vinculos
  SET status = 'REVOGADO', revogado_em = clock_timestamp(), revogado_por = v_user_id,
      motivo_revogacao = btrim(p_motivo)
  WHERE id = p_vinculo_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois,
    ator_tipo, origem, ator_identificador
  ) VALUES (
    v_user_id, 'MATCH_MANUAL_REVOGADO', 'rlx_titulo_nf_vinculos', p_vinculo_id,
    jsonb_build_object('status', 'ATIVO', 'nota_fiscal_id', v_vinculo.nota_fiscal_id),
    jsonb_build_object('status', 'REVOGADO', 'motivo', btrim(p_motivo), 'correlation_id', p_correlation_id),
    'usuario', 'gestor_conciliacao', v_user_id::text
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rlx_confirmar_match_manual(uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rlx_revogar_match_manual(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rlx_confirmar_match_manual(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rlx_revogar_match_manual(uuid, text, uuid) TO authenticated;

ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
      'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
      'publicar_integracao', 'desativar_integracao', 'testar_integracao',
      'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira',
      'confirmar_match_manual', 'revogar_match_manual'
    ])
  );

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
RETURNS TABLE (expira_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;
  IF p_action_type IS NULL OR p_action_type NOT IN (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
    'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
    'publicar_integracao', 'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira',
    'confirmar_match_manual', 'revogar_match_manual'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;
  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
    WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;
  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );
  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) TO authenticated;

COMMENT ON TABLE public.rlx_titulo_nf_vinculos IS
  'Crosswalk auditavel entre identidade financeira RLX e NF; nao altera as bases canonicas P2.2.';
COMMENT ON TABLE public.rlx_matching_resultados IS
  'Resultados imutaveis de matching por execucao e por registro financeiro.';
COMMENT ON TABLE public.rlx_conciliacao_resultados IS
  'Sintomas tecnicos imutaveis da reconciliacao D-2/D-1; nao representam saldo contabil definitivo.';

COMMIT;
