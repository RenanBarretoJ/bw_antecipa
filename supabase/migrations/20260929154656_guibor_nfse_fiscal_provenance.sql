-- GUIBOR A4: additive facts only. No financial/history backfill; due date stays NOT NULL.
begin;
alter table public.notas_fiscais
  add column tipo_documento_fiscal text,
  add column valor_liquido_origem text,
  add column vencimento_origem text,
  add column fiscal_proveniencia jsonb;

alter table public.notas_fiscais
  add constraint nf_tipo_fiscal_check check (tipo_documento_fiscal in ('NFE', 'NFSE')),
  add constraint nf_liquido_origem_check check (valor_liquido_origem in ('DOCUMENTO_EXPLICITO', 'LEGACY_BRUTO', 'NAO_INFORMADO')),
  add constraint nf_vencimento_origem_check check (vencimento_origem in ('DOCUMENT', 'MANUAL')),
  add constraint nfse_fatos_check check (tipo_documento_fiscal is distinct from 'NFSE' or (
    chave_acesso is not null and chave_acesso ~ '^[0-9]{50}$'
    and chave_acesso !~ '^([0-9])\1{49}$'
    and valor_liquido_origem is not null
    and ((valor_liquido_origem = 'DOCUMENTO_EXPLICITO' and valor_liquido is not null and valor_liquido > 0 and valor_liquido <= valor_bruto)
      or (valor_liquido_origem = 'NAO_INFORMADO' and valor_liquido is null))
    and vencimento_origem is not null and data_vencimento >= data_emissao
    and fiscal_proveniencia is not null and jsonb_typeof(fiscal_proveniencia) = 'object'
    and fiscal_proveniencia ?& array['strategy', 'source', 'competencia', 'sha256', 'vencimento_documento']
    and fiscal_proveniencia->>'strategy' in ('danfse_v2_labels', 'danfse_v2_visual')
    and fiscal_proveniencia->>'source' in ('PDF_TEXT_NATIVE', 'PDF_VISUAL_FALLBACK')
    and fiscal_proveniencia->>'sha256' ~ '^[0-9a-f]{64}$'
  ) is true);

comment on column public.notas_fiscais.valor_liquido_origem is
  'NULL = origem legada nao certificada; DOCUMENTO_EXPLICITO somente liquido fiscal impresso. Nao e desconto financeiro.';

create function private.guibor_proteger_fatos_nfse()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.tipo_documento_fiscal = 'NFSE' then
    if row(new.tipo_documento_fiscal, new.valor_liquido_origem, new.fiscal_proveniencia,
      new.valor_bruto, new.valor_liquido, new.numero_nf, new.chave_acesso, new.data_emissao,
      new.cnpj_emitente, new.cnpj_destinatario)
      is distinct from row(old.tipo_documento_fiscal, old.valor_liquido_origem, old.fiscal_proveniencia,
      old.valor_bruto, old.valor_liquido, old.numero_nf, old.chave_acesso, old.data_emissao,
      old.cnpj_emitente, old.cnpj_destinatario) then
      raise exception 'NFSE_FISCAL_FACTS_IMMUTABLE' using errcode = '23514';
    end if;
    if new.data_vencimento is distinct from old.data_vencimento then
      if old.status::text <> 'rascunho' then
        raise exception 'NFSE_DUE_REQUIRES_DRAFT' using errcode = '23514';
      end if;
      new.vencimento_origem := 'MANUAL';
    elsif new.vencimento_origem is distinct from old.vencimento_origem then
      raise exception 'NFSE_DUE_SOURCE_IMMUTABLE' using errcode = '23514';
    end if;
  elsif new.tipo_documento_fiscal = 'NFSE' then
    raise exception 'NFSE_LEGACY_REINTERPRETATION_DENIED' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guibor_proteger_fatos_nfse() from public, anon, authenticated;
create trigger guibor_proteger_fatos_nfse before update on public.notas_fiscais
  for each row execute function private.guibor_proteger_fatos_nfse();

-- Atomic audit, after RLS-authorized NF mutation. Not callable as an RPC.
create function private.guibor_auditar_vencimento_nfse()
returns trigger language plpgsql security definer set search_path = '' as $$
declare anterior date;
begin
  if new.tipo_documento_fiscal is distinct from 'NFSE' or new.vencimento_origem <> 'MANUAL' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.data_vencimento is not distinct from old.data_vencimento then return new; end if;
    anterior := old.data_vencimento;
  end if;
  if auth.uid() is null then raise exception 'NFSE_MANUAL_DUE_REQUIRES_ACTOR' using errcode = '42501'; end if;
  insert into public.logs_auditoria(usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois, origem)
  values (auth.uid(), 'NFSE_VENCIMENTO_MANUAL', 'notas_fiscais', new.id,
    jsonb_build_object('data_vencimento', anterior, 'source', case when anterior is null then 'MISSING' else old.vencimento_origem end),
    jsonb_build_object('data_vencimento', new.data_vencimento, 'source', 'MANUAL', 'contexto',
      case when tg_op = 'INSERT' then 'upload_review' else 'draft_review' end), 'guibor_nfse_review');
  return new;
end $$;
revoke all on function private.guibor_auditar_vencimento_nfse() from public, anon, authenticated;
create trigger guibor_auditar_vencimento_nfse after insert or update on public.notas_fiscais
  for each row execute function private.guibor_auditar_vencimento_nfse();
commit;
