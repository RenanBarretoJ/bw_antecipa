-- P5.5 - registra duas excecoes conhecidas de Storage e publica a politica DLZ v5.
-- Uso exclusivo na janela autorizada. Nao remove, move ou altera objetos de Storage.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $p5_5$
declare
  v_fundo_id constant uuid := '7a114257-7816-468e-adf4-d796b93364df'::uuid;
  v_politica_id constant uuid := 'd1311000-0000-4000-8000-000000000001'::uuid;
  v_actor_id constant uuid := '799f0687-7cef-41f7-a0f7-78bb4c154f58'::uuid;
  v_correlation_id constant text := 'fa463f40-761a-49e2-8759-7dea7eba5c66';
  v_hash_v5 constant text := '00d6ed07b545cd3193f92e56b81f7a2e68faa37505c9717d99caa7d0e05429c5';
  v_storage_ids constant uuid[] := array[
    '923954aa-bb86-4294-be35-90deb55af01e'::uuid,
    '6c15cbed-3b11-4105-9bfb-022e44892225'::uuid
  ];
  v_storage_fingerprints constant jsonb := jsonb_build_object(
    '923954aa-bb86-4294-be35-90deb55af01e', 'e61f9086963e4fac9264cf75e5b9d9544a5ad4c5ceb1817039af9237f9a9e8ec',
    '6c15cbed-3b11-4105-9bfb-022e44892225', 'e60c2b27474a12546423f7e1dd0482c6c86b352d4a66b5d1b8e4359a2e3ea4b3'
  );
  v_v4 public.politica_operacional_versoes%rowtype;
  v_v5 public.politica_operacional_versoes%rowtype;
  v_published_at timestamptz := clock_timestamp();
  v_object_id uuid;
  v_object_fingerprint text;
begin
  perform pg_advisory_xact_lock(hashtextextended('P5_5_DLZ_POLICY_V5', 0));

  if not exists (
    select 1 from public.profiles p
    where p.id=v_actor_id and p.status='ativo' and p.role='gestor'
      and exists (
        select 1 from public.usuario_fundos uf
        where uf.usuario_id=p.id and uf.fundo_id=v_fundo_id and uf.status='ativo'
      )
  ) then
    raise exception 'P5.5 abortado: ator gestor DLZ nao esta ativo/autorizado';
  end if;

  if (select count(*) from storage.objects where id=any(v_storage_ids)) <> 2 then
    raise exception 'P5.5 abortado: conjunto de excecoes Storage divergiu';
  end if;

  foreach v_object_id in array v_storage_ids loop
    select encode(extensions.digest(o.bucket_id || ':' || o.name, 'sha256'), 'hex')
      into strict v_object_fingerprint
    from storage.objects o
    join storage.buckets b on b.id=o.bucket_id
    where o.id=v_object_id
      and o.bucket_id='notas-fiscais'
      and b.public is false
      and to_jsonb(o)->>'archived_at' is null
      and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false) is false;

    if v_object_fingerprint <> v_storage_fingerprints->>v_object_id::text then
      raise exception 'P5.5 abortado: fingerprint da excecao Storage divergiu';
    end if;

    insert into public.logs_auditoria (
      usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois,
      ator_tipo,origem,ator_identificador
    )
    select
      v_actor_id,'STORAGE_KNOWN_EXCEPTION_REGISTERED','storage.objects',v_object_id,
      jsonb_build_object(
        'classification','KNOWN_UNREFERENCED_STORAGE',
        'context','DLZ_HEALTH',
        'decision','PRESERVAR',
        'fingerprint_sha256',v_object_fingerprint,
        'correlation_id',v_correlation_id,
        'review_required',true
      ),
      'sistema','cutover_p5_5','P5_5_AUTHORIZED_CUTOVER'
    where not exists (
      select 1 from public.logs_auditoria l
      where l.tipo_evento='STORAGE_KNOWN_EXCEPTION_REGISTERED'
        and l.entidade_tipo='storage.objects'
        and l.entidade_id=v_object_id
        and l.dados_depois->>'correlation_id'=v_correlation_id
    );
  end loop;

  select v.* into v_v5
  from public.politica_operacional_versoes v
  where v.politica_operacional_id=v_politica_id and v.versao=5
  for update;

  if found then
    if v_v5.status<>'publicada'
      or v_v5.metodo_calculo_financeiro<>'DIAS_CORRIDOS_365'
      or v_v5.vigente_ate is not null
      or v_v5.publicada_em is null
      or (select count(*) from public.politica_operacional_versoes v where v.politica_operacional_id=v_politica_id and v.status='publicada')<>1
    then
      raise exception 'P5.5 abortado: v5 preexistente nao corresponde ao estado publicado certificado';
    end if;
    return;
  end if;

  select v.* into strict v_v4
  from public.politica_operacional_versoes v
  where v.politica_operacional_id=v_politica_id
    and v.fundo_id=v_fundo_id
    and v.versao=4
    and v.status='publicada'
    and v.publicada_em is not null
    and v.vigente_ate is null
  for update;

  if (select count(*) from public.politica_operacional_versoes v where v.politica_operacional_id=v_politica_id and v.status='publicada')<>1
    or v_v4.aceite_sacado_obrigatorio is not true
    or v_v4.cessao_no_desembolso is not true
    or v_v4.cria_acompanhamento_entrega is not false
    or v_v4.permite_postergacao_upload_canhoto is not false
    or v_v4.metodo_calculo_financeiro<>'TRINTA_360'
    or v_v4.exigir_status_logistico_pre_cessao is not false
    or v_v4.tipo_ativo_financeiro<>'NOTA_FISCAL'
    or v_v4.controle_exposicao_logistica_ativo is not false
    or v_v4.gate_risco_ativo is not false
    or exists (select 1 from public.politica_requisitos_documentais r where r.politica_operacional_versao_id=v_v4.id)
  then
    raise exception 'P5.5 abortado: v4 nao corresponde a base semantica autorizada';
  end if;

  insert into public.politica_operacional_versoes (
    politica_operacional_id,cedente_fundo_id,fundo_id,versao,vigente_desde,vigente_ate,
    aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,
    configuracao,regras,parametros,conteudo_hash,publicada_por,publicada_em,
    created_at,updated_at,status,substituida_em,permite_postergacao_upload_canhoto,
    limite_postergacao_upload_canhoto_dias,metodo_calculo_financeiro,tipo_ativo_financeiro,
    exigir_status_logistico_pre_cessao,controle_exposicao_logistica_ativo,
    limite_exposicao_em_transito_pct,gate_risco_ativo,limite_inclusivo,
    tratamento_pl_indisponivel,tratamento_indeterminada,tratamento_sem_match,
    tratamento_operacao_nao_incorporada,tratamento_liquidacao_parcial
  )
  select
    politica_operacional_id,cedente_fundo_id,fundo_id,5,v_published_at,null,
    aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,
    configuracao,regras,parametros,v_hash_v5,null,null,
    v_published_at,v_published_at,'rascunho',null,permite_postergacao_upload_canhoto,
    limite_postergacao_upload_canhoto_dias,'DIAS_CORRIDOS_365',tipo_ativo_financeiro,
    exigir_status_logistico_pre_cessao,controle_exposicao_logistica_ativo,
    limite_exposicao_em_transito_pct,gate_risco_ativo,limite_inclusivo,
    tratamento_pl_indisponivel,tratamento_indeterminada,tratamento_sem_match,
    tratamento_operacao_nao_incorporada,tratamento_liquidacao_parcial
  from public.politica_operacional_versoes
  where id=v_v4.id
  returning * into strict v_v5;

  if (to_jsonb(v_v5)
      -array['id','versao','status','created_at','updated_at','vigente_desde','vigente_ate','publicada_em','publicada_por','substituida_em','conteudo_hash','metodo_calculo_financeiro'])
     is distinct from
     (to_jsonb(v_v4)
      -array['id','versao','status','created_at','updated_at','vigente_desde','vigente_ate','publicada_em','publicada_por','substituida_em','conteudo_hash','metodo_calculo_financeiro'])
    or v_v5.metodo_calculo_financeiro<>'DIAS_CORRIDOS_365'
  then
    raise exception 'P5.5 abortado: diff v4/v5 possui alteracao adicional';
  end if;

  insert into public.logs_auditoria (
    usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois,
    ator_tipo,origem,ator_identificador
  ) values (
    v_actor_id,'POLITICA_OPERACIONAL_VERSAO_CRIADA','politica_operacional_versoes',v_v5.id,
    jsonb_build_object('politica_operacional_id',v_politica_id,'fundo_id',v_fundo_id,'versao',5,'conteudo_hash',v_hash_v5,'correlation_id',v_correlation_id),
    'sistema','cutover_p5_5','P5_5_AUTHORIZED_CUTOVER'
  );

  update public.politica_operacional_versoes
  set vigente_ate=v_published_at,status='substituida',substituida_em=v_published_at
  where id=v_v4.id;

  update public.politica_operacional_versoes
  set vigente_desde=v_published_at,publicada_por=v_actor_id,publicada_em=v_published_at,status='publicada'
  where id=v_v5.id
  returning * into strict v_v5;

  update public.politicas_operacionais set status='ativa' where id=v_politica_id;

  insert into public.logs_auditoria (
    usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_depois,
    ator_tipo,origem,ator_identificador
  ) values (
    v_actor_id,'POLITICA_OPERACIONAL_VERSAO_PUBLICADA','politica_operacional_versoes',v_v5.id,
    jsonb_build_object('fundo_id',v_fundo_id,'versao',5,'publicada_em',v_v5.publicada_em,'correlation_id',v_correlation_id),
    'sistema','cutover_p5_5','P5_5_AUTHORIZED_CUTOVER'
  );
end;
$p5_5$;

commit;
