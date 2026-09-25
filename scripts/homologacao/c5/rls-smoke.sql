\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'consultor-a-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'consultor-b-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, role, nome_completo, email, status)
values
  ('c5000000-0000-4000-8000-000000000001', 'consultor', 'Consultor A C5', 'consultor-a-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000002', 'consultor', 'Consultor B C5', 'consultor-b-c5@local.test', 'ativo');

insert into public.fundos (id, nome, cnpj, administradora_nome, administradora_cnpj, gestora_nome, gestora_cnpj, ativo)
values
  ('c5100000-0000-4000-8000-000000000001', 'Fundo A C5', '51000000000101', 'Admin A', '51000000000292', 'Gestora A', '51000000000373', true),
  ('c5100000-0000-4000-8000-000000000002', 'Fundo B C5', '51000000000454', 'Admin B', '51000000000535', 'Gestora B', '51000000000616', true);

insert into public.usuario_fundos (usuario_id, fundo_id, perfil_no_fundo, status)
values
  ('c5000000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'auditor', 'ativo'),
  ('c5000000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'auditor', 'ativo');

insert into public.cedentes (id, cnpj, razao_social, status, fundo_id)
values
  ('c5200000-0000-4000-8000-000000000001', '52000000000107', 'Cedente A1 C5', 'ativo', 'c5100000-0000-4000-8000-000000000001'),
  ('c5200000-0000-4000-8000-000000000002', '52000000000280', 'Cedente A2 Inativo C5', 'bloqueado', 'c5100000-0000-4000-8000-000000000001'),
  ('c5200000-0000-4000-8000-000000000003', '52000000000360', 'Cedente B1 C5', 'ativo', 'c5100000-0000-4000-8000-000000000002');

insert into public.cedente_fundos (id, cedente_id, fundo_id, status)
values
  ('c5300000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'ativo'),
  ('c5300000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000001', 'ativo'),
  ('c5300000-0000-4000-8000-000000000003', 'c5200000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000002', 'ativo');

insert into public.consultor_cedente (consultor_id, cedente_id, status)
values
  ('c5000000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'ativo'),
  ('c5000000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000002', 'ativo'),
  ('c5000000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000003', 'ativo');

insert into public.operacoes (
  id, cedente_id, valor_bruto_total, prazo_dias, data_vencimento, status, cedente_fundo_id
)
values
  ('c5400000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 1000, 30, current_date + 30, 'solicitada', 'c5300000-0000-4000-8000-000000000001'),
  ('c5400000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 2000, 30, current_date + 30, 'solicitada', 'c5300000-0000-4000-8000-000000000002'),
  ('c5400000-0000-4000-8000-000000000003', 'c5200000-0000-4000-8000-000000000003', 3000, 30, current_date + 30, 'solicitada', 'c5300000-0000-4000-8000-000000000003');

insert into public.eventos_dominio (
  id, fundo_id, cedente_id, cedente_fundo_id, operacao_id,
  tipo_evento, categoria, descricao, visibilidade
)
values
  ('c5500000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001', 'c5_publico_a', 'operacao', 'Evento publico A', 'ambos'),
  ('c5500000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001', 'c5_interno_a', 'operacao', 'Evento interno A', 'interno'),
  ('c5500000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000003', 'c5300000-0000-4000-8000-000000000003', 'c5400000-0000-4000-8000-000000000003', 'c5_publico_b', 'operacao', 'Evento publico B', 'ambos');

set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $assert_consultor_a$
declare
  v_operacoes uuid[];
  v_eventos text[];
  v_fundos uuid[];
  v_mutacoes integer;
begin
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_operacoes
    from public.operacoes;
  if v_operacoes <> array['c5400000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'C5 RLS: Consultor A viu operacoes indevidas: %', v_operacoes;
  end if;

  select coalesce(array_agg(tipo_evento order by tipo_evento), array[]::text[])
    into v_eventos
    from public.eventos_dominio;
  if v_eventos <> array['c5_publico_a'::text] then
    raise exception 'C5 RLS: Consultor A viu eventos indevidos: %', v_eventos;
  end if;

  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_fundos
    from public.listar_fundos_operacionais_consultor();
  if v_fundos <> array['c5100000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'C5 RLS: fundos do Consultor A incorretos: %', v_fundos;
  end if;

  if not public.consultor_pode_visualizar_operacao('c5400000-0000-4000-8000-000000000001')
     or public.consultor_pode_visualizar_operacao('c5400000-0000-4000-8000-000000000002')
     or public.consultor_pode_visualizar_operacao('c5400000-0000-4000-8000-000000000003') then
    raise exception 'C5 RLS: gate explicito do Consultor A incorreto';
  end if;

  with alteradas as (
    update public.operacoes
       set prazo_dias = prazo_dias + 1
     where id = 'c5400000-0000-4000-8000-000000000001'
    returning 1
  ) select count(*) into v_mutacoes from alteradas;
  if v_mutacoes <> 0 then
    raise exception 'C5 RLS: Consultor A conseguiu atualizar operacao';
  end if;

  with excluidas as (
    delete from public.operacoes
     where id = 'c5400000-0000-4000-8000-000000000001'
    returning 1
  ) select count(*) into v_mutacoes from excluidas;
  if v_mutacoes <> 0 then
    raise exception 'C5 RLS: Consultor A conseguiu excluir operacao';
  end if;
end
$assert_consultor_a$;

select set_config('request.jwt.claims', '{"sub":"c5000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $assert_consultor_b$
declare
  v_operacoes uuid[];
begin
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_operacoes
    from public.operacoes;
  if v_operacoes <> array['c5400000-0000-4000-8000-000000000003'::uuid] then
    raise exception 'C5 RLS: Consultor B viu operacoes indevidas: %', v_operacoes;
  end if;
end
$assert_consultor_b$;

reset role;
rollback;

\echo 'C5_RLS_SMOKE_OK'
