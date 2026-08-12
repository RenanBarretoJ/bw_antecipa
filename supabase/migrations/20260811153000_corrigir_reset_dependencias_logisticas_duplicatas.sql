-- Mantem o reset de homologacao compativel com dependencias operacionais
-- criadas depois da RPC original: evidencias/memorias logisticas e duplicatas.

begin;

do $$
begin
  if to_regprocedure('public.reset_operacional_fundo_homolog_sem_dependencias_recentes(uuid,text,boolean,text,text)') is null then
    if to_regprocedure('public.reset_operacional_fundo_homolog(uuid,text,boolean,text,text)') is null then
      raise exception 'RPC public.reset_operacional_fundo_homolog nao encontrada';
    end if;

    alter function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
      rename to reset_operacional_fundo_homolog_sem_dependencias_recentes;
  else
    drop function if exists public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text);
  end if;
end;
$$;

create or replace function public.reset_operacional_fundo_homolog(
  p_fundo_id uuid,
  p_modo text default 'preview',
  p_apagar_notas_fiscais boolean default true,
  p_confirmacao text default null,
  p_escopo text default 'operacional'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_resultado jsonb;
  v_lock_key bigint;
  v_memorias_antes integer := 0;
  v_memorias_depois integer := 0;
  v_evidencias_antes integer := 0;
  v_evidencias_depois integer := 0;
  v_duplicatas_antes integer := 0;
  v_duplicatas_depois integer := 0;
  v_duplicata_storage jsonb := '[]'::jsonb;
begin
  if p_modo not in ('preview', 'reset', 'validate') then
    raise exception 'Modo invalido: %. Use preview, reset ou validate.', p_modo;
  end if;

  if p_escopo not in ('operacional', 'completo') then
    raise exception 'Escopo invalido: %. Use operacional ou completo.', p_escopo;
  end if;

  if p_modo = 'reset' and p_confirmacao is distinct from 'RESETAR_HOMOLOG' then
    raise exception 'Confirmacao obrigatoria ausente. Informe p_confirmacao = RESETAR_HOMOLOG.';
  end if;

  if not exists (select 1 from public.fundos f where f.id = p_fundo_id) then
    raise exception 'Fundo % nao encontrado.', p_fundo_id;
  end if;

  v_lock_key := ('x' || substr(md5('bw_antecipa_reset_fundo:' || p_fundo_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  if to_regclass('public.operacao_nf_logistica_memorias') is not null then
    select count(*)::integer
      into v_memorias_antes
    from public.operacao_nf_logistica_memorias m
    where m.fundo_id = p_fundo_id;
  end if;

  if to_regclass('public.evidencias_logisticas_antecipadas') is not null
     and (p_apagar_notas_fiscais or p_escopo = 'completo') then
    select count(*)::integer
      into v_evidencias_antes
    from public.evidencias_logisticas_antecipadas e
    where e.fundo_id = p_fundo_id;
  end if;

  if to_regclass('public.duplicatas') is not null and p_apagar_notas_fiscais then
    select count(*)::integer
      into v_duplicatas_antes
    from public.duplicatas d
    where d.fundo_id = p_fundo_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', dv.bucket,
          'storage_path', dv.path,
          'nome_arquivo', dv.nome_original,
          'entidade_origem', 'duplicata_versoes',
          'duplicata_id', dv.duplicata_id,
          'duplicata_versao_id', dv.id
        )
        order by dv.bucket, dv.path
      ),
      '[]'::jsonb
    )
      into v_duplicata_storage
    from public.duplicata_versoes dv
    join public.duplicatas d on d.id = dv.duplicata_id
    where d.fundo_id = p_fundo_id;
  end if;

  if p_modo = 'reset' then
    if to_regclass('public.operacao_nf_logistica_memorias') is not null
       and v_memorias_antes > 0 then
      begin
        alter table public.operacao_nf_logistica_memorias
          disable trigger operacao_nf_logistica_memoria_append_only;

        delete from public.operacao_nf_logistica_memorias m
        where m.fundo_id = p_fundo_id;

        alter table public.operacao_nf_logistica_memorias
          enable trigger operacao_nf_logistica_memoria_append_only;
      exception when others then
        alter table public.operacao_nf_logistica_memorias
          enable trigger operacao_nf_logistica_memoria_append_only;
        raise exception 'Reset operacional homolog abortado ao remover memorias logisticas: %', sqlerrm
          using errcode = sqlstate;
      end;
    end if;

    if to_regclass('public.evidencias_logisticas_antecipadas') is not null
       and (p_apagar_notas_fiscais or p_escopo = 'completo') then
      delete from public.evidencia_logistica_versoes ev
      using public.evidencias_logisticas_antecipadas e
      where ev.evidencia_logistica_id = e.id
        and e.fundo_id = p_fundo_id;

      delete from public.evidencias_logisticas_antecipadas e
      where e.fundo_id = p_fundo_id;
    end if;

    if to_regclass('public.duplicatas') is not null and p_apagar_notas_fiscais then
      begin
        alter table public.duplicata_correcoes
          disable trigger duplicata_correcoes_append_only;
        alter table public.duplicata_validacoes
          disable trigger duplicata_validacoes_append_only;
        alter table public.duplicata_versoes
          disable trigger duplicata_versoes_append_only;

        delete from public.duplicata_correcoes dc
        using public.duplicatas d
        where dc.duplicata_id = d.id
          and d.fundo_id = p_fundo_id;

        delete from public.duplicata_validacoes dv
        using public.duplicatas d
        where dv.duplicata_id = d.id
          and d.fundo_id = p_fundo_id;

        update public.duplicatas d
           set versao_atual_id = null
         where d.fundo_id = p_fundo_id
           and d.versao_atual_id is not null;

        delete from public.duplicata_versoes dv
        using public.duplicatas d
        where dv.duplicata_id = d.id
          and d.fundo_id = p_fundo_id;

        delete from public.duplicatas d
        where d.fundo_id = p_fundo_id;

        alter table public.duplicata_versoes
          enable trigger duplicata_versoes_append_only;
        alter table public.duplicata_validacoes
          enable trigger duplicata_validacoes_append_only;
        alter table public.duplicata_correcoes
          enable trigger duplicata_correcoes_append_only;
      exception when others then
        alter table public.duplicata_versoes
          enable trigger duplicata_versoes_append_only;
        alter table public.duplicata_validacoes
          enable trigger duplicata_validacoes_append_only;
        alter table public.duplicata_correcoes
          enable trigger duplicata_correcoes_append_only;
        raise exception 'Reset operacional homolog abortado ao remover duplicatas: %', sqlerrm
          using errcode = sqlstate;
      end;
    end if;
  end if;

  v_resultado := public.reset_operacional_fundo_homolog_sem_dependencias_recentes(
    p_fundo_id,
    p_modo,
    p_apagar_notas_fiscais,
    p_confirmacao,
    p_escopo
  );

  if to_regclass('public.operacao_nf_logistica_memorias') is not null then
    select count(*)::integer
      into v_memorias_depois
    from public.operacao_nf_logistica_memorias m
    where m.fundo_id = p_fundo_id;
  end if;

  if to_regclass('public.evidencias_logisticas_antecipadas') is not null then
    select count(*)::integer
      into v_evidencias_depois
    from public.evidencias_logisticas_antecipadas e
    where e.fundo_id = p_fundo_id;
  end if;

  if to_regclass('public.duplicatas') is not null then
    select count(*)::integer
      into v_duplicatas_depois
    from public.duplicatas d
    where d.fundo_id = p_fundo_id;
  end if;

  v_resultado := jsonb_set(
    v_resultado,
    '{storage_objects}',
    coalesce(v_resultado->'storage_objects', '[]'::jsonb) || v_duplicata_storage,
    true
  );

  if p_modo = 'preview' then
    v_resultado := jsonb_set(v_resultado, '{contagens,memorias_logisticas}', to_jsonb(v_memorias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens,evidencias_logisticas_antecipadas}', to_jsonb(v_evidencias_antes), true);
    return jsonb_set(v_resultado, '{contagens,duplicatas}', to_jsonb(v_duplicatas_antes), true);
  end if;

  if p_modo = 'reset' then
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,memorias_logisticas}', to_jsonb(v_memorias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,evidencias_logisticas_antecipadas}', to_jsonb(v_evidencias_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_antes,duplicatas}', to_jsonb(v_duplicatas_antes), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,memorias_logisticas_restantes}', to_jsonb(v_memorias_depois), true);
    v_resultado := jsonb_set(v_resultado, '{contagens_depois,evidencias_logisticas_antecipadas_restantes}', to_jsonb(v_evidencias_depois), true);
    return jsonb_set(v_resultado, '{contagens_depois,duplicatas_restantes}', to_jsonb(v_duplicatas_depois), true);
  end if;

  return v_resultado || jsonb_build_object(
    'memorias_logisticas_restantes', v_memorias_depois,
    'evidencias_logisticas_antecipadas_restantes', v_evidencias_depois,
    'duplicatas_restantes', v_duplicatas_depois
  );
end;
$$;

comment on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text) is
  'Wrapper transacional de homologacao que remove dependencias logisticas e duplicatas antes do reset operacional do fundo.';

revoke all on function public.reset_operacional_fundo_homolog_sem_dependencias_recentes(uuid, text, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.reset_operacional_fundo_homolog(uuid, text, boolean, text, text)
  to service_role;

commit;
