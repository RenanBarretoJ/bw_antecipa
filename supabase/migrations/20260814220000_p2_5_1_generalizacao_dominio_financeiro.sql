BEGIN;

-- P2.5.1: generaliza o dominio financeiro sem recriar entidades historicas.
-- RENAME preserva OIDs, UUIDs, FKs, RLS, grants, ownership e dependencias.

CREATE TEMP TABLE _p251_relacoes (
  old_name text PRIMARY KEY,
  new_name text NOT NULL UNIQUE,
  relation_kind "char" NOT NULL
) ON COMMIT DROP;

INSERT INTO _p251_relacoes (old_name, new_name, relation_kind) VALUES
  ('rlx_importacoes_financeiras', 'importacoes_financeiras', 'r'),
  ('rlx_importacao_arquivos', 'importacao_arquivos', 'r'),
  ('rlx_importacao_linhas', 'importacao_linhas', 'r'),
  ('rlx_importacao_ciclos', 'importacao_ciclos', 'r'),
  ('rlx_estoque_posicoes', 'estoque_posicoes', 'r'),
  ('rlx_aquisicao_movimentos', 'aquisicao_movimentos', 'r'),
  ('rlx_liquidacao_movimentos', 'liquidacao_movimentos', 'r'),
  ('rlx_carteira_snapshots', 'carteira_snapshots', 'r'),
  ('rlx_matching_execucoes', 'matching_execucoes', 'r'),
  ('rlx_matching_resultados', 'matching_resultados', 'r'),
  ('rlx_matching_candidatos', 'matching_candidatos', 'r'),
  ('rlx_titulo_nf_vinculos', 'titulo_nf_vinculos', 'r'),
  ('rlx_titulo_nf_vinculo_chaves', 'titulo_nf_vinculo_chaves', 'r'),
  ('rlx_conciliacao_execucoes', 'conciliacao_execucoes', 'r'),
  ('rlx_conciliacao_resultados', 'conciliacao_resultados', 'r'),
  ('rlx_posicao_logistica_execucoes', 'posicao_logistica_execucoes', 'r'),
  ('rlx_posicao_logistica_resultados', 'posicao_logistica_resultados', 'r'),
  ('rlx_exposicao_execucoes', 'exposicao_execucoes', 'r'),
  ('rlx_exposicao_overlay_itens', 'exposicao_overlay_itens', 'r'),
  ('rlx_estoque_atual', 'estoque_atual', 'v'),
  ('rlx_aquisicoes_atuais', 'aquisicoes_atuais', 'v'),
  ('rlx_liquidacoes_atuais', 'liquidacoes_atuais', 'v'),
  ('rlx_carteira_atual', 'carteira_atual', 'v');

CREATE TEMP TABLE _p251_funcoes (
  schema_name text NOT NULL,
  old_name text NOT NULL,
  new_name text NOT NULL,
  PRIMARY KEY (schema_name, old_name)
) ON COMMIT DROP;

INSERT INTO _p251_funcoes (schema_name, old_name, new_name) VALUES
  ('private', 'rlx_auditar', 'financeiro_auditar'),
  ('private', 'rlx_autorizar_tecnico', 'financeiro_autorizar_tecnico'),
  ('private', 'rlx_chamada_service_role', 'financeiro_chamada_service_role'),
  ('private', 'rlx_gestor_tem_acesso_fundo', 'financeiro_gestor_tem_acesso_fundo'),
  ('private', 'rlx_p2_3_autorizacao_consumida', 'financeiro_autorizacao_consumida'),
  ('private', 'rlx_p2_3_bloquear_mutacao_historica', 'matching_bloquear_mutacao_historica'),
  ('private', 'rlx_p2_3_finalizar_execucao', 'matching_finalizar_execucao'),
  ('private', 'rlx_p2_3_proteger_vinculo', 'titulo_nf_proteger_vinculo'),
  ('private', 'rlx_p2_4_finalizar_execucao', 'posicao_logistica_finalizar_execucao'),
  ('private', 'rlx_p2_5_bloquear_mutacao_historica', 'exposicao_bloquear_mutacao_historica'),
  ('private', 'rlx_usuario_e_super_admin', 'financeiro_usuario_e_super_admin'),
  ('public', 'iniciar_ciclo_importacao_financeira_rlx', 'iniciar_ciclo_importacao_financeira'),
  ('public', 'rlx_confirmar_match_manual', 'confirmar_match_manual'),
  ('public', 'rlx_persistir_conciliacao_execucao', 'persistir_conciliacao_execucao'),
  ('public', 'rlx_persistir_exposicao_execucao', 'persistir_exposicao_execucao'),
  ('public', 'rlx_persistir_matching_execucao', 'persistir_matching_execucao'),
  ('public', 'rlx_persistir_posicao_logistica_execucao', 'persistir_posicao_logistica_execucao'),
  ('public', 'rlx_revogar_match_manual', 'revogar_match_manual'),
  ('public', 'validar_linhagem_integracao_rlx', 'validar_linhagem_integracao_financeira');

CREATE TEMP TABLE _p251_identificadores (
  old_value text PRIMARY KEY,
  new_value text NOT NULL
) ON COMMIT DROP;

INSERT INTO _p251_identificadores (old_value, new_value)
SELECT old_name, new_name FROM _p251_relacoes
UNION ALL
SELECT old_name, new_name FROM _p251_funcoes;

CREATE TEMP TABLE _p251_literais (
  old_value text PRIMARY KEY,
  new_value text NOT NULL
) ON COMMIT DROP;

-- Somente eventos e origens futuras sao generalizados. Versoes de regra RLX_*
-- permanecem intactas porque compoem snapshots e contratos historicos.
INSERT INTO _p251_literais (old_value, new_value) VALUES
  ('rlx_ingestao_financeira', 'ingestao_financeira'),
  ('RLX_IMPORTACAO_FINANCEIRA_RECEBIDA', 'IMPORTACAO_FINANCEIRA_RECEBIDA'),
  ('RLX_IMPORTACAO_FINANCEIRA_VALIDADA', 'IMPORTACAO_FINANCEIRA_VALIDADA'),
  ('RLX_IMPORTACAO_FINANCEIRA_FALHOU', 'IMPORTACAO_FINANCEIRA_FALHOU'),
  ('RLX_IMPORTACAO_FINANCEIRA_RETIFICADA', 'IMPORTACAO_FINANCEIRA_RETIFICADA'),
  ('RLX_IMPORTACAO_FINANCEIRA_PUBLICADA', 'IMPORTACAO_FINANCEIRA_PUBLICADA'),
  ('RLX_IMPORTACAO_FINANCEIRA_SEM_MOVIMENTO_REGISTRADA', 'IMPORTACAO_FINANCEIRA_SEM_MOVIMENTO_REGISTRADA'),
  ('RLX_POSICAO_LOGISTICA_BASE_INCOMPLETA', 'POSICAO_LOGISTICA_BASE_INCOMPLETA'),
  ('RLX_POSICAO_LOGISTICA_EXECUTADA', 'POSICAO_LOGISTICA_EXECUTADA'),
  ('RLX_POSICAO_LOGISTICA_REPROCESSADA', 'POSICAO_LOGISTICA_REPROCESSADA'),
  ('RLX_EXPOSICAO_PL_INDISPONIVEL', 'EXPOSICAO_PL_INDISPONIVEL'),
  ('RLX_EXPOSICAO_RECALCULADA', 'EXPOSICAO_RECALCULADA'),
  ('RLX_EXPOSICAO_CALCULADA', 'EXPOSICAO_CALCULADA'),
  ('rlx_p2_4', 'financeiro_logistica'),
  ('rlx_p2_5', 'financeiro_exposicao'),
  ('rlx-matching:', 'financeiro-matching:'),
  ('rlx-conciliacao:', 'financeiro-conciliacao:'),
  ('rlx-logistica:', 'financeiro-logistica:'),
  ('rlx-exposicao:', 'financeiro-exposicao:');

DO $preflight$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM _p251_relacoes LOOP
    IF to_regclass(format('public.%I', item.old_name)) IS NOT NULL
       AND to_regclass(format('public.%I', item.new_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'P2.5.1: colisao entre %.% e %.%',
        'public', item.old_name, 'public', item.new_name;
    END IF;
  END LOOP;

  FOR item IN
    SELECT f.*, oidvectortypes(p.proargtypes) AS arg_types
    FROM _p251_funcoes f
    JOIN pg_namespace n ON n.nspname = f.schema_name
    JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = f.old_name
    WHERE p.prokind = 'f'
  LOOP
    IF to_regprocedure(format('%I.%I(%s)', item.schema_name, item.new_name, item.arg_types)) IS NOT NULL THEN
      RAISE EXCEPTION 'P2.5.1: funcao destino ja existe: %.%(%)',
        item.schema_name, item.new_name, item.arg_types;
    END IF;
  END LOOP;
END
$preflight$;

CREATE TEMP TABLE _p251_relacao_snapshot ON COMMIT DROP AS
SELECT
  rel.old_name,
  rel.new_name,
  c.oid,
  c.relrowsecurity,
  c.relforcerowsecurity,
  c.relacl,
  CASE
    WHEN c.relkind = 'r' THEN (xpath('/row/total/text()', query_to_xml(
      format('select count(*) as total from public.%I', c.relname), false, true, ''
    )))[1]::text::bigint
    ELSE NULL
  END AS row_count
FROM _p251_relacoes rel
JOIN pg_class c ON c.relnamespace = 'public'::regnamespace
               AND c.relname = rel.old_name
               AND c.relkind = rel.relation_kind;

CREATE TEMP TABLE _p251_funcao_snapshot ON COMMIT DROP AS
WITH function_defs AS MATERIALIZED (
  SELECT
    p.oid,
    n.nspname AS schema_name,
    p.proname,
    oidvectortypes(p.proargtypes) AS arg_types,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private')
    AND p.prokind = 'f'
)
SELECT DISTINCT f.*
FROM function_defs f
WHERE EXISTS (
  SELECT 1
  FROM _p251_identificadores map
  WHERE position(map.old_value IN f.definition) > 0
)
OR EXISTS (
  SELECT 1
  FROM _p251_literais map
  WHERE position(map.old_value IN f.definition) > 0
);

DO $rename_relations$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM _p251_relacoes ORDER BY relation_kind, old_name LOOP
    IF to_regclass(format('public.%I', item.old_name)) IS NULL THEN
      IF to_regclass(format('public.%I', item.new_name)) IS NULL THEN
        RAISE EXCEPTION 'P2.5.1: relacao de origem ausente: public.%', item.old_name;
      END IF;
      CONTINUE;
    END IF;

    IF item.relation_kind = 'v' THEN
      EXECUTE format('ALTER VIEW public.%I RENAME TO %I', item.old_name, item.new_name);
    ELSE
      EXECUTE format('ALTER TABLE public.%I RENAME TO %I', item.old_name, item.new_name);
    END IF;
  END LOOP;
END
$rename_relations$;

DO $rename_functions$
DECLARE
  fn record;
  replacement record;
  target_name text;
  rewritten_definition text;
BEGIN
  FOR fn IN SELECT * FROM _p251_funcao_snapshot ORDER BY schema_name, proname, arg_types LOOP
    SELECT new_name INTO target_name
    FROM _p251_funcoes
    WHERE schema_name = fn.schema_name AND old_name = fn.proname;

    target_name := coalesce(target_name, fn.proname);

    IF target_name <> fn.proname THEN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) RENAME TO %I',
        fn.schema_name, fn.proname, fn.arg_types, target_name
      );
    END IF;

    rewritten_definition := fn.definition;

    FOR replacement IN
      SELECT old_value, new_value FROM _p251_identificadores ORDER BY length(old_value) DESC
    LOOP
      rewritten_definition := replace(
        rewritten_definition,
        replacement.old_value,
        replacement.new_value
      );
    END LOOP;

    FOR replacement IN
      SELECT old_value, new_value FROM _p251_literais ORDER BY length(old_value) DESC
    LOOP
      rewritten_definition := replace(
        rewritten_definition,
        replacement.old_value,
        replacement.new_value
      );
    END LOOP;

    EXECUTE rewritten_definition;
  END LOOP;
END
$rename_functions$;

DO $rename_constraints$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relname AS relation_name, con.conname AS old_name, substr(con.conname, 5) AS new_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.conname LIKE 'rlx\_%' ESCAPE '\'
    ORDER BY c.relname, con.conname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint conflict
      WHERE conflict.conrelid = format('public.%I', item.relation_name)::regclass
        AND conflict.conname = item.new_name
    ) THEN
      RAISE EXCEPTION 'P2.5.1: constraint destino ja existe: %.%', item.relation_name, item.new_name;
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
      item.relation_name, item.old_name, item.new_name
    );
  END LOOP;
END
$rename_constraints$;

DO $rename_indexes$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      c.relname AS old_name,
      CASE
        WHEN c.relname LIKE 'idx\_rlx\_%' ESCAPE '\' THEN 'idx_' || substr(c.relname, 9)
        ELSE substr(c.relname, 5)
      END AS new_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND (c.relname LIKE 'rlx\_%' ESCAPE '\' OR c.relname LIKE 'idx\_rlx\_%' ESCAPE '\')
    ORDER BY c.relname
  LOOP
    IF to_regclass(format('public.%I', item.new_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'P2.5.1: indice destino ja existe: public.%', item.new_name;
    END IF;
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', item.old_name, item.new_name);
  END LOOP;
END
$rename_indexes$;

DO $rename_policies$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relname AS relation_name, p.polname AS old_name, substr(p.polname, 5) AS new_name
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND p.polname LIKE 'rlx\_%' ESCAPE '\'
    ORDER BY c.relname, p.polname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policy conflict
      WHERE conflict.polrelid = format('public.%I', item.relation_name)::regclass
        AND conflict.polname = item.new_name
    ) THEN
      RAISE EXCEPTION 'P2.5.1: policy destino ja existe: %.%', item.relation_name, item.new_name;
    END IF;
    EXECUTE format(
      'ALTER POLICY %I ON public.%I RENAME TO %I',
      item.old_name, item.relation_name, item.new_name
    );
  END LOOP;
END
$rename_policies$;

DO $rename_triggers$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relname AS relation_name, t.tgname AS old_name, substr(t.tgname, 5) AS new_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'rlx\_%' ESCAPE '\'
    ORDER BY c.relname, t.tgname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_trigger conflict
      WHERE conflict.tgrelid = format('public.%I', item.relation_name)::regclass
        AND conflict.tgname = item.new_name
        AND NOT conflict.tgisinternal
    ) THEN
      RAISE EXCEPTION 'P2.5.1: trigger destino ja existe: %.%', item.relation_name, item.new_name;
    END IF;
    EXECUTE format(
      'ALTER TRIGGER %I ON public.%I RENAME TO %I',
      item.old_name, item.relation_name, item.new_name
    );
  END LOOP;
END
$rename_triggers$;

COMMENT ON TABLE public.titulo_nf_vinculos IS
  'Crosswalk auditavel entre identidade financeira externa e NF; nao altera as bases canonicas financeiras.';

DO $validate$
DECLARE
  item record;
  current_count bigint;
  current_oid oid;
BEGIN
  FOR item IN SELECT * FROM _p251_relacao_snapshot LOOP
    current_oid := to_regclass(format('public.%I', item.new_name));
    IF current_oid IS NULL OR current_oid <> item.oid THEN
      RAISE EXCEPTION 'P2.5.1: OID nao preservado para public.%', item.new_name;
    END IF;

    IF item.row_count IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', item.new_name) INTO current_count;
      IF current_count <> item.row_count THEN
        RAISE EXCEPTION 'P2.5.1: contagem divergente em public.%: antes %, depois %',
          item.new_name, item.row_count, current_count;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = current_oid
        AND (c.relrowsecurity, c.relforcerowsecurity, c.relacl)
          IS DISTINCT FROM (item.relrowsecurity, item.relforcerowsecurity, item.relacl)
    ) THEN
      RAISE EXCEPTION 'P2.5.1: RLS ou grants divergentes em public.%', item.new_name;
    END IF;
  END LOOP;

  FOR item IN
    SELECT snap.*, coalesce(map.new_name, snap.proname) AS new_name
    FROM _p251_funcao_snapshot snap
    LEFT JOIN _p251_funcoes map
      ON map.schema_name = snap.schema_name AND map.old_name = snap.proname
  LOOP
    current_oid := to_regprocedure(format('%I.%I(%s)', item.schema_name, item.new_name, item.arg_types));
    IF current_oid IS NULL OR current_oid <> item.oid THEN
      RAISE EXCEPTION 'P2.5.1: funcao nao preservada: %.%(%)',
        item.schema_name, item.new_name, item.arg_types;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM _p251_relacoes rel
    WHERE to_regclass(format('public.%I', rel.old_name)) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'P2.5.1: restaram relacoes estruturais com prefixo rlx_';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace
    WHERE n.nspname = 'public' AND con.conname LIKE 'rlx\_%' ESCAPE '\'
  ) OR EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'i'
      AND (c.relname LIKE 'rlx\_%' ESCAPE '\' OR c.relname LIKE 'idx\_rlx\_%' ESCAPE '\')
  ) OR EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace AND p.polname LIKE 'rlx\_%' ESCAPE '\'
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'rlx\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'P2.5.1: restaram objetos estruturais com prefixo rlx_';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.connamespace = 'public'::regnamespace AND NOT con.convalidated
  ) THEN
    RAISE EXCEPTION 'P2.5.1: existem constraints publicas nao validadas';
  END IF;
END
$validate$;

NOTIFY pgrst, 'reload schema';

COMMIT;
