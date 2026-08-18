begin;

select set_config('app.qa_dataset', 'P2.6.10', true);

-- Atores temporarios criados previamente pelo Auth real. Nenhuma credencial e
-- persistida neste arquivo.
update public.profiles
set role = 'gestor', status = 'ativo', nome_completo = 'P2.6.10 Gestor QA A'
where id = '60b0c3c5-14df-43ab-8fbd-246bb4caaf05';
update public.profiles
set role = 'gestor', status = 'ativo', nome_completo = 'P2.6.10 Gestor QA B'
where id = 'b529b048-6486-4157-acbd-0eaf04a47cca';
update public.profiles
set role = 'super_admin', status = 'ativo', nome_completo = 'P2.6.10 Super Admin Puro'
where id = '145e724b-d74b-4949-a726-778200b67cf3';
update public.profiles
set role = 'gestor', status = 'ativo', nome_completo = 'P2.6.10 Super Admin Gestor'
where id = 'acc04177-d399-4e81-a1de-66c683c5026a';

insert into public.usuario_papeis (usuario_id, papel, ativo, origem, atribuido_por)
values
  ('60b0c3c5-14df-43ab-8fbd-246bb4caaf05', 'gestor', true, 'bootstrap_homolog', null),
  ('b529b048-6486-4157-acbd-0eaf04a47cca', 'gestor', true, 'bootstrap_homolog', null),
  ('145e724b-d74b-4949-a726-778200b67cf3', 'super_admin', true, 'bootstrap_homolog', null),
  ('acc04177-d399-4e81-a1de-66c683c5026a', 'gestor', true, 'bootstrap_homolog', null),
  ('acc04177-d399-4e81-a1de-66c683c5026a', 'super_admin', true, 'bootstrap_homolog', null)
on conflict (usuario_id, papel) do update set ativo=true, revogado_em=null, origem=excluded.origem;

create temporary table p2610_scenarios (
  ord integer primary key,
  codigo text unique not null,
  valor numeric(15,2) not null,
  com_cte boolean not null
) on commit drop;

insert into p2610_scenarios values
  (1, 'APTO',             1000000.00, true),
  (2, 'NO_LIMITE_40',    20000000.00, true),
  (3, 'ACIMA_40',        20000000.01, true),
  (4, 'REVISAO_LIBERAR', 1000000.00, false),
  (5, 'REVISAO_RECUSAR', 1000000.00, false),
  (6, 'DOUBLE',           1000000.00, true),
  (7, 'TOCTOU',           1000000.00, true),
  (8, 'STALE_REVIEW',     1000000.00, false);

-- Reinicializacao estritamente limitada aos IDs deterministas da certificacao.
-- Os resultados produtivos permanecem protegidos; o bypass de triggers existe
-- apenas para tornar a massa sintetica repetivel em homologacao.
set local session_replication_role = replica;
update public.operacoes
set status='solicitada', aprovado_por=null, aprovado_em=null,
    preco_aquisicao=null, valor_liquido_desembolso=null,
    risco_execucao_id=null, risco_revisao_id=null,
    risco_decisao_snapshot=null, risco_assinatura_inputs=null,
    risco_avaliado_em=null, updated_at=clock_timestamp()
where id in (select md5('P2.6.10:OP:'||codigo)::uuid from p2610_scenarios);
delete from public.operacao_calculo_nfs
where operacao_id in (select md5('P2.6.10:OP:'||codigo)::uuid from p2610_scenarios);
delete from public.risco_motivos
where risco_execucao_id in (
  select id from public.risco_execucoes
  where operacao_id in (select md5('P2.6.10:OP:'||codigo)::uuid from p2610_scenarios)
);
delete from public.risco_revisoes
where operacao_id in (select md5('P2.6.10:OP:'||codigo)::uuid from p2610_scenarios);
delete from public.risco_execucoes
where operacao_id in (select md5('P2.6.10:OP:'||codigo)::uuid from p2610_scenarios);
update public.notas_fiscais
set status='em_antecipacao'
where id in (select md5('P2.6.10:NF:'||codigo)::uuid from p2610_scenarios);
set local session_replication_role = origin;

insert into public.fundos (
  id,nome,cnpj,administradora_nome,administradora_cnpj,
  gestora_nome,gestora_cnpj,custodiante_nome,custodiante_cnpj,ativo,created_by
)
select md5('P2.6.10:FUNDO:'||codigo)::uuid,
       'QA P2.6.10 '||codigo||' FIDC',
       '991000000000'||lpad(ord::text,2,'0'),
       'QA P2.6.10 ADMINISTRADORA','99110000000001',
       'QA P2.6.10 GESTORA','99120000000001',
       'QA P2.6.10 CUSTODIANTE','99130000000001',true,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05'
from p2610_scenarios
on conflict (id) do update set nome=excluded.nome, ativo=true;

insert into public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
select md5('P2.6.10:UF:A:'||codigo)::uuid,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',
       md5('P2.6.10:FUNDO:'||codigo)::uuid,'gestor','ativo',ord=1
from p2610_scenarios
on conflict do nothing;

-- O gestor B participa somente do fundo concorrente; o hibrido somente do
-- fundo de revisao liberada. O Super Admin puro nao recebe fundo.
insert into public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
values
  (md5('P2.6.10:UF:B:DOUBLE')::uuid,'b529b048-6486-4157-acbd-0eaf04a47cca',md5('P2.6.10:FUNDO:DOUBLE')::uuid,'gestor','ativo',false),
  (md5('P2.6.10:UF:H:REVISAO_LIBERAR')::uuid,'acc04177-d399-4e81-a1de-66c683c5026a',md5('P2.6.10:FUNDO:REVISAO_LIBERAR')::uuid,'gestor','ativo',false)
on conflict do nothing;

insert into public.cedentes (id,user_id,cnpj,razao_social,nome_fantasia,email_comercial,status)
values (
  md5('P2.6.10:CEDENTE')::uuid,
  '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',
  '99141111000100','QA P2.6.10 CEDENTE','QA P2.6.10 CEDENTE',
  'cedente@p2-6-10.qa.invalid','ativo'
)
on conflict (id) do update set status='ativo';

insert into public.sacados (id,user_id,cnpj,razao_social,email)
values (
  md5('P2.6.10:SACADO')::uuid,
  'b529b048-6486-4157-acbd-0eaf04a47cca',
  '99142222000100','QA P2.6.10 SACADO','sacado@p2-6-10.qa.invalid'
)
on conflict (id) do update set razao_social=excluded.razao_social;

insert into public.cedente_fundos (id,cedente_id,fundo_id,codigo_externo,status,observacoes)
select md5('P2.6.10:CF:'||codigo)::uuid,
       md5('P2.6.10:CEDENTE')::uuid,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,
       'P2610-'||codigo,'ativo','P2.6.10'
from p2610_scenarios
on conflict (id) do update set status='ativo', vigente_ate=null;

insert into public.politicas_operacionais (id,fundo_id,codigo,nome,descricao,status,padrao,created_by)
select md5('P2.6.10:POL:'||codigo)::uuid,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,
       'P2610_'||codigo,'Politica QA P2.6.10 '||codigo,
       'Fixture isolada da certificacao P2.6.10','ativa',true,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05'
from p2610_scenarios
on conflict (id) do nothing;

insert into public.politica_operacional_versoes (
  id,politica_operacional_id,cedente_fundo_id,fundo_id,versao,status,
  vigente_desde,aceite_sacado_obrigatorio,cessao_no_desembolso,
  cria_acompanhamento_entrega,configuracao,regras,parametros,conteudo_hash,
  publicada_por,publicada_em,permite_postergacao_upload_canhoto,
  limite_postergacao_upload_canhoto_dias,metodo_calculo_financeiro,
  exigir_status_logistico_pre_cessao,tipo_ativo_financeiro,
  controle_exposicao_logistica_ativo,limite_exposicao_em_transito_pct,
  gate_risco_ativo,limite_inclusivo,tratamento_pl_indisponivel,
  tratamento_indeterminada,tratamento_sem_match,
  tratamento_operacao_nao_incorporada,tratamento_liquidacao_parcial
)
select md5('P2.6.10:PV:'||codigo)::uuid,
       md5('P2.6.10:POL:'||codigo)::uuid,null,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,1,'publicada',
       '2026-08-14T09:00:00-03'::timestamptz,false,false,true,
       jsonb_build_object('qa_dataset','P2.6.10','scenario',codigo),
       '{}'::jsonb,'{}'::jsonb,encode(digest('P2.6.10:PV:'||codigo,'sha256'),'hex'),
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',clock_timestamp(),
       false,null,'DIAS_CORRIDOS_365',false,'NOTA_FISCAL',true,40,true,true,
       'BLOQUEAR','REVISAO_MANUAL','BLOQUEAR','BLOQUEAR','SINALIZAR'
from p2610_scenarios
on conflict (id) do nothing;

insert into public.cedente_fundo_politicas (
  id,cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por,motivo
)
select md5('P2.6.10:ATR:'||codigo)::uuid,
       md5('P2.6.10:CF:'||codigo)::uuid,
       md5('P2.6.10:POL:'||codigo)::uuid,'ativa',
       '2026-08-14T10:00:00-03'::timestamptz,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05','P2.6.10'
from p2610_scenarios
on conflict (id) do nothing;

insert into public.taxas_cedente (id,cedente_id,prazo_min,prazo_max,taxa_percentual)
values (md5('P2.6.10:TAXA')::uuid,md5('P2.6.10:CEDENTE')::uuid,0,365,0)
on conflict (id) do update set taxa_percentual=0;

insert into public.notas_fiscais (
  id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
  data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
  cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
  descricao_itens,condicao_pagamento,status
)
select md5('P2.6.10:NF:'||codigo)::uuid,md5('P2.6.10:CEDENTE')::uuid,
       md5('P2.6.10:CF:'||codigo)::uuid,md5('P2.6.10:FUNDO:'||codigo)::uuid,
       'P2610-'||lpad(ord::text,2,'0'),'1',lpad(ord::text,44,'0'),
       '2026-08-18','2026-09-17','99141111000100','QA P2.6.10 CEDENTE',
       '99142222000100','QA P2.6.10 SACADO',valor,valor,
       'P2.6.10 '||codigo,'Fixture sintetica','em_antecipacao'
from p2610_scenarios
on conflict (id) do update set status='em_antecipacao',valor_bruto=excluded.valor_bruto;

insert into public.operacoes (
  id,cedente_id,cedente_fundo_id,politica_operacional_id,
  politica_operacional_versao_id,politica_atribuicao_id,politica_versao,
  politica_snapshot,politica_snapshot_hash,contexto_configuracao_status,
  contexto_capturado_em,aceite_sacado_exigido,aceite_sacado_status,
  valor_bruto_total,taxa_desconto,prazo_dias,data_vencimento,status,
  valor_face_total,metodo_calculo_financeiro,calculo_data_base,
  calculo_versao_motor,solicitacao_idempotency_key
)
select md5('P2.6.10:OP:'||codigo)::uuid,md5('P2.6.10:CEDENTE')::uuid,
       md5('P2.6.10:CF:'||codigo)::uuid,md5('P2.6.10:POL:'||codigo)::uuid,
       md5('P2.6.10:PV:'||codigo)::uuid,md5('P2.6.10:ATR:'||codigo)::uuid,1,
       jsonb_build_object(
         'schema','bw-antecipa.politica-operacional.v1','qa_dataset','P2.6.10',
         'scenario',codigo,'tipo_ativo_financeiro','NOTA_FISCAL',
         'cedente_fundo_id',md5('P2.6.10:CF:'||codigo)::text,
         'politica_operacional_id',md5('P2.6.10:POL:'||codigo)::text,
         'politica_operacional_versao_id',md5('P2.6.10:PV:'||codigo)::text,
         'politica_versao',1,
         'aceite_sacado_obrigatorio',false,'cessao_no_desembolso',false,
         'cria_acompanhamento_entrega',true,'exigir_status_logistico_pre_cessao',false,
         'calculo_financeiro',jsonb_build_object('metodo','DIAS_CORRIDOS_365','versao_motor',1),
         'requisitos','[]'::jsonb
       ),
       encode(digest('P2.6.10:SNAPSHOT:'||codigo,'sha256'),'hex'),'completo',clock_timestamp(),
       false,'dispensado',valor,0,30,'2026-09-17','solicitada',valor,
       'DIAS_CORRIDOS_365','2026-08-18',1,'P2.6.10-'||codigo
from p2610_scenarios
on conflict (id) do update set status='solicitada',aprovado_por=null,aprovado_em=null,
  preco_aquisicao=null,valor_liquido_desembolso=null,risco_execucao_id=null,
  risco_revisao_id=null,risco_decisao_snapshot=null,risco_assinatura_inputs=null,
  risco_avaliado_em=null,updated_at=clock_timestamp();

insert into public.operacoes_nfs (operacao_id,nota_fiscal_id)
select md5('P2.6.10:OP:'||codigo)::uuid,md5('P2.6.10:NF:'||codigo)::uuid
from p2610_scenarios on conflict do nothing;

-- Bases canonicas requeridas no D0 2026-08-18. O estoque D-2 civil e
-- necessario para a conciliacao D2/D1; movimentos vazios sao declarados.
insert into public.importacoes_financeiras (
  id,fundo_id,provedor,tipo_base,data_referencia,layout_nome,versao_layout,
  status,completude,origem,hash_conteudo,nome_arquivo,mime_type,tamanho_bytes,storage_bucket,storage_path,encoding_detectado,
  linhas_total,linhas_validas,linhas_invalidas,linhas_warning,
  linhas_publicadas,valor_total,erros,metadados,correlation_id,criado_por,
  publicada_em,finalizada_em,declaracao_sem_movimento
)
select md5('P2.6.10:IMP:'||s.codigo||':'||b.tipo||':'||b.data_ref)::uuid,
       md5('P2.6.10:FUNDO:'||s.codigo)::uuid,'QA_P2_6_10',b.tipo,b.data_ref::date,
       'P2.6.10_'||b.tipo,'1','PUBLICADA',
       case when b.tipo in ('CARTEIRA','ESTOQUE') then 'COMPLETO_COM_DADOS' else 'COMPLETO_VAZIO' end,
       'GOLDEN_DATASET',encode(digest('P2.6.10:IMP:'||s.codigo||':'||b.tipo||':'||b.data_ref,'sha256'),'hex'),
       case when b.tipo in ('CARTEIRA','ESTOQUE') then 'p2-6-10-'||lower(s.codigo)||'-'||lower(b.tipo)||'-'||b.data_ref||'.csv' else null end,
       case when b.tipo in ('CARTEIRA','ESTOQUE') then 'text/csv' else null end,
       0,
       case when b.tipo in ('CARTEIRA','ESTOQUE') then 'financeiro-importacoes' else null end,
       case when b.tipo in ('CARTEIRA','ESTOQUE') then 'qa/p2-6-10/'||lower(s.codigo)||'/'||lower(b.tipo)||'-'||b.data_ref||'.csv' else null end,
       'UTF-8',case when b.tipo='CARTEIRA' then 1 else 0 end,
       case when b.tipo='CARTEIRA' then 1 else 0 end,0,0,
       case when b.tipo='CARTEIRA' then 1 else 0 end,
       case when b.tipo='CARTEIRA' then 50000000 else 0 end,
       '[]'::jsonb,jsonb_build_object('qa_dataset','P2.6.10','scenario',s.codigo),
       md5('P2.6.10:CORR:'||s.codigo||':'||b.tipo||':'||b.data_ref)::uuid,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',clock_timestamp(),clock_timestamp(),
       b.tipo in ('AQUISICOES','LIQUIDACOES')
from p2610_scenarios s
cross join (values
  ('CARTEIRA','2026-08-14'),('ESTOQUE','2026-08-16'),
  ('ESTOQUE','2026-08-17'),('AQUISICOES','2026-08-17'),
  ('LIQUIDACOES','2026-08-17')
) b(tipo,data_ref)
on conflict (id) do nothing;

insert into public.importacao_linhas (
  id,importacao_id,fundo_id,numero_linha,status,dados_brutos,dados_normalizados,erros,avisos
)
select md5('P2.6.10:LINHA:CARTEIRA:'||codigo)::uuid,
       md5('P2.6.10:IMP:'||codigo||':CARTEIRA:2026-08-14')::uuid,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,2,'VALIDA',
       jsonb_build_object('PATRIMONIO_LIQUIDO','50000000.00'),
       jsonb_build_object('patrimonio_liquido','50000000.00','data_referencia','2026-08-14'),
       '[]'::jsonb,'[]'::jsonb
from p2610_scenarios on conflict (id) do nothing;

-- Uma posicao canonica por cenario garante que o pipeline oficial tenha
-- fonte publicada nao vazia. O valor de aquisicao corrente e zero: a
-- exposicao projetada deve vir exclusivamente da operacao candidata.
insert into public.importacao_linhas (
  id,importacao_id,fundo_id,numero_linha,status,dados_brutos,dados_normalizados,erros,avisos
)
select md5('P2.6.10:LINHA:ESTOQUE:'||s.codigo||':'||d.data_ref)::uuid,
       md5('P2.6.10:IMP:'||s.codigo||':ESTOQUE:'||d.data_ref)::uuid,
       md5('P2.6.10:FUNDO:'||s.codigo)::uuid,2,'VALIDA',
       jsonb_build_object('ID_RECEBIVEL','P2.6.10-'||s.codigo),
       jsonb_build_object('id_recebivel','P2.6.10-'||s.codigo,'chave_nfe',lpad(s.ord::text,44,'0')),
       '[]'::jsonb,'[]'::jsonb
from p2610_scenarios s
cross join (values ('2026-08-16'),('2026-08-17')) d(data_ref)
on conflict (id) do nothing;

insert into public.estoque_posicoes (
  id,importacao_id,linha_id,fundo_id,provedor,data_referencia,id_recebivel,
  seu_numero,numero_documento,tipo_recebivel,chave_nfe,cedente_nome,
  cedente_documento,sacado_nome,sacado_documento,valor_nominal,
  valor_presente,valor_aquisicao,valor_pdd,data_emissao,
  data_vencimento_original,data_aquisicao,situacao_recebivel,vigente,
  publicada_em,external_title_key,payload_origem
)
select md5('P2.6.10:ESTOQUE:'||s.codigo||':'||d.data_ref)::uuid,
       md5('P2.6.10:IMP:'||s.codigo||':ESTOQUE:'||d.data_ref)::uuid,
       md5('P2.6.10:LINHA:ESTOQUE:'||s.codigo||':'||d.data_ref)::uuid,
       md5('P2.6.10:FUNDO:'||s.codigo)::uuid,'QA_P2_6_10',d.data_ref::date,
       'P2.6.10-'||s.codigo,'P2610-'||lpad(s.ord::text,2,'0'),
       'P2610-'||lpad(s.ord::text,2,'0'),'NOTA_FISCAL',lpad(s.ord::text,44,'0'),
       'QA P2.6.10 CEDENTE','99141111000100','QA P2.6.10 SACADO','99142222000100',
       s.valor,s.valor,0,0,'2026-08-18','2026-09-17','2026-08-18','ABERTO',
       true,clock_timestamp(),'P2.6.10-'||s.codigo,
       jsonb_build_object('qa_dataset','P2.6.10','scenario',s.codigo,'data_referencia',d.data_ref)
from p2610_scenarios s
cross join (values ('2026-08-16'),('2026-08-17')) d(data_ref)
on conflict (id) do nothing;

insert into public.carteira_snapshots (
  id,importacao_id,linha_id,fundo_id,provedor,data_referencia,
  fundo_externo,documento_fundo,versao_externa,patrimonio_liquido,
  publicada_externamente_em,vigente,payload_origem
)
select md5('P2.6.10:PL:'||codigo)::uuid,
       md5('P2.6.10:IMP:'||codigo||':CARTEIRA:2026-08-14')::uuid,
       md5('P2.6.10:LINHA:CARTEIRA:'||codigo)::uuid,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,'QA_P2_6_10','2026-08-14',
       'QA P2.6.10 '||codigo,'991000000000'||lpad(ord::text,2,'0'),'1',
       50000000,'2026-08-14T20:00:00-03'::timestamptz,true,
       jsonb_build_object('qa_dataset','P2.6.10','scenario',codigo)
from p2610_scenarios on conflict (id) do nothing;

-- Evidencia CT-e aprovada para os cenarios cuja classificacao deve ser
-- EM_TRANSITO. Os cenarios de revisao permanecem INDETERMINADA.
insert into public.documentos_repositorio (id,documento_tipo_id,status,criado_por)
select md5('P2.6.10:DOC:CTE:'||s.codigo)::uuid,dt.id,'aprovado',
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05'
from p2610_scenarios s
join public.documento_tipos dt on dt.codigo='cte_xml'
where s.com_cte
on conflict (id) do nothing;

insert into public.documento_versoes (
  id,documento_id,numero_versao,bucket,path,nome_original,mime_type,
  tamanho_bytes,sha256,status,substitui_versao_id,enviado_por,enviado_em
)
select md5('P2.6.10:DV:CTE:'||codigo)::uuid,
       md5('P2.6.10:DOC:CTE:'||codigo)::uuid,1,'documentos-v2',
       'qa/P2.6.10/'||codigo||'/cte.xml','cte-'||lower(codigo)||'.xml','application/xml',
       1024,encode(digest('P2.6.10:DV:CTE:'||codigo,'sha256'),'hex'),'aprovado',null,
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',clock_timestamp()
from p2610_scenarios where com_cte on conflict (id) do nothing;

insert into public.documento_analises (
  id,documento_versao_id,resultado,analisado_por,ator_tipo,observacoes,dados_estruturados,analisado_em
)
select md5('P2.6.10:DA:CTE:'||codigo)::uuid,
       md5('P2.6.10:DV:CTE:'||codigo)::uuid,'aprovado',
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05','usuario',
       'Fixture sintetica P2.6.10',jsonb_build_object('qa_dataset','P2.6.10'),clock_timestamp()
from p2610_scenarios where com_cte on conflict (id) do nothing;

insert into public.ctes (
  id,cedente_id,fundo_id,cedente_fundo_id,chave_cte,numero,serie,data_emissao,
  formato_origem,nivel_validacao,status,analisado_por,analisado_em,
  documento_id,documento_versao_atual_id,documento_versao_aprovada_id,
  dados_extraidos,resultado_validacao
)
select md5('P2.6.10:CTE:'||codigo)::uuid,md5('P2.6.10:CEDENTE')::uuid,
       md5('P2.6.10:FUNDO:'||codigo)::uuid,md5('P2.6.10:CF:'||codigo)::uuid,
       lpad((100+ord)::text,44,'0'),'P2610-'||ord,'1','2026-08-18','xml','estrutural','aprovado',
       '60b0c3c5-14df-43ab-8fbd-246bb4caaf05',clock_timestamp(),
       md5('P2.6.10:DOC:CTE:'||codigo)::uuid,md5('P2.6.10:DV:CTE:'||codigo)::uuid,
       md5('P2.6.10:DV:CTE:'||codigo)::uuid,
       jsonb_build_object('qa_dataset','P2.6.10'),jsonb_build_object('valido',true)
from p2610_scenarios where com_cte on conflict (id) do nothing;

insert into public.cte_notas_fiscais (
  cte_id,nota_fiscal_id,chave_nfe_referenciada,status_validacao,
  resultado_validacao,divergencias,validado_em
)
select md5('P2.6.10:CTE:'||codigo)::uuid,md5('P2.6.10:NF:'||codigo)::uuid,
       lpad(ord::text,44,'0'),'aprovado',jsonb_build_object('qa_dataset','P2.6.10'),
       '[]'::jsonb,clock_timestamp()
from p2610_scenarios where com_cte on conflict do nothing;

commit;

select s.codigo,
       md5('P2.6.10:FUNDO:'||s.codigo)::uuid fundo_id,
       md5('P2.6.10:OP:'||s.codigo)::uuid operacao_id,
       md5('P2.6.10:NF:'||s.codigo)::uuid nota_fiscal_id,
       s.valor,s.com_cte
from (values
  ('APTO',1000000.00,true),('NO_LIMITE_40',20000000.00,true),
  ('ACIMA_40',20000000.01,true),('REVISAO_LIBERAR',1000000.00,false),
  ('REVISAO_RECUSAR',1000000.00,false),('DOUBLE',1000000.00,true),
  ('TOCTOU',1000000.00,true),('STALE_REVIEW',1000000.00,false)
) s(codigo,valor,com_cte);
