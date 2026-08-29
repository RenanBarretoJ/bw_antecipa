-- P4 - preflight imediatamente anterior ao cutover DLZ/HEALTH.
-- Fonte: baseline de producao capturada em 2026-08-27T23:31:23Z.
-- Este arquivo e deliberadamente read-only. O modo da transacao impede DDL/DML
-- mesmo se uma instrucao mutavel for adicionada acidentalmente.

begin transaction read only;

select
  current_setting('transaction_read_only') = 'on' as transacao_read_only,
  current_database() as database_name,
  current_setting('server_version') as server_version,
  clock_timestamp() as capturado_em;

with esperado(metrica, quantidade) as (
  values
    ('fundos', 2::bigint),
    ('cedentes', 12::bigint),
    ('operacoes', 46::bigint),
    ('notas_fiscais', 910::bigint),
    ('documentos', 123::bigint),
    ('storage_objects', 1644::bigint),
    ('auth_users', 23::bigint),
    ('profiles', 23::bigint),
    ('fromtis_historico', 26::bigint)
), atual(metrica, quantidade) as (
  values
    ('fundos', (select count(*) from public.fundos)),
    ('cedentes', (select count(*) from public.cedentes)),
    ('operacoes', (select count(*) from public.operacoes)),
    ('notas_fiscais', (select count(*) from public.notas_fiscais)),
    ('documentos', (select count(*) from public.documentos)),
    ('storage_objects', (select count(*) from storage.objects)),
    ('auth_users', (select count(*) from auth.users)),
    ('profiles', (select count(*) from public.profiles)),
    ('fromtis_historico', (
      select count(*) from public.operacoes
      where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null
    ))
)
select
  e.metrica,
  e.quantidade as esperado,
  a.quantidade as atual,
  a.quantidade = e.quantidade as passou
from esperado e
join atual a using (metrica)
order by e.metrica;

select 'operacoes_por_status' as grupo, status::text as status, count(*) as quantidade
from public.operacoes
group by status
union all
select 'notas_fiscais_por_status', status::text, count(*)
from public.notas_fiscais
group by status
union all
select 'documentos_por_status', status::text, count(*)
from public.documentos
group by status
order by grupo, status;

select
  id,
  regexp_replace(cnpj, '[^0-9]', '', 'g') as cnpj,
  nome,
  ativo
from public.fundos
order by id;

select
  fundo_id,
  status::text as status,
  count(*) as cedentes
from public.cedentes
group by fundo_id, status
order by fundo_id nulls last, status;

with esperados(cedente_id, cnpj) as (
  values
    ('382fab89-936b-4ff9-b4fe-edbfab0fa7f4'::uuid, '20817796000187'::text),
    ('c3df4597-25a8-4b50-ae83-fadada7170e4'::uuid, '31775519000175'::text)
)
select
  e.cedente_id,
  c.id is not null as existe,
  regexp_replace(c.cnpj, '[^0-9]', '', 'g') = e.cnpj as cnpj_confere,
  c.status::text in ('pendente', 'ativo') as status_compativel,
  c.fundo_id is null as sem_fundo_legado,
  not exists (select 1 from public.operacoes o where o.cedente_id = e.cedente_id) as sem_operacoes,
  not exists (select 1 from public.notas_fiscais n where n.cedente_id = e.cedente_id) as sem_notas_fiscais
from esperados e
left join public.cedentes c on c.id = e.cedente_id
order by e.cedente_id;

with snapshot as (
  select timestamptz '2026-08-27 18:25:50.037+00' as capturado_em
)
select * from (
  values
    ('cedentes_criados', (select count(*) from public.cedentes, snapshot where created_at > snapshot.capturado_em)),
    ('operacoes_criadas', (select count(*) from public.operacoes, snapshot where created_at > snapshot.capturado_em)),
    ('notas_fiscais_criadas', (select count(*) from public.notas_fiscais, snapshot where created_at > snapshot.capturado_em)),
    ('documentos_criados', (select count(*) from public.documentos, snapshot where created_at > snapshot.capturado_em)),
    ('storage_objects_criados', (select count(*) from storage.objects, snapshot where created_at > snapshot.capturado_em)),
    ('auth_users_criados', (select count(*) from auth.users, snapshot where created_at > snapshot.capturado_em)),
    ('profiles_criados', (select count(*) from public.profiles, snapshot where created_at > snapshot.capturado_em)),
    ('remessas_criadas', (
      select count(*) from public.operacoes, snapshot
      where remessa_gerado_em > snapshot.capturado_em or remessa_enviado_em > snapshot.capturado_em
    ))
) as delta(metrica, quantidade)
order by metrica;

select * from (
  values
    ('operacoes_sem_cedente', (
      select count(*) from public.operacoes o
      left join public.cedentes c on c.id = o.cedente_id
      where c.id is null
    )),
    ('nfs_sem_cedente', (
      select count(*) from public.notas_fiscais n
      left join public.cedentes c on c.id = n.cedente_id
      where c.id is null
    )),
    ('documentos_com_cedente_orfao', (
      select count(*) from public.documentos d
      left join public.cedentes c on c.id = d.cedente_id
      where d.cedente_id is not null and c.id is null
    )),
    ('operacoes_nfs_com_operacao_orfa', (
      select count(*) from public.operacoes_nfs x
      left join public.operacoes o on o.id = x.operacao_id
      where o.id is null
    )),
    ('operacoes_nfs_com_nf_orfa', (
      select count(*) from public.operacoes_nfs x
      left join public.notas_fiscais n on n.id = x.nota_fiscal_id
      where n.id is null
    )),
    ('auth_sem_profile', (
      select count(*) from auth.users u
      left join public.profiles p on p.id = u.id
      where u.deleted_at is null and p.id is null
    )),
    ('profile_sem_auth', (
      select count(*) from public.profiles p
      left join auth.users u on u.id = p.id
      where u.id is null
    )),
    ('cedente_cnpj_duplicado', (
      select count(*) from (
        select regexp_replace(cnpj, '[^0-9]', '', 'g')
        from public.cedentes
        group by 1
        having count(*) > 1
      ) d
    ))
) as integridade(check_name, falhas)
order by check_name;

select version, name
from supabase_migrations.schema_migrations
order by version;

select
  count(*) = 14 as baseline_exato,
  min(version) = '003' as primeira_versao_confere,
  max(version) = '016' as ultima_versao_confere
from supabase_migrations.schema_migrations;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in (
    'fundos', 'cedentes', 'operacoes', 'notas_fiscais', 'documentos',
    'profiles', 'sacados', 'notificacoes', 'objects'
  )
order by schemaname, tablename, policyname;

select bucket_id, count(*) as objetos
from storage.objects
group by bucket_id
order by bucket_id;

rollback;
