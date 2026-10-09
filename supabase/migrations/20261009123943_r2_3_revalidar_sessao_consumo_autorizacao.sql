-- R2.3: consumir uma autorizacao exige que a sessao MFA continue valida.
-- Nao altera autorizacoes existentes, auditoria, ACLs ou migrations historicas.
begin;

do $precondition$
begin
  if to_regprocedure('public.consumir_autorizacao_acao_sensivel(text,text)') is null
     or to_regprocedure('public.obter_sessao_mfa_atual()') is null then
    raise exception 'R2_3_MFA_PREREQUISITE_MISSING';
  end if;
end;
$precondition$;

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
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_autorizacao_id uuid;
  v_consumida uuid;
begin
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    return false;
  end;

  if v_user_id is null or v_session_id is null then
    return false;
  end if;

  -- Ordem fixa: sessao Auth -> elevacao -> autorizacao.
  -- SHARE conflita com DELETE/UPDATE de logout/revogacao ate o fim da transacao.
  perform 1 from auth.sessions s
   where s.id = v_session_id and s.user_id = v_user_id
   for share;
  if not found then
    return false;
  end if;

  perform 1 from public.sessoes_elevadas e
   where e.user_id = v_user_id and e.session_id = v_session_id
   for share;
  if not found then
    return false;
  end if;

  select a.id into v_autorizacao_id
    from public.autorizacoes_acoes_sensiveis a
   where a.user_id = v_user_id
     and a.session_id = v_session_id
     and a.action_type = p_action_type
     and a.nonce_hash = p_nonce_hash
     and a.consumida_em is null
     and a.revogada_em is null
     and clock_timestamp() < a.expira_em
   for update;
  if not found then
    return false;
  end if;

  -- Revalidar depois de qualquer espera por locks; reutiliza o contrato canonico
  -- de AAL2, not_after, elevacao fixa, revogacao e fator TOTP verificado.
  if not exists (
    select 1 from public.obter_sessao_mfa_atual() estado
     where estado.status = 'valid' and estado.session_id = v_session_id
  ) then
    return false;
  end if;

  update public.autorizacoes_acoes_sensiveis a
     set consumida_em = clock_timestamp()
   where a.id = v_autorizacao_id
     and a.user_id = v_user_id
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

-- CREATE OR REPLACE preserva owner e grants da funcao existente.
commit;
