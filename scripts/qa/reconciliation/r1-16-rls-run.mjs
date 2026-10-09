import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {applyR116} from './r1-16-forwards.mjs'
import {applyAuthFix} from './r1-16-auth-forward.mjs'
import {verifyR116Directed} from './r1-16-directed.mjs'
import {freshStack} from './r1-10-fresh-stack.mjs'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
import {seed,actors,cedentes,expectedIds} from './r1-15-rls-fixture.mjs'
const r118=process.argv.includes('--r118')
assert.deepEqual(process.argv.slice(2),r118?['--local-only','--r118']:['--local-only'])
if(r118){const {requireR118Bootstrap}=await import('./r1-18-bootstrap-gate.mjs');await requireR118Bootstrap()}
const dir='rehearsal/reports/',read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
const prefix=(r118?'R1_18_RLS_':'R1_16_AUTH_RLS_')+Date.now(),reportPath=dir+prefix+'.json'
const report={at:new Date().toISOString(),id:prefix,scope:'LOCAL_R116_FORWARDS_AND_RLS_AB_ONLY',result:'IN_PROGRESS',stacks:[],runs:[],comparisons:[],remoteCalls:0,remoteWrites:0,forwardMigrationCreated:true}
const persist=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
const checkpoint={branch:gitBytes(['branch','--show-current']).toString().trim(),head:gitBytes(['rev-parse','HEAD']).toString().trim(),files:[],reports:[],docker:await inventory()}
assert.equal(checkpoint.branch,'reconcile/main-homolog-2026-10-06');assert.equal(checkpoint.head,'2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
for(const path of [...new Set(gitBytes(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean))].sort())checkpoint.files.push({path,sha256:hash(await readFile(path))})
async function scan(path){for(const entry of await readdir(path,{withFileTypes:true})){const p=path+'/'+entry.name;if(entry.isDirectory())await scan(p);else checkpoint.reports.push({path:p,sha256:hash(await readFile(p))})}}
await scan('rehearsal/reports')
await writeFile(dir+prefix+'_CHECKPOINT.json',JSON.stringify(checkpoint,null,2)+'\n',{flag:'wx'})
report.checkpoint=dir+prefix+'_CHECKPOINT.json';await persist()
const prod=(await read('R1_15_PROD_CATALOG')).evidence
const targets=[['taxas_cedente','taxas_cedente_select'],['devedores_solidarios','Cedentes podem ver seus devedores']].map(([table,name])=>{const p=prod.policies.find(p=>p.tablename===table&&p.policyname===name);assert(p);assert.equal(p.cmd,'SELECT');assert.equal(p.permissive,'PERMISSIVE');assert.deepEqual(p.roles,['public']);return p})
const ident=s=>'"'+s.replaceAll('"','""')+'"'
const key=p=>p.schemaname+'.'+p.tablename+'.'+p.policyname
const securityQuery=`SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage') AND c.relkind IN('r','p','v','m','S','f')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'body',md5(p.prosrc)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','auth','storage')),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('public','private','auth','storage')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass',rolbypassrls,'inherit',rolinherit) ORDER BY rolname) FROM pg_roles),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN('public','private','auth','storage')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'def',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN('public','private','auth','storage'))
 ) AS state`
const datasetTables=['auth.users','public.profiles','public.usuario_papeis','public.fundos','public.cedentes','public.cedente_estabelecimentos','public.cedente_fundos','public.cedente_acessos','public.usuario_fundos','public.consultores','public.consultor_usuarios','public.consultor_cedentes','public.consultor_fundos','public.taxas_cedente','public.devedores_solidarios']
async function fingerprint(db){const rows=[];for(const table of datasetTables){const r=await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${table} t`);rows.push({table,...r.rows[0]})}return {tables:rows,hash:hash(JSON.stringify(rows))}}
async function security(db){return (await db.query(securityQuery)).rows[0].state}
function assertPolicyOnlyDelta(base,current,removed){
 const expected=structuredClone(base);expected.policies=expected.policies.filter(p=>!removed.includes(key(p)))
 assert.deepEqual(current,expected,'UNAUTHORIZED_SECURITY_OR_POLICY_CHANGE')
}
async function sample(db,variant,policySet){
 const results=[]
 for(const actor of actors){
  await db.query('SET LOCAL ROLE authenticated')
  const claims={sub:actor.id,role:'authenticated',aud:'authenticated',aal:'aal2',email:actor.email,app_metadata:{provider:'email'}}
  await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify(claims),actor.id])
  const proof=(await db.query(`SELECT current_user AS actor_role,auth.uid()::text AS uid,auth.jwt()->>'role' AS jwt_role,public.get_user_role()::text AS domain_role,r.rolsuper,r.rolbypassrls,current_setting('row_security') AS row_security,current_setting('session_replication_role') AS replication_role FROM pg_roles r WHERE r.rolname=current_user`)).rows[0]
  assert.equal(proof.actor_role,'authenticated');assert.equal(proof.uid,actor.id);assert.equal(proof.jwt_role,'authenticated');assert.equal(proof.domain_role,actor.role)
  assert.equal(proof.rolsuper,false);assert.equal(proof.rolbypassrls,false);assert.equal(proof.row_security,'on');assert.equal(proof.replication_role,'origin')
  for(const table of ['taxas_cedente','devedores_solidarios']){
   const guard=(await db.query('SELECT row_security_active($1::regclass) AS active,pg_has_role(current_user,c.relowner,\'USAGE\') AS owner FROM pg_class c WHERE c.oid=$1::regclass',['public.'+table])).rows[0]
   assert.equal(guard.active,true);assert.equal(guard.owner,false)
   for(const filter of [null,...cedentes.map(c=>c.key)]){
    const query=`SELECT id::text,cedente_id::text FROM public.${ident(table)}${filter?' WHERE cedente_id=$1::uuid':''} ORDER BY id`
    const params=filter?[cedentes.find(c=>c.key===filter).id]:[]
    const visible=(await db.query(query,params)).rows,ids=visible.map(r=>r.id).sort()
    results.push({scenario:actor.name+':'+table+':'+(filter??'ALL'),variant,actor:{id:actor.id,name:actor.name,role:actor.role,papel:actor.papel??null,authorizedFunds:actor.funds},fund:filter?cedentes.find(c=>c.key===filter).fund:'ALL_UNFILTERED',cedente:filter,dbRole:'authenticated',claims,proof,rls:guard,policySet:policySet.filter(p=>p.tablename===table),query,params,visible,ids,rowSetSha256:hash(JSON.stringify(ids)),expectedCanonicalIds:expectedIds(actor,table,filter)})
   }
  }
  await db.query('RESET ROLE')
 }
 return results
}
try{
 for(const suite of ['probea','probeb']){
  let stack
  try{
   stack=await freshStack(suite,report.stacks)
   const {db}=stack
   await applyR116(db,stack.evidence)
   stack.evidence.authorizationFix=await applyAuthFix(db)
   const canonical=await security(db)
   const certified=(await read('R1_15_ACL_CONSUMERS')).rows
   for(const r of certified){const c=canonical.relations.find(x=>x.schema+'.'+x.name===r.relation);assert(c);assert.deepEqual([...c.acl].sort(),[...r.cleanroomCapturedAcl].sort(),'CERTIFIED_ACL_DRIFT:'+r.relation)}
   for(const p of targets){
    assert(!canonical.policies.some(c=>key(c)===key(p)))
    await db.query(`CREATE POLICY ${ident(p.policyname)} ON ${ident(p.schemaname)}.${ident(p.tablename)} AS PERMISSIVE FOR SELECT TO PUBLIC USING (${p.qual})`)
   }
   const base=await security(db)
   assertPolicyOnlyDelta(base,canonical,targets.map(key))
   const fixture=await seed(db),data=await fingerprint(db)
   assert.deepEqual(await security(db),base,'FIXTURE_CHANGED_SECURITY')
   const run={projectId:stack.spec.projectId,fixture,fixtureData:data,certifiedAclRelations:57,canonicalSecurityHash:hash(JSON.stringify(canonical)),baselineSecurity:base,variants:[]}
   report.runs.push(run);await persist()
   for(const [variant,removed] of [['BASELINE',[]],['WITHOUT_TAXAS_LEGACY',[targets[0]]],['WITHOUT_DEVEDORES_LEGACY',[targets[1]]],['WITHOUT_BOTH',targets]]){
    await db.query('BEGIN')
    try{
     for(const p of removed)await db.query(`DROP POLICY ${ident(p.policyname)} ON ${ident(p.schemaname)}.${ident(p.tablename)}`)
     const state=await security(db);assertPolicyOnlyDelta(base,state,removed.map(key))
     const variantEvidence={variant,removedPolicies:removed.map(key),securityHash:hash(JSON.stringify(state)),otherSecurityPreserved:true,results:await sample(db,variant,state.policies)}
     run.variants.push(variantEvidence)
    }finally{await db.query('ROLLBACK')}
    assert.deepEqual(await security(db),base,'ROLLBACK_SECURITY_NOT_RESTORED')
    assert.deepEqual(await fingerprint(db),data,'FIXTURE_CHANGED_BETWEEN_VARIANTS')
    await persist();console.log(JSON.stringify({projectId:run.projectId,variant,queries:run.variants.at(-1).results.length}))
   }
   const baseline=run.variants[0].results
   for(const v of run.variants.slice(1))for(const candidate of v.results){
    const before=baseline.find(r=>r.scenario===candidate.scenario);assert(before)
    assert.equal(before.query,candidate.query);assert.deepEqual(before.params,candidate.params);assert.deepEqual(before.claims,candidate.claims)
    const removed=before.ids.filter(id=>!candidate.ids.includes(id)),added=candidate.ids.filter(id=>!before.ids.includes(id))
    report.comparisons.push({projectId:run.projectId,scenario:candidate.scenario,actor:candidate.actor,fund:candidate.fund,table:candidate.query.match(/public\."([^"]+)"/)[1],candidateVariant:v.variant,baseline:before.ids,candidate:candidate.ids,expectedCanonical:candidate.expectedCanonicalIds,removed,added,legitimateLost:removed.filter(id=>candidate.expectedCanonicalIds.includes(id)),legacyUnexpectedRemoved:removed.filter(id=>!candidate.expectedCanonicalIds.includes(id)),candidateUnexpected:candidate.ids.filter(id=>!candidate.expectedCanonicalIds.includes(id))})
   }
   run.directed=await verifyR116Directed(db)
   assert.deepEqual(await fingerprint(db),data,'DIRECTED_TEST_CHANGED_FIXTURE')
   run.result='PROOF_CAPTURED';stack.evidence.result='PASS';await stack.persist();await persist()
  }finally{await stack?.close()}
 }
 assert.equal(report.runs[0].fixture.declarationHash,report.runs[1].fixture.declarationHash)
 for(let i=0;i<4;i++)assert.deepEqual(report.runs[0].variants[i].results.map(r=>({scenario:r.scenario,ids:r.ids,query:r.query,claims:r.claims})),report.runs[1].variants[i].results.map(r=>({scenario:r.scenario,ids:r.ids,query:r.query,claims:r.claims})),'INDEPENDENT_STACK_RESULT_DRIFT')
 for(const c of report.comparisons.filter(c=>c.candidateVariant==='WITHOUT_BOTH')) {
  assert.deepEqual(c.added,[],'R116_ACCESS_WIDENED');assert.deepEqual(c.legitimateLost,[],'R116_LEGITIMATE_ACCESS_LOST');assert.deepEqual(c.candidateUnexpected,[],'R116_LEGACY_ACCESS_REMAINS')
  if(c.table==='taxas_cedente')assert.deepEqual(c.removed,[],'R116_TAXAS_ACCESS_CHANGED')
 }
 report.result='PASS_REAL_RLS_CAPTURE'
}catch(e){report.result='FAIL_STOPPED';report.failure={message:e.message,code:e.code??'ASSERTION'};process.exitCode=1}
finally{
 for(const f of [...checkpoint.files,...checkpoint.reports])assert.equal(hash(await readFile(f.path)),f.sha256,'EXISTING_ARTIFACT_CHANGED:'+f.path)
 assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),checkpoint.head)
 report.preservation={files:checkpoint.files.length,reports:checkpoint.reports.length,result:'PASS'}
 const after=await inventory();assert.deepEqual(after,checkpoint.docker,'DOCKER_INVENTORY_CHANGED')
 report.cleanup='PASS';report.dockerAfter=after;await persist()
}
console.log(JSON.stringify({report:reportPath,result:report.result,comparisons:report.comparisons.length,changed:report.comparisons.filter(c=>c.removed.length||c.added.length).map(c=>({scenario:c.scenario,variant:c.candidateVariant,removed:c.removed,added:c.added})),failure:report.failure,cleanup:report.cleanup}))
