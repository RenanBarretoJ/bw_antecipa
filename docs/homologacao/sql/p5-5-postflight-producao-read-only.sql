-- P5.5 - postflight read-only posterior a excecao Storage e politica DLZ v5.
begin transaction read only;

select jsonb_build_object(
  'fundos_confere', (select count(*) from public.fundos)=2,
  'cedentes_confere', (select count(*) from public.cedentes)=12,
  'operacoes_confere', (select count(*) from public.operacoes)=47,
  'notas_fiscais_confere', (select count(*) from public.notas_fiscais)=916,
  'documentos_confere', (select count(*) from public.documentos)=123,
  'storage_confere', (select count(*) from storage.objects)=1663,
  'auth_profiles_confere', (select count(*) from auth.users)=23 and (select count(*) from public.profiles)=23,
  'migrations_confere', (select count(*) from supabase_migrations.schema_migrations)=199,
  'p5_2_presente', exists(select 1 from supabase_migrations.schema_migrations where version='20260829173938'),
  'cinco_migrations_homolog_preservadas_historicamente', (select count(*) from supabase_migrations.schema_migrations where version in ('20260723182639','20260728153646','20260804103235','20260811153000','20260823125731'))=5,
  'foreign_keys_invalidas_zero', (select count(*) from pg_constraint where contype='f' and not convalidated)=0,
  'funcoes_reset_homolog_zero', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'reset_%homolog%')=0,
  'politica_dlz_v5_unica', (select count(*) from public.politica_operacional_versoes where politica_operacional_id='d1311000-0000-4000-8000-000000000001' and versao=5 and status='publicada' and vigente_ate is null and metodo_calculo_financeiro='DIAS_CORRIDOS_365')=1,
  'politica_dlz_v4_substituida', (select count(*) from public.politica_operacional_versoes where politica_operacional_id='d1311000-0000-4000-8000-000000000001' and versao=4 and status='substituida' and vigente_ate is not null and conteudo_hash='9ec067c54aa27cc0f8b1947d6d2f8ed1ad3dd830f2da326af5af6d2063ecfba5')=1,
  'politica_dlz_requisitos_v4_v5_iguais', (select count(*) from public.politica_requisitos_documentais r join public.politica_operacional_versoes v on v.id=r.politica_operacional_versao_id where v.politica_operacional_id='d1311000-0000-4000-8000-000000000001' and v.versao in (4,5))=0,
  'politica_dlz_atribuicoes', (select count(*) from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where a.politica_operacional_id='d1311000-0000-4000-8000-000000000001' and a.status='ativa' and cf.fundo_id='7a114257-7816-468e-adf4-d796b93364df')=12,
  'historico_operacoes_preservado', (select encode(extensions.digest(coalesce(string_agg(concat_ws('|',o.id::text,o.politica_operacional_id::text,o.politica_operacional_versao_id::text,o.politica_versao::text,o.politica_snapshot_hash),E'\n' order by o.id),'[]'),'sha256'),'hex') from public.operacoes o)='ef5a7d14210014a6dc183e226d0256dde007801979918ee81991f42b3f48523f',
  'storage_excecoes_registradas', (select count(*) from public.logs_auditoria where tipo_evento='STORAGE_KNOWN_EXCEPTION_REGISTERED' and origem='cutover_p5_5' and dados_depois->>'classification'='KNOWN_UNREFERENCED_STORAGE' and dados_depois->>'decision'='PRESERVAR')=2
) as gates_p5_5_postflight;

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
