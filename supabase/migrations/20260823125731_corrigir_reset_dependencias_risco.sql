-- Corrige o reset operacional apos a inclusao do gate de risco (P2.6).
--
-- risco_execucoes possui duas dependencias em sentido contrario ao fluxo
-- anterior do reset:
--   risco_execucoes.operacao_id -> operacoes (ON DELETE RESTRICT)
--   operacoes.risco_execucao_id -> risco_execucoes (ON DELETE RESTRICT)
--
-- Antes desta correcao, a RPC removia operacoes sem primeiro remover os
-- snapshots de risco. Em homologacao isso abortava com a FK
-- risco_execucoes_operacao_id_fkey. Os snapshots sao dados operacionais e
-- podem ser removidos no reset de homologacao; os fundos e demais cadastros
-- estruturais continuam preservados.

BEGIN;

-- Reconstroi o wrapper logistico em um nome estavel. A primeira versao da
-- camada de risco podia ter substituido o wrapper publico antes de ele ser
-- preservado; por isso nao dependemos de um rename do estado atual.
CREATE OR REPLACE FUNCTION public.reset_operacional_fundo_homolog_sem_dependencias_logisticas_duplicatas(
  p_fundo_id uuid,
  p_modo text DEFAULT 'preview',
  p_apagar_notas_fiscais boolean DEFAULT true,
  p_confirmacao text DEFAULT NULL,
  p_escopo text DEFAULT 'operacional'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_resultado jsonb;
  v_lock_key bigint;
  v_memorias_antes integer := 0;
  v_memorias_depois integer := 0;
  v_evidencias_antes integer := 0;
  v_evidencias_depois integer := 0;
  v_duplicatas_antes integer := 0;
  v_duplicatas_depois integer := 0;
  v_duplicata_storage jsonb := '[]'::jsonb;
BEGIN
  IF p_modo NOT IN ('preview', 'reset', 'validate') THEN
    RAISE EXCEPTION 'Modo invalido: %. Use preview, reset ou validate.', p_modo;
  END IF;

  IF p_escopo NOT IN ('operacional', 'completo') THEN
    RAISE EXCEPTION 'Escopo invalido: %. Use operacional ou completo.', p_escopo;
  END IF;

  IF p_modo = 'reset' AND p_confirmacao IS DISTINCT FROM 'RESETAR_HOMOLOG' THEN
    RAISE EXCEPTION 'Confirmacao obrigatoria ausente. Informe p_confirmacao = RESETAR_HOMOLOG.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo % nao encontrado.', p_fundo_id;
  END IF;

  v_lock_key := ('x' || substr(md5('bw_antecipa_reset_fundo:' || p_fundo_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF to_regclass('public.operacao_nf_logistica_memorias') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_memorias_antes
    FROM public.operacao_nf_logistica_memorias m
    WHERE m.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.evidencias_logisticas_antecipadas') IS NOT NULL
     AND (p_apagar_notas_fiscais OR p_escopo = 'completo') THEN
    SELECT count(*)::integer INTO v_evidencias_antes
    FROM public.evidencias_logisticas_antecipadas e
    WHERE e.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.duplicatas') IS NOT NULL AND p_apagar_notas_fiscais THEN
    SELECT count(*)::integer INTO v_duplicatas_antes
    FROM public.duplicatas d
    WHERE d.fundo_id = p_fundo_id;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', dv.bucket,
          'storage_path', dv.path,
          'nome_arquivo', dv.nome_original,
          'entidade_origem', 'duplicata_versoes',
          'duplicata_id', dv.duplicata_id,
          'duplicata_versao_id', dv.id
        ) ORDER BY dv.bucket, dv.path
      ),
      '[]'::jsonb
    ) INTO v_duplicata_storage
    FROM public.duplicata_versoes dv
    JOIN public.duplicatas d ON d.id = dv.duplicata_id
    WHERE d.fundo_id = p_fundo_id;
  END IF;

  IF p_modo = 'reset' THEN
    IF to_regclass('public.operacao_nf_logistica_memorias') IS NOT NULL
       AND v_memorias_antes > 0 THEN
      BEGIN
        ALTER TABLE public.operacao_nf_logistica_memorias
          DISABLE TRIGGER operacao_nf_logistica_memoria_append_only;
        DELETE FROM public.operacao_nf_logistica_memorias m
        WHERE m.fundo_id = p_fundo_id;
        ALTER TABLE public.operacao_nf_logistica_memorias
          ENABLE TRIGGER operacao_nf_logistica_memoria_append_only;
      EXCEPTION WHEN OTHERS THEN
        ALTER TABLE public.operacao_nf_logistica_memorias
          ENABLE TRIGGER operacao_nf_logistica_memoria_append_only;
        RAISE EXCEPTION 'Reset operacional homolog abortado ao remover memorias logisticas: %', SQLERRM
          USING ERRCODE = SQLSTATE;
      END;
    END IF;

    IF to_regclass('public.evidencias_logisticas_antecipadas') IS NOT NULL
       AND (p_apagar_notas_fiscais OR p_escopo = 'completo') THEN
      DELETE FROM public.evidencia_logistica_versoes ev
      USING public.evidencias_logisticas_antecipadas e
      WHERE ev.evidencia_logistica_id = e.id
        AND e.fundo_id = p_fundo_id;
      DELETE FROM public.evidencias_logisticas_antecipadas e
      WHERE e.fundo_id = p_fundo_id;
    END IF;

    IF to_regclass('public.duplicatas') IS NOT NULL AND p_apagar_notas_fiscais THEN
      BEGIN
        ALTER TABLE public.duplicata_correcoes DISABLE TRIGGER duplicata_correcoes_append_only;
        ALTER TABLE public.duplicata_validacoes DISABLE TRIGGER duplicata_validacoes_append_only;
        ALTER TABLE public.duplicata_versoes DISABLE TRIGGER duplicata_versoes_append_only;

        DELETE FROM public.duplicata_correcoes dc
        USING public.duplicatas d
        WHERE dc.duplicata_id = d.id AND d.fundo_id = p_fundo_id;
        DELETE FROM public.duplicata_validacoes dv
        USING public.duplicatas d
        WHERE dv.duplicata_id = d.id AND d.fundo_id = p_fundo_id;
        UPDATE public.duplicatas d
        SET versao_atual_id = NULL
        WHERE d.fundo_id = p_fundo_id AND d.versao_atual_id IS NOT NULL;
        DELETE FROM public.duplicata_versoes dv
        USING public.duplicatas d
        WHERE dv.duplicata_id = d.id AND d.fundo_id = p_fundo_id;
        DELETE FROM public.duplicatas d
        WHERE d.fundo_id = p_fundo_id;

        ALTER TABLE public.duplicata_versoes ENABLE TRIGGER duplicata_versoes_append_only;
        ALTER TABLE public.duplicata_validacoes ENABLE TRIGGER duplicata_validacoes_append_only;
        ALTER TABLE public.duplicata_correcoes ENABLE TRIGGER duplicata_correcoes_append_only;
      EXCEPTION WHEN OTHERS THEN
        ALTER TABLE public.duplicata_versoes ENABLE TRIGGER duplicata_versoes_append_only;
        ALTER TABLE public.duplicata_validacoes ENABLE TRIGGER duplicata_validacoes_append_only;
        ALTER TABLE public.duplicata_correcoes ENABLE TRIGGER duplicata_correcoes_append_only;
        RAISE EXCEPTION 'Reset operacional homolog abortado ao remover duplicatas: %', SQLERRM
          USING ERRCODE = SQLSTATE;
      END;
    END IF;
  END IF;

  -- Escopo das operacoes e NFs precisa ser materializado antes que o reset
  -- base remova essas entidades.
  DROP TABLE IF EXISTS tmp_reset_scope_operacoes;
  DROP TABLE IF EXISTS tmp_reset_scope_notas_fiscais;
  CREATE TEMP TABLE tmp_reset_scope_operacoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_scope_notas_fiscais(id uuid PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO tmp_reset_scope_operacoes(id)
  SELECT o.id
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE cf.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_scope_notas_fiscais(id)
  SELECT onf.nota_fiscal_id
  FROM public.operacoes_nfs onf
  WHERE onf.operacao_id IN (SELECT id FROM tmp_reset_scope_operacoes)
  ON CONFLICT DO NOTHING;

  IF p_apagar_notas_fiscais THEN
    INSERT INTO tmp_reset_scope_notas_fiscais(id)
    SELECT nf.id
    FROM public.notas_fiscais nf
    WHERE nf.cedente_fundo_id IN (
      SELECT cf.id FROM public.cedente_fundos cf WHERE cf.fundo_id = p_fundo_id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Dependencias financeiras/logisticas que nao existiam quando a RPC base
  -- foi criada. Todas precisam sair antes de operacoes, parcelas ou NFs.
  IF to_regclass('public.posicao_logistica_resultados') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.posicao_logistica_resultados DISABLE TRIGGER USER;
      DELETE FROM public.posicao_logistica_resultados
      WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.posicao_logistica_resultados ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.posicao_logistica_resultados ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover posicoes logisticas: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.matching_candidatos') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.matching_candidatos DISABLE TRIGGER USER;
      DELETE FROM public.matching_candidatos
      WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.matching_candidatos ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.matching_candidatos ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover candidatos de matching: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.matching_resultados') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.matching_resultados DISABLE TRIGGER USER;
      DELETE FROM public.matching_resultados
      WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.matching_resultados ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.matching_resultados ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover resultados de matching: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.exposicao_overlay_itens') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.exposicao_overlay_itens DISABLE TRIGGER USER;
      DELETE FROM public.exposicao_overlay_itens
      WHERE operacao_id IN (SELECT id FROM tmp_reset_scope_operacoes)
         OR nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.exposicao_overlay_itens ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.exposicao_overlay_itens ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover overlay de exposicao: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.conciliacao_resultados') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.conciliacao_resultados DISABLE TRIGGER USER;
      DELETE FROM public.conciliacao_resultados
      WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.conciliacao_resultados ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.conciliacao_resultados ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover resultados de conciliacao: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.titulo_nf_vinculos') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.titulo_nf_vinculos DISABLE TRIGGER USER;
      DELETE FROM public.titulo_nf_vinculos
      WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
      ALTER TABLE public.titulo_nf_vinculos ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.titulo_nf_vinculos ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover vinculos de titulos: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  IF to_regclass('public.comunicacao_itens') IS NOT NULL THEN
    DELETE FROM public.comunicacao_itens
    WHERE operacao_id IN (SELECT id FROM tmp_reset_scope_operacoes)
       OR nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
  END IF;

  IF to_regclass('public.nota_fiscal_remessas') IS NOT NULL AND p_apagar_notas_fiscais THEN
    DELETE FROM public.nota_fiscal_remessas
    WHERE nota_fiscal_venda_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
  END IF;

  IF to_regclass('public.operacao_calculo_nfs') IS NOT NULL THEN
    DELETE FROM public.operacao_calculo_nfs
    WHERE operacao_id IN (SELECT id FROM tmp_reset_scope_operacoes)
       OR nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
  END IF;

  IF to_regclass('public.operacoes_nf_parcelas') IS NOT NULL THEN
    DELETE FROM public.operacoes_nf_parcelas
    WHERE operacao_id IN (SELECT id FROM tmp_reset_scope_operacoes)
       OR nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
  END IF;

  IF p_apagar_notas_fiscais AND to_regclass('public.nota_fiscal_parcelas') IS NOT NULL THEN
    -- O contexto da instancia documental exige exatamente um entre NF,
    -- operacao e entrega. Uma NF com varias parcelas pode ter uma instancia
    -- por parcela; ao converter todas para NF, a constraint
    -- documento_requisito_unique (politica_requisito_id, nota_fiscal_id,
    -- parcela_id) causaria duplicidade. Mantemos uma instancia por
    -- requisito/NF e removemos as duplicatas somente durante o reset
    -- operacional de homologacao. Os documentos das duplicatas continuam
    -- alcancaveis pelos vinculos da propria NF e serao limpos pela RPC base.
    WITH instancias_parceladas AS (
      SELECT
        dri.id,
        dri.politica_requisito_id,
        p.nota_fiscal_id,
        row_number() OVER (
          PARTITION BY dri.politica_requisito_id, p.nota_fiscal_id
          ORDER BY dri.created_at, dri.id
        ) AS ordem,
        EXISTS (
          SELECT 1
          FROM public.documento_requisito_instancias existente
          WHERE existente.politica_requisito_id = dri.politica_requisito_id
            AND existente.nota_fiscal_id = p.nota_fiscal_id
            AND existente.parcela_id IS NULL
        ) AS ja_existe_no_nivel_nf
      FROM public.documento_requisito_instancias dri
      JOIN public.nota_fiscal_parcelas p ON p.id = dri.parcela_id
      WHERE p.nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais)
    )
    DELETE FROM public.documento_requisito_instancias dri
    WHERE dri.id IN (
      SELECT id
      FROM instancias_parceladas
      WHERE ordem > 1 OR ja_existe_no_nivel_nf
    );

    -- Apos remover as duplicatas, a instancia sobrevivente passa a
    -- representar a NF, permitindo a coleta documental da RPC base antes da
    -- exclusao das notas fiscais.
    UPDATE public.documento_requisito_instancias dri
    SET nota_fiscal_id = p.nota_fiscal_id,
        parcela_id = NULL
    FROM public.nota_fiscal_parcelas p
    WHERE dri.parcela_id = p.id
      AND p.nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);

    DELETE FROM public.nota_fiscal_parcelas
    WHERE nota_fiscal_id IN (SELECT id FROM tmp_reset_scope_notas_fiscais);
  END IF;

  v_resultado := public.reset_operacional_fundo_homolog_sem_dependencias_recentes(
    p_fundo_id, p_modo, p_apagar_notas_fiscais, p_confirmacao, p_escopo
  );

  IF to_regclass('public.operacao_nf_logistica_memorias') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_memorias_depois
    FROM public.operacao_nf_logistica_memorias m
    WHERE m.fundo_id = p_fundo_id;
  END IF;
  IF to_regclass('public.evidencias_logisticas_antecipadas') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_evidencias_depois
    FROM public.evidencias_logisticas_antecipadas e
    WHERE e.fundo_id = p_fundo_id;
  END IF;
  IF to_regclass('public.duplicatas') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_duplicatas_depois
    FROM public.duplicatas d
    WHERE d.fundo_id = p_fundo_id;
  END IF;

  v_resultado := jsonb_set(
    v_resultado,
    '{storage_objects}',
    coalesce(v_resultado->'storage_objects', '[]'::jsonb) || v_duplicata_storage,
    true
  );

  IF p_modo = 'preview' THEN
    v_resultado := jsonb_set(v_resultado, '{contagens,memorias_logisticas}', to_jsonb(v_memorias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens,evidencias_logisticas_antecipadas}', to_jsonb(v_evidencias_antes), true);
    RETURN jsonb_set(v_resultado, '{contagens,duplicatas}', to_jsonb(v_duplicatas_antes), true);
  END IF;

  IF p_modo = 'reset' THEN
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,memorias_logisticas}', to_jsonb(v_memorias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,evidencias_logisticas_antecipadas}', to_jsonb(v_evidencias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,duplicatas}', to_jsonb(v_duplicatas_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,memorias_logisticas_restantes}', to_jsonb(v_memorias_depois), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,evidencias_logisticas_antecipadas_restantes}', to_jsonb(v_evidencias_depois), true);
    RETURN jsonb_set(v_resultado, '{contagens_depois,duplicatas_restantes}', to_jsonb(v_duplicatas_depois), true);
  END IF;

  RETURN v_resultado || jsonb_build_object(
    'memorias_logisticas_restantes', v_memorias_depois,
    'evidencias_logisticas_antecipadas_restantes', v_evidencias_depois,
    'duplicatas_restantes', v_duplicatas_depois
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_operacional_fundo_homolog(
  p_fundo_id uuid,
  p_modo text DEFAULT 'preview',
  p_apagar_notas_fiscais boolean DEFAULT true,
  p_confirmacao text DEFAULT NULL,
  p_escopo text DEFAULT 'operacional'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_resultado jsonb;
  v_lock_key bigint;
  v_risco_execucoes_antes integer := 0;
  v_risco_motivos_antes integer := 0;
  v_risco_revisoes_antes integer := 0;
  v_risco_execucoes_depois integer := 0;
  v_risco_motivos_depois integer := 0;
  v_risco_revisoes_depois integer := 0;
BEGIN
  IF p_modo NOT IN ('preview', 'reset', 'validate') THEN
    RAISE EXCEPTION 'Modo invalido: %. Use preview, reset ou validate.', p_modo;
  END IF;

  IF p_escopo NOT IN ('operacional', 'completo') THEN
    RAISE EXCEPTION 'Escopo invalido: %. Use operacional ou completo.', p_escopo;
  END IF;

  IF p_modo = 'reset' AND p_confirmacao IS DISTINCT FROM 'RESETAR_HOMOLOG' THEN
    RAISE EXCEPTION 'Confirmacao obrigatoria ausente. Informe p_confirmacao = RESETAR_HOMOLOG.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo % nao encontrado.', p_fundo_id;
  END IF;

  v_lock_key := ('x' || substr(md5('bw_antecipa_reset_fundo:' || p_fundo_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF to_regclass('public.risco_execucoes') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_execucoes_antes
    FROM public.risco_execucoes r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.risco_motivos') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_motivos_antes
    FROM public.risco_motivos r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.risco_revisoes') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_revisoes_antes
    FROM public.risco_revisoes r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF p_modo = 'reset' AND to_regclass('public.risco_execucoes') IS NOT NULL THEN
    BEGIN
      -- Primeiro solta as FKs que partem de operacoes. Os demais campos de
      -- risco sao historicos da operacao que sera removida pelo wrapper.
      UPDATE public.operacoes o
      SET risco_execucao_id = NULL,
          risco_revisao_id = NULL
      WHERE o.id IN (
          SELECT op.id
          FROM public.operacoes op
          JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
          WHERE cf.fundo_id = p_fundo_id
        )
         OR o.risco_execucao_id IN (
          SELECT r.id
          FROM public.risco_execucoes r
          WHERE r.fundo_id = p_fundo_id
             OR r.operacao_id IN (
                SELECT op.id
                FROM public.operacoes op
                JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
                WHERE cf.fundo_id = p_fundo_id
              )
        )
         OR o.risco_revisao_id IN (
          SELECT r.id
          FROM public.risco_revisoes r
          WHERE r.fundo_id = p_fundo_id
             OR r.operacao_id IN (
                SELECT op.id
                FROM public.operacoes op
                JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
                WHERE cf.fundo_id = p_fundo_id
              )
        );

      -- As tabelas de risco possuem protecoes de imutabilidade para o uso
      -- normal. O reset e uma operacao administrativa exclusiva de
      -- homologacao, portanto desabilita apenas os triggers da aplicacao e
      -- preserva as constraints/FKs do PostgreSQL.
      IF to_regclass('public.risco_revisoes') IS NOT NULL THEN
        ALTER TABLE public.risco_revisoes DISABLE TRIGGER USER;
        DELETE FROM public.risco_revisoes
        WHERE fundo_id = p_fundo_id
           OR operacao_id IN (
              SELECT op.id
              FROM public.operacoes op
              JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
              WHERE cf.fundo_id = p_fundo_id
            )
           OR risco_execucao_id IN (
              SELECT r.id
              FROM public.risco_execucoes r
              WHERE r.fundo_id = p_fundo_id
                 OR r.operacao_id IN (
                    SELECT op.id
                    FROM public.operacoes op
                    JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
                    WHERE cf.fundo_id = p_fundo_id
                  )
            );
        ALTER TABLE public.risco_revisoes ENABLE TRIGGER USER;
      END IF;

      IF to_regclass('public.risco_motivos') IS NOT NULL THEN
        ALTER TABLE public.risco_motivos DISABLE TRIGGER USER;
        DELETE FROM public.risco_motivos
        WHERE fundo_id = p_fundo_id
           OR risco_execucao_id IN (
              SELECT r.id
              FROM public.risco_execucoes r
              WHERE r.fundo_id = p_fundo_id
                 OR r.operacao_id IN (
                    SELECT op.id
                    FROM public.operacoes op
                    JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
                    WHERE cf.fundo_id = p_fundo_id
                  )
            );
        ALTER TABLE public.risco_motivos ENABLE TRIGGER USER;
      END IF;

      ALTER TABLE public.risco_execucoes DISABLE TRIGGER USER;
      DELETE FROM public.risco_execucoes
      WHERE fundo_id = p_fundo_id
         OR operacao_id IN (
            SELECT op.id
            FROM public.operacoes op
            JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
            WHERE cf.fundo_id = p_fundo_id
          );
      ALTER TABLE public.risco_execucoes ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
      IF to_regclass('public.risco_revisoes') IS NOT NULL THEN
        ALTER TABLE public.risco_revisoes ENABLE TRIGGER USER;
      END IF;
      IF to_regclass('public.risco_motivos') IS NOT NULL THEN
        ALTER TABLE public.risco_motivos ENABLE TRIGGER USER;
      END IF;
      ALTER TABLE public.risco_execucoes ENABLE TRIGGER USER;
      RAISE EXCEPTION 'Reset operacional homolog abortado ao remover snapshots de risco: %', SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;

  v_resultado := public.reset_operacional_fundo_homolog_sem_dependencias_logisticas_duplicatas(
    p_fundo_id,
    p_modo,
    p_apagar_notas_fiscais,
    p_confirmacao,
    p_escopo
  );

  IF to_regclass('public.risco_execucoes') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_execucoes_depois
    FROM public.risco_execucoes r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.risco_motivos') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_motivos_depois
    FROM public.risco_motivos r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF to_regclass('public.risco_revisoes') IS NOT NULL THEN
    SELECT count(*)::integer INTO v_risco_revisoes_depois
    FROM public.risco_revisoes r
    WHERE r.fundo_id = p_fundo_id;
  END IF;

  IF p_modo = 'preview' THEN
    v_resultado := jsonb_set(v_resultado, '{contagens,risco_execucoes}', to_jsonb(v_risco_execucoes_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens,risco_motivos}', to_jsonb(v_risco_motivos_antes), true);
    RETURN jsonb_set(v_resultado, '{contagens,risco_revisoes}', to_jsonb(v_risco_revisoes_antes), true);
  END IF;

  IF p_modo = 'reset' THEN
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,risco_execucoes}', to_jsonb(v_risco_execucoes_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,risco_motivos}', to_jsonb(v_risco_motivos_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,risco_revisoes}', to_jsonb(v_risco_revisoes_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,risco_execucoes_restantes}', to_jsonb(v_risco_execucoes_depois), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,risco_motivos_restantes}', to_jsonb(v_risco_motivos_depois), true);
    RETURN jsonb_set(v_resultado, '{contagens_depois,risco_revisoes_restantes}', to_jsonb(v_risco_revisoes_depois), true);
  END IF;

  RETURN v_resultado || jsonb_build_object(
    'risco_execucoes_restantes', v_risco_execucoes_depois,
    'risco_motivos_restantes', v_risco_motivos_depois,
    'risco_revisoes_restantes', v_risco_revisoes_depois
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Reset operacional homolog abortado: %', SQLERRM
    USING ERRCODE = SQLSTATE;
END;
$$;

COMMENT ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text) IS
  'Wrapper transacional de homologacao que remove snapshots de risco antes das operacoes e demais dependencias operacionais.';

REVOKE ALL ON FUNCTION public.reset_operacional_fundo_homolog_sem_dependencias_logisticas_duplicatas(uuid, text, boolean, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
