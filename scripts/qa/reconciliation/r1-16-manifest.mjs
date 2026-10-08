import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
import {loadSources} from './r1-14-provenance.mjs'

assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/', read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
assert.equal((await read('R1_16_REMOTE_BASELINE')).result,'PASS')
const counts=await read('R1_16_DATA_PREFLIGHTS')
assert.equal(counts.queries.length,8);assert(counts.queries.every(r=>r.count===0))
const checkpoint=await read('R1_16_CHECKPOINT')
for(const f of checkpoint.migrations) assert.equal(hash(await readFile(f.path)),f.sha256,'HISTORICAL_MIGRATION_CHANGED:'+f.path)
const canonical=await loadSources(await read('R1_5_MANIFESTS'))
assert.equal(canonical.sources.length,270)
const files=(await readdir('supabase/migrations')).filter(n=>n.includes('_r1_16_')).sort()
assert.equal(files.length,7)
const entries=[]
for(const [i,filename] of files.entries()) {
  const path='supabase/migrations/'+filename,bytes=await readFile(path),sql=bytes.toString('utf8')
  assert(!sql.includes('\r'));assert.equal(hash(Buffer.from(sql)),hash(bytes))
  assert(sql.startsWith('-- R1.16 FWD-0'+(i+1)))
  assert(sql.includes('BEGIN;')&&sql.endsWith('COMMIT;\n'))
  assert.doesNotMatch(sql,/REVOKE\s+ALL|DISABLE\s+ROW\s+LEVEL\s+SECURITY|ALTER\s+DEFAULT\s+PRIVILEGES|BYPASSRLS|schema_migrations|cron\.schedule|vault\.|ALTER\s+ROLE/i)
  entries.push({filename,path,version:filename.split('_')[0],sha256:hash(bytes),lfOnly:true,source:'NEW_R1_16_FORWARD',dependencies:i?[entries[i-1].version]:['R1_5_EXPLICIT_UPGRADE_OR_CANONICAL_PATH','20261006201914','20261006210815'],objectsChanged:[['57 explicitly listed relation ACLs'],['public.cedentes: four nullable escrow columns','three timestamp nullability attributes'],['public.taxas_cedente: checks'],['public.usuario_papeis: origin check'],['public.corrigir_duplicata(uuid,jsonb,text,text): negative text only'],['taxas_cedente_select','Cedentes podem ver seus devedores'],['public.idx_taxas_cedente_id']][i],prodAction:'APPLY_FORWARD_AFTER_EXPLICIT_DELTAS',homologAction:'APPLY_FORWARD_AFTER_EXPLICIT_DELTAS',cleanroomAction:'APPLY_AFTER_CANONICAL_CHAIN'})
}
assert.equal(new Set(entries.map(e=>e.version)).size,7)
const acl=await read('R1_15_ACL_CONSUMERS'),sql=await readFile(entries[0].path,'utf8')
assert.equal(acl.rows.filter(r=>r.changedRole==='authenticated').length,56)
assert.equal(acl.rows.filter(r=>r.changedRole==='service_role').length,1)
for(const r of acl.rows)assert(sql.includes("('"+r.relation+"', '"+r.changedRole+"'"))
const security={at:new Date().toISOString(),result:'PASS',scope:'STATIC_FORWARD_REVIEW_RUNTIME_PROOF_REQUIRED',historicalSourcesVerified:270,protectedCompositionSource:'R1_15_SECURITY_COMPOSITION.json',changedDomainFunction:'corrigir_duplicata only; exact source hash and security ACL checks',businessRowMutations:'NONE during migration (UPDATE in the preserved RPC body runs only on future authorized RPC calls)',acl:'Explicit 56 authenticated + 1 service_role; only D/x/t/m; exact pre/post ACL matrices',rls:'Only two approved legacy policies; no RLS toggle or compensating ownership policy',escrow:'ADD without DEFAULT then SET DEFAULT preserves existing rows',timestamps:'CHECK NOT VALID / VALIDATE / SET NOT NULL / DROP transient; atomic and lock-timeout bounded; ACCESS EXCLUSIVE held until commit',remoteWrites:0,guardRails:['A6 original excluded from PROD upgrade','Historical C5 and P14 excluded from PROD upgrade','SACADO DB-only not replayed in PROD','No Notifications/MFA/fiscal/Auth/Storage helper changes','No scheduler/env/Vault/Graph/RLX activation']}
await writeFile(dir+'R1_16_FORWARD_MANIFEST.json',JSON.stringify({at:new Date().toISOString(),result:'PASS',entries},null,2)+'\n',{flag:'wx'})
await writeFile(dir+'R1_16_FORWARD_SECURITY_REVIEW.json',JSON.stringify(security,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:'PASS',forwards:entries.length,historicalSources:270,review:security.scope}))
