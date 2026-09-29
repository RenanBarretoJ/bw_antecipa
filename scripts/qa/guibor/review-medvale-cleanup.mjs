// The only authorized mutation to existing MEDVALE is temporary delegated QA access.
// Never deletes its cadastro, funds, links, policies, establishments or other users.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { ref, phase, homolog, medvale, medvaleSnapshot } from './review-target.mjs'
assert(homolog, 'HOMOLOG_ONLY')
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
const report=JSON.parse(readFileSync(`rehearsal/reports/GUIBOR_${phase}_A.json`,'utf8'))
assert.equal(report.target,ref);assert(report.preserveExisting)
assert.deepEqual(report.fixtures,medvale)
const user=report.users.cedente
assert(/^[0-9a-f-]{36}$/.test(user))
assert.equal(Object.keys(report.users).length,1,'ONLY_DELEGATED_USER_ALLOWED')
function cli(args){
 const r=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8000000})
 assert.equal(r.status,0,'MEDVALE_CLEANUP_CLI_FAILED');return JSON.parse(r.stdout)
}
function sql(q){
 assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
 writeFileSync('rehearsal/tmp/guibor-medvale-cleanup.sql',q)
 return cli(['db','query','--linked','--file','rehearsal/tmp/guibor-medvale-cleanup.sql','--output','json']).rows
}
assert.deepEqual(sql(medvaleSnapshot(user))[0],report.originalSnapshot,'EXISTING_CONFIGURATION_DRIFT_STOP')
const known=sql(`select id,email from auth.users where id='${user}'`)
assert.equal(known.length,1);assert.equal(known[0].email,`guibor-${report.run}-cedente@example.invalid`)
const notes=sql(`select n.id,n.status,n.tipo_documento_fiscal,i.id receipt from public.notas_fiscais n
 join public.nfse_review_intents i on i.id::text=n.fiscal_proveniencia->>'review_intent_id'
 where n.cedente_id='${medvale.cedente}' and i.actor_id='${user}' and i.nf_id=n.id`)
assert(notes.length<=1);for(const n of notes){assert.equal(n.status,'rascunho');assert.equal(n.tipo_documento_fiscal,'NFSE')}
if(report.nfId)assert.equal(notes[0]?.id,report.nfId)
const objects=sql(`select o.bucket_id,o.name from storage.objects o where exists(
 select 1 from public.nfse_review_intents i where i.actor_id='${user}' and i.cedente_id='${medvale.cedente}'
 and ((o.bucket_id='notas-fiscais' and o.name=i.storage_path) or (o.bucket_id='documentos-v2' and o.name=i.document_storage_path)))`)
assert(objects.length<=1,'UNEXPECTED_QA_STORAGE_COUNT')
console.log(JSON.stringify({target:ref,protectedCedente:medvale.cedente,qaUsers:1,qaNotes:notes.length,qaObjects:objects.length,execute:process.argv.includes('--execute')}))
if(process.argv.includes('--execute')){
 const keys=cli(['projects','api-keys','--project-ref',ref,'--output','json'])
 const admin=createClient(`https://${ref}.supabase.co`,keys.find(k=>k.name==='service_role').api_key,{auth:{persistSession:false,autoRefreshToken:false}})
 if(notes.length)sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${user}',true);
 SELECT public.excluir_notas_fiscais_rascunho_cedente(ARRAY['${notes[0].id}']::uuid[]);COMMIT;SELECT true removed;`)
 for(const o of objects){const {error}=await admin.storage.from(o.bucket_id).remove([o.name]);assert(!error,'MEDVALE_QA_STORAGE_CLEANUP_PENDING')}
 sql(`BEGIN;
 DELETE FROM public.nfse_review_intents WHERE actor_id='${user}' AND cedente_id='${medvale.cedente}';
 DELETE FROM public.cedente_acessos WHERE user_id='${user}' AND cedente_id='${medvale.cedente}';
 DELETE FROM public.eventos_dominio WHERE ator_usuario_id='${user}';
 DELETE FROM public.logs_auditoria WHERE usuario_id='${user}';
 DELETE FROM public.sessoes_elevadas WHERE user_id='${user}';
 DELETE FROM public.seguranca_eventos WHERE usuario_id='${user}' OR ator_usuario_id='${user}';
 COMMIT;SELECT true cleaned;`)
 const {error}=await admin.auth.admin.deleteUser(user);assert(!error,'MEDVALE_QA_AUTH_CLEANUP_PENDING')
 assert.deepEqual(sql(medvaleSnapshot())[0],report.originalSnapshot,'MEDVALE_BASELINE_NOT_RESTORED')
 const after=sql(`select
 (select count(*)::int from auth.users where id='${user}') users,
 (select count(*)::int from public.profiles where id='${user}') profiles,
 (select count(*)::int from auth.mfa_factors where user_id='${user}') mfa,
 (select count(*)::int from auth.sessions where user_id='${user}') sessions,
 (select count(*)::int from public.cedente_acessos where user_id='${user}') accesses,
 (select count(*)::int from public.nfse_review_intents where actor_id='${user}') intents,
 (select count(*)::int from public.notas_fiscais where cedente_id='${medvale.cedente}') notes,
 (select count(*)::int from storage.objects where (bucket_id='notas-fiscais' and name like '51464297000187/nf/%') or (bucket_id='documentos-v2' and name like '${medvale.cedente}/%')) objects`)[0]
 for(const [k,n] of Object.entries(after))assert.equal(n,k==='objects'?(report.before?.objects??0):0,'MEDVALE_QA_RESIDUE_STOP')
 const result={target:ref,cleanup:'PASS',existingConfigurationPreserved:true,after,productionChanged:false}
 writeFileSync(`rehearsal/reports/GUIBOR_${phase}_MEDVALE_CLEANUP.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
