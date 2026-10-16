-- Synthetic only. Requires fixtures/guibor_a5_a6.sql (or native equivalent).
-- Catalog fixtures validate lookup semantics; they do not upload file bytes.
-- Never run against a shared or production database.
BEGIN;
DO $fixtures$
DECLARE
  e uuid;
  n integer;
  nf uuid;
  reservation uuid;
  token uuid := '61000000-0000-4000-8000-000000000001';
  file_path text;
BEGIN
  SELECT id INTO e FROM public.cedente_estabelecimentos
    WHERE cedente_id='23000000-0000-4000-8000-000000000001' LIMIT 1;
  IF e IS NULL THEN
    INSERT INTO public.cedente_estabelecimentos(cedente_id,cnpj,razao_social,tipo)
    VALUES ('23000000-0000-4000-8000-000000000001','98100000000168','Cedente QA','matriz') RETURNING id INTO e;
  END IF;
  FOR n IN 1..6 LOOP
    nf := ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    reservation := ('63000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    file_path := reservation::text||'/1/original.'||CASE WHEN n=2 THEN 'xml' ELSE 'pdf' END;
    INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,
      numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
      cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status)
    VALUES (nf,'23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',e,'ORIGINAL-QA-'||n,'QA',current_date,current_date+30,
      '98100000000168','Cedente QA','98000000000439','Sacado QA',100,100,'LEGACY_BRUTO','submetida');
    INSERT INTO private.fiscal_identity_reservations(id,document_type,identity_sha256,state,
      owner_token,generation,lease_expires_at,source_channel,actor_type,actor_user_id,actor_session_id,
      ingest_actor,fundo_id,cedente_id,cedente_fundo_id,estabelecimento_id,file_sha256,nota_fiscal_id)
    VALUES (reservation,'NFE',lpad(n::text,64,'0'),CASE WHEN n=5 THEN 'RELEASED' ELSE 'COMPLETED' END,
      token,CASE WHEN n=6 THEN 2 ELSE 1 END,now()+interval '1 hour','MANUAL_UPLOAD','HUMAN',
      '21000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000001','{}',
      '22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',e,repeat('a',64),nf);
    UPDATE public.notas_fiscais SET fiscal_reservation_id=reservation WHERE id=nf;
    IF n<>3 THEN
      INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documentos-v2',file_path,
        jsonb_build_object('size',100,'mimetype',CASE WHEN n=2 THEN 'application/xml' ELSE 'application/pdf' END));
    END IF;
    INSERT INTO private.fiscal_storage_intents(reservation_id,generation,owner_token,bucket,path,sha256,state)
    VALUES(reservation,1,token,'documentos-v2',file_path,repeat('a',64),CASE WHEN n=4 THEN 'PLANNED' ELSE 'RETAINED' END);
  END LOOP;
END;
$fixtures$;

DO $assertions$
DECLARE result_count integer;
BEGIN
  SELECT count(*) INTO result_count FROM public.fiscal_intake_get_originals(ARRAY(
    SELECT id FROM public.notas_fiscais WHERE numero_nf LIKE 'ORIGINAL-QA-%'));
  IF result_count<>2 THEN RAISE EXCEPTION 'Expected exactly PDF/XML originals; got %',result_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_intake_get_originals(ARRAY(
      SELECT id FROM public.notas_fiscais WHERE numero_nf LIKE 'ORIGINAL-QA-%')) b
    WHERE b.nota_fiscal_id NOT IN ('62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002')
      OR (public.fiscal_intake_get_original(b.nota_fiscal_id)->>'path') IS DISTINCT FROM b.path
  ) THEN RAISE EXCEPTION 'Batch original differs from the canonical viewer resolver'; END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_intake_get_originals('{}'::uuid[]))
    THEN RAISE EXCEPTION 'Empty batch returned objects'; END IF;
  IF has_function_privilege('anon','public.fiscal_intake_get_originals(uuid[])','EXECUTE')
    OR has_function_privilege('authenticated','public.fiscal_intake_get_originals(uuid[])','EXECUTE')
    OR NOT has_function_privilege('service_role','public.fiscal_intake_get_originals(uuid[])','EXECUTE')
    THEN RAISE EXCEPTION 'Invalid original batch privileges'; END IF;
END;
$assertions$;

SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  BEGIN
    PERFORM * FROM public.fiscal_intake_get_originals(ARRAY['62000000-0000-4000-8000-000000000001'::uuid]);
    RAISE EXCEPTION 'Browser role accessed private canonical metadata';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$deny$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $allow$
BEGIN
  IF (SELECT count(*) FROM public.fiscal_intake_get_originals(ARRAY['62000000-0000-4000-8000-000000000001'::uuid]))<>1
    THEN RAISE EXCEPTION 'Trusted server cannot resolve original'; END IF;
END;
$allow$;
RESET ROLE;
ROLLBACK;
