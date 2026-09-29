import assert from 'node:assert/strict'
import { readFileSync,writeFileSync,existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { ref, phase } from './review-target.mjs'
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
const reports=['A','B','C'].map(l=>`rehearsal/reports/GUIBOR_${phase}_${l}.json`).filter(existsSync).map(p=>JSON.parse(readFileSync(p,'utf8'))).filter(r=>!r.preserveExisting)
assert(reports.length>0,'NO_DISPOSABLE_QA_FIXTURES')
assert(reports.every(r=>r.target===ref))
const ids=key=>reports.map(r=>r.fixtures[key]).filter(Boolean)
const users=reports.flatMap(r=>Object.values(r.users))
const list=values=>values.map(id=>{assert(/^[0-9a-f-]{36}$/.test(id));return `'${id}'`}).join(',')
const cedentes=list(ids('cedente')),funds=list(ids('fund')),orgs=list(ids('org')),userIds=list(users)
function cli(args){const r=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8000000});if(r.status!==0){writeFileSync('rehearsal/reports/GUIBOR_CLEANUP_ERROR.txt',r.stderr);throw new Error('GUIBOR_CLEANUP_CLI_FAILED')}return JSON.parse(r.stdout)}
function sql(q){writeFileSync('rehearsal/tmp/guibor-review-cleanup.sql',q);return cli(['db','query','--linked','--file','rehearsal/tmp/guibor-review-cleanup.sql','--output','json']).rows}
const pre=sql(`select
 (select count(*) from public.notas_fiscais where cedente_id in (${cedentes})) notes,
 (select count(*) from public.operacoes where cedente_id in (${cedentes})) operations,
 (select count(*) from public.cedentes where id in (${cedentes})) cedentes,
 (select count(*) from public.fundos where id in (${funds})) funds,
 (select count(*) from auth.users where id in (${userIds})) users,
 (select count(*) from storage.objects) storage_total`)[0]
assert(pre.notes<=2,'UNEXPECTED_QA_NF_COUNT_STOP')
assert.equal(pre.operations,0,'CLEANUP_REVIEW_ONLY_NO_OP_EXPECTED')
console.log(JSON.stringify({target:ref,execute:process.argv.includes('--execute'),pre}))
const knownUsers=sql(`select id,email from auth.users where id in (${userIds})`)
for(const u of knownUsers)assert(reports.some(r=>Object.values(r.users).includes(u.id)&&u.email.startsWith(`guibor-${r.run}-`)&&u.email.endsWith('@example.invalid')),'QA_USER_IDENTITY_MISMATCH')
const domain=sql(`select id,razao_social name from public.cedentes where id in (${cedentes}) union all select id,nome name from public.fundos where id in (${funds})`)
for(const row of domain)assert(reports.some(r=>[r.fixtures.cedente,r.fixtures.fund].includes(row.id)&&row.name.includes(`GUIBOR ${r.run}`)),'QA_DOMAIN_IDENTITY_MISMATCH')
if(process.argv.includes('--execute')){
 const keys=cli(['projects','api-keys','--project-ref',ref,'--output','json'])
 const admin=createClient(`https://${ref}.supabase.co`,keys.find(k=>k.name==='service_role').api_key,{auth:{persistSession:false,autoRefreshToken:false}})
 // Resolve exact QA-owned objects before touching anything. No broad bucket deletion.
 const objects=sql(`select bucket_id,name from storage.objects where
  (bucket_id='documentos-v2' and split_part(name,'/',1) in (select id::text from public.cedentes where id in (${cedentes})))
  or (bucket_id='notas-fiscais' and split_part(name,'/',1) in (select regexp_replace(cnpj,'[^0-9]','','g') from public.cedentes where id in (${cedentes})))`)
 const nfs=sql(`select id,cedente_id,status,tipo_documento_fiscal from public.notas_fiscais where cedente_id in (${cedentes})`)
 for(const nf of nfs)assert(nf.status==='rascunho'&&nf.tipo_documento_fiscal==='NFSE','QA_NOTE_CHANGED_STOP')
 // Use the existing transactional draft-deletion contract; this is cleanup, not RLS evidence.
 for(const r of reports){
  const owned=nfs.filter(n=>n.cedente_id===r.fixtures.cedente)
  if(!owned.length)continue
  sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${r.users.cedente}',true);
   SELECT public.excluir_notas_fiscais_rascunho_cedente(ARRAY[${list(owned.map(n=>n.id))}]::uuid[]);
   COMMIT;SELECT true drafts_removed;`)
 }
 for(const bucket of ['notas-fiscais','documentos-v2']){
  const paths=objects.filter(o=>o.bucket_id===bucket).map(o=>o.name)
  if(paths.length){const {error}=await admin.storage.from(bucket).remove(paths);if(error)throw new Error('QA_STORAGE_CLEANUP_PENDING')}
 }
 assert.equal(sql(`select count(*)::int n from public.notas_fiscais where cedente_id in (${cedentes})`)[0].n,0)

 // Same restricted QA cleanup pattern as scripts/homologacao/rlx-golden/cleanup.mjs.
 // Session-local trigger bypass permits deleting our immutable QA policy versions.
 // Only manifest-owned QA identities are removed; operational entities are forbidden.
 const deletes=[
  ['nfse_review_intents',`cedente_id in (${cedentes}) and actor_id in (${userIds})`],
  ['eventos_dominio',`ator_usuario_id in (${userIds})`],
  ['consultor_cedentes',`consultor_id in (${orgs}) and cedente_id in (${cedentes})`],
  ['consultor_fundos',`consultor_id in (${orgs}) and fundo_id in (${funds})`],
  ['consultor_usuarios',`consultor_id in (${orgs}) and user_id in (${userIds})`],
  ['consultores',`id in (${orgs})`],
  ['cedente_fundo_politicas',`id in (${list(ids('policyLink'))})`],
  ['politica_operacional_versoes',`id in (${list(ids('version'))})`],
  ['politicas_operacionais',`id in (${list(ids('policy'))})`],
  ['taxas_cedente',`cedente_id in (${cedentes})`],
  ['contas_escrow',`id in (${list(ids('escrow'))})`],
  ['cedente_fundos',`id in (${list(ids('link'))})`],
  ['cedente_acessos',`cedente_id in (${cedentes})`],
  ['cedente_estabelecimentos',`cedente_id in (${cedentes})`],
  ['cedentes',`id in (${cedentes})`],
  ['usuario_fundos',`usuario_id in (${userIds}) and fundo_id in (${funds})`],
  ['fundos',`id in (${funds})`],
  ['logs_auditoria',`usuario_id in (${userIds})`],
  ['sessoes_elevadas',`user_id in (${userIds})`],
  ['seguranca_eventos',`usuario_id in (${userIds}) or ator_usuario_id in (${userIds})`]
 ]
 sql(`BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL session_replication_role='replica';
 DO $g$ BEGIN IF EXISTS(SELECT 1 FROM public.notas_fiscais WHERE cedente_id in (${cedentes})) OR EXISTS(SELECT 1 FROM public.operacoes WHERE cedente_id in (${cedentes})) THEN RAISE EXCEPTION 'QA changed; stop'; END IF; END $g$;
 ${deletes.map(([table,where])=>`DELETE FROM public.${table} WHERE ${where};`).join('\n')}
 SET LOCAL session_replication_role='origin';COMMIT;SELECT true cleaned;`)
 for(const u of knownUsers){const {error}=await admin.auth.admin.deleteUser(u.id);if(error)throw new Error('QA_AUTH_CLEANUP_FAILED')}
 const post=sql(`select (select count(*) from public.cedentes where id in (${cedentes})) cedentes,(select count(*) from public.fundos where id in (${funds})) funds,(select count(*) from auth.users where id in (${userIds})) users,(select count(*) from public.nfse_review_intents where actor_id in (${userIds})) intents,(select count(*) from public.profiles where id in (${userIds})) profiles,(select count(*) from public.notas_fiscais where cedente_id in (${cedentes})) notes,(select count(*) from auth.mfa_factors where user_id in (${userIds})) mfa,(select count(*) from auth.sessions where user_id in (${userIds})) sessions,(select count(*) from public.logs_auditoria where usuario_id in (${userIds})) audit,(select count(*) from storage.objects) storage_total`)[0]
 for(const [k,v] of Object.entries(post))assert.equal(v,k==='storage_total'?pre.storage_total-objects.length:0,'QA_RESIDUE_STOP')
 const result={target:ref,removed:pre,after:post,cleanup:'PASS',storageDeleted:objects.length,productionChanged:false}
 writeFileSync(`rehearsal/reports/GUIBOR_${phase}_CLEANUP.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
