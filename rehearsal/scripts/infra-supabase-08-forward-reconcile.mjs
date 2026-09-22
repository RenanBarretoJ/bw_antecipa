import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationName = '20260922161558_reconcile_runtime_policies_reset_functions_grants.sql'
const migrationPath = path.join(repositoryRoot, 'supabase', 'migrations', migrationName)
const containerArgument = process.argv.find((argument) => argument.startsWith('--container='))
const container = containerArgument?.slice('--container='.length)

if (!container || !/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('Informe um container local explicito com --container=supabase_db_<projeto>.')
}

const migration = fs.readFileSync(migrationPath, 'utf8').replace(/\r\n?/gu, '\n')

function psql(sql, { expectFailure = false } = {}) {
  try {
    const output = execFileSync('docker', [
      'exec', '-i', container, 'psql', '-X', '--username=postgres', '--dbname=postgres',
      '--set=ON_ERROR_STOP=1', '--no-psqlrc', '--tuples-only', '--no-align',
    ], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (expectFailure) throw new Error('Comando deveria falhar fechado, mas concluiu com sucesso.')
    return output.trim()
  } catch (error) {
    if (!expectFailure) throw error
    const detail = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    if (!detail.includes('overload(s) de reset inesperado(s)')) throw error
    return detail
  }
}

function snapshot() {
  const raw = psql(`
    with target_policies as (
      select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and tablename in ('cedente_acessos', 'notificacoes', 'sacados', 'testemunhas')
      order by tablename, policyname
    ), target_grants as (
      select table_schema, table_name, grantee, privilege_type, is_grantable
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name in ('notificacoes', 'sacados')
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      order by table_name, grantee, privilege_type
    ), target_functions as (
      select format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'public' and p.proname like 'reset_operacional_fundo_homolog%')
         or (n.nspname = 'private' and p.proname = 'excluir_usuarios_homolog')
      order by signature
    ), target_rls as (
      select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('cedente_acessos', 'notificacoes', 'sacados', 'testemunhas')
      order by c.relname
    ), auth_trigger as (
      select t.tgname, t.tgenabled, t.tgtype, t.tgfoid::regprocedure::text as function,
             p.prosecdef, p.proconfig
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'auth.users'::regclass
        and t.tgname = 'on_auth_user_created'
        and not t.tgisinternal
    )
    select jsonb_build_object(
      'policies', coalesce((select jsonb_agg(to_jsonb(x)) from target_policies x), '[]'::jsonb),
      'grants', coalesce((select jsonb_agg(to_jsonb(x)) from target_grants x), '[]'::jsonb),
      'functions', coalesce((select jsonb_agg(to_jsonb(x)) from target_functions x), '[]'::jsonb),
      'rls', coalesce((select jsonb_agg(to_jsonb(x)) from target_rls x), '[]'::jsonb),
      'auth_trigger', coalesce((select jsonb_agg(to_jsonb(x)) from auth_trigger x), '[]'::jsonb)
    );
  `)
  return JSON.parse(raw)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function assertEqual(actual, expected, message) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`${message}: esperado=${hash(expected)} atual=${hash(actual)}`)
  }
}

const remotePolicies = `
  create policy ca_gestor_all on public.cedente_acessos
    for all using (public.get_user_role() = 'gestor');
  create policy notificacoes_gestor_all on public.notificacoes
    for all using (public.get_user_role() = 'gestor');
  create policy sacados_gestor_all on public.sacados
    for all using (public.get_user_role() = 'gestor');
  create policy testemunhas_gestor_all on public.testemunhas
    for all using (public.get_user_role() = 'gestor');

  drop policy notificacoes_own_select on public.notificacoes;
  create policy notificacoes_own_select on public.notificacoes
    for select using (usuario_id = auth.uid());
  drop policy notificacoes_own_update on public.notificacoes;
  create policy notificacoes_own_update on public.notificacoes
    for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
  drop policy sacados_own_select on public.sacados;
  create policy sacados_own_select on public.sacados
    for select using (user_id = auth.uid());
`

const remoteFunctions = `
  create function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function public.reset_operacional_fundo_homolog_sem_dependencias_logisticas_dup(uuid, text, boolean, text, text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function public.reset_operacional_fundo_homolog_sem_dependencias_recentes(uuid, text, boolean, text, text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function public.reset_operacional_fundo_homolog_sem_postergacoes(uuid, text, boolean, text, text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function private.excluir_usuarios_homolog(uuid[])
    returns table(user_id uuid, resultado text)
    language sql as $$ select null::uuid, null::text where false $$;
`

function contaminateFull() {
  psql(`
    begin;
    ${remotePolicies}
    revoke all privileges on table public.sacados from authenticated;
    grant truncate, references, trigger, maintain on table public.sacados to authenticated;
    revoke all privileges on table public.notificacoes from authenticated;
    grant truncate, references, trigger, maintain on table public.notificacoes to authenticated;
    ${remoteFunctions}
    commit;
  `)
}

function contaminatePartial() {
  psql(`
    begin;
    create policy ca_gestor_all on public.cedente_acessos
      for all using (public.get_user_role() = 'gestor');
    create policy sacados_gestor_all on public.sacados
      for all using (public.get_user_role() = 'gestor');
    drop policy notificacoes_own_update on public.notificacoes;
    create policy notificacoes_own_update on public.notificacoes
      for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
    revoke all privileges on table public.notificacoes from authenticated;
    grant select on table public.notificacoes to authenticated;
    create function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
      returns jsonb language sql as $$ select '{"partial":true}'::jsonb $$;
    commit;
  `)
}

function verifySecurity() {
  psql(`
    begin;

    insert into auth.users (id, email, raw_user_meta_data)
    values
      ('91000000-0000-4000-8000-000000000001', 'infra08-gestor@qa.invalid', '{"role":"gestor","nome_completo":"QA Gestor"}'::jsonb),
      ('91000000-0000-4000-8000-000000000002', 'infra08-cedente@qa.invalid', '{"role":"cedente","nome_completo":"QA Cedente"}'::jsonb),
      ('91000000-0000-4000-8000-000000000003', 'infra08-consultor@qa.invalid', '{"role":"consultor","nome_completo":"QA Consultor"}'::jsonb),
      ('91000000-0000-4000-8000-000000000004', 'infra08-super-admin@qa.invalid', '{"role":"cedente","nome_completo":"QA Super Admin"}'::jsonb);

    update public.profiles
       set role = 'super_admin'
     where id = '91000000-0000-4000-8000-000000000004';

    insert into public.sacados (user_id, cnpj, razao_social)
    values
      ('91000000-0000-4000-8000-000000000001', '99000000000101', 'QA Gestor'),
      ('91000000-0000-4000-8000-000000000002', '99000000000102', 'QA Cedente'),
      ('91000000-0000-4000-8000-000000000003', '99000000000103', 'QA Consultor'),
      ('91000000-0000-4000-8000-000000000004', '99000000000104', 'QA Super Admin');

    insert into public.notificacoes (usuario_id, titulo, mensagem, tipo)
    select id, 'INFRA08', 'RLS QA', 'info'
      from public.profiles
     where id::text like '91000000-0000-4000-8000-00000000000%';

    set local role authenticated;

    do $security$
    declare
      v_users uuid[] := array[
        '91000000-0000-4000-8000-000000000001'::uuid,
        '91000000-0000-4000-8000-000000000002'::uuid,
        '91000000-0000-4000-8000-000000000003'::uuid,
        '91000000-0000-4000-8000-000000000004'::uuid
      ];
      v_roles text[] := array['gestor', 'cedente', 'consultor', 'super_admin'];
      v_user uuid;
      v_count integer;
      v_updated integer;
      v_index integer;
    begin
      if not has_table_privilege(current_user, 'public.sacados', 'SELECT')
         or has_table_privilege(current_user, 'public.sacados', 'INSERT')
         or has_table_privilege(current_user, 'public.sacados', 'UPDATE')
         or has_table_privilege(current_user, 'public.sacados', 'DELETE') then
        raise exception 'ACL authenticated de sacados divergente';
      end if;

      if not has_table_privilege(current_user, 'public.notificacoes', 'SELECT')
         or not has_table_privilege(current_user, 'public.notificacoes', 'UPDATE')
         or has_table_privilege(current_user, 'public.notificacoes', 'INSERT')
         or has_table_privilege(current_user, 'public.notificacoes', 'DELETE') then
        raise exception 'ACL authenticated de notificacoes divergente';
      end if;

      for v_index in 1..array_length(v_users, 1) loop
        v_user := v_users[v_index];
        perform set_config('request.jwt.claim.sub', v_user::text, true);

        if public.get_user_role() <> v_roles[v_index] then
          raise exception 'Perfil QA divergente para %', v_roles[v_index];
        end if;

        select count(*) into v_count from public.sacados;
        if v_count <> 1 then
          raise exception 'RLS cross-tenant de sacados falhou para %: % linhas', v_roles[v_index], v_count;
        end if;

        select count(*) into v_count from public.notificacoes;
        if v_count <> 1 then
          raise exception 'RLS cross-tenant de notificacoes falhou para %: % linhas', v_roles[v_index], v_count;
        end if;

        update public.notificacoes set lida = true;
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'RLS UPDATE de notificacoes falhou para %: % linhas', v_roles[v_index], v_updated;
        end if;
      end loop;
    end
    $security$;

    reset role;
    set local role anon;
    do $anon$
    begin
      if has_table_privilege(current_user, 'public.sacados', 'SELECT')
         or has_table_privilege(current_user, 'public.notificacoes', 'SELECT') then
        raise exception 'anon recebeu leitura runtime inesperada';
      end if;
    end
    $anon$;

    reset role;
    set local role service_role;
    do $service$
    begin
      if not has_table_privilege(current_user, 'public.sacados', 'SELECT, INSERT, UPDATE, DELETE')
         or not has_table_privilege(current_user, 'public.notificacoes', 'SELECT, INSERT, UPDATE, DELETE') then
        raise exception 'service_role perdeu DML canonico';
      end if;
    end
    $service$;

    reset role;
    rollback;
  `)
}

const canonical = snapshot()

psql(migration)
const canonicalNoop = snapshot()
assertEqual(canonicalNoop, canonical, 'Aplicacao sobre estado canonico nao foi no-op')

contaminateFull()
const homologBefore = snapshot()
if (hash(homologBefore) === hash(canonical)) throw new Error('Fixture homolog-current nao criou drift.')
psql(migration)
const homologAfter = snapshot()
assertEqual(homologAfter, canonical, 'Homolog-current nao convergiu ao canonico')

psql(migration)
const idempotentAfter = snapshot()
assertEqual(idempotentAfter, canonical, 'Segunda aplicacao alterou o estado canonico')

contaminatePartial()
const partialBefore = snapshot()
if (hash(partialBefore) === hash(canonical)) throw new Error('Fixture parcial nao criou drift.')
psql(migration)
const partialAfter = snapshot()
assertEqual(partialAfter, canonical, 'Estado parcial nao convergiu ao canonico')

psql(`
  create function public.reset_operacional_fundo_homolog(integer)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
`)
psql(migration, { expectFailure: true })
const conflictingState = snapshot()
if (!conflictingState.functions.some(({ signature }) => signature.endsWith('(integer)'))) {
  throw new Error('Fixture conflitante desapareceu apesar da falha fechada.')
}
psql('drop function public.reset_operacional_fundo_homolog(integer) restrict;')
assertEqual(snapshot(), canonical, 'Cleanup da fixture conflitante nao restaurou o canonico')
verifySecurity()
assertEqual(snapshot(), canonical, 'Security regression alterou o estado persistente')

const report = {
  generated_at: new Date().toISOString(),
  environment: 'local-docker-only',
  migration: migrationName,
  canonical_hash: hash(canonical),
  canonical_noop_hash: hash(canonicalNoop),
  homolog_before_hash: hash(homologBefore),
  homolog_after_hash: hash(homologAfter),
  idempotent_after_hash: hash(idempotentAfter),
  partial_before_hash: hash(partialBefore),
  partial_after_hash: hash(partialAfter),
  unexpected_signature_fail_closed: true,
  security_roles_and_cross_tenant: true,
  status: 'PASS',
}

const reportDirectory = path.join(repositoryRoot, 'rehearsal', 'reports')
fs.mkdirSync(reportDirectory, { recursive: true })
fs.writeFileSync(
  path.join(reportDirectory, 'INFRA_SUPABASE_08_FORWARD_REHEARSAL.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify(report, null, 2))
