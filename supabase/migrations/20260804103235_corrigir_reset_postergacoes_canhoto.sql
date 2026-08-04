-- Mantem o reset de homologacao compativel com o historico imutavel de
-- postergacoes do comprovante de entrega, criado depois da RPC original.

begin;

do $$
begin
  if to_regprocedure('public.reset_operacional_fundo_homolog_sem_postergacoes(uuid,text,boolean,text,text)') is null then
    if to_regprocedure('public.reset_operacional_fundo_homolog(uuid,text,boolean,text,text)') is null then
      raise exception 'RPC public.reset_operacional_fundo_homolog nao encontrada';
    end if;

    alter function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
      rename to reset_operacional_fundo_homolog_sem_postergacoes;
  else
    drop function if exists public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text);
  end if;
end;
$$;

create or replace function public.reset_operacional_fundo_homolog(
  p_fundo_id uuid,
  p_modo text default 'preview',
  p_apagar_notas_fiscais boolean default true,
  p_confirmacao text default null,
  p_escopo text default 'operacional'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_resultado jsonb;
  v_lock_key bigint;
  v_postergacoes_antes integer := 0;
  v_postergacoes_depois integer := 0;
begin
  if p_modo not in ('preview', 'reset', 'validate') then
    raise exception 'Modo invalido: %. Use preview, reset ou validate.', p_modo;
  end if;

  if p_escopo not in ('operacional', 'completo') then
    raise exception 'Escopo invalido: %. Use operacional ou completo.', p_escopo;
  end if;

  if p_modo = 'reset' and p_confirmacao is distinct from 'RESETAR_HOMOLOG' then
    raise exception 'Confirmacao obrigatoria ausente. Informe p_confirmacao = RESETAR_HOMOLOG.';
  end if;

  if not exists (select 1 from public.fundos f where f.id = p_fundo_id) then
    raise exception 'Fundo % nao encontrado.', p_fundo_id;
  end if;

  v_lock_key := ('x' || substr(md5('bw_antecipa_reset_fundo:' || p_fundo_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*)::integer
    into v_postergacoes_antes
  from public.nota_fiscal_entrega_postergacoes_canhoto p
  where p.fundo_id = p_fundo_id;

  if p_modo = 'reset' and v_postergacoes_antes > 0 then
    begin
      alter table public.nota_fiscal_entrega_postergacoes_canhoto
        disable trigger postergacao_upload_canhoto_append_only;

      delete from public.nota_fiscal_entrega_postergacoes_canhoto p
      where p.fundo_id = p_fundo_id;

      alter table public.nota_fiscal_entrega_postergacoes_canhoto
        enable trigger postergacao_upload_canhoto_append_only;
    exception when others then
      alter table public.nota_fiscal_entrega_postergacoes_canhoto
        enable trigger postergacao_upload_canhoto_append_only;
      raise exception 'Reset operacional homolog abortado ao remover postergacoes: %', sqlerrm
        using errcode = sqlstate;
    end;
  end if;

  v_resultado := public.reset_operacional_fundo_homolog_sem_postergacoes(
    p_fundo_id,
    p_modo,
    p_apagar_notas_fiscais,
    p_confirmacao,
    p_escopo
  );

  select count(*)::integer
    into v_postergacoes_depois
  from public.nota_fiscal_entrega_postergacoes_canhoto p
  where p.fundo_id = p_fundo_id;

  if p_modo = 'preview' then
    return jsonb_set(
      v_resultado,
      '{contagens,postergacoes_canhoto}',
      to_jsonb(v_postergacoes_antes),
      true
    );
  end if;

  if p_modo = 'reset' then
    v_resultado := jsonb_set(
      v_resultado,
      '{contagens_antes,postergacoes_canhoto}',
      to_jsonb(v_postergacoes_antes),
      true
    );
    return jsonb_set(
      v_resultado,
      '{contagens_depois,postergacoes_canhoto_restantes}',
      to_jsonb(v_postergacoes_depois),
      true
    );
  end if;

  return v_resultado || jsonb_build_object(
    'postergacoes_canhoto_restantes',
    v_postergacoes_depois
  );
end;
$$;

comment on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text) is
  'Wrapper transacional de homologacao que remove postergacoes imutaveis antes do reset operacional do fundo.';

revoke all on function public.reset_operacional_fundo_homolog_sem_postergacoes(uuid, text, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  to service_role;

commit;
