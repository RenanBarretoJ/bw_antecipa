-- P5.5 - preflight read-only anterior a excecao Storage e politica DLZ v5.
begin transaction read only;

select jsonb_build_object(
  'fundos', (select count(*) from public.fundos),
  'cedentes', (select count(*) from public.cedentes),
  'operacoes', (select count(*) from public.operacoes),
  'notas_fiscais', (select count(*) from public.notas_fiscais),
  'documentos', (select count(*) from public.documentos),
  'storage_objects', (select count(*) from storage.objects),
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'migrations', (select count(*) from supabase_migrations.schema_migrations),
  'foreign_keys_invalidas', (select count(*) from pg_constraint where contype='f' and not convalidated),
  'funcoes_reset_homolog', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'reset_%homolog%'),
  'politica_dlz_publicada', (select count(*) from public.politica_operacional_versoes where politica_operacional_id='d1311000-0000-4000-8000-000000000001' and status='publicada' and vigente_ate is null),
  'politica_dlz_versao', (select versao from public.politica_operacional_versoes where politica_operacional_id='d1311000-0000-4000-8000-000000000001' and status='publicada' and vigente_ate is null),
  'politica_dlz_metodo', (select metodo_calculo_financeiro from public.politica_operacional_versoes where politica_operacional_id='d1311000-0000-4000-8000-000000000001' and status='publicada' and vigente_ate is null),
  'politica_dlz_atribuicoes', (select count(*) from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where a.politica_operacional_id='d1311000-0000-4000-8000-000000000001' and a.status='ativa' and cf.fundo_id='7a114257-7816-468e-adf4-d796b93364df'),
  'historico_operacoes_hash', (select encode(extensions.digest(coalesce(string_agg(concat_ws('|',o.id::text,o.politica_operacional_id::text,o.politica_operacional_versao_id::text,o.politica_versao::text,o.politica_snapshot_hash),E'\n' order by o.id),'[]'),'sha256'),'hex') from public.operacoes o)
) as baseline_p5_5_preflight;

select v.versao,v.status,v.metodo_calculo_financeiro,v.conteudo_hash,v.vigente_desde,v.vigente_ate,
       (select count(*) from public.politica_requisitos_documentais r where r.politica_operacional_versao_id=v.id) as requisitos
from public.politica_operacional_versoes v
where v.politica_operacional_id='d1311000-0000-4000-8000-000000000001'
order by v.versao;

select o.id,o.bucket_id,b.public,
       encode(extensions.digest(o.bucket_id || ':' || o.name,'sha256'),'hex') as fingerprint_sha256,
       o.metadata->>'mimetype' as content_type,(o.metadata->>'size')::bigint as size_bytes
from storage.objects o join storage.buckets b on b.id=o.bucket_id
where o.id in (
  '923954aa-bb86-4294-be35-90deb55af01e'::uuid,
  '6c15cbed-3b11-4105-9bfb-022e44892225'::uuid
)
order by o.id;

rollback;
