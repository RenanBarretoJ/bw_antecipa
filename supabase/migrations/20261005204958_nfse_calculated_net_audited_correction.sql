-- Global NFS-e fiscal net derived from evidenced retentions. No automatic data backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.nfse_calculo_liquido_valido(p_bruto numeric, p_liquido numeric, p_calc jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; total numeric := 0; amount numeric; codes text[] := '{}'; code text;
begin
  if p_bruto is null or p_liquido is null or p_calc is null or p_bruto <= 0
    or p_bruto::text in ('NaN','Infinity','-Infinity') or p_bruto <> round(p_bruto,2)
    or jsonb_typeof(p_calc) <> 'object' or p_calc->>'versao' is distinct from '1'
    or p_calc->>'formula' is distinct from 'BRUTO_MENOS_RETENCOES'
    or p_calc->'completo' is distinct from 'true'::jsonb
    or jsonb_typeof(p_calc->'componentes') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_calc->'componentes') not between 1 and 6 then return false; end if;
  for item in select value from jsonb_array_elements(p_calc->'componentes') loop
    code := item->>'codigo';
    if code is null or code not in ('IRRF','PIS','COFINS','CSLL','INSS','ISS_RETIDO','TOTAL_RETENCOES')
      or code = any(codes) or jsonb_typeof(item->'valor') is distinct from 'number'
      or coalesce(length(btrim(item->>'rotulo')),0) not between 1 and 200 then return false; end if;
    codes := array_append(codes,code);
    amount := (item->>'valor')::numeric;
    if amount < 0 or amount <> round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') then return false; end if;
    total := total + amount;
  end loop;
  if 'TOTAL_RETENCOES' = any(codes) and cardinality(codes) <> 1 then return false; end if;
  return coalesce(total < p_bruto and p_liquido = p_bruto-total
    and (p_calc->>'bruto')::numeric = p_bruto and (p_calc->>'liquido')::numeric = p_liquido
    and (p_calc->>'total_retencoes')::numeric = total, false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function private.nfse_calculo_liquido_valido(numeric,numeric,jsonb) from public, anon;
grant execute on function private.nfse_calculo_liquido_valido(numeric,numeric,jsonb) to authenticated, service_role;

alter table public.notas_fiscais drop constraint nf_liquido_origem_check;
alter table public.notas_fiscais add constraint nf_liquido_origem_check
  check (valor_liquido_origem in ('DOCUMENTO_EXPLICITO','CALCULADO_RETENCOES','LEGACY_BRUTO','NAO_INFORMADO'));
-- Preserve the complete installed national/municipal identity constraint, changing only net origin.
do $$ declare definition text; revised text; begin
  select pg_get_constraintdef(oid) into strict definition from pg_constraint
    where conrelid='public.notas_fiscais'::regclass and conname='nfse_fatos_check';
  revised := replace(definition, 'valor_liquido_origem = ''DOCUMENTO_EXPLICITO''::text',
    'valor_liquido_origem = ANY (ARRAY[''DOCUMENTO_EXPLICITO''::text,''CALCULADO_RETENCOES''::text])');
  if definition = revised then raise exception 'NFSE_BASELINE_CONSTRAINT_UNEXPECTED'; end if;
  alter table public.notas_fiscais drop constraint nfse_fatos_check;
  execute 'alter table public.notas_fiscais add constraint nfse_fatos_check ' || revised;
end $$;
alter table public.notas_fiscais add constraint nfse_calculated_net_evidence_check
  check (valor_liquido_origem is distinct from 'CALCULADO_RETENCOES' or
    (tipo_documento_fiscal = 'NFSE' and private.nfse_calculo_liquido_valido(
      valor_bruto,valor_liquido,fiscal_proveniencia->'calculo_liquido')) is true);
comment on column public.notas_fiscais.valor_liquido_origem is
  'DOCUMENTO_EXPLICITO: liquido impresso. CALCULADO_RETENCOES: bruto menos retencoes comprovadas, memoria em fiscal_proveniencia. Nunca desconto financeiro.';

-- Keep function/trigger OIDs and existing ACLs; no historical migration or audit rename.
alter function private.guibor_proteger_fatos_nfse() rename to proteger_fatos_nfse;
alter trigger guibor_proteger_fatos_nfse on public.notas_fiscais rename to proteger_fatos_nfse;
alter function private.guibor_auditar_vencimento_nfse() rename to auditar_vencimento_nfse;
alter trigger guibor_auditar_vencimento_nfse on public.notas_fiscais rename to auditar_vencimento_nfse;

create or replace function private.proteger_fatos_nfse()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare maintenance boolean := current_user='postgres' and session_user='postgres'
  and current_setting('app.nfse_correction_id',true)=old.id::text;
begin
  if old.tipo_documento_fiscal = 'NFSE' then
    if maintenance is true then
      -- Maintenance cannot change identity, issuer, fund, status, document, gross or old provenance.
      if old.status::text not in ('rascunho','requer_ajuste') or old.valor_liquido is not null
        or old.valor_liquido_origem is distinct from 'NAO_INFORMADO'
        or new.valor_liquido_origem is distinct from 'CALCULADO_RETENCOES'
        or new.vencimento_origem is distinct from 'MANUAL'
        or (new.fiscal_proveniencia - 'calculo_liquido') is distinct from old.fiscal_proveniencia
        or (to_jsonb(new)-array['valor_liquido','valor_liquido_origem','data_vencimento','vencimento_origem','fiscal_proveniencia','updated_at'])
          is distinct from (to_jsonb(old)-array['valor_liquido','valor_liquido_origem','data_vencimento','vencimento_origem','fiscal_proveniencia','updated_at'])
        or not private.nfse_calculo_liquido_valido(new.valor_bruto,new.valor_liquido,new.fiscal_proveniencia->'calculo_liquido') then
        raise exception 'NFSE_CORRECTION_SCOPE_INVALID' using errcode='23514';
      end if;
      return new;
    end if;
    if row(new.tipo_documento_fiscal,new.valor_liquido_origem,new.fiscal_proveniencia,new.valor_bruto,
      new.valor_liquido,new.numero_nf,new.chave_acesso,new.data_emissao,new.cnpj_emitente,new.cnpj_destinatario)
      is distinct from row(old.tipo_documento_fiscal,old.valor_liquido_origem,old.fiscal_proveniencia,old.valor_bruto,
      old.valor_liquido,old.numero_nf,old.chave_acesso,old.data_emissao,old.cnpj_emitente,old.cnpj_destinatario) then
      raise exception 'NFSE_FISCAL_FACTS_IMMUTABLE' using errcode='23514';
    end if;
    if new.data_vencimento is distinct from old.data_vencimento then
      if old.status::text <> 'rascunho' then raise exception 'NFSE_DUE_REQUIRES_DRAFT' using errcode='23514'; end if;
      new.vencimento_origem := 'MANUAL';
    elsif new.vencimento_origem is distinct from old.vencimento_origem then
      raise exception 'NFSE_DUE_SOURCE_IMMUTABLE' using errcode='23514';
    end if;
  elsif new.tipo_documento_fiscal = 'NFSE' then
    raise exception 'NFSE_LEGACY_REINTERPRETATION_DENIED' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function private.auditar_vencimento_nfse()
returns trigger language plpgsql security definer set search_path = '' as $$
declare anterior date;
begin
  if new.tipo_documento_fiscal is distinct from 'NFSE' or new.vencimento_origem <> 'MANUAL' then return new; end if;
  if tg_op='UPDATE' then
    if new.data_vencimento is not distinct from old.data_vencimento then return new; end if;
    anterior := old.data_vencimento;
    -- The private maintenance routine writes one combined before/after event atomically.
    if session_user='postgres' and current_setting('app.nfse_correction_id',true)=new.id::text then return new; end if;
  end if;
  if auth.uid() is null then raise exception 'NFSE_MANUAL_DUE_REQUIRES_ACTOR' using errcode='42501'; end if;
  insert into public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois,origem)
  values(auth.uid(),'NFSE_VENCIMENTO_MANUAL','notas_fiscais',new.id,
    jsonb_build_object('data_vencimento',anterior,'source',case when anterior is null then 'MISSING' else old.vencimento_origem end),
    jsonb_build_object('data_vencimento',new.data_vencimento,'source','MANUAL','contexto',
      case when tg_op='INSERT' then 'upload_review' else 'draft_review' end),'nfse_review');
  return new;
end $$;

-- Privileged support operation, not an application RPC. No grant to service_role or authenticated.
-- Optimistic checksum + row lock + no operation/parcel links. Missing-net completion only.
create function private.corrigir_nfse_liquido_ausente(
  p_nf uuid,p_expected_hash text,p_document_hash text,p_calculo jsonb,p_vencimento date,p_motivo text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare before_row public.notas_fiscais; after_row public.notas_fiscais;
  correlation text := gen_random_uuid()::text; previous_flag text;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'NFSE_MAINTENANCE_ONLY' using errcode='42501'; end if;
  if p_motivo is null or length(btrim(p_motivo)) not between 20 and 1000 or p_vencimento is null then
    raise exception 'NFSE_CORRECTION_REASON_REQUIRED'; end if;
  select * into strict before_row from public.notas_fiscais where id=p_nf for update;
  if p_expected_hash is null or md5(to_jsonb(before_row)::text) <> p_expected_hash
    or p_document_hash is null or before_row.fiscal_proveniencia->>'sha256' is distinct from p_document_hash then
    raise exception 'NFSE_CORRECTION_BASELINE_CHANGED'; end if;
  if before_row.tipo_documento_fiscal is distinct from 'NFSE'
    or before_row.status::text not in ('rascunho','requer_ajuste')
    or before_row.valor_liquido is not null or before_row.valor_liquido_origem is distinct from 'NAO_INFORMADO'
    or before_row.fiscal_proveniencia ? 'calculo_liquido'
    or p_vencimento < before_row.data_emissao or p_vencimento < (now() at time zone 'America/Sao_Paulo')::date
    or not private.nfse_calculo_liquido_valido(before_row.valor_bruto,(p_calculo->>'liquido')::numeric,p_calculo) then
    raise exception 'NFSE_CORRECTION_NOT_ELIGIBLE'; end if;
  if exists(select 1 from public.operacoes_nfs where nota_fiscal_id=p_nf)
    or exists(select 1 from public.operacoes_nf_parcelas where nota_fiscal_id=p_nf)
    or exists(select 1 from public.nota_fiscal_parcelas where nota_fiscal_id=p_nf)
    or exists(select 1 from public.operacao_calculo_nfs where nota_fiscal_id=p_nf)
    or exists(select 1 from public.duplicatas where nota_fiscal_id=p_nf) then
    raise exception 'NFSE_CORRECTION_FINANCIAL_LINK_EXISTS'; end if;
  previous_flag := current_setting('app.nfse_correction_id',true);
  perform set_config('app.nfse_correction_id',p_nf::text,true);
  update public.notas_fiscais set valor_liquido=(p_calculo->>'liquido')::numeric,
    valor_liquido_origem='CALCULADO_RETENCOES',data_vencimento=p_vencimento,vencimento_origem='MANUAL',
    fiscal_proveniencia=before_row.fiscal_proveniencia || jsonb_build_object('calculo_liquido',p_calculo)
    where id=p_nf returning * into strict after_row;
  perform set_config('app.nfse_correction_id',coalesce(previous_flag,''),true);
  insert into public.logs_auditoria(usuario_id,ator_tipo,ator_identificador,origem,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
    values(null,'sistema','suporte_autorizado','nfse_correcao_controlada','NFSE_CORRECAO_FISCAL','notas_fiscais',p_nf,
      jsonb_build_object('valor_liquido',before_row.valor_liquido,'valor_liquido_origem',before_row.valor_liquido_origem,
        'data_vencimento',before_row.data_vencimento,'fiscal_proveniencia',before_row.fiscal_proveniencia),
      jsonb_build_object('valor_liquido',after_row.valor_liquido,'valor_liquido_origem',after_row.valor_liquido_origem,
        'data_vencimento',after_row.data_vencimento,'calculo_liquido',p_calculo,'motivo',p_motivo,
        'document_sha256',p_document_hash,'correlation_id',correlation,'executor_db',session_user));
  insert into public.eventos_dominio(fundo_id,cedente_id,cedente_fundo_id,nota_fiscal_id,tipo_evento,categoria,
    ator_nome_snapshot,ator_perfil_snapshot,origem,descricao,metadata,visibilidade,correlation_id)
    values(before_row.fundo_id,before_row.cedente_id,before_row.cedente_fundo_id,p_nf,'NFSE_CORRECAO_FISCAL','documento',
      'Suporte autorizado','Sistema','nfse_correcao_controlada',
      'Liquido fiscal calculado pelas retencoes do documento e vencimento corrigido. Aguardando resubmissao pelo cedente.',
      jsonb_build_object('valor_liquido',after_row.valor_liquido,'data_vencimento',after_row.data_vencimento),
      'ambos',correlation);
  return jsonb_build_object('status',after_row.status,'valor_liquido',after_row.valor_liquido,
    'data_vencimento',after_row.data_vencimento,'correlation_id',correlation,'row_hash',md5(to_jsonb(after_row)::text));
end $$;
revoke all on function private.corrigir_nfse_liquido_ausente(uuid,text,text,jsonb,date,text) from public,anon,authenticated,service_role;

create or replace function private.resolver_valor_base_antecipacao(
  p_base text,p_bruto numeric,p_liquido numeric,p_origem text,p_parcelada boolean
) returns numeric language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_base is null or p_base not in ('BRUTO','LIQUIDO') or p_bruto is null or p_bruto <= 0
    or p_bruto::text in ('NaN','Infinity','-Infinity') then raise exception 'Base de antecipacao invalida'; end if;
  if p_base='BRUTO' then return p_bruto; end if;
  if p_parcelada is distinct from false then raise exception 'Antecipacao pelo valor liquido indisponivel para notas parceladas'; end if;
  if p_origem is null or p_origem not in ('DOCUMENTO_EXPLICITO','CALCULADO_RETENCOES') or p_liquido is null
    or p_liquido <= 0 or p_liquido > p_bruto or p_liquido::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas'; end if;
  return p_liquido;
end $$;
commit;
