import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// This runner can address ONLY the explicitly created local rehearsal database.
const container = 'supabase_db_fhgkmggthxikfpogrvaa'
const db = 'guibor_a3_a4_roles_20260929'
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'DOCKER_TEST_FAILED')
  return result.stdout
}
const migration = readFileSync('supabase/migrations/20260929154656_guibor_nfse_fiscal_provenance.sql', 'utf8')
if (process.argv.includes('--prepare')) {
  const existing = docker(['exec', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atc', `select 1 from pg_database where datname='${db}'`]).trim()
  if (existing) throw new Error('ISOLATED_DATABASE_ALREADY_EXISTS')
  docker(['exec', container, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc', '--exclude-table-data=vault.secrets', '-f', '/tmp/guibor_verified_baseline.dump'])
  docker(['exec', container, 'createdb', '-U', 'supabase_admin', db])
  docker(['exec', container, 'pg_restore', '-U', 'supabase_admin', '-d', db, '/tmp/guibor_verified_baseline.dump'])
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], migration)
}
let setup = readFileSync('supabase/tests/c2_1_r2_fluxo_taxa.test.sql', 'utf8').match(/DO \$setup\$[\s\S]*?\$setup\$;/)[0]
const ids = new Map([...new Set(setup.match(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g))].map(id => [id, randomUUID()]))
for (const [from, to] of ids) setup = setup.replaceAll(from, to)
const id = (prefix, suffix = 1) => ids.get(`${prefix}000000-0000-4000-8000-00000000000${suffix}`)
const nf = randomUUID()
const claims = (user) => `select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.jwt.claim.role','authenticated',true);`
const insert = `insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,chave_acesso,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,status,tipo_documento_fiscal,valor_liquido_origem,vencimento_origem,fiscal_proveniencia)
values('${nf}','${id('23')}','${id('24')}','${id('22')}','232',repeat('1234567890',5),current_date,current_date+40,'98100000000168','QA GUIBOR','11222333000181','QA TOMADOR',112710.81,105779.10,'rascunho','NFSE','DOCUMENTO_EXPLICITO','MANUAL',jsonb_build_object('strategy','danfse_v2_visual','source','PDF_VISUAL_FALLBACK','competencia',current_date,'sha256',repeat('a',64),'vencimento_documento',null))`
const sql = `begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
${setup}
select plan(16);
${claims(id('21'))}
set local role authenticated;
select lives_ok($test$${insert}$test$,'OPERADOR own scope inserts NFS-e');
reset role;
select is((select valor_liquido from public.notas_fiscais where id='${nf}'),105779.10::numeric,'explicit net preserved');
select is((select count(*)::int from public.logs_auditoria where entidade_id='${nf}' and tipo_evento='NFSE_VENCIMENTO_MANUAL' and usuario_id='${id('21')}' and dados_antes->'data_vencimento'='null'::jsonb and dados_depois->>'source'='MANUAL'),1,'atomic audit includes real actor missing old due');
set local role authenticated;
select throws_ok($test$update public.notas_fiscais set valor_liquido=valor_bruto where id='${nf}'$test$,'23514','NFSE_FISCAL_FACTS_IMMUTABLE','net cannot become gross');
select throws_ok($test$update public.notas_fiscais set data_vencimento=null where id='${nf}'$test$,null,null,'due stays required');
select lives_ok($test$update public.notas_fiscais set data_vencimento=current_date+41 where id='${nf}'$test$,'authorized draft due review');
reset role;
select is((select count(*)::int from public.logs_auditoria where entidade_id='${nf}' and tipo_evento='NFSE_VENCIMENTO_MANUAL'),2,'due review audited');
${claims(id('21', 2))}
set local role authenticated;
select throws_ok($test$${insert.replaceAll(nf, randomUUID()).replace("repeat('1234567890',5)", "repeat('2345678901',5)")}$test$,null,null,'LEITOR cannot insert');
with changed as (update public.notas_fiscais set data_vencimento=current_date+42 where id='${nf}' returning id) select is((select count(*)::int from changed),0,'LEITOR cannot edit due');
reset role;
${claims(id('21', 3))}
set local role authenticated;
select lives_ok($test$update public.notas_fiscais set data_vencimento=current_date+43 where id='${nf}'$test$,'Cedente can review own NF');
reset role;
${claims(id('21', 4))}
set local role authenticated;
select is((select count(*)::int from public.notas_fiscais where id='${nf}'),1,'authorized manager can read');
reset role;
select is((select count(*)::int from public.notas_fiscais where id='${id('2a')}' and tipo_documento_fiscal is null and valor_liquido=valor_bruto),1,'legacy facts remain untagged');
select throws_ok($test$${insert.replaceAll(nf, randomUUID()).replace("repeat('1234567890',5)", "repeat('3456789012',5)").replace("'NFSE','DOCUMENTO_EXPLICITO'", "'NFSE','NAO_INFORMADO'")}$test$,null,null,'missing provenance cannot coexist with copied gross');
update public.consultor_cedentes set status='inativo' where consultor_id='${id('29')}' and cedente_id='${id('23')}';
${claims(id('21'))}
set local role authenticated;
with changed as (update public.notas_fiscais set data_vencimento=current_date+44 where id='${nf}' returning id) select is((select count(*)::int from changed),0,'outside organizational portfolio denied');
reset role;
update public.consultor_cedentes set status='ativo' where consultor_id='${id('29')}' and cedente_id='${id('23')}';
update public.consultor_fundos set status='inativo' where consultor_id='${id('29')}' and fundo_id='${id('22')}';
set local role authenticated;
with changed as (update public.notas_fiscais set data_vencimento=current_date+44 where id='${nf}' returning id) select is((select count(*)::int from changed),0,'outside authorized fund denied');
reset role;
select is((select data_vencimento from public.notas_fiscais where id='${nf}'),current_date+43,'denied actors did not alter due');
select * from finish(); rollback;`
const output = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], sql)
console.log(output.split('\n').filter(line => /^(ok |not ok |#|1\.\.)/.test(line)).join('\n'))
if (/not ok|Looks like you failed|Looks like you planned/.test(output)) process.exitCode = 1
