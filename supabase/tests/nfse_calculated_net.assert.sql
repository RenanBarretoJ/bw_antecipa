-- Synthetic actors/entities from fixtures/guibor_a5_a6.sql; caller always rolls back.
select set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
 data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
 valor_bruto,valor_liquido,valor_liquido_origem,status,tipo_documento_fiscal,vencimento_origem,fiscal_proveniencia)
values('3b000000-0000-4000-8000-000000000011','23000000-0000-4000-8000-000000000001',
 '24000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','99011',null,null,
 current_date,current_date+10,'98100000000168','EMITENTE SINTETICO QA','11222333000181','SACADO SINTETICO QA',
 1234.56,null,'NAO_INFORMADO','requer_ajuste','NFSE','MANUAL',jsonb_build_object(
 'strategy','nfse_municipal_visual','source','PDF_VISUAL_FALLBACK','sha256',repeat('a',64),'competencia',null,
 'vencimento_documento',null,'orgao_emissor','PREFEITURA MUNICIPAL DE CIDADE QA','codigo_verificacao','QA-99011'));
create temp table nfse_net_baseline as select to_jsonb(n) row from public.notas_fiscais n where id='3b000000-0000-4000-8000-000000000011';
do $$
declare calc jsonb := '{"versao":1,"formula":"BRUTO_MENOS_RETENCOES","completo":true,"bruto":1234.56,"total_retencoes":34.56,"liquido":1200,"componentes":[{"codigo":"IRRF","valor":34.56,"rotulo":"IRRF"}]}';
  original_hash text; answer jsonb;
begin
  if not private.nfse_calculo_liquido_valido(1234.56,1200,calc) then raise exception 'VALID_CALCULATION_REJECTED'; end if;
  if private.nfse_calculo_liquido_valido(1234.56,1200,calc || '{"completo":false}')
    or private.nfse_calculo_liquido_valido(1234.56,1201,calc)
    or private.nfse_calculo_liquido_valido(1234.56,1200,null)
    or private.nfse_calculo_liquido_valido(1234.56,1200,jsonb_set(calc,'{componentes}',(calc->'componentes')||(calc->'componentes')))
    then raise exception 'INVALID_CALCULATION_ACCEPTED'; end if;
  select md5(row::text) into original_hash from nfse_net_baseline;
  begin
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',original_hash,repeat('a',64),calc || '{"liquido":1201}',current_date+20,'Synthetic authorized correction for test');
    raise exception 'WRONG_SUM_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_NOT_ELIGIBLE' then raise; end if; end;
  begin
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',original_hash,repeat('a',64),calc,current_date-1,'Synthetic authorized correction for test');
    raise exception 'PAST_DUE_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_NOT_ELIGIBLE' then raise; end if; end;
  begin
    insert into public.nota_fiscal_parcelas(nota_fiscal_id,numero_parcela,valor_nominal,data_vencimento)
      values('3b000000-0000-4000-8000-000000000011',1,1234.56,current_date+10);
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',original_hash,repeat('a',64),calc,current_date+20,'Synthetic authorized correction for test');
    raise exception 'LINKED_NOTE_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_FINANCIAL_LINK_EXISTS' then raise; end if; end;
  begin
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011','wrong',repeat('a',64),calc,current_date+20,'Synthetic authorized correction for test');
    raise exception 'STALE_BASELINE_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_BASELINE_CHANGED' then raise; end if; end;
  begin
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',original_hash,repeat('b',64),calc,current_date+20,'Synthetic authorized correction for test');
    raise exception 'WRONG_DOCUMENT_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_BASELINE_CHANGED' then raise; end if; end;
  begin
    update public.notas_fiscais set valor_liquido=1200 where id='3b000000-0000-4000-8000-000000000011';
    raise exception 'DIRECT_UPDATE_ACCEPTED';
  exception when check_violation then if sqlerrm <> 'NFSE_FISCAL_FACTS_IMMUTABLE' then raise; end if; end;
  answer := private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',original_hash,repeat('a',64),calc,current_date+20,'Synthetic authorized correction for test');
  if answer->>'status' <> 'requer_ajuste' or (answer->>'valor_liquido')::numeric <> 1200 then raise exception 'REPAIR_FAILED'; end if;
  if (select count(*) from public.logs_auditoria where entidade_id='3b000000-0000-4000-8000-000000000011' and tipo_evento='NFSE_CORRECAO_FISCAL' and ator_tipo='sistema') <> 1
    or (select count(*) from public.eventos_dominio where nota_fiscal_id='3b000000-0000-4000-8000-000000000011' and tipo_evento='NFSE_CORRECAO_FISCAL') <> 1 then raise exception 'AUDIT_MISSING'; end if;
  if exists(select 1 from public.notas_fiscais n,nfse_net_baseline b where n.id='3b000000-0000-4000-8000-000000000011'
    and to_jsonb(n)-array['valor_liquido','valor_liquido_origem','data_vencimento','fiscal_proveniencia','updated_at']
      is distinct from b.row-array['valor_liquido','valor_liquido_origem','data_vencimento','fiscal_proveniencia','updated_at']) then raise exception 'UNRELATED_FACT_CHANGED'; end if;
  begin
    perform private.corrigir_nfse_liquido_ausente('3b000000-0000-4000-8000-000000000011',answer->>'row_hash',repeat('a',64),calc,current_date+20,'Synthetic authorized correction for test');
    raise exception 'REPEAT_REPAIR_ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'NFSE_CORRECTION_NOT_ELIGIBLE' then raise; end if; end;
  if private.resolver_valor_base_antecipacao('LIQUIDO',1234.56,1200,'CALCULADO_RETENCOES',false) <> 1200 then raise exception 'BASE_REJECTED'; end if;
end $$;
select set_config('app.nfse_correction_id','3b000000-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ begin
  begin
    perform private.corrigir_nfse_liquido_ausente(null,null,null,null,null,null);
    raise exception 'AUTHENTICATED_REPAIR_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    update public.notas_fiscais set valor_liquido=1 where id='3b000000-0000-4000-8000-000000000011';
    raise exception 'FORGED_FLAG_BYPASS';
  exception when check_violation then if sqlerrm <> 'NFSE_FISCAL_FACTS_IMMUTABLE' then raise; end if; end;
end $$;
reset role;
select set_config('app.nfse_correction_id','',true);
set local role service_role;
do $$ begin
  begin
    perform private.corrigir_nfse_liquido_ausente(null,null,null,null,null,null);
    raise exception 'SERVICE_ROLE_REPAIR_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
