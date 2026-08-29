-- Preserva no e-mail operacional o nome visivel da gestora do fundo.
-- O endereco autenticado continua protegido na configuracao SMTP do ambiente.

alter table public.comunicacoes
  add column if not exists remetente_nome text;

update public.comunicacoes c
set remetente_nome = coalesce(
  nullif(btrim(regexp_replace(f.gestora_nome, E'[[:space:]]+(LTDA\\.?|LIMITADA)$', '', 'i')), ''),
  'BETTER WITH'
)
from public.fundos f
where f.id = c.fundo_id
  and nullif(btrim(c.remetente_nome), '') is null;

update public.comunicacoes
set remetente_nome = 'BETTER WITH'
where nullif(btrim(remetente_nome), '') is null;

alter table public.comunicacoes
  alter column remetente_nome set default 'BETTER WITH',
  alter column remetente_nome set not null;

alter table public.comunicacoes
  drop constraint if exists comunicacoes_remetente_nome_check;

alter table public.comunicacoes
  add constraint comunicacoes_remetente_nome_check check (
    char_length(btrim(remetente_nome)) between 1 and 120
    and remetente_nome !~ E'[\\r\\n]'
  );

create or replace function public.registrar_comunicacao_operacional(
  p_comunicacao jsonb,
  p_itens jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_comunicacao_id uuid;
  v_item jsonb;
  v_estagio_id uuid;
  v_itens_inseridos integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Acesso restrito ao job interno'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Comunicacao sem itens nao e permitida';
  end if;

  insert into public.comunicacoes(
    fundo_id, configuracao_versao_id, template_versao_id, execucao_id,
    familia, categoria, status, remetente_nome, destinatario_nome, destinatario_email,
    destinatario_hash, copias, assunto, corpo_html, corpo_texto,
    conteudo_hash, message_id, idempotency_key, data_efetiva, bloqueio_motivo
  ) values (
    (p_comunicacao ->> 'fundo_id')::uuid,
    (p_comunicacao ->> 'configuracao_versao_id')::uuid,
    (p_comunicacao ->> 'template_versao_id')::uuid,
    nullif(p_comunicacao ->> 'execucao_id', '')::uuid,
    p_comunicacao ->> 'familia', p_comunicacao ->> 'categoria',
    p_comunicacao ->> 'status',
    coalesce(nullif(btrim(p_comunicacao ->> 'remetente_nome'), ''), 'BETTER WITH'),
    p_comunicacao ->> 'destinatario_nome',
    nullif(p_comunicacao ->> 'destinatario_email', ''),
    nullif(p_comunicacao ->> 'destinatario_hash', ''),
    coalesce(p_comunicacao -> 'copias', '[]'::jsonb),
    p_comunicacao ->> 'assunto', p_comunicacao ->> 'corpo_html',
    p_comunicacao ->> 'corpo_texto', p_comunicacao ->> 'conteudo_hash',
    p_comunicacao ->> 'message_id', p_comunicacao ->> 'idempotency_key',
    (p_comunicacao ->> 'data_efetiva')::date,
    nullif(p_comunicacao ->> 'bloqueio_motivo', '')
  )
  on conflict (idempotency_key) do nothing
  returning id into v_comunicacao_id;

  if v_comunicacao_id is null then
    select id into v_comunicacao_id
    from public.comunicacoes
    where idempotency_key = p_comunicacao ->> 'idempotency_key';
    return v_comunicacao_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    insert into public.comunicacao_item_estagios(
      fundo_id, familia, item_key, etapa, data_obrigacao, data_nominal,
      data_efetiva, motivo_ajuste, status, comunicacao_id, rejeicao_versao_id
    ) values (
      (p_comunicacao ->> 'fundo_id')::uuid,
      p_comunicacao ->> 'familia', v_item ->> 'item_key', v_item ->> 'etapa',
      (v_item ->> 'data_obrigacao')::date, (v_item ->> 'data_nominal')::date,
      (v_item ->> 'data_efetiva')::date, nullif(v_item ->> 'motivo_ajuste', ''),
      'PENDENTE', v_comunicacao_id, nullif(v_item ->> 'rejeicao_versao_id', '')::uuid
    )
    on conflict (fundo_id, familia, item_key, etapa) do nothing
    returning id into v_estagio_id;

    if v_estagio_id is not null then
      insert into public.comunicacao_itens(
        comunicacao_id, fundo_id, familia, item_key, entidade_tipo, entidade_id,
        nota_fiscal_id, operacao_id, etapa, data_obrigacao, data_nominal,
        data_efetiva, motivo_ajuste, snapshot
      ) values (
        v_comunicacao_id, (p_comunicacao ->> 'fundo_id')::uuid,
        p_comunicacao ->> 'familia', v_item ->> 'item_key',
        v_item ->> 'entidade_tipo', nullif(v_item ->> 'entidade_id', '')::uuid,
        nullif(v_item ->> 'nota_fiscal_id', '')::uuid,
        nullif(v_item ->> 'operacao_id', '')::uuid,
        v_item ->> 'etapa', (v_item ->> 'data_obrigacao')::date,
        (v_item ->> 'data_nominal')::date, (v_item ->> 'data_efetiva')::date,
        nullif(v_item ->> 'motivo_ajuste', ''), coalesce(v_item -> 'snapshot', '{}'::jsonb)
      );
      v_itens_inseridos := v_itens_inseridos + 1;
    end if;
    v_estagio_id := null;
  end loop;

  if v_itens_inseridos = 0 then
    delete from public.comunicacoes where id = v_comunicacao_id and status = 'PENDENTE';
    return null;
  end if;
  return v_comunicacao_id;
end;
$$;

revoke all on function public.registrar_comunicacao_operacional(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_comunicacao_operacional(jsonb, jsonb) to service_role;

comment on column public.comunicacoes.remetente_nome is
  'Snapshot do nome visivel da gestora usado no cabecalho From; o endereco SMTP permanece em segredo de ambiente.';
