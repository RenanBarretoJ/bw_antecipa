-- Execute after the c2_1_r2 $setup$ fixture truncated before its NF inserts,
-- inside a local transaction that is always rolled back.
DO $test$
DECLARE
  first_id uuid;
  second_id uuid;
  updated integer;
BEGIN
  IF has_table_privilege('authenticated', 'public.nfse_review_intents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.nfse_review_intents', 'SELECT')
     OR has_table_privilege('anon', 'public.nfse_review_intents', 'SELECT') THEN
    RAISE EXCEPTION 'RECEIPT_API_PRIVILEGE_LEAK';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.nfse_review_intents'::regclass) THEN
    RAISE EXCEPTION 'RECEIPT_RLS_MISSING';
  END IF;
  INSERT INTO public.nfse_review_intents(actor_id,cedente_id,cedente_fundo_id,fundo_id,file_sha256,fiscal_sha256,identity_sha256)
  VALUES ('21000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64))
  RETURNING id INTO first_id;
  INSERT INTO public.nfse_review_intents(actor_id,cedente_id,cedente_fundo_id,fundo_id,file_sha256,fiscal_sha256,identity_sha256)
  SELECT actor_id,cedente_id,cedente_fundo_id,fundo_id,repeat('d',64),fiscal_sha256,identity_sha256
  FROM public.nfse_review_intents WHERE id=first_id RETURNING id INTO second_id;
  UPDATE public.nfse_review_intents SET state='PROCESSING',storage_path='qa/first.pdf'
  WHERE id=first_id AND state='REVIEW' AND expires_at>now();
  GET DIAGNOSTICS updated=ROW_COUNT;
  IF updated<>1 THEN RAISE EXCEPTION 'CLAIM_FAILED'; END IF;
  UPDATE public.nfse_review_intents SET state='PROCESSING',storage_path='qa/replay.pdf'
  WHERE id=first_id AND state='REVIEW' AND expires_at>now();
  GET DIAGNOSTICS updated=ROW_COUNT;
  IF updated<>0 THEN RAISE EXCEPTION 'DOUBLE_CLAIM'; END IF;
  BEGIN
    UPDATE public.nfse_review_intents SET state='PROCESSING',storage_path='qa/second.pdf' WHERE id=second_id;
    RAISE EXCEPTION 'DUPLICATE_IDENTITY_ALLOWED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.nfse_review_intents SET state='CLEANUP_PENDING' WHERE id=first_id;
  BEGIN
    UPDATE public.nfse_review_intents SET state='PROCESSING',storage_path='qa/second.pdf' WHERE id=second_id;
    RAISE EXCEPTION 'PENDING_CLEANUP_RETRIED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.nfse_review_intents SET state='FAILED' WHERE id=first_id;
  UPDATE public.nfse_review_intents SET state='PROCESSING',storage_path='qa/second.pdf' WHERE id=second_id;
  BEGIN
    UPDATE public.nfse_review_intents SET state='COMPLETED' WHERE id=second_id;
    RAISE EXCEPTION 'COMPLETED_WITHOUT_NF';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
SELECT 'GUIBOR_REVIEW_LOCAL_SQL_PASS' AS result;
