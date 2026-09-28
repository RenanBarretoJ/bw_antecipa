-- C2.1-R2: proposta de taxa pelo Consultor e decisao final pelo Gestor.
--
-- Principios preservados:
-- - o fluxo direto do Cedente continua usando o calculo e a RPC legados;
-- - a proposta do Consultor e imutavel e nunca e sobrescrita pela aprovacao;
-- - taxa_desconto/calculo_memoria/aprovado_por/aprovado_em seguem como
--   resultado final canonico da operacao;
-- - nenhuma etapa/status/aceite adicional e criado para o Cedente;
-- - a validacao final continua restrita as taxas configuradas em
--   taxas_cedente para o prazo da operacao.

BEGIN;

ALTER TABLE public.operacoes
  ADD COLUMN IF NOT EXISTS taxa_proposta_consultor numeric,
  ADD COLUMN IF NOT EXISTS taxa_proposta_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS taxa_proposta_consultor_id uuid REFERENCES public.consultores(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS taxa_proposta_em timestamptz,
  ADD COLUMN IF NOT EXISTS calculo_proposta_memoria jsonb;

ALTER TABLE public.operacoes
  DROP CONSTRAINT IF EXISTS operacoes_taxa_proposta_consultor_check,
  ADD CONSTRAINT operacoes_taxa_proposta_consultor_check
    CHECK (taxa_proposta_consultor IS NULL OR taxa_proposta_consultor >= 0),
  DROP CONSTRAINT IF EXISTS operacoes_proposta_consultor_completa_check,
  ADD CONSTRAINT operacoes_proposta_consultor_completa_check CHECK (
    num_nonnulls(
      taxa_proposta_consultor,
      taxa_proposta_por,
      taxa_proposta_consultor_id,
      taxa_proposta_em,
      calculo_proposta_memoria
    ) IN (0, 5)
  );

COMMENT ON COLUMN public.operacoes.taxa_proposta_consultor IS
  'Taxa mensal originalmente proposta pelo Consultor. Imutavel apos a submissao.';
COMMENT ON COLUMN public.operacoes.taxa_proposta_por IS
  'Usuario Consultor que submeteu a proposta de taxa.';
COMMENT ON COLUMN public.operacoes.taxa_proposta_consultor_id IS
  'Organizacao Consultora ativa no instante da proposta.';
COMMENT ON COLUMN public.operacoes.taxa_proposta_em IS
  'Instante em que a proposta de taxa foi submetida.';
COMMENT ON COLUMN public.operacoes.calculo_proposta_memoria IS
  'Snapshot financeiro canonico calculado no backend para a proposta do Consultor.';

CREATE OR REPLACE FUNCTION public.proteger_proposta_taxa_consultor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_alteracao_autorizada boolean := coalesce(
    pg_catalog.current_setting('app.c2_1_gravar_proposta', true),
    'false'
  ) = 'true' AND CURRENT_USER = 'postgres';
BEGIN
  -- A proposta nasce nula no INSERT canonico e so e preenchida pelo UPDATE
  -- interno da RPC SECURITY DEFINER. Isto impede payload direto forjado.
  IF TG_OP = 'INSERT' THEN
    IF num_nonnulls(
      NEW.taxa_proposta_consultor,
      NEW.taxa_proposta_por,
      NEW.taxa_proposta_consultor_id,
      NEW.taxa_proposta_em,
      NEW.calculo_proposta_memoria
    ) <> 0 THEN
      RAISE EXCEPTION 'A proposta de taxa do Consultor so pode ser criada pela RPC autorizada';
    END IF;

    RETURN NEW;
  END IF;

  IF (
    NEW.taxa_proposta_consultor IS DISTINCT FROM OLD.taxa_proposta_consultor
    OR NEW.taxa_proposta_por IS DISTINCT FROM OLD.taxa_proposta_por
    OR NEW.taxa_proposta_consultor_id IS DISTINCT FROM OLD.taxa_proposta_consultor_id
    OR NEW.taxa_proposta_em IS DISTINCT FROM OLD.taxa_proposta_em
    OR NEW.calculo_proposta_memoria IS DISTINCT FROM OLD.calculo_proposta_memoria
  ) AND NOT v_alteracao_autorizada THEN
    RAISE EXCEPTION 'A proposta de taxa do Consultor e imutavel';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operacoes_proteger_proposta_taxa_consultor ON public.operacoes;
CREATE TRIGGER operacoes_proteger_proposta_taxa_consultor
  BEFORE INSERT OR UPDATE OF taxa_proposta_consultor, taxa_proposta_por,
    taxa_proposta_consultor_id, taxa_proposta_em, calculo_proposta_memoria
  ON public.operacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_proposta_taxa_consultor();

REVOKE ALL ON FUNCTION public.proteger_proposta_taxa_consultor()
  FROM PUBLIC, anon, authenticated;

-- O executor legado deixa de ser chamavel diretamente. Os dois wrappers
-- abaixo tornam explicito qual contrato e permitido para cada perfil.
REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text,
  uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_cedente_atomica(
  p_cedente_id uuid,
  p_cedente_fundo_id uuid,
  p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid,
  p_politica_versao integer,
  p_politica_snapshot jsonb,
  p_politica_snapshot_hash text,
  p_aceite_sacado_exigido boolean,
  p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[],
  p_valor_bruto_total numeric,
  p_taxa_desconto numeric,
  p_prazo_dias integer,
  p_valor_liquido_desembolso numeric,
  p_data_vencimento date,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role()::text <> 'cedente' THEN
    RAISE EXCEPTION 'Somente Cedente autenticado pode usar o fluxo direto';
  END IF;

  RETURN public.solicitar_operacao_antecipacao_atomica(
    p_cedente_id,
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    p_nota_fiscal_ids,
    p_valor_bruto_total,
    p_taxa_desconto,
    p_prazo_dias,
    p_valor_liquido_desembolso,
    p_data_vencimento,
    p_idempotency_key,
    p_parcela_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_cedente_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text,
  uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_cedente_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text,
  uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  p_cedente_id uuid,
  p_cedente_fundo_id uuid,
  p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid,
  p_politica_versao integer,
  p_politica_snapshot jsonb,
  p_politica_snapshot_hash text,
  p_aceite_sacado_exigido boolean,
  p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[],
  p_taxa_proposta_consultor numeric,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_consultor_id uuid;
  v_metodo text;
  v_data_base date := (pg_catalog.timezone('America/Sao_Paulo', pg_catalog.now()))::date;
  v_item record;
  v_memoria jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_valor_bruto_total numeric := 0;
  v_valor_liquido_total numeric := 0;
  v_desconto_total numeric := 0;
  v_prazo_ponderado numeric := 0;
  v_prazo_medio integer := 0;
  v_prazo_referencia integer := 0;
  v_data_vencimento date;
  v_quantidade_itens integer := 0;
  v_quantidade_nfs integer := 0;
  v_snapshot jsonb;
  v_resultado jsonb;
  v_operacao_id uuid;
  v_operacao record;
  v_actor_nome text;
BEGIN
  IF v_actor_id IS NULL OR public.get_user_role()::text <> 'consultor' THEN
    RAISE EXCEPTION 'Somente Consultor autenticado pode propor taxa';
  END IF;
  IF p_taxa_proposta_consultor IS NULL OR p_taxa_proposta_consultor < 0 THEN
    RAISE EXCEPTION 'Taxa proposta invalida';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma NF';
  END IF;

  v_consultor_id := private.consultor_organizacao_ativa_do_usuario(v_actor_id);
  IF v_consultor_id IS NULL
     OR NOT private.consultor_usuario_pode_operar_cedente(v_actor_id, p_cedente_id) THEN
    RAISE EXCEPTION 'Consultor sem vinculo organizacional ativo com o Cedente informado';
  END IF;

  SELECT pov.metodo_calculo_financeiro
  INTO v_metodo
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundos cf
    ON cf.id = p_cedente_fundo_id
   AND cf.cedente_id = p_cedente_id
   AND cf.fundo_id = po.fundo_id
  WHERE pov.id = p_politica_operacional_versao_id
    AND po.id = p_politica_operacional_id
    AND pov.versao = p_politica_versao
  LIMIT 1;

  IF v_metodo IS NULL THEN
    RAISE EXCEPTION 'Versao da politica financeira nao pertence ao contexto informado';
  END IF;

  FOR v_item IN
    SELECT
      nf.id AS nota_fiscal_id,
      NULL::uuid AS parcela_id,
      nf.valor_bruto AS valor_nominal,
      nf.data_vencimento AS vencimento
    FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.nota_fiscal_parcelas p
        WHERE p.nota_fiscal_id = nf.id
      )

    UNION ALL

    SELECT
      nf.id AS nota_fiscal_id,
      p.id AS parcela_id,
      p.valor_nominal,
      p.data_vencimento AS vencimento
    FROM public.nota_fiscal_parcelas p
    JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
    WHERE p_parcela_ids IS NOT NULL
      AND p.id = ANY(p_parcela_ids)
      AND nf.id = ANY(p_nota_fiscal_ids)
      AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id
    ORDER BY nota_fiscal_id, parcela_id NULLS FIRST
  LOOP
    v_memoria := private.calcular_memoria_financeira_nf(
      v_item.nota_fiscal_id,
      v_item.valor_nominal,
      p_taxa_proposta_consultor,
      v_data_base,
      v_item.vencimento,
      v_metodo
    );

    v_itens := v_itens || pg_catalog.jsonb_build_array(
      v_memoria || pg_catalog.jsonb_build_object('parcela_id', v_item.parcela_id)
    );
    v_valor_bruto_total := v_valor_bruto_total + (v_memoria->>'valor_nominal')::numeric;
    v_valor_liquido_total := v_valor_liquido_total + (v_memoria->>'valor_presente')::numeric;
    v_desconto_total := v_desconto_total + (v_memoria->>'desconto')::numeric;
    v_prazo_ponderado := v_prazo_ponderado
      + ((v_memoria->>'dias')::integer * (v_memoria->>'valor_nominal')::numeric);
    v_prazo_referencia := greatest(v_prazo_referencia, (v_memoria->>'dias')::integer);
    v_data_vencimento := greatest(v_data_vencimento, v_item.vencimento);
    v_quantidade_itens := v_quantidade_itens + 1;
  END LOOP;

  IF v_quantidade_itens = 0 OR v_valor_bruto_total <= 0 THEN
    RAISE EXCEPTION 'A selecao nao possui itens financeiros validos';
  END IF;

  SELECT count(DISTINCT item.nf_id)
  INTO v_quantidade_nfs
  FROM unnest(p_nota_fiscal_ids) AS item(nf_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.taxas_cedente tc
    WHERE tc.cedente_id = p_cedente_id
      AND tc.taxa_percentual = p_taxa_proposta_consultor
      AND v_prazo_referencia BETWEEN tc.prazo_min AND tc.prazo_max
  ) THEN
    RAISE EXCEPTION 'A taxa proposta nao esta configurada para o prazo da operacao';
  END IF;

  v_prazo_medio := pg_catalog.round(v_prazo_ponderado / v_valor_bruto_total);
  v_snapshot := pg_catalog.jsonb_build_object(
    'tipo', 'proposta_consultor',
    'taxa_mensal', p_taxa_proposta_consultor,
    'metodo', v_metodo,
    'data_base', v_data_base,
    'valor_nominal', pg_catalog.round(v_valor_bruto_total, 2),
    'desagio_estimado', pg_catalog.round(v_desconto_total, 2),
    'valor_liquido_estimado', pg_catalog.round(v_valor_liquido_total, 2),
    'prazo_medio', v_prazo_medio,
    'prazo_referencia', v_prazo_referencia,
    'quantidade_nfs', v_quantidade_nfs,
    'quantidade_itens', v_quantidade_itens,
    'itens', v_itens,
    'versao_motor', 1,
    'arredondamento', 'ROUND_HALF_UP_2_CASAS'
  );

  v_resultado := public.solicitar_operacao_antecipacao_atomica(
    p_cedente_id,
    p_cedente_fundo_id,
    p_politica_operacional_id,
    p_politica_operacional_versao_id,
    p_politica_versao,
    p_politica_snapshot,
    p_politica_snapshot_hash,
    p_aceite_sacado_exigido,
    p_aceite_sacado_status,
    p_nota_fiscal_ids,
    pg_catalog.round(v_valor_bruto_total, 2),
    p_taxa_proposta_consultor,
    v_prazo_medio,
    pg_catalog.round(v_valor_liquido_total, 2),
    v_data_vencimento,
    p_idempotency_key,
    p_parcela_ids
  );

  v_operacao_id := (v_resultado->>'operacao_id')::uuid;
  IF coalesce((v_resultado->>'idempotent_replay')::boolean, false) THEN
    SELECT * INTO v_operacao
    FROM public.operacoes
    WHERE id = v_operacao_id;

    IF v_operacao.taxa_proposta_consultor IS DISTINCT FROM p_taxa_proposta_consultor
       OR v_operacao.taxa_proposta_por IS DISTINCT FROM v_actor_id
       OR v_operacao.taxa_proposta_consultor_id IS DISTINCT FROM v_consultor_id THEN
      RAISE EXCEPTION 'Replay idempotente diverge da proposta original';
    END IF;

    RETURN v_resultado || pg_catalog.jsonb_build_object(
      'taxa_proposta_consultor', v_operacao.taxa_proposta_consultor
    );
  END IF;

  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'true', true);
  UPDATE public.operacoes
  SET taxa_proposta_consultor = p_taxa_proposta_consultor,
      taxa_proposta_por = v_actor_id,
      taxa_proposta_consultor_id = v_consultor_id,
      taxa_proposta_em = pg_catalog.now(),
      calculo_proposta_memoria = v_snapshot
  WHERE id = v_operacao_id
    AND taxa_proposta_consultor IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel preservar a proposta do Consultor';
  END IF;
  PERFORM pg_catalog.set_config('app.c2_1_gravar_proposta', 'false', true);

  SELECT p.nome_completo INTO v_actor_nome
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  INSERT INTO public.logs_auditoria (
    usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    v_actor_id,
    'TAXA_PROPOSTA_CONSULTOR',
    'operacoes',
    v_operacao_id,
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor,
      'calculo_proposta_memoria', v_snapshot
    )
  );

  INSERT INTO public.eventos_dominio (
    fundo_id, cedente_id, cedente_fundo_id, operacao_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    correlation_id, origem_evento, origem_registro_id
  )
  SELECT
    cf.fundo_id,
    p_cedente_id,
    p_cedente_fundo_id,
    v_operacao_id,
    'taxa_proposta_consultor',
    'operacao',
    v_actor_id,
    coalesce(v_actor_nome, 'Consultor'),
    'consultor',
    'c2_1_r2',
    'Taxa proposta pelo Consultor na solicitacao da operacao.',
    pg_catalog.jsonb_build_object(
      'operacao_id', v_operacao_id,
      'cedente_id', p_cedente_id,
      'consultor_id', v_consultor_id,
      'actor_user_id', v_actor_id,
      'actor_role', 'consultor',
      'taxa_proposta_consultor', p_taxa_proposta_consultor
    ),
    'interno',
    'operacao:' || v_operacao_id::text,
    'c2_1_r2',
    v_operacao_id::text || ':proposta'
  FROM public.cedente_fundos cf
  WHERE cf.id = p_cedente_fundo_id;

  RETURN v_resultado || pg_catalog.jsonb_build_object(
    'taxa_proposta_consultor', p_taxa_proposta_consultor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text,
  uuid[], numeric, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_consultor_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text,
  uuid[], numeric, text, uuid[]
) TO authenticated;

-- A decisao final permanece na RPC transacional protegida pelo advisory lock
-- e pelo FOR UPDATE. O evento de taxa e gravado na mesma transacao da aprovacao.
CREATE OR REPLACE FUNCTION public.aprovar_operacao_com_risco_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric,
  p_risco_execucao_id uuid,
  p_assinatura_inputs text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_op record;
  v_op_final record;
  v_risco public.risco_execucoes%ROWTYPE;
  v_revisao public.risco_revisoes%ROWTYPE;
  v_result jsonb;
  v_tipo_evento text;
  v_actor_nome text;
BEGIN
  IF v_actor_id IS NULL OR (
    public.get_user_role()::text <> 'gestor'
    AND NOT EXISTS (
      SELECT 1
      FROM public.usuario_papeis up
      WHERE up.usuario_id = v_actor_id
        AND up.papel::text = 'gestor'
        AND up.ativo
    )
  ) THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aprovar-risco:' || p_operacao_id::text, 0)
  );

  SELECT o.*, cf.fundo_id
  INTO v_op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND OR v_op.status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao nao elegivel ou alterada concorrentemente';
  END IF;
  IF NOT private.financeiro_gestor_tem_acesso_fundo(v_op.fundo_id) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  SELECT * INTO v_risco
  FROM public.risco_execucoes
  WHERE id = p_risco_execucao_id
    AND operacao_id = p_operacao_id
    AND fundo_id = v_op.fundo_id;

  IF NOT FOUND
     OR v_risco.assinatura_inputs <> p_assinatura_inputs
     OR v_risco.regra_versao <> 'GATE_RISCO_V1' THEN
    RAISE EXCEPTION 'Avaliacao de risco invalida para a operacao';
  END IF;
  IF v_risco.operacao_updated_at_snapshot IS DISTINCT FROM v_op.updated_at
     OR v_risco.taxa_desconto_snapshot IS DISTINCT FROM p_taxa_desconto THEN
    RAISE EXCEPTION 'A avaliacao de risco expirou porque a operacao foi alterada';
  END IF;
  IF v_risco.aplicavel AND v_risco.decisao = 'BLOQUEADO' THEN
    RAISE EXCEPTION 'Operacao bloqueada pelo gate de risco';
  END IF;
  IF v_risco.aplicavel AND v_risco.decisao = 'REVISAO_MANUAL' THEN
    SELECT * INTO v_revisao
    FROM public.risco_revisoes
    WHERE risco_execucao_id = v_risco.id
      AND assinatura_inputs = v_risco.assinatura_inputs;
    IF NOT FOUND OR v_revisao.status <> 'LIBERADA' THEN
      RAISE EXCEPTION 'Operacao depende de revisao manual liberada';
    END IF;
  ELSIF v_risco.aplicavel AND v_risco.decisao <> 'APTO' THEN
    RAISE EXCEPTION 'Decisao de risco nao autoriza aprovacao';
  END IF;

  v_result := public.aprovar_operacao_atomica_financeiro_v1(
    p_operacao_id,
    p_taxa_desconto
  );

  UPDATE public.operacoes
  SET risco_execucao_id = v_risco.id,
      risco_revisao_id = v_revisao.id,
      risco_decisao_snapshot = CASE
        WHEN v_risco.aplicavel THEN v_risco.decisao
        ELSE 'NAO_APLICAVEL'
      END,
      risco_assinatura_inputs = v_risco.assinatura_inputs,
      risco_avaliado_em = v_risco.finalizado_em
  WHERE id = p_operacao_id;

  IF v_op.taxa_proposta_consultor IS NOT NULL THEN
    v_tipo_evento := CASE
      WHEN v_op.taxa_proposta_consultor = p_taxa_desconto
        THEN 'TAXA_MANTIDA_GESTOR'
      ELSE 'TAXA_ALTERADA_GESTOR'
    END;

    SELECT o.calculo_memoria, o.aprovado_por, o.aprovado_em
    INTO v_op_final
    FROM public.operacoes o
    WHERE o.id = p_operacao_id;

    SELECT p.nome_completo INTO v_actor_nome
    FROM public.profiles p
    WHERE p.id = v_actor_id;

    INSERT INTO public.logs_auditoria (
      usuario_id, tipo_evento, entidade_tipo, entidade_id,
      dados_antes, dados_depois
    ) VALUES (
      v_actor_id,
      v_tipo_evento,
      'operacoes',
      p_operacao_id,
      pg_catalog.jsonb_build_object(
        'taxa_proposta_consultor', v_op.taxa_proposta_consultor,
        'taxa_desconto', v_op.taxa_desconto
      ),
      pg_catalog.jsonb_build_object(
        'operacao_id', p_operacao_id,
        'cedente_id', v_op.cedente_id,
        'consultor_id', v_op.taxa_proposta_consultor_id,
        'actor_user_id', v_actor_id,
        'actor_role', 'gestor',
        'taxa_proposta_consultor', v_op.taxa_proposta_consultor,
        'taxa_final_operacao', p_taxa_desconto,
        'taxa_final_definida_por_user_id', v_op_final.aprovado_por,
        'taxa_final_definida_em', v_op_final.aprovado_em,
        'calculo_final_memoria', v_op_final.calculo_memoria
      )
    );

    INSERT INTO public.eventos_dominio (
      fundo_id, cedente_id, cedente_fundo_id, operacao_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      correlation_id, origem_evento, origem_registro_id
    ) VALUES (
      v_op.fundo_id,
      v_op.cedente_id,
      v_op.cedente_fundo_id,
      p_operacao_id,
      lower(v_tipo_evento),
      'aprovacao',
      v_actor_id,
      coalesce(v_actor_nome, 'Gestor'),
      'gestor',
      'c2_1_r2',
      CASE
        WHEN v_tipo_evento = 'TAXA_MANTIDA_GESTOR'
          THEN 'Gestor aprovou a operacao mantendo a taxa proposta pelo Consultor.'
        ELSE 'Gestor aprovou a operacao com taxa diferente da proposta pelo Consultor.'
      END,
      pg_catalog.jsonb_build_object(
        'operacao_id', p_operacao_id,
        'cedente_id', v_op.cedente_id,
        'consultor_id', v_op.taxa_proposta_consultor_id,
        'actor_user_id', v_actor_id,
        'actor_role', 'gestor',
        'taxa_proposta_consultor', v_op.taxa_proposta_consultor,
        'taxa_final_operacao', p_taxa_desconto
      ),
      'interno',
      'operacao:' || p_operacao_id::text,
      'c2_1_r2',
      p_operacao_id::text || ':decisao-final'
    );
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'risco_execucao_id', v_risco.id,
    'risco_decisao', CASE
      WHEN v_risco.aplicavel THEN v_risco.decisao
      ELSE 'NAO_APLICAVEL'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_operacao_com_risco_atomica(
  uuid, numeric, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_com_risco_atomica(
  uuid, numeric, uuid, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
