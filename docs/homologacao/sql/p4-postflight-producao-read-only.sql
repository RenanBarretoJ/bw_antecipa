-- P4 - postflight depois do upgrade e da configuracao DLZ/HEALTH.
-- Executar somente quando a cadeia da janela tiver terminado.
-- O script nao corrige estado: apenas retorna evidencias e falhas.

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

with bloqueadas(version) as (
  values
    ('20260723182639'::text),
    ('20260728153646'::text),
    ('20260804103235'::text),
    ('20260811153000'::text),
    ('20260823125731'::text)
), obrigatorias(version) as (
  values
    ('20260827183411'::text),
    ('20260827184403'::text),
    ('20260827185557'::text),
    ('20260827203000'::text),
    ('20260827204000'::text),
    ('20260827205000'::text)
)
select
  (select count(*) from supabase_migrations.schema_migrations) = 192 as total_migrations_confere,
  not exists (
    select 1 from bloqueadas b
    join supabase_migrations.schema_migrations m using (version)
  ) as migrations_homolog_ausentes,
  not exists (
    select 1 from obrigatorias o
    left join supabase_migrations.schema_migrations m using (version)
    where m.version is null
  ) as bridges_e_correcoes_presentes;

select * from (
  values
    ('cedentes_dlz_ativos', (
      select count(distinct cedente_id) from public.cedente_fundos
      where fundo_id = '7a114257-7816-468e-adf4-d796b93364df'::uuid and status = 'ativo'
    ), 12::bigint),
    ('cedentes_impulse_ativos', (
      select count(distinct cedente_id) from public.cedente_fundos
      where fundo_id = 'cb372689-65c8-43af-8a20-7438002a3b91'::uuid and status = 'ativo'
    ), 0::bigint),
    ('atribuicoes_politica_dlz', (
      select count(*) from public.cedente_fundo_politicas
      where politica_operacional_id = 'd1311000-0000-4000-8000-000000000001'::uuid and status = 'ativa'
    ), 12::bigint),
    ('politica_dlz_publicada', (
      select count(*) from public.politica_operacional_versoes
      where id = 'd1311000-0000-4000-8000-000000000002'::uuid
        and fundo_id = '7a114257-7816-468e-adf4-d796b93364df'::uuid
        and status = 'publicada'
        and aceite_sacado_obrigatorio is true
        and gate_risco_ativo is false
        and controle_exposicao_logistica_ativo is false
    ), 1::bigint),
    ('cnab_dlz_publicado', (
      select count(*) from public.configuracao_cnab_versoes
      where id = 'd1312000-0000-4000-8000-000000000002'::uuid
        and status = 'publicada'
        and layout = 'cnab444'
        and versao_layout = 'H/D/T'
        and codigo_originador = '00000000000000500497'
        and codigo_banco = '001'
    ), 1::bigint),
    ('integracao_dlz_legacy_publicada', (
      select count(*) from public.integracao_fundo_versoes v
      join public.integracoes_fundo i on i.id = v.integracao_fundo_id
      where v.id = 'd1313000-0000-4000-8000-000000000002'::uuid
        and i.fundo_id = '7a114257-7816-468e-adf4-d796b93364df'::uuid
        and v.status = 'publicada'
        and v.adapter_key = 'sinqia_portal_fidc'
        and v.configuracao_nao_sensivel ->> 'runtime_mode' = 'legacy_env_sinqia_terra'
    ), 1::bigint),
    ('capability_cessao_envio_dlz', (
      select count(*) from public.integracao_fundo_versao_capacidades
      where integracao_fundo_versao_id = 'd1313000-0000-4000-8000-000000000002'::uuid
        and fundo_id = '7a114257-7816-468e-adf4-d796b93364df'::uuid
        and ambiente = 'producao'
        and capability = 'CESSAO_ENVIO'
    ), 1::bigint)
) as configuracao(check_name, atual, esperado)
order by check_name;

select * from (
  values
    ('operacoes_sem_cedente_fundo', (
      select count(*) from public.operacoes o
      left join public.cedente_fundos cf on cf.id = o.cedente_fundo_id
      where o.cedente_fundo_id is null
         or cf.id is null
         or cf.cedente_id <> o.cedente_id
    )),
    ('nfs_sem_cedente_fundo', (
      select count(*) from public.notas_fiscais n
      left join public.cedente_fundos cf on cf.id = n.cedente_fundo_id
      where n.cedente_fundo_id is null
         or n.fundo_id is null
         or cf.id is null
         or cf.cedente_id <> n.cedente_id
         or cf.fundo_id <> n.fundo_id
    )),
    ('operacoes_nfs_orfas', (
      select count(*) from public.operacoes_nfs x
      left join public.operacoes o on o.id = x.operacao_id
      left join public.notas_fiscais n on n.id = x.nota_fiscal_id
      where o.id is null or n.id is null
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
    ('fks_public_nao_validadas', (
      select count(*) from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' and c.contype = 'f' and not c.convalidated
    ))
) as integridade(check_name, falhas)
order by check_name;

select
  exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and not tgisinternal
  ) as trigger_profile_auth_presente,
  has_table_privilege('authenticated', 'public.sacados', 'SELECT') as grant_sacado_select,
  has_table_privilege('authenticated', 'public.notificacoes', 'SELECT') as grant_notificacoes_select,
  has_table_privilege('authenticated', 'public.notificacoes', 'UPDATE') as grant_notificacoes_update,
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sacados'
      and policyname = 'sacados_own_select' and cmd = 'SELECT'
  ) as policy_sacado_presente,
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notificacoes'
      and policyname = 'notificacoes_own_select' and cmd = 'SELECT'
  ) as policy_notificacoes_select_presente,
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notificacoes'
      and policyname = 'notificacoes_own_update' and cmd = 'UPDATE'
  ) as policy_notificacoes_update_presente;

select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'fundos', 'cedentes', 'cedente_fundos', 'operacoes', 'notas_fiscais',
    'documentos', 'profiles', 'sacados', 'notificacoes'
  )
order by tablename;

select bucket_id, count(*) as objetos
from storage.objects
group by bucket_id
order by bucket_id;

-- P4.2: deve retornar DLZ_READINESS = READY. Consulta somente leitura;
-- nao chama a integracao externa.
select case when
  exists(select 1 from public.fundos where id='7a114257-7816-468e-adf4-d796b93364df'::uuid and ativo is true)
  and (select count(distinct cedente_id) from public.cedente_fundos where fundo_id='7a114257-7816-468e-adf4-d796b93364df'::uuid and status='ativo')=12
  and exists(select 1 from public.politica_operacional_versoes where id='d1311000-0000-4000-8000-000000000002'::uuid and status='publicada' and aceite_sacado_obrigatorio is true and gate_risco_ativo is false and controle_exposicao_logistica_ativo is false)
  and exists(select 1 from public.configuracao_cnab_versoes where id='d1312000-0000-4000-8000-000000000002'::uuid and status='publicada' and codigo_originador='00000000000000500497')
  and exists(select 1 from public.integracao_fundo_versoes where id='d1313000-0000-4000-8000-000000000002'::uuid and status='publicada' and adapter_key='sinqia_portal_fidc' and configuracao_nao_sensivel->>'runtime_mode'='legacy_env_sinqia_terra' and credencial_integracao_id is null)
  and exists(select 1 from public.integracao_fundo_versao_capacidades where integracao_fundo_versao_id='d1313000-0000-4000-8000-000000000002'::uuid and capability='CESSAO_ENVIO')
  and not exists(select 1 from public.politicas_operacionais where fundo_id='cb372689-65c8-43af-8a20-7438002a3b91'::uuid)
  and not exists(select 1 from public.configuracoes_cnab where fundo_id='cb372689-65c8-43af-8a20-7438002a3b91'::uuid)
  and not exists(select 1 from public.integracoes_fundo where fundo_id='cb372689-65c8-43af-8a20-7438002a3b91'::uuid)
then 'READY' else 'FAIL' end as "DLZ_READINESS";

rollback;
