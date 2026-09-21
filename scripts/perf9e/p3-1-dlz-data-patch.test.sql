\set ON_ERROR_STOP on

-- Harness local e descartavel. Executa a migration real contra um schema
-- minimo; os dados de apoio sao sinteticos e cada caso reinicia o estado.
DROP TABLE IF EXISTS public.cedente_fundos;
DROP TABLE IF EXISTS public.cedentes;
DROP TABLE IF EXISTS public.fundos;

CREATE TABLE public.fundos (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  cnpj text NOT NULL,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE public.cedentes (
  id uuid PRIMARY KEY,
  cnpj text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.cedente_fundos (
  id uuid PRIMARY KEY,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  codigo_externo text,
  status text NOT NULL,
  vigente_desde timestamptz NOT NULL,
  vigente_ate timestamptz,
  observacoes text
);

CREATE UNIQUE INDEX uq_p3_1_cedente_fundo_ativo
  ON public.cedente_fundos (cedente_id, fundo_id)
  WHERE status = 'ativo';

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P3.1 test failed: %', p_message;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.reset_p3_1_fixture()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  TRUNCATE public.cedente_fundos, public.cedentes, public.fundos;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.seed_p3_1_exact(
  p_generic_active integer,
  p_target_active integer DEFAULT 0,
  p_deterministic_target_links boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_i integer;
  v_cedente_id uuid;
  v_target_id uuid;
  v_link_id uuid;
BEGIN
  INSERT INTO public.fundos (id, nome, cnpj, ativo)
  VALUES (
    '7a114257-7816-468e-adf4-d796b93364df',
    'DLZ QA SYNTHETIC',
    '62.342.629/0001-77',
    true
  );

  INSERT INTO public.cedentes (id, cnpj, status) VALUES
    ('382fab89-936b-4ff9-b4fe-edbfab0fa7f4', '20.817.796/0001-87', 'pendente'),
    ('c3df4597-25a8-4b50-ae83-fadada7170e4', '31.775.519/0001-75', 'ativo');

  IF p_generic_active < 0 OR p_target_active NOT BETWEEN 0 AND 2 THEN
    RAISE EXCEPTION 'fixture invalida';
  END IF;

  FOR v_i IN 1..p_generic_active LOOP
    v_cedente_id := md5('p3-1-generic-cedente-' || v_i::text)::uuid;
    INSERT INTO public.cedentes (id, cnpj, status)
    VALUES (v_cedente_id, '90' || lpad(v_i::text, 12, '0'), 'ativo');

    INSERT INTO public.cedente_fundos (
      id, cedente_id, fundo_id, status, vigente_desde, observacoes
    ) VALUES (
      md5('p3-1-generic-link-' || v_i::text)::uuid,
      v_cedente_id,
      '7a114257-7816-468e-adf4-d796b93364df',
      'ativo',
      '2026-08-01 00:00:00+00',
      'fixture sintetica P3.1'
    );
  END LOOP;

  FOR v_i IN 1..p_target_active LOOP
    v_target_id := CASE v_i
      WHEN 1 THEN '382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid
      ELSE 'c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid
    END;
    v_link_id := CASE
      WHEN p_deterministic_target_links AND v_i = 1
        THEN 'd1310000-0000-4000-8000-000000000001'::uuid
      WHEN p_deterministic_target_links AND v_i = 2
        THEN 'd1310000-0000-4000-8000-000000000002'::uuid
      ELSE md5('p3-1-preexisting-target-link-' || v_i::text)::uuid
    END;

    INSERT INTO public.cedente_fundos (
      id, cedente_id, fundo_id, status, vigente_desde, observacoes
    ) VALUES (
      v_link_id,
      v_target_id,
      '7a114257-7816-468e-adf4-d796b93364df',
      'ativo',
      CASE WHEN p_deterministic_target_links
        THEN '2026-08-27 21:33:04+00'::timestamptz
        ELSE '2026-08-20 00:00:00+00'::timestamptz
      END,
      CASE WHEN p_deterministic_target_links
        THEN 'P3.1 - vinculo DLZ/HEALTH confirmado para o primeiro cutover'
        ELSE 'vinculo preexistente sintetico'
      END
    );
  END LOOP;
END;
$function$;

-- Caso 1: TARGET_ABSENT e no-op sem materializar qualquer anchor real.
SELECT pg_temp.reset_p3_1_fixture();
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.fundos)
  AND (SELECT count(*) = 0 FROM public.cedentes)
  AND (SELECT count(*) = 0 FROM public.cedente_fundos),
  'TARGET_ABSENT criou dados de negocio'
);

-- Caso 2: TARGET_PRE_PATCH exato aplica os dois vinculos e chega a 12.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 0, false);
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
SELECT pg_temp.assert_true(
  (SELECT count(DISTINCT cedente_id) = 12
     FROM public.cedente_fundos
    WHERE fundo_id = '7a114257-7816-468e-adf4-d796b93364df'
      AND status = 'ativo')
  AND (SELECT count(*) = 2
         FROM public.cedente_fundos
        WHERE id IN (
          'd1310000-0000-4000-8000-000000000001',
          'd1310000-0000-4000-8000-000000000002'
        )
          AND vigente_desde = '2026-08-27 21:33:04+00'
          AND observacoes = 'P3.1 - vinculo DLZ/HEALTH confirmado para o primeiro cutover'),
  'TARGET_PRE_PATCH nao produziu o post-state exato'
);

-- Caso 3: TARGET_POST_PATCH exato com vinculos preexistentes e no-op.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 2, false);
CREATE TEMP TABLE p3_1_post_snapshot AS
SELECT * FROM public.cedente_fundos;
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
SELECT pg_temp.assert_true(
  NOT EXISTS (
    (SELECT * FROM public.cedente_fundos EXCEPT SELECT * FROM p3_1_post_snapshot)
    UNION ALL
    (SELECT * FROM p3_1_post_snapshot EXCEPT SELECT * FROM public.cedente_fundos)
  ),
  'TARGET_POST_PATCH sofreu mutacao'
);
DROP TABLE p3_1_post_snapshot;

-- Helper psql: cada bloco abaixo espera SQLSTATE P0001 e continua o harness.

-- Caso 4: fundo presente e Cedentes ausentes.
SELECT pg_temp.reset_p3_1_fixture();
INSERT INTO public.fundos VALUES (
  '7a114257-7816-468e-adf4-d796b93364df', 'DLZ QA SYNTHETIC', '62342629000177', true
);
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 4 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 4 deveria falhar'
  \quit 1
\endif

-- Caso 5: estado parcial 6/12.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(6, 0, false);
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 5 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 5 deveria falhar'
  \quit 1
\endif

-- Caso 6: estado parcial 11/12.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 1, false);
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 6 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 6 deveria falhar'
  \quit 1
\endif

-- Caso 7: estado divergente 13/12.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(11, 2, false);
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 7 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 7 deveria falhar'
  \quit 1
\endif

-- Caso 8: UUID correto e CNPJ divergente.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 0, false);
UPDATE public.cedentes
   SET cnpj = '99000000000001'
 WHERE id = '382fab89-936b-4ff9-b4fe-edbfab0fa7f4';
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 8 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 8 deveria falhar'
  \quit 1
\endif

-- Caso 9: CNPJ correto e UUID divergente.
SELECT pg_temp.reset_p3_1_fixture();
INSERT INTO public.fundos VALUES (
  '7a114257-7816-468e-adf4-d796b93364df', 'DLZ QA SYNTHETIC', '62342629000177', true
);
INSERT INTO public.cedentes VALUES
  (md5('p3-1-wrong-id-1')::uuid, '20817796000187', 'pendente'),
  (md5('p3-1-wrong-id-2')::uuid, '31775519000175', 'ativo');
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 9 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 9 deveria falhar'
  \quit 1
\endif

-- Caso 10: anchor duplicado/ambiguo.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 0, false);
INSERT INTO public.fundos VALUES (
  md5('p3-1-duplicate-fund')::uuid, 'FUNDO DUPLICADO QA', '62.342.629/0001-77', true
);
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 10 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 10 deveria falhar'
  \quit 1
\endif

-- Caso 11: erro no segundo INSERT deve desfazer o primeiro INSERT do DO.
SELECT pg_temp.reset_p3_1_fixture();
SELECT pg_temp.seed_p3_1_exact(10, 0, false);
CREATE OR REPLACE FUNCTION pg_temp.fail_second_p3_1_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id = 'd1310000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'falha sintetica no segundo INSERT';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER p3_1_fail_second_insert
  BEFORE INSERT ON public.cedente_fundos
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_p3_1_insert();
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
\set p3_1_failed :ERROR
\set p3_1_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
\if :p3_1_failed
  SELECT :'p3_1_sqlstate' = 'P0001' AS p3_1_expected_sqlstate \gset
  \if :p3_1_expected_sqlstate
  \else
    \echo 'P3.1 test failed: caso 11 retornou SQLSTATE inesperado'
    \quit 1
  \endif
\else
  \echo 'P3.1 test failed: caso 11 deveria falhar'
  \quit 1
\endif
DROP TRIGGER p3_1_fail_second_insert ON public.cedente_fundos;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 10 FROM public.cedente_fundos)
  AND (SELECT count(*) = 0
         FROM public.cedente_fundos
        WHERE id IN (
          'd1310000-0000-4000-8000-000000000001',
          'd1310000-0000-4000-8000-000000000002'
        )),
  'falha durante mutacao deixou estado parcial'
);

SELECT 'P3_1_STATE_MACHINE_TESTS=PASS' AS resultado;
