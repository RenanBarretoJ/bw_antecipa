-- Reconcilia, por estado final, o drift material entre a cadeia canonica e
-- ambientes que receberam apenas parte das bridges/runtime fixes historicas.
-- Nao altera migration history nem depende de identidade de ambiente.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(
  hashtextextended('bw_antecipa:reconcile_runtime_security_objects:v1', 0)
);

do $precheck$
declare
  v_missing text[];
  v_unexpected text[];
  v_dependents text[];
begin
  select array_agg(required_object order by required_object)
    into v_missing
    from (
      values
        ('schema public', to_regnamespace('public') is not null),
        ('schema private', to_regnamespace('private') is not null),
        ('table public.cedente_acessos', to_regclass('public.cedente_acessos') is not null),
        ('table public.notificacoes', to_regclass('public.notificacoes') is not null),
        ('table public.sacados', to_regclass('public.sacados') is not null),
        ('table public.testemunhas', to_regclass('public.testemunhas') is not null),
        ('table auth.users', to_regclass('auth.users') is not null),
        ('function public.handle_new_user()', to_regprocedure('public.handle_new_user()') is not null),
        ('role anon', exists (select 1 from pg_roles where rolname = 'anon')),
        ('role authenticated', exists (select 1 from pg_roles where rolname = 'authenticated')),
        ('role service_role', exists (select 1 from pg_roles where rolname = 'service_role'))
    ) as required(required_object, present)
   where not present;

  if v_missing is not null then
    raise exception 'Forward reconciliation abortada: dependencias ausentes: %',
      array_to_string(v_missing, ', ');
  end if;

  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('cedente_acessos', 'notificacoes', 'sacados', 'testemunhas')
       and (c.relkind not in ('r', 'p') or not c.relrowsecurity or c.relforcerowsecurity)
  ) then
    raise exception
      'Forward reconciliation abortada: tabelas-alvo devem ser tabelas com RLS enabled e FORCE RLS disabled.';
  end if;

  select array_agg(format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) order by p.oid)
    into v_unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'reset_operacional_fundo_homolog%'
     and not (
       p.prokind = 'f'
       and p.proname = any (array[
         'reset_operacional_fundo_homolog',
         'reset_operacional_fundo_homolog_sem_dependencias_logisticas_dup',
         'reset_operacional_fundo_homolog_sem_dependencias_recentes',
         'reset_operacional_fundo_homolog_sem_postergacoes'
       ]::name[])
       and oidvectortypes(p.proargtypes) = 'uuid, text, boolean, text, text'
     );

  if v_unexpected is not null then
    raise exception 'Forward reconciliation abortada: overload(s) de reset inesperado(s): %',
      array_to_string(v_unexpected, ', ');
  end if;

  select array_agg(format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) order by p.oid)
    into v_unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'excluir_usuarios_homolog'
     and not (p.prokind = 'f' and oidvectortypes(p.proargtypes) = 'uuid[]');

  if v_unexpected is not null then
    raise exception 'Forward reconciliation abortada: assinatura inesperada de excluir_usuarios_homolog: %',
      array_to_string(v_unexpected, ', ');
  end if;

  select array_agg(distinct p.oid::regprocedure::text order by p.oid::regprocedure::text)
    into v_dependents
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.refobjid = p.oid and d.deptype not in ('i', 'e')
   where (n.nspname = 'public' and p.proname like 'reset_operacional_fundo_homolog%')
      or (n.nspname = 'private' and p.proname = 'excluir_usuarios_homolog');

  if v_dependents is not null then
    raise exception 'Forward reconciliation abortada: funcao(oes) alvo possuem dependentes: %',
      array_to_string(v_dependents, ', ');
  end if;

  if exists (
    select 1
      from information_schema.table_privileges
     where table_schema = 'public'
       and table_name in ('notificacoes', 'sacados')
       and grantee in ('PUBLIC', 'anon')
  ) then
    raise exception
      'Forward reconciliation abortada: PUBLIC/anon possuem grants inesperados nas tabelas runtime.';
  end if;
end
$precheck$;

-- Policies amplas do schema legado: ausentes no estado canonico.
drop policy if exists ca_gestor_all on public.cedente_acessos;
drop policy if exists notificacoes_gestor_all on public.notificacoes;
drop policy if exists sacados_gestor_all on public.sacados;
drop policy if exists testemunhas_gestor_all on public.testemunhas;

-- Policies runtime: somente recria quando a definicao atual diverge do
-- snapshot canonico certificado.
do $policies$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'sacados'
       and policyname = 'sacados_own_select'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
       and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = user_id)'
       and with_check is null
  ) then
    execute 'drop policy if exists sacados_own_select on public.sacados';
    execute $sql$
      create policy sacados_own_select
        on public.sacados
        for select
        to authenticated
        using ((select auth.uid()) = user_id)
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'notificacoes'
       and policyname = 'notificacoes_own_select'
       and cmd = 'SELECT'
       and roles = array['authenticated']::name[]
       and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = usuario_id)'
       and with_check is null
  ) then
    execute 'drop policy if exists notificacoes_own_select on public.notificacoes';
    execute $sql$
      create policy notificacoes_own_select
        on public.notificacoes
        for select
        to authenticated
        using ((select auth.uid()) = usuario_id)
    $sql$;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'notificacoes'
       and policyname = 'notificacoes_own_update'
       and cmd = 'UPDATE'
       and roles = array['authenticated']::name[]
       and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = usuario_id)'
       and with_check = '(( SELECT auth.uid() AS uid) = usuario_id)'
  ) then
    execute 'drop policy if exists notificacoes_own_update on public.notificacoes';
    execute $sql$
      create policy notificacoes_own_update
        on public.notificacoes
        for update
        to authenticated
        using ((select auth.uid()) = usuario_id)
        with check ((select auth.uid()) = usuario_id)
    $sql$;
  end if;
end
$policies$;

-- ACLs runtime: remove privilegios residuais e concede somente o conjunto
-- explicitamente presente no clean-room canonico.
do $runtime_grants$
declare
  v_privileges text[];
begin
  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'sacados'
     and grantee = 'authenticated';

  if v_privileges is distinct from array['SELECT']::text[] then
    revoke all privileges on table public.sacados from authenticated;
    grant select on table public.sacados to authenticated;
  end if;

  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'notificacoes'
     and grantee = 'authenticated';

  if v_privileges is distinct from array['SELECT', 'UPDATE']::text[] then
    revoke all privileges on table public.notificacoes from authenticated;
    grant select, update on table public.notificacoes to authenticated;
  end if;
end
$runtime_grants$;

-- O clean-room nao contem RPCs destrutivas de reset nem o helper remoto
-- ad-hoc de exclusao de usuarios. RESTRICT garante falha fechada se surgir
-- qualquer dependencia antes da aplicacao futura.
do $drop_noncanonical_functions$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname like 'reset_operacional_fundo_homolog%')
        or (n.nspname = 'private' and p.proname = 'excluir_usuarios_homolog')
     order by p.oid
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function
    );
    execute format('drop function %s restrict', v_function);
  end loop;
end
$drop_noncanonical_functions$;

do $postcheck$
declare
  v_privileges text[];
  v_trigger_count bigint;
  v_trigger_enabled "char";
  v_trigger_type smallint;
  v_trigger_function_oid oid;
  v_handle_new_user_oid oid := to_regprocedure('public.handle_new_user()');
  v_security_definer boolean;
  v_function_config text[];
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (tablename, policyname) in (
         ('cedente_acessos', 'ca_gestor_all'),
         ('notificacoes', 'notificacoes_gestor_all'),
         ('sacados', 'sacados_gestor_all'),
         ('testemunhas', 'testemunhas_gestor_all')
       )
  ) then
    raise exception 'Forward reconciliation falhou: policy legada permaneceu instalada.';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sacados'
       and policyname = 'sacados_own_select' and cmd = 'SELECT'
       and roles = array['authenticated']::name[] and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = user_id)' and with_check is null
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notificacoes'
       and policyname = 'notificacoes_own_select' and cmd = 'SELECT'
       and roles = array['authenticated']::name[] and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = usuario_id)' and with_check is null
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notificacoes'
       and policyname = 'notificacoes_own_update' and cmd = 'UPDATE'
       and roles = array['authenticated']::name[] and permissive = 'PERMISSIVE'
       and qual = '(( SELECT auth.uid() AS uid) = usuario_id)'
       and with_check = '(( SELECT auth.uid() AS uid) = usuario_id)'
  ) then
    raise exception 'Forward reconciliation falhou: policy runtime nao convergiu ao estado canonico.';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('cedente_acessos', 'notificacoes', 'sacados', 'testemunhas')
       and (not c.relrowsecurity or c.relforcerowsecurity)
  ) then
    raise exception 'Forward reconciliation falhou: estado RLS divergiu do canonico.';
  end if;

  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'sacados' and grantee = 'authenticated';
  if v_privileges is distinct from array['SELECT']::text[] then
    raise exception 'Forward reconciliation falhou: grants authenticated de sacados = %', v_privileges;
  end if;

  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'notificacoes' and grantee = 'authenticated';
  if v_privileges is distinct from array['SELECT', 'UPDATE']::text[] then
    raise exception 'Forward reconciliation falhou: grants authenticated de notificacoes = %', v_privileges;
  end if;

  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name in ('notificacoes', 'sacados')
       and grantee in ('PUBLIC', 'anon')
  ) then
    raise exception 'Forward reconciliation falhou: PUBLIC/anon receberam grants runtime.';
  end if;

  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'sacados' and grantee = 'service_role';
  if v_privileges is distinct from array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] then
    raise exception 'Forward reconciliation falhou: grants service_role de sacados divergiram: %', v_privileges;
  end if;

  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[])
    into v_privileges
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'notificacoes' and grantee = 'service_role';
  if v_privileges is distinct from array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] then
    raise exception 'Forward reconciliation falhou: grants service_role de notificacoes divergiram: %', v_privileges;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname like 'reset_operacional_fundo_homolog%')
        or (n.nspname = 'private' and p.proname = 'excluir_usuarios_homolog')
  ) then
    raise exception 'Forward reconciliation falhou: funcao nao canonica permaneceu instalada.';
  end if;

  select count(*)
    into v_trigger_count
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'on_auth_user_created'
     and not t.tgisinternal;

  select t.tgenabled, t.tgtype, t.tgfoid
    into v_trigger_enabled, v_trigger_type, v_trigger_function_oid
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'on_auth_user_created'
     and not t.tgisinternal
   limit 1;

  if v_trigger_count <> 1
     or v_trigger_enabled <> 'O'
     or v_trigger_type <> 5
     or v_trigger_function_oid <> v_handle_new_user_oid then
    raise exception 'Forward reconciliation falhou: trigger Auth divergiu durante a migration.';
  end if;

  select p.prosecdef, p.proconfig
    into v_security_definer, v_function_config
    from pg_proc p
   where p.oid = v_handle_new_user_oid;

  if not v_security_definer
     or not coalesce(v_function_config @> array['search_path=public']::text[], false) then
    raise exception 'Forward reconciliation falhou: seguranca de handle_new_user() divergente.';
  end if;
end
$postcheck$;

notify pgrst, 'reload schema';

commit;
