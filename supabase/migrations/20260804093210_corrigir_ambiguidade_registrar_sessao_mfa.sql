-- Corrige a ambiguidade entre o parametro de saida `session_id` e a coluna
-- homonima de `sessoes_elevadas` no alvo do ON CONFLICT.

begin;

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
  on conflict on constraint sessoes_elevadas_pkey do update set
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

revoke all on function public.registrar_sessao_mfa_atual(text) from public, anon;
grant execute on function public.registrar_sessao_mfa_atual(text) to authenticated;

commit;
