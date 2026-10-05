-- Synthetic fixture only; caller owns a transaction that is always rolled back.
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
 data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
 valor_bruto,valor_liquido,valor_liquido_origem,status,tipo_documento_fiscal,vencimento_origem,fiscal_proveniencia)
VALUES ('3b000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
 '24000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','99001',null,null,
 current_date,current_date+30,'98100000000168','EMITENTE SINTETICO QA','11222333000181','SACADO SINTETICO QA',
 1234.56,null,'NAO_INFORMADO','rascunho','NFSE','MANUAL',
 jsonb_build_object('strategy','nfse_municipal_visual','source','PDF_VISUAL_FALLBACK','sha256',repeat('a',64),'competencia',null,
 'vencimento_documento',null,'orgao_emissor','PREFEITURA MUNICIPAL DE CIDADE QA','codigo_verificacao','QA-99001'));

CREATE TEMP TABLE nfse_submit_before AS SELECT to_jsonb(n) row FROM public.notas_fiscais n WHERE id='3b000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE nfse_submit_counts AS SELECT count(*) due_audits FROM public.logs_auditoria WHERE entidade_id='3b000000-0000-4000-8000-000000000001' AND tipo_evento='NFSE_VENCIMENTO_MANUAL';
GRANT SELECT ON nfse_submit_before,nfse_submit_counts TO authenticated;
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.notas_fiscais SET valor_bruto=1 WHERE id='3b000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TAMPERING_ALLOWED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.notas_fiscais SET valor_liquido=0 WHERE id='3b000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'NULL_TO_ZERO_ALLOWED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.notas_fiscais SET status='submetida',submetida_em=now(),submetida_por=auth.uid()
    WHERE id='3b000000-0000-4000-8000-000000000001' AND status='rascunho'
    AND cedente_id='23000000-0000-4000-8000-000000000001'
    AND cedente_fundo_id='24000000-0000-4000-8000-000000000001'
    AND fundo_id='22000000-0000-4000-8000-000000000001';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMIT_DID_NOT_UPDATE'; END IF;
  IF (SELECT to_jsonb(n)-ARRAY['status','submetida_em','submetida_por','updated_at'] FROM public.notas_fiscais n WHERE id='3b000000-0000-4000-8000-000000000001')
    IS DISTINCT FROM (SELECT row-ARRAY['status','submetida_em','submetida_por','updated_at'] FROM nfse_submit_before)
    THEN RAISE EXCEPTION 'FISCAL_FACTS_CHANGED'; END IF;
  UPDATE public.notas_fiscais SET status='submetida' WHERE id='3b000000-0000-4000-8000-000000000001' AND status='rascunho';
  IF FOUND THEN RAISE EXCEPTION 'DOUBLE_SUBMISSION'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.logs_auditoria WHERE entidade_id='3b000000-0000-4000-8000-000000000001' AND tipo_evento='NFSE_VENCIMENTO_MANUAL')
    <> (SELECT due_audits FROM nfse_submit_counts) THEN RAISE EXCEPTION 'DUPLICATED_DUE_DATE_AUDIT'; END IF;
END $$;
SELECT 'NFSE_SUBMIT_SQL_PASS' AS result;
