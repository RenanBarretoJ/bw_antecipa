-- MFA/TOTP por sessao Supabase, com validade fixa de 24 horas.
-- Elevações antigas são removidas deliberadamente: elas não possuem session_id
-- confiável e, portanto, não podem ser promovidas para o novo modelo.

begin;

delete from public.sessoes_elevadas;

alter table public.sessoes_elevadas
  drop constraint if exists sessoes_elevadas_pkey;

alter table public.sessoes_elevadas
  add column if not exists session_id uuid,
  add column if not exists revogada_em timestamptz,
  add column if not exists motivo_revogacao text;

alter table public.sessoes_elevadas
  alter column session_id set not null;

alter table public.sessoes_elevadas
  add constraint sessoes_elevadas_pkey primary key (user_id, session_id);

alter table public.sessoes_elevadas
  drop constraint if exists sessoes_elevadas_periodo_check;
alter table public.sessoes_elevadas
  add constraint sessoes_elevadas_periodo_check check (expira_em > elevada_em);

create index if not exists sessoes_elevadas_session_id_idx
  on public.sessoes_elevadas (session_id);
create index if not exists sessoes_elevadas_ativas_expira_idx
  on public.sessoes_elevadas (expira_em)
  where revogada_em is null;

create table if not exists public.autorizacoes_acoes_sensiveis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  action_type text not null,
  nonce_hash text not null unique,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  consumida_em timestamptz,
  revogada_em timestamptz,
  constraint autorizacoes_acoes_sensiveis_action_check check (
    action_type = any (array[
      'alterar_senha',
      'alterar_email',
      'regenerar_recovery_codes',
      'encerrar_outras_sessoes',
      'reset_mfa_administrativo',
      'cadastrar_credencial_integracao',
      'rotacionar_credencial_integracao',
      'ativar_credencial_integracao',
      'revogar_credencial_integracao'
    ])
  ),
  constraint autorizacoes_acoes_sensiveis_nonce_hash_check check (nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint autorizacoes_acoes_sensiveis_periodo_check check (expira_em > criada_em)
);

create index if not exists autorizacoes_acoes_sensiveis_lookup_idx
  on public.autorizacoes_acoes_sensiveis (user_id, session_id, action_type, expira_em)
  where consumida_em is null and revogada_em is null;

alter table public.autorizacoes_acoes_sensiveis enable row level security;
alter table public.autorizacoes_acoes_sensiveis force row level security;

revoke all on public.autorizacoes_acoes_sensiveis from public, anon, authenticated;
grant select, insert, update, delete on public.autorizacoes_acoes_sensiveis to service_role;

create or replace function public.registrar_sessao_mfa_atual(p_factor_id text)
returns table (
  session_id uuid,
  elevada_em timestamptz,
  expira_em timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sessao nao autenticada';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'Sessao Supabase sem identificador valido';
  end;

  if v_session_id is null or not exists (
    select 1
      from auth.sessions s
     where s.id = v_session_id
       and s.user_id = v_user_id
       and s.aal = 'aal2'
       and (s.not_after is null or v_agora < s.not_after)
  ) then
    raise exception using errcode = '42501', message = 'Sessao Supabase AAL2 invalida';
  end if;

  if p_factor_id is null or not exists (
    select 1
      from auth.mfa_factors f
     where f.id::text = p_factor_id
       and f.user_id = v_user_id
       and f.status = 'verified'
  ) then
    raise exception using errcode = '42501', message = 'Fator TOTP verificado nao encontrado';
  end if;

  insert into public.sessoes_elevadas (
    user_id, session_id, aal, metodo, factor_id,
    elevada_em, expira_em, revogada_em, motivo_revogacao, updated_at
  ) values (
    v_user_id, v_session_id, 'aal2', 'totp', p_factor_id,
    v_agora, v_agora + interval '24 hours', null, null, v_agora
  )
  on conflict (user_id, session_id) do update set
    aal = excluded.aal,
    metodo = excluded.metodo,
    factor_id = excluded.factor_id,
    elevada_em = excluded.elevada_em,
    expira_em = excluded.expira_em,
    revogada_em = null,
    motivo_revogacao = null,
    updated_at = excluded.updated_at;

  return query
    select v_session_id, v_agora, v_agora + interval '24 hours';
end;
$$;

create or replace function public.obter_sessao_mfa_atual()
returns table (
  session_id uuid,
  status text,
  elevada_em timestamptz,
  expira_em timestamptz,
  server_now timestamptz,
  metodo text,
  factor_id text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
  v_elevacao public.sessoes_elevadas%rowtype;
begin
  if v_user_id is null then
    return query select null::uuid, 'unauthenticated'::text, null::timestamptz,
      null::timestamptz, v_agora, null::text, null::text;
    return;
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    v_session_id := null;
  end;

  if v_session_id is null or not exists (
    select 1 from auth.sessions s
     where s.id = v_session_id and s.user_id = v_user_id
       and s.aal = 'aal2'
       and (s.not_after is null or v_agora < s.not_after)
  ) then
    return query select v_session_id, 'session_invalid'::text, null::timestamptz,
      null::timestamptz, v_agora, null::text, null::text;
    return;
  end if;

  select * into v_elevacao
    from public.sessoes_elevadas e
   where e.user_id = v_user_id and e.session_id = v_session_id;

  if not found then
    return query select v_session_id, 'missing'::text, null::timestamptz,
      null::timestamptz, v_agora, null::text, null::text;
    return;
  end if;

  if v_elevacao.revogada_em is not null then
    return query select v_session_id, 'revoked'::text, v_elevacao.elevada_em,
      v_elevacao.expira_em, v_agora, v_elevacao.metodo, v_elevacao.factor_id;
    return;
  end if;

  if v_agora >= v_elevacao.expira_em then
    return query select v_session_id, 'expired'::text, v_elevacao.elevada_em,
      v_elevacao.expira_em, v_agora, v_elevacao.metodo, v_elevacao.factor_id;
    return;
  end if;

  if v_elevacao.metodo <> 'totp' or v_elevacao.factor_id is null or not exists (
    select 1 from auth.mfa_factors f
     where f.id::text = v_elevacao.factor_id
       and f.user_id = v_user_id
       and f.status = 'verified'
  ) then
    return query select v_session_id, 'factor_invalid'::text, v_elevacao.elevada_em,
      v_elevacao.expira_em, v_agora, v_elevacao.metodo, v_elevacao.factor_id;
    return;
  end if;

  return query select v_session_id, 'valid'::text, v_elevacao.elevada_em,
    v_elevacao.expira_em, v_agora, v_elevacao.metodo, v_elevacao.factor_id;
end;
$$;

create or replace function public.revogar_sessao_mfa_atual(p_motivo text default 'logout')
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_session_id uuid;
  v_revogadas integer := 0;
begin
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    return false;
  end;

  update public.sessoes_elevadas
     set revogada_em = coalesce(revogada_em, clock_timestamp()),
         motivo_revogacao = coalesce(nullif(left(trim(p_motivo), 120), ''), 'logout'),
         updated_at = clock_timestamp()
   where user_id = auth.uid()
     and session_id = v_session_id
     and revogada_em is null;
  get diagnostics v_revogadas = row_count;

  update public.autorizacoes_acoes_sensiveis
     set revogada_em = coalesce(revogada_em, clock_timestamp())
   where user_id = auth.uid()
     and session_id = v_session_id
     and consumida_em is null
     and revogada_em is null;

  if v_revogadas > 0 then
    insert into public.seguranca_eventos (
      tipo_evento, usuario_id, ator_usuario_id, ator_tipo, origem,
      severidade, entidade_tipo, entidade_id, dados
    ) values (
      case when p_motivo like 'expiracao%' then 'SESSAO_MFA_EXPIRADA' else 'SESSAO_MFA_REVOGADA' end,
      auth.uid(), auth.uid(), 'usuario', 'mfa_sessao_24h',
      'warning', 'auth.sessions', v_session_id,
      jsonb_build_object('session_id', v_session_id, 'motivo', left(coalesce(p_motivo, 'logout'), 120))
    );
  end if;

  return v_revogadas > 0;
end;
$$;

create or replace function public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
returns table (expira_em timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
begin
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    raise exception using errcode = '42501', message = 'Sessao Supabase invalida';
  end;

  if p_action_type is null or p_action_type not in (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao',
    'revogar_credencial_integracao'
  ) then
    raise exception using errcode = '22023', message = 'Tipo de acao sensivel invalido';
  end if;

  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Nonce invalido';
  end if;

  if not exists (
    select 1 from public.obter_sessao_mfa_atual() estado
     where estado.status = 'valid' and estado.session_id = v_session_id
  ) then
    raise exception using errcode = '42501', message = 'Sessao MFA de 24 horas invalida';
  end if;

  insert into public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) values (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );

  return query select v_agora + interval '5 minutes';
end;
$$;

create or replace function public.consumir_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_session_id uuid;
  v_consumida uuid;
begin
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    return false;
  end;

  update public.autorizacoes_acoes_sensiveis a
     set consumida_em = clock_timestamp()
   where a.user_id = auth.uid()
     and a.session_id = v_session_id
     and a.action_type = p_action_type
     and a.nonce_hash = p_nonce_hash
     and a.consumida_em is null
     and a.revogada_em is null
     and clock_timestamp() < a.expira_em
  returning a.id into v_consumida;

  return v_consumida is not null;
end;
$$;

revoke all on function public.registrar_sessao_mfa_atual(text) from public, anon;
revoke all on function public.obter_sessao_mfa_atual() from public, anon;
revoke all on function public.revogar_sessao_mfa_atual(text) from public, anon;
revoke all on function public.criar_autorizacao_acao_sensivel(text, text) from public, anon;
revoke all on function public.consumir_autorizacao_acao_sensivel(text, text) from public, anon;
grant execute on function public.registrar_sessao_mfa_atual(text) to authenticated;
grant execute on function public.obter_sessao_mfa_atual() to authenticated;
grant execute on function public.revogar_sessao_mfa_atual(text) to authenticated;
grant execute on function public.criar_autorizacao_acao_sensivel(text, text) to authenticated;
grant execute on function public.consumir_autorizacao_acao_sensivel(text, text) to authenticated;

alter table public.seguranca_eventos
  drop constraint if exists seguranca_eventos_tipo_check;
alter table public.seguranca_eventos
  add constraint seguranca_eventos_tipo_check check (tipo_evento = any (array[
    'MFA_ENROLL_INICIADO', 'MFA_ATIVADO', 'MFA_DESATIVADO', 'MFA_FALHA',
    'MFA_RECOVERY_USADO', 'MFA_RECOVERY_REGENERADO', 'MFA_RESET_ADMINISTRATIVO',
    'SESSAO_ELEVADA', 'SESSOES_REVOGADAS', 'CREDENCIAL_CRIADA',
    'CREDENCIAL_TESTADA', 'CREDENCIAL_ATIVADA', 'CREDENCIAL_ROTACIONADA',
    'CREDENCIAL_REVOGADA', 'CREDENCIAL_USADA', 'ACESSO_CREDENCIAL_NEGADO',
    'ACESSO_NEGADO', 'RATE_LIMIT_BLOQUEADO', 'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_EMAIL_SENT', 'PASSWORD_RESET_LINK_OPENED',
    'PASSWORD_RESET_LINK_INVALID', 'PASSWORD_RESET_LINK_EXPIRED',
    'PASSWORD_RECOVERY_SESSION_CREATED', 'PASSWORD_RECOVERY_SESSION_CLEARED',
    'PASSWORD_RESET_COMPLETED', 'PASSWORD_RESET_ABORTED', 'PASSWORD_CHANGED',
    'PASSWORD_CHANGE_FAILED', 'PASSWORD_REAUTH_NONCE_REQUESTED',
    'MFA_SETUP_REQUIRED_AFTER_RESET', 'MFA_CHALLENGE_AFTER_PASSWORD_RESET',
    'MFA_VERIFIED_AFTER_PASSWORD_RESET', 'MFA_FAILED_AFTER_PASSWORD_RESET',
    'RECOVERY_CODE_USED', 'MFA_REENROLL_REQUIRED', 'AUTH_FLOW_BLOCKED_ROUTE_ATTEMPT',
    'MFA_LOGIN_VALIDADO', 'MFA_LOGIN_FALHOU', 'SESSAO_MFA_EXPIRADA',
    'SESSAO_MFA_REVOGADA', 'MFA_ACAO_SENSIVEL_VALIDADA',
    'MFA_ACAO_SENSIVEL_FALHOU', 'AUTORIZACAO_SENSIVEL_CONSUMIDA',
    'AUTORIZACAO_SENSIVEL_REUTILIZACAO_BLOQUEADA'
  ]));

alter table public.seguranca_rate_limits
  drop constraint if exists seguranca_rate_limits_escopo_check;
alter table public.seguranca_rate_limits
  add constraint seguranca_rate_limits_escopo_check check (escopo = any (array[
    'login', 'mfa_setup', 'mfa_totp', 'mfa_recovery', 'password_reset',
    'password_change', 'portal_fidc_test', 'portal_fidc_send',
    'critical_action', 'mfa_sensitive'
  ]));

commit;
