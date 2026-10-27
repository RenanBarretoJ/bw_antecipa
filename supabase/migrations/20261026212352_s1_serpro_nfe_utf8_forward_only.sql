-- S1.7 / SERPRO NF-e: reparo forward-only do texto UTF-8 persistido.
--
-- Esta migration corrige exclusivamente artefatos textuais que podem ter sido
-- recodificados de UTF-8 para Windows-1252 durante a aplicação da S1. Ela não
-- altera tabelas, assinaturas, ACLs, RLS, policies, triggers ou dados existentes.
BEGIN;

DO $preconditions$
DECLARE
  v_snapshot_comment text;
  v_consultas_comment text;
  v_resumo_default text;
BEGIN
  IF to_regclass('public.nfe_fiscal_snapshots') IS NULL
     OR to_regclass('public.nfe_fiscal_consultas') IS NULL
     OR to_regprocedure('private.nfe_snapshot_imutavel()') IS NULL
     OR to_regprocedure('private.nfe_enfileirar_apos_submissao()') IS NULL
     OR to_regprocedure('public.nfe_fiscal_claim(integer)') IS NULL
     OR to_regprocedure('public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.nfe_fiscal_fail(uuid,uuid,text,text,integer)') IS NULL
     OR to_regprocedure('public.solicitar_reconsulta_nfe_fiscal(uuid)') IS NULL
     OR to_regprocedure('public.obter_situacao_fiscal_nfe(uuid)') IS NULL THEN
    RAISE EXCEPTION 'S1.7 requer todos os objetos canônicos da S1';
  END IF;

  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'S1.7 requer extensions.digest(bytea,text)';
  END IF;

  SELECT obj_description('public.nfe_fiscal_snapshots'::regclass, 'pg_class')
    INTO v_snapshot_comment;
  IF v_snapshot_comment IS NULL OR v_snapshot_comment NOT IN (
    'Snapshot fiscal mÃ­nimo e imutÃ¡vel capturado na submissÃ£o. Sem texto livre, dados clÃ­nicos ou documento original.',
    'Snapshot fiscal mínimo e imutável capturado na submissão. Sem texto livre, dados clínicos ou documento original.'
  ) THEN
    RAISE EXCEPTION 'Comentário inesperado em public.nfe_fiscal_snapshots';
  END IF;

  SELECT obj_description('public.nfe_fiscal_consultas'::regclass, 'pg_class')
    INTO v_consultas_comment;
  IF v_consultas_comment IS NULL OR v_consultas_comment NOT IN (
    'Fila e visÃ£o minimizada da consulta fiscal. O payload bruto do provedor nÃ£o Ã© persistido nesta tabela.',
    'Fila e visão minimizada da consulta fiscal. O payload bruto do provedor não é persistido nesta tabela.'
  ) THEN
    RAISE EXCEPTION 'Comentário inesperado em public.nfe_fiscal_consultas';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_resumo_default
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.nfe_fiscal_consultas'::regclass
     AND a.attname = 'resumo'
     AND NOT a.attisdropped;
  IF v_resumo_default IS NULL OR v_resumo_default NOT IN (
    '''Consulta fiscal ainda nÃ£o executada.''::text',
    '''Consulta fiscal ainda não executada.''::text'
  ) THEN
    RAISE EXCEPTION 'Default inesperado em public.nfe_fiscal_consultas.resumo: %', v_resumo_default;
  END IF;
END
$preconditions$;

COMMENT ON TABLE public.nfe_fiscal_snapshots IS
  'Snapshot fiscal mínimo e imutável capturado na submissão. Sem texto livre, dados clínicos ou documento original.';

COMMENT ON TABLE public.nfe_fiscal_consultas IS
  'Fila e visão minimizada da consulta fiscal. O payload bruto do provedor não é persistido nesta tabela.';

ALTER TABLE public.nfe_fiscal_consultas
  ALTER COLUMN resumo SET DEFAULT 'Consulta fiscal ainda não executada.';

DO $repair_functions$
DECLARE
  v_item record;
  v_oid oid;
  v_definition text;
  v_actual_hash text;
  v_repaired_definition text;
  v_repaired_hash text;
BEGIN
  FOR v_item IN
    SELECT *
      FROM (VALUES
        ('private.nfe_enfileirar_apos_submissao()',
         'f23184fad59f39f15b243838f2ce66e13ad4996ce17fd2e296d3a1d1e18c1998',
         '8edf3384c23ae33be15077f74394e702a03d729299fd096c2409651d012f06eb'),
        ('private.nfe_snapshot_imutavel()',
         'ebde450d3da92cf42943793736953fdd907d2fbb9f7b95e05c3064da27878fa1',
         'ce87f6231e5947f62b6e3730e3ccf60b7d92439997b4fc88a502f8a2ee627b46'),
        ('public.nfe_fiscal_claim(integer)',
         '916bac342f9fb567deab779f004231c57ebb0679e2aaf41ce16ef1df8cd24f6f',
         '37cf963745884e278818a0309d6afb81ef4158494891223e595017a60291dea2'),
        ('public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)',
         'd50cec208f1b666f9352b33ce5ba580abdcabfe2270efeb45c73424a42e4fa67',
         '78bab349e047795ec0f5e4fe76d1689eb01bbc70cd1e6d6423174061141788df'),
        ('public.nfe_fiscal_fail(uuid,uuid,text,text,integer)',
         'cdf19c5f2426fd7fbc0df2859fcd8bae2d65261f08d16c687273e35353e565d5',
         '05e6b87cda721d19aef8fbc7ec85455783f1d84941a5b21ce92c5449ff5d1fab'),
        ('public.obter_situacao_fiscal_nfe(uuid)',
         '4d6e7fa184010c76347bef65fceeb3d66516c9683ac88b511f3aa24083ca7df5',
         '93d8519e2ba647c9361a6d0b462662a49b501e763c00ea732740ae002857f09d'),
        ('public.solicitar_reconsulta_nfe_fiscal(uuid)',
         '4436b43d99465b39fc2179f569008f86f151c6b20bd65cac427ae12eb9ed2f2c',
         'ef8986d0243bd83f4bfca72b8e2c45679730f752e72bd74d51db19cfc764d6e4')
      ) AS expected(identity_arguments, bad_hash, good_hash)
  LOOP
    v_oid := to_regprocedure(v_item.identity_arguments);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Função esperada ausente durante reparo: %', v_item.identity_arguments;
    END IF;
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Definição ausente para %', v_item.identity_arguments;
    END IF;
    v_actual_hash := encode(
      extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
      'hex'
    );

    IF v_actual_hash = v_item.good_hash THEN
      CONTINUE;
    END IF;
    IF v_actual_hash IS NULL OR v_actual_hash <> v_item.bad_hash THEN
      RAISE EXCEPTION 'Definição inesperada para %: %',
        v_item.identity_arguments, v_actual_hash;
    END IF;

    v_repaired_definition := convert_from(
      convert_to(v_definition, 'WIN1252'),
      'UTF8'
    );
    v_repaired_hash := encode(
      extensions.digest(convert_to(v_repaired_definition, 'UTF8'), 'sha256'),
      'hex'
    );
    IF v_repaired_hash IS DISTINCT FROM v_item.good_hash THEN
      RAISE EXCEPTION 'Reparo UTF-8 divergente para %: esperado %, obtido %',
        v_item.identity_arguments, v_item.good_hash, v_repaired_hash;
    END IF;

    EXECUTE v_repaired_definition;
  END LOOP;
END
$repair_functions$;

DO $postconditions$
DECLARE
  v_item record;
  v_oid oid;
  v_definition text;
  v_actual_hash text;
  v_resumo_default text;
BEGIN
  FOR v_item IN
    SELECT *
      FROM (VALUES
        ('private.nfe_enfileirar_apos_submissao()', '8edf3384c23ae33be15077f74394e702a03d729299fd096c2409651d012f06eb'),
        ('private.nfe_snapshot_imutavel()', 'ce87f6231e5947f62b6e3730e3ccf60b7d92439997b4fc88a502f8a2ee627b46'),
        ('public.nfe_fiscal_claim(integer)', '37cf963745884e278818a0309d6afb81ef4158494891223e595017a60291dea2'),
        ('public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)', '78bab349e047795ec0f5e4fe76d1689eb01bbc70cd1e6d6423174061141788df'),
        ('public.nfe_fiscal_fail(uuid,uuid,text,text,integer)', '05e6b87cda721d19aef8fbc7ec85455783f1d84941a5b21ce92c5449ff5d1fab'),
        ('public.obter_situacao_fiscal_nfe(uuid)', '93d8519e2ba647c9361a6d0b462662a49b501e763c00ea732740ae002857f09d'),
        ('public.solicitar_reconsulta_nfe_fiscal(uuid)', 'ef8986d0243bd83f4bfca72b8e2c45679730f752e72bd74d51db19cfc764d6e4')
      ) AS expected(identity_arguments, good_hash)
  LOOP
    v_oid := to_regprocedure(v_item.identity_arguments);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Função esperada ausente na pós-condição: %', v_item.identity_arguments;
    END IF;
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_actual_hash := encode(
      extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
      'hex'
    );
    IF v_definition IS NULL
       OR v_actual_hash IS DISTINCT FROM v_item.good_hash
       OR position('Ã' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Pós-condição UTF-8 falhou para %: %',
        v_item.identity_arguments, v_actual_hash;
    END IF;
  END LOOP;

  IF obj_description('public.nfe_fiscal_snapshots'::regclass, 'pg_class') IS DISTINCT FROM
       'Snapshot fiscal mínimo e imutável capturado na submissão. Sem texto livre, dados clínicos ou documento original.'
     OR obj_description('public.nfe_fiscal_consultas'::regclass, 'pg_class') IS DISTINCT FROM
       'Fila e visão minimizada da consulta fiscal. O payload bruto do provedor não é persistido nesta tabela.' THEN
    RAISE EXCEPTION 'Pós-condição UTF-8 falhou nos comentários S1';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_resumo_default
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.nfe_fiscal_consultas'::regclass
     AND a.attname = 'resumo'
     AND NOT a.attisdropped;
  IF v_resumo_default IS DISTINCT FROM '''Consulta fiscal ainda não executada.''::text' THEN
    RAISE EXCEPTION 'Pós-condição UTF-8 falhou no default de resumo: %', v_resumo_default;
  END IF;
END
$postconditions$;

NOTIFY pgrst, 'reload schema';
COMMIT;
