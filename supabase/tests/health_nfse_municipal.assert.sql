-- Run with fixtures/guibor_a5_a6.sql, pgTAP and the new migration in a rollback transaction.
CREATE FUNCTION pg_temp.insert_health_nf(patch jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r public.notas_fiscais; created uuid;
BEGIN
  r := jsonb_populate_record(NULL::public.notas_fiscais, jsonb_build_object(
    'id',gen_random_uuid(), 'cedente_id','23000000-0000-4000-8000-000000000001',
    'cedente_fundo_id','24000000-0000-4000-8000-000000000001',
    'fundo_id','22000000-0000-4000-8000-000000000001',
    'numero_nf','80123','serie','1','data_emissao',current_date,'data_vencimento',current_date+30,
    'cnpj_emitente','98100000000168','razao_social_emitente','EMITENTE SINTETICO HEALTH',
    'cnpj_destinatario','11222333000181','razao_social_destinatario','TOMADOR SINTETICO HEALTH',
    'valor_bruto',1000,'valor_liquido',null,'valor_liquido_origem','NAO_INFORMADO',
    'status','rascunho','tipo_documento_fiscal','NFSE','vencimento_origem','MANUAL',
    'fiscal_proveniencia',jsonb_build_object('strategy','nfse_municipal_visual','source','PDF_VISUAL_FALLBACK',
      'competencia',null,'sha256',repeat('a',64),'vencimento_documento',null,
      'orgao_emissor','PREFEITURA MUNICIPAL DE CIDADE QA','codigo_verificacao','QA-1234')) || patch);
  INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,
    data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,
    razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status,
    tipo_documento_fiscal,vencimento_origem,fiscal_proveniencia,chave_acesso)
  VALUES(r.id,r.cedente_id,r.cedente_fundo_id,r.fundo_id,r.numero_nf,r.serie,
    r.data_emissao,r.data_vencimento,r.cnpj_emitente,r.razao_social_emitente,r.cnpj_destinatario,
    r.razao_social_destinatario,r.valor_bruto,r.valor_liquido,r.valor_liquido_origem,r.status,
    r.tipo_documento_fiscal,r.vencimento_origem,r.fiscal_proveniencia,r.chave_acesso)
  RETURNING id INTO created;
  RETURN created;
END $$;

SELECT no_plan();
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.insert_health_nf('{"id":"3a000000-0000-4000-8000-000000000001"}')$$,'cedente autorizado persiste municipal sem chave nacional');
SELECT is((SELECT chave_acesso FROM public.notas_fiscais WHERE numero_nf='80123'),NULL::text,'nenhuma chave nacional inventada');
SELECT is((SELECT valor_liquido FROM public.notas_fiscais WHERE numero_nf='80123'),NULL::numeric,'liquido ausente continua nulo');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf()$$,'23505',NULL,'mesma identidade municipal bloqueada');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('fiscal_proveniencia',(SELECT fiscal_proveniencia || '{"codigo_verificacao":"QA-ALTERADO"}'::jsonb FROM public.notas_fiscais WHERE numero_nf='80123')))$$,'23505',NULL,'codigo diferente nao contorna unicidade');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80124","data_vencimento":null}')$$,'23502',NULL,'sem vencimento nao persiste NF');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('numero_nf','80124','data_vencimento',current_date-1))$$,'23514',NULL,'vencimento anterior a emissao negado');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80124","valor_liquido":950}')$$,'23514',NULL,'liquido nao informado nao aceita valor arbitrario');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80124","valor_liquido":1001,"valor_liquido_origem":"DOCUMENTO_EXPLICITO"}')$$,'23514',NULL,'liquido maior que bruto negado');
SELECT lives_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80124","valor_liquido":950,"valor_liquido_origem":"DOCUMENTO_EXPLICITO"}')$$,'liquido explicito valido aceito');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80125","chave_acesso":"1234567890"}')$$,'23514',NULL,'municipal nao aceita chave inventada');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"00080125"}')$$,'23514',NULL,'numero nao canonico negado');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80125","fiscal_proveniencia":null}')$$,'23514',NULL,'proveniencia nula negada');

-- Invalid field matrix: replace one piece of an otherwise valid provenance.
RESET ROLE;
CREATE TEMP TABLE health_invalid_provenance(label text, patch jsonb);
INSERT INTO health_invalid_provenance VALUES
 ('orgao ausente','{"orgao_emissor":null}'),
 ('orgao nao canonico','{"orgao_emissor":"Prefeitura Cidade QA"}'),
 ('orgao generico','{"orgao_emissor":"EMPRESA QUALQUER QA"}'),
 ('orgao com espacos duplicados','{"orgao_emissor":"PREFEITURA  CIDADE QA"}'),
 ('codigo ausente','{"codigo_verificacao":null}'),
 ('codigo muito curto','{"codigo_verificacao":"X"}'),
 ('codigo ambiguo','{"codigo_verificacao":"QA 1234"}'),
 ('hash invalido','{"sha256":"abc"}'),
 ('origem nao visual','{"source":"PDF_TEXT_NATIVE"}'),
 ('estrategia desconhecida','{"strategy":"qualquer"}');
GRANT SELECT ON health_invalid_provenance TO authenticated;
SET LOCAL ROLE authenticated;
SELECT throws_ok(format('SELECT pg_temp.insert_health_nf(%L::jsonb)',jsonb_build_object('numero_nf','80125','fiscal_proveniencia',n.fiscal_proveniencia || p.patch)),'23514',NULL,p.label)
FROM health_invalid_provenance p CROSS JOIN public.notas_fiscais n WHERE n.numero_nf='80123';
SELECT throws_ok($$UPDATE public.notas_fiscais SET fiscal_proveniencia=fiscal_proveniencia || '{"codigo_verificacao":"QA-OUTRO"}' WHERE numero_nf='80123'$$,'23514','NFSE_FISCAL_FACTS_IMMUTABLE','fatos municipais imutaveis');
SELECT lives_ok($$UPDATE public.notas_fiscais SET data_vencimento=current_date+31 WHERE numero_nf='80123'$$,'vencimento manual em rascunho permitido');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.logs_auditoria WHERE tipo_evento='NFSE_VENCIMENTO_MANUAL' AND entidade_id='3a000000-0000-4000-8000-000000000001'),2::bigint,'inclusao e alteracao de vencimento auditadas');
SELECT is((SELECT count(*) FROM public.notas_fiscais WHERE numero_nf='80123'),1::bigint,'tentativas duplicadas sem segunda NF');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.notas_fiscais'::regclass),'RLS permanece ativo');
SELECT ok(NOT has_table_privilege('anon','public.notas_fiscais','INSERT'),'anon sem INSERT');
SELECT ok(NOT has_table_privilege('authenticated','public.nfse_review_intents','SELECT'),'receipt continua server-only');

-- National NFS-e contract remains strict and works with both prior strategies.
SELECT lives_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('numero_nf','90101','chave_acesso',repeat('1234567890',5),'vencimento_origem','DOCUMENT','fiscal_proveniencia',jsonb_build_object('strategy','danfse_v2_labels','source','PDF_TEXT_NATIVE','sha256',repeat('b',64),'competencia',null,'vencimento_documento',current_date+30)))$$,'NFS-e nacional textual preservada');
SELECT lives_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('numero_nf','90102','chave_acesso',repeat('2345678901',5),'vencimento_origem','DOCUMENT','fiscal_proveniencia',jsonb_build_object('strategy','danfse_v2_visual','source','PDF_VISUAL_FALLBACK','sha256',repeat('c',64),'competencia',null,'vencimento_documento',current_date+30)))$$,'NFS-e nacional visual preservada');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('numero_nf','90103','fiscal_proveniencia',jsonb_build_object('strategy','danfse_v2_visual','source','PDF_VISUAL_FALLBACK','sha256',repeat('c',64),'competencia',null,'vencimento_documento',current_date+30)))$$,'23514',NULL,'nacional sem chave continua negada');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf(jsonb_build_object('numero_nf','90103','chave_acesso',repeat('1',50),'fiscal_proveniencia',jsonb_build_object('strategy','danfse_v2_visual','source','PDF_VISUAL_FALLBACK','sha256',repeat('c',64),'competencia',null,'vencimento_documento',current_date+30)))$$,'23514',NULL,'nacional com chave repetida continua negada');

-- A real SQL role/JWT boundary, not a privileged SELECT used as proof of RLS.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('21000000-0000-4000-8000-000000000005','outsider-health@example.invalid','{}');
UPDATE public.profiles SET role='cedente',status='ativo' WHERE id='21000000-0000-4000-8000-000000000005';
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.notas_fiscais),0::bigint,'outro cedente nao ve as NFs');
SELECT throws_ok($$SELECT pg_temp.insert_health_nf('{"numero_nf":"80200"}')$$,'P0001','Vinculo cedente-fundo da nota fiscal nao encontrado.','outro cedente nao insere no vinculo alheio');
RESET ROLE;
SELECT * FROM finish();
