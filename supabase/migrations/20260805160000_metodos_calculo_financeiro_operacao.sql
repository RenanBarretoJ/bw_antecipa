-- Metodos financeiros versionados por politica e memoria imutavel da aprovacao.
-- Nao existe backfill: registros historicos sem metodo continuam sendo lidos
-- explicitamente como LEGADO_MENSAL_DIAS_REAIS_30.

BEGIN;

ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS metodo_calculo_financeiro text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'politica_versao_metodo_calculo_check'
      AND conrelid = 'public.politica_operacional_versoes'::regclass
  ) THEN
    ALTER TABLE public.politica_operacional_versoes
      ADD CONSTRAINT politica_versao_metodo_calculo_check
      CHECK (
        metodo_calculo_financeiro IS NULL
        OR metodo_calculo_financeiro IN ('DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365')
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.politica_operacional_versoes.metodo_calculo_financeiro IS
  'Metodo financeiro mensal exigido em novas publicacoes. NULL e preservado somente para versoes historicas, interpretadas pelo fallback legado.';

ALTER TABLE public.operacoes
  ALTER COLUMN taxa_desconto DROP NOT NULL,
  ALTER COLUMN valor_liquido_desembolso DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS metodo_calculo_financeiro text,
  ADD COLUMN IF NOT EXISTS calculo_data_base date,
  ADD COLUMN IF NOT EXISTS calculo_versao_motor integer,
  ADD COLUMN IF NOT EXISTS calculo_memoria jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operacoes_metodo_calculo_check'
      AND conrelid = 'public.operacoes'::regclass
  ) THEN
    ALTER TABLE public.operacoes
      ADD CONSTRAINT operacoes_metodo_calculo_check
      CHECK (
        metodo_calculo_financeiro IS NULL
        OR metodo_calculo_financeiro IN (
          'LEGADO_MENSAL_DIAS_REAIS_30',
          'DIAS_UTEIS_252',
          'TRINTA_360',
          'DIAS_CORRIDOS_365'
        )
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.operacao_calculo_nfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  metodo_calculo_financeiro text NOT NULL,
  valor_nominal numeric(18,2) NOT NULL CHECK (valor_nominal > 0),
  taxa_mensal numeric NOT NULL CHECK (taxa_mensal >= 0),
  data_base date NOT NULL,
  vencimento_contratual date NOT NULL,
  vencimento_calculo date NOT NULL,
  base_calculo integer NOT NULL CHECK (base_calculo IN (30, 252, 360, 365)),
  calendario text,
  dias_corridos_reais integer NOT NULL CHECK (dias_corridos_reais >= 0),
  dias_uteis integer CHECK (dias_uteis IS NULL OR dias_uteis >= 0),
  dias_financeiros integer CHECK (dias_financeiros IS NULL OR dias_financeiros >= 0),
  dias_aplicados integer NOT NULL CHECK (dias_aplicados >= 0),
  expoente numeric NOT NULL CHECK (expoente >= 0),
  fator numeric NOT NULL CHECK (fator > 0),
  valor_presente numeric(18,2) NOT NULL CHECK (valor_presente >= 0),
  desconto numeric(18,2) NOT NULL CHECK (desconto >= 0),
  regra_arredondamento text NOT NULL DEFAULT 'ROUND_HALF_UP_2_CASAS',
  versao_motor integer NOT NULL CHECK (versao_motor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacao_calculo_nfs_operacao_nf_unique UNIQUE (operacao_id, nota_fiscal_id),
  CONSTRAINT operacao_calculo_nfs_metodo_check CHECK (
    metodo_calculo_financeiro IN (
      'LEGADO_MENSAL_DIAS_REAIS_30',
      'DIAS_UTEIS_252',
      'TRINTA_360',
      'DIAS_CORRIDOS_365'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_operacao_calculo_nfs_operacao
  ON public.operacao_calculo_nfs(operacao_id);
CREATE INDEX IF NOT EXISTS idx_operacao_calculo_nfs_fundo
  ON public.operacao_calculo_nfs(fundo_id, created_at DESC);

COMMENT ON TABLE public.operacao_calculo_nfs IS
  'Memoria financeira por NF, gravada atomicamente na aprovacao e preservada para reproducao e auditoria.';

ALTER TABLE public.operacao_calculo_nfs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operacao_calculo_nfs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.operacao_calculo_nfs TO authenticated;
GRANT ALL ON TABLE public.operacao_calculo_nfs TO service_role;

DROP POLICY IF EXISTS operacao_calculo_nfs_gestor_select ON public.operacao_calculo_nfs;
CREATE POLICY operacao_calculo_nfs_gestor_select
  ON public.operacao_calculo_nfs FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'gestor'
    AND (SELECT private.usuario_tem_acesso_fundo(fundo_id))
  );

DROP POLICY IF EXISTS operacao_calculo_nfs_cedente_select ON public.operacao_calculo_nfs;
CREATE POLICY operacao_calculo_nfs_cedente_select
  ON public.operacao_calculo_nfs FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'cedente'
    AND cedente_id = (SELECT public.get_user_cedente_id())
  );

-- Computus gregoriano, utilizado somente para materializar os feriados moveis
-- do calendario nacional ANBIMA (Carnaval, Sexta-feira Santa e Corpus Christi).
CREATE OR REPLACE FUNCTION private.pascoa_gregoriana(p_ano integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  a integer; b integer; c integer; d integer; e integer; f integer;
  g integer; h integer; i integer; k integer; l integer; m integer;
  mes integer; dia integer;
BEGIN
  a := p_ano % 19;
  b := p_ano / 100;
  c := p_ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN pg_catalog.make_date(p_ano, mes, dia);
END;
$$;

CREATE OR REPLACE FUNCTION private.eh_dia_util_anbima(p_data date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  pascoa date := private.pascoa_gregoriana(extract(year FROM p_data)::integer);
  ano integer := extract(year FROM p_data)::integer;
BEGIN
  IF extract(isodow FROM p_data)::integer IN (6, 7) THEN
    RETURN false;
  END IF;
  IF p_data IN (
    pg_catalog.make_date(ano, 1, 1),
    pascoa - 48,
    pascoa - 47,
    pascoa - 2,
    pg_catalog.make_date(ano, 4, 21),
    pg_catalog.make_date(ano, 5, 1),
    pascoa + 60,
    pg_catalog.make_date(ano, 9, 7),
    pg_catalog.make_date(ano, 10, 12),
    pg_catalog.make_date(ano, 11, 2),
    pg_catalog.make_date(ano, 11, 15),
    pg_catalog.make_date(ano, 12, 25)
  ) THEN
    RETURN false;
  END IF;
  -- A partir de 2024, 20/11 integra o calendario nacional publicado pela ANBIMA.
  IF ano >= 2024 AND p_data = pg_catalog.make_date(ano, 11, 20) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.calcular_memoria_financeira_nf(
  p_nota_fiscal_id uuid,
  p_valor_nominal numeric,
  p_taxa_mensal numeric,
  p_data_base date,
  p_vencimento date,
  p_metodo text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  vencimento_calculo date := p_vencimento;
  cursor_data date;
  dias_corridos integer := p_vencimento - p_data_base;
  dias_uteis integer;
  dias_financeiros integer;
  dias_aplicados integer;
  base_calculo integer;
  expoente numeric;
  fator numeric;
  valor_presente numeric;
  desconto numeric;
  calendario text;
BEGIN
  IF dias_corridos < 0 THEN
    RAISE EXCEPTION 'A NF esta vencida e nao pode ser incluida na operacao';
  END IF;
  IF p_valor_nominal <= 0 OR p_taxa_mensal < 0 THEN
    RAISE EXCEPTION 'Parametros financeiros invalidos';
  END IF;
  IF p_metodo NOT IN (
    'LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365'
  ) THEN
    RAISE EXCEPTION 'Metodo de calculo financeiro invalido';
  END IF;

  IF p_metodo = 'DIAS_UTEIS_252' THEN
    WHILE NOT private.eh_dia_util_anbima(vencimento_calculo) LOOP
      vencimento_calculo := vencimento_calculo + 1;
    END LOOP;
    dias_uteis := 0;
    cursor_data := p_data_base + 1;
    WHILE cursor_data <= vencimento_calculo LOOP
      IF private.eh_dia_util_anbima(cursor_data) THEN
        dias_uteis := dias_uteis + 1;
      END IF;
      cursor_data := cursor_data + 1;
    END LOOP;
    dias_aplicados := dias_uteis;
    base_calculo := 252;
    expoente := dias_aplicados::numeric / 21;
    calendario := 'ANBIMA';
  ELSIF p_metodo = 'TRINTA_360' THEN
    dias_financeiros := 360 * (extract(year FROM p_vencimento)::integer - extract(year FROM p_data_base)::integer)
      + 30 * (extract(month FROM p_vencimento)::integer - extract(month FROM p_data_base)::integer)
      + (least(extract(day FROM p_vencimento)::integer, 30) - least(extract(day FROM p_data_base)::integer, 30));
    IF dias_financeiros < 0 THEN
      RAISE EXCEPTION 'Prazo financeiro 30/360 invalido';
    END IF;
    dias_aplicados := dias_financeiros;
    base_calculo := 360;
    expoente := dias_aplicados::numeric / 30;
  ELSIF p_metodo = 'DIAS_CORRIDOS_365' THEN
    dias_aplicados := dias_corridos;
    base_calculo := 365;
    expoente := 12 * dias_aplicados::numeric / 365;
  ELSE
    dias_aplicados := dias_corridos;
    base_calculo := 30;
    expoente := dias_aplicados::numeric / 30;
  END IF;

  fator := power(1 + (p_taxa_mensal / 100), expoente);
  valor_presente := round(p_valor_nominal / fator, 2);
  desconto := round(p_valor_nominal - valor_presente, 2);

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'valor_nominal', p_valor_nominal,
    'taxa_mensal', p_taxa_mensal,
    'data_base', p_data_base,
    'vencimento_contratual', p_vencimento,
    'vencimento_calculo', vencimento_calculo,
    'metodo', p_metodo,
    'base', base_calculo,
    'calendario', calendario,
    'dias_corridos_reais', dias_corridos,
    'dias_uteis', dias_uteis,
    'dias_financeiros', dias_financeiros,
    'dias', dias_aplicados,
    'expoente', expoente,
    'fator', fator,
    'valor_presente', valor_presente,
    'desconto', desconto,
    'arredondamento', 'ROUND_HALF_UP_2_CASAS',
    'versao_motor', 1
  );
END;
$$;

REVOKE ALL ON FUNCTION private.pascoa_gregoriana(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.eh_dia_util_anbima(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.calcular_memoria_financeira_nf(uuid, numeric, numeric, date, date, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preparar_contexto_calculo_nova_operacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  metodo_snapshot text := NEW.politica_snapshot #>> '{calculo_financeiro,metodo}';
  metodo_versao text;
BEGIN
  IF NEW.politica_operacional_versao_id IS NOT NULL THEN
    SELECT pov.metodo_calculo_financeiro
    INTO metodo_versao
    FROM public.politica_operacional_versoes pov
    WHERE pov.id = NEW.politica_operacional_versao_id;
  END IF;

  IF metodo_versao IS NOT NULL AND metodo_snapshot IS DISTINCT FROM metodo_versao THEN
    RAISE EXCEPTION 'Metodo financeiro do snapshot diverge da versao da politica';
  END IF;

  NEW.metodo_calculo_financeiro := coalesce(metodo_snapshot, 'LEGADO_MENSAL_DIAS_REAIS_30');
  NEW.calculo_data_base := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  NEW.calculo_versao_motor := coalesce((NEW.politica_snapshot #>> '{calculo_financeiro,versao_motor}')::integer, 1);
  IF NEW.taxa_desconto IS NULL THEN
    NEW.valor_liquido_desembolso := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operacoes_preparar_contexto_calculo ON public.operacoes;
CREATE TRIGGER operacoes_preparar_contexto_calculo
  BEFORE INSERT ON public.operacoes
  FOR EACH ROW EXECUTE FUNCTION public.preparar_contexto_calculo_nova_operacao();

REVOKE ALL ON FUNCTION public.preparar_contexto_calculo_nova_operacao()
  FROM PUBLIC, anon, authenticated;

-- Metodo e data-base sao congelados desde a criacao. Depois da aprovacao, o
-- resultado e a memoria tambem nao podem ser alterados fora da RPC atomica.
CREATE OR REPLACE FUNCTION public.proteger_resultado_financeiro_operacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  alteracao_autorizada boolean := coalesce(
    pg_catalog.current_setting('app.calculo_aprovacao', true),
    'false'
  ) = 'true';
BEGIN
  IF NOT alteracao_autorizada AND (
    NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.calculo_data_base IS DISTINCT FROM OLD.calculo_data_base
  ) THEN
    RAISE EXCEPTION 'Metodo financeiro e data-base da operacao sao imutaveis';
  END IF;

  IF NOT alteracao_autorizada
     AND (OLD.status NOT IN ('solicitada', 'em_analise') OR NEW.status = 'aprovada')
     AND (
       NEW.taxa_desconto IS DISTINCT FROM OLD.taxa_desconto
       OR NEW.valor_liquido_desembolso IS DISTINCT FROM OLD.valor_liquido_desembolso
       OR NEW.calculo_versao_motor IS DISTINCT FROM OLD.calculo_versao_motor
       OR NEW.calculo_memoria IS DISTINCT FROM OLD.calculo_memoria
     ) THEN
    RAISE EXCEPTION 'Resultado financeiro aprovado e imutavel';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operacoes_proteger_resultado_financeiro ON public.operacoes;
CREATE TRIGGER operacoes_proteger_resultado_financeiro
  BEFORE UPDATE ON public.operacoes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_resultado_financeiro_operacao();

REVOKE ALL ON FUNCTION public.proteger_resultado_financeiro_operacao()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_versao_publicada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publicada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Versao publicada de politica nao pode ser excluida';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.publicada_em IS NOT NULL AND (
    NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
    OR NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.publicada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.publicada_em IS NULL)
     AND NEW.metodo_calculo_financeiro IS NULL THEN
    RAISE EXCEPTION 'Selecione o metodo de calculo financeiro antes de publicar';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.aprovar_operacao_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  op record;
  nf record;
  memoria jsonb;
  metodo text;
  data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  fundo_id_operacao uuid;
  valor_bruto_total numeric := 0;
  valor_liquido_total numeric := 0;
  desconto_total numeric := 0;
  prazo_ponderado numeric := 0;
  prazo_medio integer := 0;
  prazo_referencia integer := 0;
  vencimento_maximo date;
  nfs_count integer := 0;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;
  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa mensal invalida';
  END IF;

  SELECT o.*, cf.fundo_id
  INTO op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  fundo_id_operacao := op.fundo_id;
  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  IF op.status = 'aprovada' THEN
    RETURN jsonb_build_object(
      'operacao_id', op.id,
      'idempotent_replay', true,
      'status', op.status,
      'valor_liquido_desembolso', op.valor_liquido_desembolso,
      'metodo_calculo_financeiro', coalesce(op.metodo_calculo_financeiro, 'LEGADO_MENSAL_DIAS_REAIS_30'),
      'data_base', op.calculo_data_base
    );
  END IF;
  IF op.status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', op.status;
  END IF;
  IF op.contexto_configuracao_status = 'completo' AND (
    op.cedente_fundo_id IS NULL OR op.politica_operacional_versao_id IS NULL OR op.politica_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Operacao sem contexto operacional completo';
  END IF;

  metodo := coalesce(
    op.metodo_calculo_financeiro,
    op.politica_snapshot #>> '{calculo_financeiro,metodo}',
    'LEGADO_MENSAL_DIAS_REAIS_30'
  );
  IF metodo NOT IN ('LEGADO_MENSAL_DIAS_REAIS_30', 'DIAS_UTEIS_252', 'TRINTA_360', 'DIAS_CORRIDOS_365') THEN
    RAISE EXCEPTION 'Metodo financeiro congelado na operacao e invalido';
  END IF;

  DELETE FROM public.operacao_calculo_nfs WHERE operacao_id = p_operacao_id;

  FOR nf IN
    SELECT n.*
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
    FOR UPDATE OF n
  LOOP
    IF nf.cedente_id <> op.cedente_id
       OR nf.cedente_fundo_id IS DISTINCT FROM op.cedente_fundo_id
       OR nf.fundo_id IS DISTINCT FROM fundo_id_operacao THEN
      RAISE EXCEPTION 'NF fora do contexto da operacao';
    END IF;
    IF nf.status NOT IN ('em_antecipacao', 'aceita') THEN
      RAISE EXCEPTION 'NF % nao esta elegivel para aprovacao', nf.numero_nf;
    END IF;

    memoria := private.calcular_memoria_financeira_nf(
      nf.id, nf.valor_bruto, p_taxa_desconto, data_base, nf.data_vencimento, metodo
    );

    INSERT INTO public.operacao_calculo_nfs (
      operacao_id, nota_fiscal_id, fundo_id, cedente_id, metodo_calculo_financeiro,
      valor_nominal, taxa_mensal, data_base, vencimento_contratual, vencimento_calculo,
      base_calculo, calendario, dias_corridos_reais, dias_uteis, dias_financeiros,
      dias_aplicados, expoente, fator, valor_presente, desconto, regra_arredondamento, versao_motor
    ) VALUES (
      op.id, nf.id, fundo_id_operacao, op.cedente_id, metodo,
      (memoria->>'valor_nominal')::numeric, p_taxa_desconto, data_base,
      (memoria->>'vencimento_contratual')::date, (memoria->>'vencimento_calculo')::date,
      (memoria->>'base')::integer, memoria->>'calendario',
      (memoria->>'dias_corridos_reais')::integer, (memoria->>'dias_uteis')::integer,
      (memoria->>'dias_financeiros')::integer, (memoria->>'dias')::integer,
      (memoria->>'expoente')::numeric, (memoria->>'fator')::numeric,
      (memoria->>'valor_presente')::numeric, (memoria->>'desconto')::numeric,
      memoria->>'arredondamento', (memoria->>'versao_motor')::integer
    );

    UPDATE public.notas_fiscais
    SET taxa_desagio = p_taxa_desconto,
        valor_antecipado = (memoria->>'valor_presente')::numeric
    WHERE id = nf.id;

    valor_bruto_total := valor_bruto_total + (memoria->>'valor_nominal')::numeric;
    valor_liquido_total := valor_liquido_total + (memoria->>'valor_presente')::numeric;
    desconto_total := desconto_total + (memoria->>'desconto')::numeric;
    prazo_ponderado := prazo_ponderado + ((memoria->>'dias')::integer * (memoria->>'valor_nominal')::numeric);
    prazo_referencia := greatest(prazo_referencia, (memoria->>'dias')::integer);
    vencimento_maximo := greatest(vencimento_maximo, nf.data_vencimento);
    nfs_count := nfs_count + 1;
  END LOOP;

  IF nfs_count = 0 THEN RAISE EXCEPTION 'Operacao sem NFs vinculadas'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.taxas_cedente tc
    WHERE tc.cedente_id = op.cedente_id
      AND tc.taxa_percentual = p_taxa_desconto
      AND prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max
  ) THEN
    RAISE EXCEPTION 'A taxa selecionada nao esta configurada para o prazo da operacao';
  END IF;

  prazo_medio := round(prazo_ponderado / valor_bruto_total);

  PERFORM pg_catalog.set_config('app.calculo_aprovacao', 'true', true);

  UPDATE public.operacoes
  SET taxa_desconto = p_taxa_desconto,
      prazo_dias = prazo_medio,
      valor_bruto_total = round(valor_bruto_total, 2),
      valor_liquido_desembolso = round(valor_liquido_total, 2),
      data_vencimento = vencimento_maximo,
      metodo_calculo_financeiro = metodo,
      calculo_data_base = data_base,
      calculo_versao_motor = 1,
      calculo_memoria = jsonb_build_object(
        'metodo', metodo,
        'taxa_mensal', p_taxa_desconto,
        'data_base', data_base,
        'valor_bruto_total', round(valor_bruto_total, 2),
        'valor_liquido_total', round(valor_liquido_total, 2),
        'desconto_total', round(desconto_total, 2),
        'prazo_medio', prazo_medio,
        'prazo_unidade', CASE metodo
          WHEN 'DIAS_UTEIS_252' THEN 'dias_uteis'
          WHEN 'TRINTA_360' THEN 'dias_financeiros'
          ELSE 'dias_corridos'
        END,
        'vencimento_maximo', vencimento_maximo,
        'quantidade_nfs', nfs_count,
        'previa_valor_liquido_solicitacao', op.valor_liquido_desembolso,
        'diferenca_previa_aprovacao', CASE
          WHEN op.valor_liquido_desembolso IS NULL THEN NULL
          ELSE round(valor_liquido_total - op.valor_liquido_desembolso, 2)
        END,
        'versao_motor', 1,
        'arredondamento', 'ROUND_HALF_UP_2_CASAS'
      ),
      status = 'aprovada',
      aprovado_por = actor_id,
      aprovado_em = now()
  WHERE id = p_operacao_id AND status IN ('solicitada', 'em_analise');

  IF NOT FOUND THEN RAISE EXCEPTION 'A operacao foi alterada concorrentemente'; END IF;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    actor_id, 'OPERACAO_APROVADA', 'operacoes', p_operacao_id,
    jsonb_build_object('status', op.status),
    jsonb_build_object(
      'status', 'aprovada', 'taxa_desconto', p_taxa_desconto,
      'metodo_calculo_financeiro', metodo, 'data_base', data_base,
      'prazo_dias', prazo_medio, 'valor_liquido_desembolso', round(valor_liquido_total, 2),
      'desconto_total', round(desconto_total, 2), 'nfs', nfs_count
    )
  );

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'idempotent_replay', false,
    'status', 'aprovada',
    'prazo_dias', prazo_medio,
    'valor_liquido_desembolso', round(valor_liquido_total, 2),
    'desconto_total', round(desconto_total, 2),
    'metodo_calculo_financeiro', metodo,
    'data_base', data_base,
    'nfs', nfs_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;

COMMIT;
