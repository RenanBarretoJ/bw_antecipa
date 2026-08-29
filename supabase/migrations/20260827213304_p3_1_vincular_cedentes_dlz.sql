-- P3.1: patch de dados idempotente para o primeiro cutover DLZ/HEALTH.
-- O patch aborta se os identificadores auditados no clone de producao divergirem.
DO $$
DECLARE
  v_dlz_id constant uuid := '7a114257-7816-468e-adf4-d796b93364df';
  v_dlz_cnpj constant text := '62342629000177';
  v_total_ativos integer;
  v_target record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.fundos f
     WHERE f.id = v_dlz_id
       AND regexp_replace(f.cnpj, '[^0-9]', '', 'g') = v_dlz_cnpj
       AND f.ativo IS TRUE
       AND upper(f.nome) LIKE 'DLZ%'
  ) THEN
    RAISE EXCEPTION 'P3.1 abortado: fundo DLZ/HEALTH auditado nao corresponde ao estado esperado';
  END IF;

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
END;
$$;
