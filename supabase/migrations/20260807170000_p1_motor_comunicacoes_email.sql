-- P1 - motor generico de alertas, lembretes e cobrancas por e-mail.
-- A migration cria somente estrutura e defaults de dominio. Nenhum fundo e
-- ativado e nenhuma comunicacao operacional e gerada durante a aplicacao.

begin;

create table public.comunicacao_configuracoes (
  id uuid primary key default gen_random_uuid(),
  fundo_id uuid not null references public.fundos(id) on delete restrict,
  pausada boolean not null default false,
  criada_por uuid not null references public.profiles(id) on delete restrict,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint comunicacao_configuracoes_fundo_unique unique (fundo_id)
);

create table public.comunicacao_configuracao_versoes (
  id uuid primary key default gen_random_uuid(),
  configuracao_id uuid not null references public.comunicacao_configuracoes(id) on delete cascade,
  fundo_id uuid not null references public.fundos(id) on delete restrict,
  numero_versao integer not null check (numero_versao > 0),
  status text not null default 'rascunho' check (status in ('rascunho', 'publicada', 'inativa')),
  logistica_habilitada boolean not null default false,
  cte_habilitado boolean not null default true,
  comprovante_habilitado boolean not null default true,
  financeiro_habilitado boolean not null default false,
  regua_logistica jsonb not null default '{"offsets":[-5,-3,-1,0,1,3],"recorrencia_apos":3,"recorrencia_dias":3}'::jsonb,
  regua_financeira jsonb not null default '{"offsets":[-7,-3,-1,0,1,3,5,7],"recorrencia_apos":7,"recorrencia_dias":3}'::jsonb,
  somente_dias_uteis boolean not null default true check (somente_dias_uteis),
  horario_envio time not null default '08:00:00',
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  ativada_em timestamptz,
  publicada_em timestamptz,
  publicada_por uuid references public.profiles(id) on delete restrict,
  criada_por uuid not null references public.profiles(id) on delete restrict,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint comunicacao_config_versoes_numero_unique unique (configuracao_id, numero_versao),
  constraint comunicacao_config_versoes_fundo_consistente unique (id, fundo_id),
  constraint comunicacao_regua_logistica_shape check (
    jsonb_typeof(regua_logistica -> 'offsets') = 'array'
    and coalesce((regua_logistica ->> 'recorrencia_dias')::integer, 0) >= 1
  ),
  constraint comunicacao_regua_financeira_shape check (
    jsonb_typeof(regua_financeira -> 'offsets') = 'array'
    and coalesce((regua_financeira ->> 'recorrencia_dias')::integer, 0) >= 1
  )
);

create unique index comunicacao_config_versao_publicada_unique
  on public.comunicacao_configuracao_versoes(configuracao_id)
  where status = 'publicada';
create index comunicacao_config_versoes_fundo_status_idx
  on public.comunicacao_configuracao_versoes(fundo_id, status, numero_versao desc);

create table public.comunicacao_template_versoes (
  id uuid primary key default gen_random_uuid(),
  configuracao_versao_id uuid not null,
  fundo_id uuid not null,
  categoria text not null check (categoria in (
    'LOGISTICA_LEMBRETE', 'LOGISTICA_VENCE_HOJE', 'LOGISTICA_VENCIDO', 'LOGISTICA_REJEITADO',
    'FINANCEIRO_LEMBRETE', 'FINANCEIRO_VENCE_HOJE', 'FINANCEIRO_VENCIDO'
  )),
  modo text not null default 'padrao' check (modo in ('padrao', 'personalizado')),
  assunto text,
  corpo_html text,
  corpo_texto text,
  conteudo_hash text not null,
  criada_por uuid not null references public.profiles(id) on delete restrict,
  criada_em timestamptz not null default now(),
  constraint comunicacao_template_config_fundo_fk
    foreign key (configuracao_versao_id, fundo_id)
    references public.comunicacao_configuracao_versoes(id, fundo_id) on delete cascade,
  constraint comunicacao_template_categoria_unique unique (configuracao_versao_id, categoria),
  constraint comunicacao_template_personalizado_preenchido check (
    modo = 'padrao'
    or (nullif(btrim(assunto), '') is not null
      and nullif(btrim(corpo_html), '') is not null
      and nullif(btrim(corpo_texto), '') is not null)
  )
);

create index comunicacao_templates_fundo_idx
  on public.comunicacao_template_versoes(fundo_id, categoria);

create table public.comunicacao_execucoes (
  id uuid primary key default gen_random_uuid(),
  data_referencia date not null,
  modo text not null default 'producao' check (modo in ('producao', 'controlado')),
  status text not null default 'PROCESSANDO' check (status in ('PROCESSANDO', 'CONCLUIDA', 'FALHA')),
  encontrada integer not null default 0,
  agrupada integer not null default 0,
  enviada integer not null default 0,
  falha integer not null default 0,
  bloqueada integer not null default 0,
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz,
  erro_sanitizado text
);
create index comunicacao_execucoes_data_idx
  on public.comunicacao_execucoes(data_referencia desc, iniciada_em desc);

create table public.comunicacoes (
  id uuid primary key default gen_random_uuid(),
  fundo_id uuid not null references public.fundos(id) on delete restrict,
  configuracao_versao_id uuid not null,
  template_versao_id uuid not null references public.comunicacao_template_versoes(id) on delete restrict,
  execucao_id uuid references public.comunicacao_execucoes(id) on delete set null,
  familia text not null check (familia in ('LOGISTICA', 'FINANCEIRO')),
  categoria text not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'PROCESSANDO', 'ENVIADA', 'FALHA', 'BLOQUEADA', 'CANCELADA')),
  destinatario_nome text not null,
  destinatario_email text,
  destinatario_hash text,
  copias jsonb not null default '[]'::jsonb check (jsonb_typeof(copias) = 'array'),
  assunto text not null,
  corpo_html text not null,
  corpo_texto text not null,
  conteudo_hash text not null,
  message_id text not null,
  idempotency_key text not null,
  data_efetiva date not null,
  bloqueio_motivo text,
  provider_id text,
  criada_em timestamptz not null default now(),
  enviada_em timestamptz,
  atualizada_em timestamptz not null default now(),
  constraint comunicacoes_config_fundo_fk
    foreign key (configuracao_versao_id, fundo_id)
    references public.comunicacao_configuracao_versoes(id, fundo_id) on delete restrict,
  constraint comunicacoes_idempotency_unique unique (idempotency_key),
  constraint comunicacoes_message_id_unique unique (message_id),
  constraint comunicacoes_destinatario_status check (
    (status = 'BLOQUEADA' and nullif(btrim(bloqueio_motivo), '') is not null)
    or (status <> 'BLOQUEADA' and nullif(btrim(destinatario_email), '') is not null)
  )
);
create index comunicacoes_fundo_data_idx on public.comunicacoes(fundo_id, criada_em desc);
create index comunicacoes_status_retry_idx on public.comunicacoes(status, atualizada_em)
  where status in ('PENDENTE', 'FALHA');

create table public.comunicacao_itens (
  id uuid primary key default gen_random_uuid(),
  comunicacao_id uuid not null references public.comunicacoes(id) on delete cascade,
  fundo_id uuid not null references public.fundos(id) on delete restrict,
  familia text not null check (familia in ('LOGISTICA', 'FINANCEIRO')),
  item_key text not null,
  entidade_tipo text not null,
  entidade_id uuid,
  nota_fiscal_id uuid references public.notas_fiscais(id) on delete restrict,
  operacao_id uuid references public.operacoes(id) on delete restrict,
  etapa text not null,
  data_obrigacao date not null,
  data_nominal date not null,
  data_efetiva date not null,
  motivo_ajuste text,
  snapshot jsonb not null default '{}'::jsonb,
  criada_em timestamptz not null default now(),
  constraint comunicacao_itens_comunicacao_item_unique unique (comunicacao_id, item_key, etapa)
);
create index comunicacao_itens_fundo_item_idx on public.comunicacao_itens(fundo_id, item_key, criada_em desc);

create table public.comunicacao_item_estagios (
  id uuid primary key default gen_random_uuid(),
  fundo_id uuid not null references public.fundos(id) on delete restrict,
  familia text not null check (familia in ('LOGISTICA', 'FINANCEIRO')),
  item_key text not null,
  etapa text not null,
  data_obrigacao date not null,
  data_nominal date not null,
  data_efetiva date not null,
  motivo_ajuste text,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'COMUNICADO', 'NAO_APLICAVEL', 'CANCELADO')),
  comunicacao_id uuid references public.comunicacoes(id) on delete restrict,
  rejeicao_versao_id uuid references public.documento_versoes(id) on delete restrict,
  criada_em timestamptz not null default now(),
  comunicada_em timestamptz,
  constraint comunicacao_item_estagios_unique unique (fundo_id, familia, item_key, etapa)
);
create index comunicacao_item_estagios_pendentes_idx
  on public.comunicacao_item_estagios(fundo_id, status, data_efetiva);

create table public.comunicacao_tentativas (
  id uuid primary key default gen_random_uuid(),
  comunicacao_id uuid not null references public.comunicacoes(id) on delete cascade,
  numero_tentativa integer not null check (numero_tentativa between 1 and 3),
  status text not null check (status in ('PROCESSANDO', 'ENVIADA', 'FALHA')),
  provider text not null default 'resend',
  provider_id text,
  erro_codigo text,
  erro_sanitizado text,
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz,
  constraint comunicacao_tentativas_numero_unique unique (comunicacao_id, numero_tentativa)
);

create or replace function private.proteger_configuracao_comunicacao_publicada()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE' and old.status in ('publicada', 'inativa') then
    raise exception 'Versoes publicadas de comunicacao sao imutaveis';
  end if;
  if tg_op = 'UPDATE' and old.status in ('publicada', 'inativa') then
    if not (
      old.status = 'publicada'
      and new.status = 'inativa'
      and (to_jsonb(new) - 'status' - 'atualizada_em') = (to_jsonb(old) - 'status' - 'atualizada_em')
    ) then
      raise exception 'Versoes publicadas de comunicacao sao imutaveis';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger comunicacao_config_versao_imutavel
before update or delete on public.comunicacao_configuracao_versoes
for each row execute function private.proteger_configuracao_comunicacao_publicada();

create or replace function private.proteger_template_comunicacao_publicado()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.comunicacao_configuracao_versoes
  where id = coalesce(new.configuracao_versao_id, old.configuracao_versao_id);
  if v_status in ('publicada', 'inativa') then
    raise exception 'Templates de configuracao publicada sao imutaveis';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger comunicacao_template_imutavel
before insert or update or delete on public.comunicacao_template_versoes
for each row execute function private.proteger_template_comunicacao_publicado();

create or replace function public.criar_rascunho_configuracao_comunicacoes(
  p_fundo_id uuid,
  p_base_versao_id uuid,
  p_templates_padrao jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_configuracao_id uuid;
  v_versao_id uuid;
  v_numero integer;
  v_base public.comunicacao_configuracao_versoes;
  v_template jsonb;
begin
  if auth.uid() is null or not private.usuario_pode_administrar_fundo_ativo(p_fundo_id) then
    raise exception 'Acesso negado ao fundo informado';
  end if;

  insert into public.comunicacao_configuracoes(fundo_id, criada_por)
  values (p_fundo_id, auth.uid())
  on conflict (fundo_id) do nothing;

  select id into v_configuracao_id
  from public.comunicacao_configuracoes
  where fundo_id = p_fundo_id
  for update;

  select id into v_versao_id
  from public.comunicacao_configuracao_versoes
  where configuracao_id = v_configuracao_id and status = 'rascunho'
  order by numero_versao desc
  limit 1;
  if v_versao_id is not null then return v_versao_id; end if;

  if p_base_versao_id is not null then
    select * into v_base
    from public.comunicacao_configuracao_versoes
    where id = p_base_versao_id and configuracao_id = v_configuracao_id;
    if not found then raise exception 'Versao base nao pertence ao fundo informado'; end if;
  else
    select * into v_base
    from public.comunicacao_configuracao_versoes
    where configuracao_id = v_configuracao_id and status = 'publicada'
    order by numero_versao desc
    limit 1;
  end if;

  select coalesce(max(numero_versao), 0) + 1 into v_numero
  from public.comunicacao_configuracao_versoes
  where configuracao_id = v_configuracao_id;

  insert into public.comunicacao_configuracao_versoes(
    configuracao_id, fundo_id, numero_versao, logistica_habilitada,
    cte_habilitado, comprovante_habilitado, financeiro_habilitado,
    regua_logistica, regua_financeira, criada_por
  ) values (
    v_configuracao_id, p_fundo_id, v_numero,
    coalesce(v_base.logistica_habilitada, false),
    coalesce(v_base.cte_habilitado, true),
    coalesce(v_base.comprovante_habilitado, true),
    coalesce(v_base.financeiro_habilitado, false),
    coalesce(v_base.regua_logistica, '{"offsets":[-5,-3,-1,0,1,3],"recorrencia_apos":3,"recorrencia_dias":3}'::jsonb),
    coalesce(v_base.regua_financeira, '{"offsets":[-7,-3,-1,0,1,3,5,7],"recorrencia_apos":7,"recorrencia_dias":3}'::jsonb),
    auth.uid()
  ) returning id into v_versao_id;

  if v_base.id is not null then
    insert into public.comunicacao_template_versoes(
      configuracao_versao_id, fundo_id, categoria, modo, assunto,
      corpo_html, corpo_texto, conteudo_hash, criada_por
    )
    select v_versao_id, p_fundo_id, categoria, modo, assunto,
      corpo_html, corpo_texto, conteudo_hash, auth.uid()
    from public.comunicacao_template_versoes
    where configuracao_versao_id = v_base.id;
  else
    if jsonb_typeof(p_templates_padrao) <> 'array' or jsonb_array_length(p_templates_padrao) <> 7 then
      raise exception 'Os sete templates padrao sao obrigatorios';
    end if;
    for v_template in select value from jsonb_array_elements(p_templates_padrao)
    loop
      insert into public.comunicacao_template_versoes(
        configuracao_versao_id, fundo_id, categoria, modo, conteudo_hash, criada_por
      ) values (
        v_versao_id, p_fundo_id, v_template ->> 'categoria', 'padrao',
        v_template ->> 'conteudo_hash', auth.uid()
      );
    end loop;
  end if;

  return v_versao_id;
end;
$$;

create or replace function public.publicar_configuracao_comunicacoes(p_versao_id uuid)
returns public.comunicacao_configuracao_versoes
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_versao public.comunicacao_configuracao_versoes;
  v_categorias integer;
begin
  select * into v_versao
  from public.comunicacao_configuracao_versoes
  where id = p_versao_id
  for update;
  if not found then raise exception 'Versao de comunicacao nao encontrada'; end if;
  if auth.uid() is null or not private.usuario_pode_administrar_fundo_ativo(v_versao.fundo_id) then
    raise exception 'Acesso negado ao fundo informado';
  end if;
  if v_versao.status <> 'rascunho' then raise exception 'Somente rascunhos podem ser publicados'; end if;

  select count(*) into v_categorias
  from public.comunicacao_template_versoes
  where configuracao_versao_id = p_versao_id;
  if v_categorias <> 7 then raise exception 'A configuracao deve possuir os sete templates obrigatorios'; end if;

  update public.comunicacao_configuracao_versoes
  set status = 'inativa', atualizada_em = now()
  where configuracao_id = v_versao.configuracao_id and status = 'publicada';

  update public.comunicacao_configuracao_versoes
  set status = 'publicada', ativada_em = coalesce(ativada_em, now()),
      publicada_em = now(), publicada_por = auth.uid(), atualizada_em = now()
  where id = p_versao_id
  returning * into v_versao;
  return v_versao;
end;
$$;

create or replace function public.iniciar_execucao_comunicacoes(p_data_referencia date)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Acesso restrito ao job interno'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bw-antecipa:comunicacoes', 0));
  if exists (
    select 1 from public.comunicacao_execucoes
    where status = 'PROCESSANDO' and iniciada_em > now() - interval '30 minutes'
  ) then return null; end if;
  insert into public.comunicacao_execucoes(data_referencia)
  values (p_data_referencia)
  returning id into v_id;
  return v_id;
end;
$$;

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
    familia, categoria, status, destinatario_nome, destinatario_email,
    destinatario_hash, copias, assunto, corpo_html, corpo_texto,
    conteudo_hash, message_id, idempotency_key, data_efetiva, bloqueio_motivo
  ) values (
    (p_comunicacao ->> 'fundo_id')::uuid,
    (p_comunicacao ->> 'configuracao_versao_id')::uuid,
    (p_comunicacao ->> 'template_versao_id')::uuid,
    nullif(p_comunicacao ->> 'execucao_id', '')::uuid,
    p_comunicacao ->> 'familia', p_comunicacao ->> 'categoria',
    p_comunicacao ->> 'status', p_comunicacao ->> 'destinatario_nome',
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

alter table public.comunicacao_configuracoes enable row level security;
alter table public.comunicacao_configuracao_versoes enable row level security;
alter table public.comunicacao_template_versoes enable row level security;
alter table public.comunicacao_execucoes enable row level security;
alter table public.comunicacoes enable row level security;
alter table public.comunicacao_itens enable row level security;
alter table public.comunicacao_item_estagios enable row level security;
alter table public.comunicacao_tentativas enable row level security;

create policy comunicacao_config_select on public.comunicacao_configuracoes for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_config_insert on public.comunicacao_configuracoes for insert to authenticated
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)) and criada_por = (select auth.uid()));
create policy comunicacao_config_update on public.comunicacao_configuracoes for update to authenticated
using ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)))
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)));

create policy comunicacao_versao_select on public.comunicacao_configuracao_versoes for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_versao_insert on public.comunicacao_configuracao_versoes for insert to authenticated
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)) and criada_por = (select auth.uid()));
create policy comunicacao_versao_update on public.comunicacao_configuracao_versoes for update to authenticated
using ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)))
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)));
create policy comunicacao_versao_delete on public.comunicacao_configuracao_versoes for delete to authenticated
using ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)) and status = 'rascunho');

create policy comunicacao_template_select on public.comunicacao_template_versoes for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_template_insert on public.comunicacao_template_versoes for insert to authenticated
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)) and criada_por = (select auth.uid()));
create policy comunicacao_template_update on public.comunicacao_template_versoes for update to authenticated
using ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)))
with check ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)));
create policy comunicacao_template_delete on public.comunicacao_template_versoes for delete to authenticated
using ((select private.usuario_pode_administrar_fundo_ativo(fundo_id)));

create policy comunicacoes_select on public.comunicacoes for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_itens_select on public.comunicacao_itens for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_estagios_select on public.comunicacao_item_estagios for select to authenticated
using ((select private.usuario_tem_acesso_fundo(fundo_id)));
create policy comunicacao_tentativas_select on public.comunicacao_tentativas for select to authenticated
using (exists (
  select 1 from public.comunicacoes c
  where c.id = comunicacao_tentativas.comunicacao_id
    and (select private.usuario_tem_acesso_fundo(c.fundo_id))
));

revoke all on table public.comunicacao_configuracoes from anon, authenticated;
revoke all on table public.comunicacao_configuracao_versoes from anon, authenticated;
revoke all on table public.comunicacao_template_versoes from anon, authenticated;
revoke all on table public.comunicacao_execucoes from anon, authenticated;
revoke all on table public.comunicacoes from anon, authenticated;
revoke all on table public.comunicacao_itens from anon, authenticated;
revoke all on table public.comunicacao_item_estagios from anon, authenticated;
revoke all on table public.comunicacao_tentativas from anon, authenticated;

grant select, insert, update on table public.comunicacao_configuracoes to authenticated;
grant select, insert, update, delete on table public.comunicacao_configuracao_versoes to authenticated;
grant select, insert, update, delete on table public.comunicacao_template_versoes to authenticated;
grant select on table public.comunicacoes, public.comunicacao_itens,
  public.comunicacao_item_estagios, public.comunicacao_tentativas to authenticated;

revoke all on function public.publicar_configuracao_comunicacoes(uuid) from public, anon;
grant execute on function public.publicar_configuracao_comunicacoes(uuid) to authenticated;
revoke all on function public.criar_rascunho_configuracao_comunicacoes(uuid, uuid, jsonb) from public, anon;
grant execute on function public.criar_rascunho_configuracao_comunicacoes(uuid, uuid, jsonb) to authenticated;
revoke all on function public.iniciar_execucao_comunicacoes(date) from public, anon, authenticated;
grant execute on function public.iniciar_execucao_comunicacoes(date) to service_role;
revoke all on function public.registrar_comunicacao_operacional(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_comunicacao_operacional(jsonb, jsonb) to service_role;

comment on table public.comunicacao_configuracoes is 'Raiz da configuracao de comunicacoes por fundo; pausada interrompe novos envios sem apagar historico.';
comment on table public.comunicacao_configuracao_versoes is 'Versoes imutaveis das reguas logistica e financeira; a primeira publicacao define ativada_em.';
comment on table public.comunicacoes is 'Snapshot consolidado e idempotente do e-mail operacional, preservado para retry tecnico.';
comment on table public.comunicacao_item_estagios is 'Idempotencia por obrigacao e etapa nominal, independente do lote consolidado.';

commit;
