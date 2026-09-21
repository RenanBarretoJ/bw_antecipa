-- P3.1: patch de dados idempotente para o primeiro cutover DLZ/HEALTH.
-- O patch aborta se os identificadores auditados no clone de producao divergirem.
DO $$
DECLARE
  v_dlz_id constant uuid := '7a114257-7816-468e-adf4-d796b93364df';
  v_dlz_cnpj constant text := '62342629000177';
  v_estado text;
  v_fundos_anchor integer;
  v_fundos_exatos integer;
  v_cedentes_anchor integer;
  v_cedentes_exatos integer;
  v_vinculos_anchor integer;
  v_vinculos_target_ativos integer;
  v_cedentes_target_ativos integer;
  v_vinculos_target_outro_fundo integer;
  v_vinculos_deterministicos integer;
  v_vinculos_deterministicos_exatos integer;
  v_total_ativos integer;
  v_target record;
BEGIN
  -- Classifica o estado completo antes de qualquer mutacao. O alvo ausente e
  -- esperado em clean-room; qualquer anchor parcial permanece fail-closed.
  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE f.id = v_dlz_id
             AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') = v_dlz_cnpj
             AND f.ativo IS TRUE
             AND upper(f.nome) LIKE 'DLZ%'
         )::integer
    INTO v_fundos_anchor, v_fundos_exatos
    FROM public.fundos f
   WHERE f.id = v_dlz_id
      OR regexp_replace(f.cnpj, '[^0-9]', '', 'g') = v_dlz_cnpj;

  SELECT count(*)::integer
    INTO v_cedentes_anchor
    FROM public.cedentes c
   WHERE c.id IN (
           '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid,
           'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
         )
      OR regexp_replace(c.cnpj, '[^0-9]', '', 'g') IN (
           '20817796000187',
           '31775519000175'
         );

  SELECT count(*)::integer
    INTO v_cedentes_exatos
    FROM (VALUES
      ('382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid, '20817796000187'::text),
      ('c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid, '31775519000175'::text)
    ) AS expected(cedente_id, cnpj)
    JOIN public.cedentes c
      ON c.id = expected.cedente_id
     AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') = expected.cnpj
     AND c.status::text IN ('pendente', 'ativo');

  SELECT count(*)::integer
    INTO v_vinculos_anchor
    FROM public.cedente_fundos cf
   WHERE cf.id IN (
           'd1310000-0000-4000-8000-000000000001'::uuid,
           'd1310000-0000-4000-8000-000000000002'::uuid
         )
      OR cf.cedente_id IN (
           '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid,
           'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
         )
      OR cf.fundo_id = v_dlz_id;

  SELECT count(*)::integer,
         count(DISTINCT cf.cedente_id)::integer
    INTO v_vinculos_target_ativos, v_cedentes_target_ativos
    FROM public.cedente_fundos cf
   WHERE cf.cedente_id IN (
           '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid,
           'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
         )
     AND cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo';

  SELECT count(*)::integer
    INTO v_vinculos_target_outro_fundo
    FROM public.cedente_fundos cf
   WHERE cf.cedente_id IN (
           '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid,
           'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
         )
     AND cf.status = 'ativo'
     AND cf.fundo_id <> v_dlz_id;

  SELECT count(*)::integer
    INTO v_vinculos_deterministicos
    FROM public.cedente_fundos cf
   WHERE cf.id IN (
           'd1310000-0000-4000-8000-000000000001'::uuid,
           'd1310000-0000-4000-8000-000000000002'::uuid
         );

  SELECT count(*)::integer
    INTO v_vinculos_deterministicos_exatos
    FROM (VALUES
      ('d1310000-0000-4000-8000-000000000001'::uuid, '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid),
      ('d1310000-0000-4000-8000-000000000002'::uuid, 'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid)
    ) AS expected(vinculo_id, cedente_id)
    JOIN public.cedente_fundos cf
      ON cf.id = expected.vinculo_id
     AND cf.cedente_id = expected.cedente_id
     AND cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo'
     AND cf.vigente_desde = '2026-08-27 21:33:04+00'::timestamptz
     AND cf.vigente_ate IS NULL
     AND cf.codigo_externo IS NULL
     AND cf.observacoes = 'P3.1 - vinculo DLZ/HEALTH confirmado para o primeiro cutover';

  SELECT count(DISTINCT cf.cedente_id)::integer
    INTO v_total_ativos
    FROM public.cedente_fundos cf
   WHERE cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo';

  IF v_fundos_anchor = 0
     AND v_cedentes_anchor = 0
     AND v_vinculos_anchor = 0 THEN
    v_estado := 'TARGET_ABSENT';
  ELSIF v_fundos_anchor = 1
     AND v_fundos_exatos = 1
     AND v_cedentes_anchor = 2
     AND v_cedentes_exatos = 2
     AND v_vinculos_target_ativos = 0
     AND v_cedentes_target_ativos = 0
     AND v_vinculos_target_outro_fundo = 0
     AND v_vinculos_deterministicos = 0
     AND v_total_ativos = 10 THEN
    v_estado := 'TARGET_PRE_PATCH';
  ELSIF v_fundos_anchor = 1
     AND v_fundos_exatos = 1
     AND v_cedentes_anchor = 2
     AND v_cedentes_exatos = 2
     AND v_vinculos_target_ativos = 2
     AND v_cedentes_target_ativos = 2
     AND v_vinculos_target_outro_fundo = 0
     AND v_total_ativos = 12
     AND (
       v_vinculos_deterministicos = 0
       OR (
         v_vinculos_deterministicos = 2
         AND v_vinculos_deterministicos_exatos = 2
       )
     ) THEN
    v_estado := 'TARGET_POST_PATCH';
  ELSE
    v_estado := 'TARGET_INCONSISTENT';
  END IF;

  IF v_estado = 'TARGET_ABSENT' THEN
    RAISE NOTICE 'P3.1: alvo historico ausente; patch de dados ignorado';
    RETURN;
  ELSIF v_estado = 'TARGET_POST_PATCH' THEN
    RAISE NOTICE 'P3.1: estado final historico ja materializado; nenhuma mutacao aplicada';
    RETURN;
  ELSIF v_estado = 'TARGET_INCONSISTENT' THEN
    RAISE EXCEPTION 'P3.1 abortado: estado historico parcial, ambiguo ou divergente';
  END IF;

  -- Corpo funcional original: somente TARGET_PRE_PATCH chega a esta etapa.
  FOR v_target IN
    SELECT * FROM (VALUES
      ('d1310000-0000-4000-8000-000000000001'::uuid, '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid, '20817796000187'::text),
      ('d1310000-0000-4000-8000-000000000002'::uuid, 'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid, '31775519000175'::text)
    ) AS expected(vinculo_id, cedente_id, cnpj)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.cedentes c
       WHERE c.id = v_target.cedente_id
         AND regexp_replace(c.cnpj, '[^0-9]', '', 'g') = v_target.cnpj
         AND c.status::text IN ('pendente', 'ativo')
    ) THEN
      RAISE EXCEPTION 'P3.1 abortado: Cedente % nao corresponde ao ID/CNPJ/status auditado', v_target.cedente_id;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.cedente_fundos cf
       WHERE cf.cedente_id = v_target.cedente_id
         AND cf.status = 'ativo'
         AND cf.fundo_id <> v_dlz_id
    ) THEN
      RAISE EXCEPTION 'P3.1 abortado: Cedente % possui vinculo ativo com outro fundo', v_target.cedente_id;
    END IF;

    INSERT INTO public.cedente_fundos (
      id, cedente_id, fundo_id, status, vigente_desde, observacoes
    )
    SELECT v_target.vinculo_id, v_target.cedente_id, v_dlz_id, 'ativo',
           '2026-08-27 21:33:04+00'::timestamptz,
           'P3.1 - vinculo DLZ/HEALTH confirmado para o primeiro cutover'
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.cedente_fundos cf
       WHERE cf.cedente_id = v_target.cedente_id
         AND cf.fundo_id = v_dlz_id
         AND cf.status = 'ativo'
    );
  END LOOP;

  SELECT count(DISTINCT cf.cedente_id)::integer
    INTO v_total_ativos
    FROM public.cedente_fundos cf
   WHERE cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo';

  IF v_total_ativos <> 12 THEN
    RAISE EXCEPTION 'P3.1 abortado: DLZ deveria possuir 12 Cedentes ativos, encontrou %', v_total_ativos;
  END IF;

  SELECT count(*)::integer,
         count(DISTINCT cf.cedente_id)::integer
    INTO v_vinculos_target_ativos, v_cedentes_target_ativos
    FROM public.cedente_fundos cf
   WHERE cf.cedente_id IN (
           '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid,
           'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
         )
     AND cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo';

  SELECT count(*)::integer
    INTO v_vinculos_deterministicos_exatos
    FROM (VALUES
      ('d1310000-0000-4000-8000-000000000001'::uuid, '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid),
      ('d1310000-0000-4000-8000-000000000002'::uuid, 'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid)
    ) AS expected(vinculo_id, cedente_id)
    JOIN public.cedente_fundos cf
      ON cf.id = expected.vinculo_id
     AND cf.cedente_id = expected.cedente_id
     AND cf.fundo_id = v_dlz_id
     AND cf.status = 'ativo'
     AND cf.vigente_desde = '2026-08-27 21:33:04+00'::timestamptz
     AND cf.vigente_ate IS NULL
     AND cf.codigo_externo IS NULL
     AND cf.observacoes = 'P3.1 - vinculo DLZ/HEALTH confirmado para o primeiro cutover';

  IF v_vinculos_target_ativos <> 2
     OR v_cedentes_target_ativos <> 2
     OR v_vinculos_deterministicos_exatos <> 2 THEN
    RAISE EXCEPTION 'P3.1 abortado: post-state dos vinculos DLZ/HEALTH nao corresponde ao esperado';
  END IF;
END;
$$;
