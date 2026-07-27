-- RPC de homologação para reset operacional por fundo.
-- Exclusiva para ambientes de teste/homologação.
--
-- Não remove cadastros estruturais:
-- fundos, cedentes, cedente_fundos, políticas, requisitos de política,
-- templates, CNAB, integrações ou credenciais.
--
-- Quando p_escopo = 'completo', remove também as configurações do fundo:
-- políticas operacionais, templates jurídicos, CNAB, integrações e credenciais.
-- Ainda preserva fundos, cedentes, cedente_fundos e usuario_fundos.
--
-- Fonte de escopo:
-- operacoes.cedente_fundo_id -> cedente_fundos.id -> cedente_fundos.fundo_id

DROP FUNCTION IF EXISTS public.reset_operacional_fundo_homolog(uuid, text, boolean, text);

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
SET search_path = public
AS $$
DECLARE
  v_fundo_nome text;
  v_lock_key bigint;
  v_status_nf_reset text;
  v_deleted integer;
  v_counts_before jsonb;
  v_counts_after jsonb;
  v_storage_objects jsonb;
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

  SELECT nome INTO v_fundo_nome
  FROM public.fundos
  WHERE id = p_fundo_id;

  IF v_fundo_nome IS NULL THEN
    RAISE EXCEPTION 'Fundo % nao encontrado.', p_fundo_id;
  END IF;

  v_lock_key := ('x' || substr(md5('bw_antecipa_reset_fundo:' || p_fundo_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  DROP TABLE IF EXISTS tmp_reset_operacoes;
  DROP TABLE IF EXISTS tmp_reset_notas_fiscais;
  DROP TABLE IF EXISTS tmp_reset_entregas;
  DROP TABLE IF EXISTS tmp_reset_remessas;
  DROP TABLE IF EXISTS tmp_reset_documentos;
  DROP TABLE IF EXISTS tmp_reset_documento_versoes;
  DROP TABLE IF EXISTS tmp_reset_requisitos;
  DROP TABLE IF EXISTS tmp_reset_ctes;
  DROP TABLE IF EXISTS tmp_reset_documentos_gerados;
  DROP TABLE IF EXISTS tmp_reset_integracao_execucoes;
  DROP TABLE IF EXISTS tmp_reset_politicas;
  DROP TABLE IF EXISTS tmp_reset_politica_versoes;
  DROP TABLE IF EXISTS tmp_reset_politica_requisitos;
  DROP TABLE IF EXISTS tmp_reset_cedente_fundo_politicas;
  DROP TABLE IF EXISTS tmp_reset_templates;
  DROP TABLE IF EXISTS tmp_reset_template_versoes;
  DROP TABLE IF EXISTS tmp_reset_configuracoes_cnab;
  DROP TABLE IF EXISTS tmp_reset_configuracao_cnab_versoes;
  DROP TABLE IF EXISTS tmp_reset_integracoes_fundo;
  DROP TABLE IF EXISTS tmp_reset_integracao_fundo_versoes;
  DROP TABLE IF EXISTS tmp_reset_credenciais_integracao;
  DROP TABLE IF EXISTS tmp_reset_storage_objects_to_delete;

  CREATE TEMP TABLE tmp_reset_operacoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_notas_fiscais(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_entregas(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_remessas(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_documentos(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_documento_versoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_requisitos(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_ctes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_documentos_gerados(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_integracao_execucoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_politicas(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_politica_versoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_politica_requisitos(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_cedente_fundo_politicas(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_templates(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_template_versoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_configuracoes_cnab(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_configuracao_cnab_versoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_integracoes_fundo(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_integracao_fundo_versoes(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_credenciais_integracao(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_reset_storage_objects_to_delete(
    bucket text,
    storage_path text,
    nome_arquivo text,
    entidade_origem text,
    documento_id uuid,
    documento_versao_id uuid,
    remessa_id uuid,
    documento_gerado_id uuid
  ) ON COMMIT DROP;

  INSERT INTO tmp_reset_operacoes(id)
  SELECT op.id
  FROM public.operacoes op
  JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
  WHERE cf.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_notas_fiscais(id)
  SELECT DISTINCT onf.nota_fiscal_id
  FROM public.operacoes_nfs onf
  JOIN tmp_reset_operacoes tmp ON tmp.id = onf.operacao_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_notas_fiscais(id)
  SELECT nf.id
  FROM public.notas_fiscais nf
  WHERE p_apagar_notas_fiscais
    AND nf.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_entregas(id)
  SELECT nfe.id
  FROM public.nota_fiscal_entregas nfe
  WHERE nfe.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR nfe.nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_remessas(id)
  SELECT DISTINCT rco.remessa_cnab_id
  FROM public.remessas_cnab_operacoes rco
  WHERE rco.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_remessas(id)
  SELECT r.id
  FROM public.remessas_cnab r
  WHERE r.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_requisitos(id)
  SELECT dri.id
  FROM public.documento_requisito_instancias dri
  WHERE dri.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR dri.nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
     OR (p_apagar_notas_fiscais AND dri.nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais))
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_ctes(id)
  SELECT DISTINCT cnf.cte_id
  FROM public.cte_notas_fiscais cnf
  WHERE p_apagar_notas_fiscais
    AND cnf.nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos_gerados(id)
  SELECT dg.id
  FROM public.documentos_gerados dg
  WHERE dg.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR dg.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_integracao_execucoes(id)
  SELECT ie.id
  FROM public.integracao_execucoes ie
  WHERE ie.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR ie.remessa_cnab_id IN (SELECT id FROM tmp_reset_remessas)
     OR ie.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos(id)
  SELECT DISTINCT dv.documento_id
  FROM public.documento_vinculos dv
  WHERE dv.operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR dv.nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
     OR dv.cte_id IN (SELECT id FROM tmp_reset_ctes)
     OR (p_apagar_notas_fiscais AND dv.nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais))
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos(id)
  SELECT DISTINCT dri.documento_id
  FROM public.documento_requisito_instancias dri
  WHERE dri.id IN (SELECT id FROM tmp_reset_requisitos)
    AND dri.documento_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos(id)
  SELECT DISTINCT c.documento_id
  FROM public.ctes c
  WHERE c.id IN (SELECT id FROM tmp_reset_ctes)
    AND c.documento_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos(id)
  SELECT DISTINCT c.documento_id
  FROM public.canhotos c
  WHERE c.nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
    AND c.documento_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documento_versoes(id)
  SELECT dv.id
  FROM public.documento_versoes dv
  WHERE dv.documento_id IN (SELECT id FROM tmp_reset_documentos)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documento_versoes(id)
  SELECT DISTINCT c.documento_versao_atual_id
  FROM public.ctes c
  WHERE c.id IN (SELECT id FROM tmp_reset_ctes)
    AND c.documento_versao_atual_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documento_versoes(id)
  SELECT DISTINCT c.documento_versao_atual_id
  FROM public.canhotos c
  WHERE c.nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
    AND c.documento_versao_atual_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documento_versoes(id)
  SELECT DISTINCT c.documento_versao_aprovada_id
  FROM public.canhotos c
  WHERE c.nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
    AND c.documento_versao_aprovada_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_requisitos(id)
  SELECT dri.id
  FROM public.documento_requisito_instancias dri
  WHERE dri.documento_id IN (SELECT id FROM tmp_reset_documentos)
     OR dri.versao_aprovada_id IN (SELECT id FROM tmp_reset_documento_versoes)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documentos(id)
  SELECT DISTINCT dri.documento_id
  FROM public.documento_requisito_instancias dri
  WHERE dri.id IN (SELECT id FROM tmp_reset_requisitos)
    AND dri.documento_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_documento_versoes(id)
  SELECT dv.id
  FROM public.documento_versoes dv
  WHERE dv.documento_id IN (SELECT id FROM tmp_reset_documentos)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_storage_objects_to_delete(bucket, storage_path, nome_arquivo, entidade_origem, documento_id, documento_versao_id)
  SELECT dv.bucket, dv.path, dv.nome_original, 'documento_versoes', dv.documento_id, dv.id
  FROM public.documento_versoes dv
  WHERE dv.id IN (SELECT id FROM tmp_reset_documento_versoes);

  INSERT INTO tmp_reset_storage_objects_to_delete(bucket, storage_path, nome_arquivo, entidade_origem, remessa_id)
  SELECT r.bucket, r.storage_path, r.nome_arquivo, 'remessas_cnab', r.id
  FROM public.remessas_cnab r
  WHERE r.id IN (SELECT id FROM tmp_reset_remessas);

  INSERT INTO tmp_reset_storage_objects_to_delete(bucket, storage_path, nome_arquivo, entidade_origem, documento_gerado_id)
  SELECT dg.bucket, dg.storage_path, NULL, 'documentos_gerados', dg.id
  FROM public.documentos_gerados dg
  WHERE dg.id IN (SELECT id FROM tmp_reset_documentos_gerados);

  INSERT INTO tmp_reset_politicas(id)
  SELECT po.id
  FROM public.politicas_operacionais po
  WHERE po.fundo_id = p_fundo_id
     OR po.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_politica_versoes(id)
  SELECT pov.id
  FROM public.politica_operacional_versoes pov
  WHERE pov.politica_operacional_id IN (SELECT id FROM tmp_reset_politicas)
     OR pov.fundo_id = p_fundo_id
     OR pov.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_politica_requisitos(id)
  SELECT pr.id
  FROM public.politica_requisitos_documentais pr
  WHERE pr.politica_operacional_id IN (SELECT id FROM tmp_reset_politicas)
     OR pr.politica_operacional_versao_id IN (SELECT id FROM tmp_reset_politica_versoes)
     OR pr.fundo_id = p_fundo_id
     OR pr.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_cedente_fundo_politicas(id)
  SELECT cfp.id
  FROM public.cedente_fundo_politicas cfp
  WHERE cfp.politica_operacional_id IN (SELECT id FROM tmp_reset_politicas)
     OR cfp.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_templates(id)
  SELECT td.id
  FROM public.templates_documentos td
  WHERE td.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_template_versoes(id)
  SELECT tv.id
  FROM public.template_versoes tv
  WHERE tv.template_id IN (SELECT id FROM tmp_reset_templates)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_configuracoes_cnab(id)
  SELECT cc.id
  FROM public.configuracoes_cnab cc
  WHERE cc.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_configuracao_cnab_versoes(id)
  SELECT ccv.id
  FROM public.configuracao_cnab_versoes ccv
  WHERE ccv.configuracao_cnab_id IN (SELECT id FROM tmp_reset_configuracoes_cnab)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_integracoes_fundo(id)
  SELECT inf.id
  FROM public.integracoes_fundo inf
  WHERE inf.fundo_id = p_fundo_id
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_integracao_fundo_versoes(id)
  SELECT ifv.id
  FROM public.integracao_fundo_versoes ifv
  WHERE ifv.integracao_fundo_id IN (SELECT id FROM tmp_reset_integracoes_fundo)
  ON CONFLICT DO NOTHING;

  INSERT INTO tmp_reset_credenciais_integracao(id)
  SELECT ci.id
  FROM public.credenciais_integracao ci
  WHERE ci.fundo_id = p_fundo_id
     OR ci.integracao_fundo_id IN (SELECT id FROM tmp_reset_integracoes_fundo)
  ON CONFLICT DO NOTHING;

  v_counts_before := jsonb_build_object(
    'operacoes', (SELECT count(*) FROM tmp_reset_operacoes),
    'notas_fiscais', (SELECT count(*) FROM tmp_reset_notas_fiscais),
    'entregas', (SELECT count(*) FROM tmp_reset_entregas),
    'remessas', (SELECT count(*) FROM tmp_reset_remessas),
    'documentos_repositorio', (SELECT count(*) FROM tmp_reset_documentos),
    'documento_versoes', (SELECT count(*) FROM tmp_reset_documento_versoes),
    'documento_requisito_instancias', (SELECT count(*) FROM tmp_reset_requisitos),
    'ctes', (SELECT count(*) FROM tmp_reset_ctes),
    'documentos_gerados', (SELECT count(*) FROM tmp_reset_documentos_gerados),
    'integracao_execucoes', (SELECT count(*) FROM tmp_reset_integracao_execucoes),
    'storage_objects', (SELECT count(*) FROM tmp_reset_storage_objects_to_delete),
    'politicas', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_politicas) ELSE 0 END,
    'politica_versoes', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_politica_versoes) ELSE 0 END,
    'politica_requisitos', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_politica_requisitos) ELSE 0 END,
    'cedente_fundo_politicas', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_cedente_fundo_politicas) ELSE 0 END,
    'templates', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_templates) ELSE 0 END,
    'template_versoes', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_template_versoes) ELSE 0 END,
    'configuracoes_cnab', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_configuracoes_cnab) ELSE 0 END,
    'configuracao_cnab_versoes', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_configuracao_cnab_versoes) ELSE 0 END,
    'integracoes_fundo', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_integracoes_fundo) ELSE 0 END,
    'integracao_fundo_versoes', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_integracao_fundo_versoes) ELSE 0 END,
    'credenciais_integracao', CASE WHEN p_escopo = 'completo' THEN (SELECT count(*) FROM tmp_reset_credenciais_integracao) ELSE 0 END
  );

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.entidade_origem, s.bucket, s.storage_path), '[]'::jsonb)
  INTO v_storage_objects
  FROM tmp_reset_storage_objects_to_delete s;

  IF p_modo = 'preview' THEN
    RETURN jsonb_build_object(
      'modo', p_modo,
      'fundo_id', p_fundo_id,
      'fundo_nome', v_fundo_nome,
      'escopo', p_escopo,
      'apagar_notas_fiscais', p_apagar_notas_fiscais,
      'contagens', v_counts_before,
      'storage_objects', v_storage_objects
    );
  END IF;

  IF p_modo = 'validate' THEN
    RETURN jsonb_build_object(
      'modo', p_modo,
      'fundo_id', p_fundo_id,
      'fundo_nome', v_fundo_nome,
      'escopo', p_escopo,
      'operacoes_restantes', (
        SELECT count(*)
        FROM public.operacoes op
        JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
        WHERE cf.fundo_id = p_fundo_id
      ),
      'entregas_restantes', (
        SELECT count(*)
        FROM public.nota_fiscal_entregas nfe
        JOIN public.operacoes op ON op.id = nfe.operacao_id
        JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
        WHERE cf.fundo_id = p_fundo_id
      ),
      'remessas_restantes', (SELECT count(*) FROM public.remessas_cnab WHERE fundo_id = p_fundo_id),
      'documentos_gerados_restantes', (SELECT count(*) FROM public.documentos_gerados WHERE fundo_id = p_fundo_id),
      'notas_fiscais_restantes_do_fundo', (
        SELECT count(*)
        FROM public.notas_fiscais nf
        WHERE nf.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
      ),
      'cadastros_preservados', jsonb_build_object(
        'fundos', (SELECT count(*) FROM public.fundos WHERE id = p_fundo_id),
        'cedente_fundos', (SELECT count(*) FROM public.cedente_fundos WHERE fundo_id = p_fundo_id),
        'politicas', (
          SELECT count(*)
          FROM public.politicas_operacionais po
          JOIN public.cedente_fundos cf ON cf.id = po.cedente_fundo_id
          WHERE cf.fundo_id = p_fundo_id
        ),
        'templates', (SELECT count(*) FROM public.templates_documentos WHERE fundo_id = p_fundo_id),
        'configuracoes_cnab', (SELECT count(*) FROM public.configuracoes_cnab WHERE fundo_id = p_fundo_id),
        'integracoes', (SELECT count(*) FROM public.integracoes_fundo WHERE fundo_id = p_fundo_id)
      )
    );
  END IF;

  DELETE FROM public.retornos_integracao
  WHERE integracao_execucao_id IN (SELECT id FROM tmp_reset_integracao_execucoes)
     OR remessa_cnab_id IN (SELECT id FROM tmp_reset_remessas);

  DELETE FROM public.integracao_execucoes
  WHERE id IN (SELECT id FROM tmp_reset_integracao_execucoes);

  DELETE FROM public.logs_auditoria
  WHERE (entidade_tipo = 'operacoes' AND entidade_id IN (SELECT id FROM tmp_reset_operacoes))
     OR (entidade_tipo = 'notas_fiscais' AND entidade_id IN (SELECT id FROM tmp_reset_notas_fiscais))
     OR (entidade_tipo = 'nota_fiscal_entregas' AND entidade_id IN (SELECT id FROM tmp_reset_entregas))
     OR (entidade_tipo = 'remessas_cnab' AND entidade_id IN (SELECT id FROM tmp_reset_remessas))
     OR (entidade_tipo = 'documentos_repositorio' AND entidade_id IN (SELECT id FROM tmp_reset_documentos))
     OR (entidade_tipo = 'documento_versoes' AND entidade_id IN (SELECT id FROM tmp_reset_documento_versoes))
     OR (entidade_tipo = 'documentos_gerados' AND entidade_id IN (SELECT id FROM tmp_reset_documentos_gerados));

  DELETE FROM public.notificacoes n
  WHERE n.dedupe_key IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT id FROM tmp_reset_operacoes
        UNION ALL SELECT id FROM tmp_reset_notas_fiscais
        UNION ALL SELECT id FROM tmp_reset_entregas
        UNION ALL SELECT id FROM tmp_reset_remessas
      ) alvo
      WHERE n.dedupe_key LIKE ('%:' || alvo.id::text || ':%')
         OR n.dedupe_key LIKE (alvo.id::text || ':%')
         OR n.dedupe_key LIKE ('%:' || alvo.id::text)
    );

  DELETE FROM public.remessas_cnab_operacoes
  WHERE remessa_cnab_id IN (SELECT id FROM tmp_reset_remessas)
     OR operacao_id IN (SELECT id FROM tmp_reset_operacoes);

  BEGIN
    ALTER TABLE public.remessas_cnab DISABLE TRIGGER remessas_cnab_sem_delete;
    DELETE FROM public.remessas_cnab WHERE id IN (SELECT id FROM tmp_reset_remessas);
    ALTER TABLE public.remessas_cnab ENABLE TRIGGER remessas_cnab_sem_delete;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.remessas_cnab ENABLE TRIGGER remessas_cnab_sem_delete;
    RAISE;
  END;

  BEGIN
    ALTER TABLE public.documentos_gerados DISABLE TRIGGER documentos_gerados_sem_delete;
    DELETE FROM public.documentos_gerados WHERE id IN (SELECT id FROM tmp_reset_documentos_gerados);
    ALTER TABLE public.documentos_gerados ENABLE TRIGGER documentos_gerados_sem_delete;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.documentos_gerados ENABLE TRIGGER documentos_gerados_sem_delete;
    RAISE;
  END;

  DELETE FROM public.documento_vinculos
  WHERE documento_id IN (SELECT id FROM tmp_reset_documentos)
     OR operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
     OR cte_id IN (SELECT id FROM tmp_reset_ctes)
     OR (p_apagar_notas_fiscais AND nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais));

  BEGIN
    ALTER TABLE public.documento_analises DISABLE TRIGGER documento_analise_append_only;
    DELETE FROM public.documento_analises
    WHERE documento_versao_id IN (SELECT id FROM tmp_reset_documento_versoes);
    ALTER TABLE public.documento_analises ENABLE TRIGGER documento_analise_append_only;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.documento_analises ENABLE TRIGGER documento_analise_append_only;
    RAISE;
  END;

  DELETE FROM public.cte_notas_fiscais
  WHERE cte_id IN (SELECT id FROM tmp_reset_ctes)
     OR (p_apagar_notas_fiscais AND nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais));

  DELETE FROM public.canhotos
  WHERE nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas)
     OR documento_id IN (SELECT id FROM tmp_reset_documentos)
     OR documento_versao_atual_id IN (SELECT id FROM tmp_reset_documento_versoes)
     OR documento_versao_aprovada_id IN (SELECT id FROM tmp_reset_documento_versoes);

  DELETE FROM public.ctes
  WHERE id IN (SELECT id FROM tmp_reset_ctes)
     OR documento_id IN (SELECT id FROM tmp_reset_documentos)
     OR documento_versao_atual_id IN (SELECT id FROM tmp_reset_documento_versoes);

  DELETE FROM public.documento_requisito_instancias
  WHERE id IN (SELECT id FROM tmp_reset_requisitos)
     OR documento_id IN (SELECT id FROM tmp_reset_documentos)
     OR versao_aprovada_id IN (SELECT id FROM tmp_reset_documento_versoes);

  BEGIN
    ALTER TABLE public.eventos_entrega DISABLE TRIGGER eventos_entrega_append_only;
    DELETE FROM public.eventos_entrega
    WHERE nota_fiscal_entrega_id IN (SELECT id FROM tmp_reset_entregas);
    ALTER TABLE public.eventos_entrega ENABLE TRIGGER eventos_entrega_append_only;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.eventos_entrega ENABLE TRIGGER eventos_entrega_append_only;
    RAISE;
  END;

  DELETE FROM public.nota_fiscal_entregas
  WHERE id IN (SELECT id FROM tmp_reset_entregas);

  BEGIN
    ALTER TABLE public.documento_versoes DISABLE TRIGGER documento_versao_aprovada_immutavel;
    DELETE FROM public.documento_versoes
    WHERE id IN (SELECT id FROM tmp_reset_documento_versoes);
    ALTER TABLE public.documento_versoes ENABLE TRIGGER documento_versao_aprovada_immutavel;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.documento_versoes ENABLE TRIGGER documento_versao_aprovada_immutavel;
    RAISE;
  END;

  DELETE FROM public.documentos_repositorio
  WHERE id IN (SELECT id FROM tmp_reset_documentos);

  DELETE FROM public.movimentos_escrow
  WHERE operacao_id IN (SELECT id FROM tmp_reset_operacoes);

  DELETE FROM public.operacoes_nfs
  WHERE operacao_id IN (SELECT id FROM tmp_reset_operacoes)
     OR (p_apagar_notas_fiscais AND nota_fiscal_id IN (SELECT id FROM tmp_reset_notas_fiscais));

  DELETE FROM public.operacoes
  WHERE id IN (SELECT id FROM tmp_reset_operacoes);

  IF p_apagar_notas_fiscais THEN
    DELETE FROM public.notas_fiscais
    WHERE id IN (SELECT id FROM tmp_reset_notas_fiscais);
  ELSE
    SELECT e.enumlabel
      INTO v_status_nf_reset
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'nf_status'
      AND e.enumlabel IN ('aprovada', 'submetida', 'rascunho')
    ORDER BY CASE e.enumlabel WHEN 'aprovada' THEN 1 WHEN 'submetida' THEN 2 ELSE 3 END
    LIMIT 1;

    IF v_status_nf_reset IS NULL THEN
      RAISE EXCEPTION 'Nao foi possivel identificar status real de NF para reset.';
    END IF;

    UPDATE public.notas_fiscais
       SET status = v_status_nf_reset::nf_status,
           aprovacao_sacado_em = NULL,
           aprovada_gestor_em = NULL,
           motivo_ajuste = NULL,
           taxa_desagio = NULL,
           valor_antecipado = NULL
     WHERE id IN (SELECT id FROM tmp_reset_notas_fiscais);
  END IF;

  IF p_escopo = 'completo' THEN
    DELETE FROM public.logs_auditoria
    WHERE (entidade_tipo = 'cedente_fundo_politicas' AND entidade_id IN (SELECT id FROM tmp_reset_cedente_fundo_politicas))
       OR (entidade_tipo = 'politicas_operacionais' AND entidade_id IN (SELECT id FROM tmp_reset_politicas))
       OR (entidade_tipo = 'politica_operacional_versoes' AND entidade_id IN (SELECT id FROM tmp_reset_politica_versoes))
       OR (entidade_tipo = 'templates_documentos' AND entidade_id IN (SELECT id FROM tmp_reset_templates))
       OR (entidade_tipo = 'template_versoes' AND entidade_id IN (SELECT id FROM tmp_reset_template_versoes))
       OR (entidade_tipo = 'configuracoes_cnab' AND entidade_id IN (SELECT id FROM tmp_reset_configuracoes_cnab))
       OR (entidade_tipo = 'configuracao_cnab_versoes' AND entidade_id IN (SELECT id FROM tmp_reset_configuracao_cnab_versoes))
       OR (entidade_tipo = 'integracoes_fundo' AND entidade_id IN (SELECT id FROM tmp_reset_integracoes_fundo))
       OR (entidade_tipo = 'integracao_fundo_versoes' AND entidade_id IN (SELECT id FROM tmp_reset_integracao_fundo_versoes))
       OR (entidade_tipo = 'credenciais_integracao' AND entidade_id IN (SELECT id FROM tmp_reset_credenciais_integracao));

    UPDATE public.integracao_fundo_versoes
       SET credencial_integracao_id = NULL
     WHERE id IN (SELECT id FROM tmp_reset_integracao_fundo_versoes)
       AND credencial_integracao_id IS NOT NULL;

    UPDATE public.credenciais_integracao
       SET substituida_por = NULL
     WHERE id IN (SELECT id FROM tmp_reset_credenciais_integracao)
        OR substituida_por IN (SELECT id FROM tmp_reset_credenciais_integracao);

    BEGIN
      ALTER TABLE public.integracao_fundo_versoes DISABLE TRIGGER integracao_fundo_versoes_validacao;
      DELETE FROM public.integracao_fundo_versoes
      WHERE id IN (SELECT id FROM tmp_reset_integracao_fundo_versoes);
      ALTER TABLE public.integracao_fundo_versoes ENABLE TRIGGER integracao_fundo_versoes_validacao;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.integracao_fundo_versoes ENABLE TRIGGER integracao_fundo_versoes_validacao;
      RAISE;
    END;

    DELETE FROM public.credenciais_integracao
    WHERE id IN (SELECT id FROM tmp_reset_credenciais_integracao);

    DELETE FROM public.integracoes_fundo
    WHERE id IN (SELECT id FROM tmp_reset_integracoes_fundo);

    DELETE FROM public.sequencias_remessa
    WHERE configuracao_cnab_id IN (SELECT id FROM tmp_reset_configuracoes_cnab);

    BEGIN
      ALTER TABLE public.configuracao_cnab_versoes DISABLE TRIGGER configuracao_cnab_versoes_validacao;
      DELETE FROM public.configuracao_cnab_versoes
      WHERE id IN (SELECT id FROM tmp_reset_configuracao_cnab_versoes);
      ALTER TABLE public.configuracao_cnab_versoes ENABLE TRIGGER configuracao_cnab_versoes_validacao;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.configuracao_cnab_versoes ENABLE TRIGGER configuracao_cnab_versoes_validacao;
      RAISE;
    END;

    BEGIN
      ALTER TABLE public.configuracoes_cnab DISABLE TRIGGER configuracoes_cnab_sem_delete_utilizado;
      DELETE FROM public.configuracoes_cnab
      WHERE id IN (SELECT id FROM tmp_reset_configuracoes_cnab);
      ALTER TABLE public.configuracoes_cnab ENABLE TRIGGER configuracoes_cnab_sem_delete_utilizado;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.configuracoes_cnab ENABLE TRIGGER configuracoes_cnab_sem_delete_utilizado;
      RAISE;
    END;

    BEGIN
      ALTER TABLE public.template_versoes DISABLE TRIGGER template_versoes_validacao;
      DELETE FROM public.template_versoes
      WHERE id IN (SELECT id FROM tmp_reset_template_versoes);
      ALTER TABLE public.template_versoes ENABLE TRIGGER template_versoes_validacao;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.template_versoes ENABLE TRIGGER template_versoes_validacao;
      RAISE;
    END;

    BEGIN
      ALTER TABLE public.templates_documentos DISABLE TRIGGER templates_documentos_sem_delete_utilizado;
      DELETE FROM public.templates_documentos
      WHERE id IN (SELECT id FROM tmp_reset_templates);
      ALTER TABLE public.templates_documentos ENABLE TRIGGER templates_documentos_sem_delete_utilizado;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.templates_documentos ENABLE TRIGGER templates_documentos_sem_delete_utilizado;
      RAISE;
    END;

    DELETE FROM public.cedente_fundo_politicas
    WHERE id IN (SELECT id FROM tmp_reset_cedente_fundo_politicas);

    BEGIN
      ALTER TABLE public.politica_requisitos_documentais DISABLE TRIGGER politica_requisito_publicado_immutavel;
      DELETE FROM public.politica_requisitos_documentais
      WHERE id IN (SELECT id FROM tmp_reset_politica_requisitos);
      ALTER TABLE public.politica_requisitos_documentais ENABLE TRIGGER politica_requisito_publicado_immutavel;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.politica_requisitos_documentais ENABLE TRIGGER politica_requisito_publicado_immutavel;
      RAISE;
    END;

    BEGIN
      ALTER TABLE public.politica_operacional_versoes DISABLE TRIGGER politica_versao_publicada_validacao;
      DELETE FROM public.politica_operacional_versoes
      WHERE id IN (SELECT id FROM tmp_reset_politica_versoes);
      ALTER TABLE public.politica_operacional_versoes ENABLE TRIGGER politica_versao_publicada_validacao;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.politica_operacional_versoes ENABLE TRIGGER politica_versao_publicada_validacao;
      RAISE;
    END;

    BEGIN
      ALTER TABLE public.politicas_operacionais DISABLE TRIGGER politicas_operacionais_sem_delete;
      DELETE FROM public.politicas_operacionais
      WHERE id IN (SELECT id FROM tmp_reset_politicas);
      ALTER TABLE public.politicas_operacionais ENABLE TRIGGER politicas_operacionais_sem_delete;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.politicas_operacionais ENABLE TRIGGER politicas_operacionais_sem_delete;
      RAISE;
    END;
  END IF;

  v_counts_after := jsonb_build_object(
    'operacoes_restantes', (
      SELECT count(*)
      FROM public.operacoes op
      JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
      WHERE cf.fundo_id = p_fundo_id
    ),
    'entregas_restantes', (
      SELECT count(*)
      FROM public.nota_fiscal_entregas nfe
      JOIN public.operacoes op ON op.id = nfe.operacao_id
      JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
      WHERE cf.fundo_id = p_fundo_id
    ),
    'remessas_restantes', (SELECT count(*) FROM public.remessas_cnab WHERE fundo_id = p_fundo_id),
    'documentos_gerados_restantes', (SELECT count(*) FROM public.documentos_gerados WHERE fundo_id = p_fundo_id),
    'notas_fiscais_restantes_do_fundo', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
    ),
    'politicas_restantes', (
      SELECT count(*)
      FROM public.politicas_operacionais po
      WHERE po.fundo_id = p_fundo_id
         OR po.cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE fundo_id = p_fundo_id)
    ),
    'templates_restantes', (SELECT count(*) FROM public.templates_documentos WHERE fundo_id = p_fundo_id),
    'configuracoes_cnab_restantes', (SELECT count(*) FROM public.configuracoes_cnab WHERE fundo_id = p_fundo_id),
    'integracoes_restantes', (SELECT count(*) FROM public.integracoes_fundo WHERE fundo_id = p_fundo_id),
    'credenciais_restantes', (SELECT count(*) FROM public.credenciais_integracao WHERE fundo_id = p_fundo_id)
  );

  RETURN jsonb_build_object(
    'modo', p_modo,
    'fundo_id', p_fundo_id,
    'fundo_nome', v_fundo_nome,
    'escopo', p_escopo,
    'apagar_notas_fiscais', p_apagar_notas_fiscais,
    'contagens_antes', v_counts_before,
    'contagens_depois', v_counts_after,
    'storage_objects', v_storage_objects
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Reset operacional homolog abortado: %', SQLERRM
      USING ERRCODE = SQLSTATE;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text) TO service_role;
