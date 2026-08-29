-- P5.2 - neutralizacao forward-only dos resets exclusivos de homologacao.
--
-- As migrations historicas que instalaram estas funcoes permanecem registradas.
-- Esta migration remove somente os artefatos executaveis; nao altera dados
-- operacionais nem o historico de migrations.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(
  hashtextextended('bw_antecipa:p5_2:neutralizar_resets_homolog', 0)
);

do $migration$
declare
  v_funcao regprocedure;
begin
  -- O prefixo e reservado aos resets destrutivos de homologacao. A busca por
  -- catalogo tambem cobre overloads e nomes truncados pelo limite de 63 bytes
  -- do PostgreSQL, sem depender da forma textual usada nas migrations antigas.
  for v_funcao in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'reset_operacional_fundo_homolog%'
     order by p.oid
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_funcao
    );

    -- RESTRICT e intencional: uma dependencia legitima faz a migration falhar
    -- fechada, em vez de remover objetos em cascata.
    execute format('drop function %s restrict', v_funcao);
  end loop;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'reset_operacional_fundo_homolog%'
  ) then
    raise exception
      'P5.2 abortada: permaneceu funcao de reset operacional de homologacao.';
  end if;
end
$migration$;

notify pgrst, 'reload schema';

commit;
