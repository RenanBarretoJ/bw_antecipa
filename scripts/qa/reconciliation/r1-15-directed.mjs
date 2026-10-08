// R1.15: disposable PostgreSQL expression tests, never application DDL or real rows.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {docker,inventory} from '../../email-intake/disposable-resources.mjs'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const before=await inventory(),name='bw_r115_readonly_'+Date.now(),label='bw.reconciliation.r115='+name
const report={at:new Date().toISOString(),name,label,before,image:'sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73',queries:[],applicationDDL:false,realBusinessRows:false,actualRlsEnforcementTest:false,limitations:['Expression tests do not execute application RLS, triggers, RPC authorization, or indexes.','A synthetic EXPLAIN is not an index performance benchmark.','Local locale/version recorded; no remote function execution.']}
const file=root+'R1_15_DIRECTED_TESTS.json'
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
assert(!before.containers.includes(name))
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n')
const sqlString=s=>"'"+s.replaceAll("'","''")+"'"
async function query(id,sql){
 assert.match(sql,/^(?:WITH|SELECT|EXPLAIN)\b/i)
 const output=await docker(['exec','-e','PGCLIENTENCODING=UTF8',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','BEGIN READ ONLY; '+sql+'; ROLLBACK;'])
 const result=JSON.parse(output)
 report.queries.push({id,sql,sha256:hash(sql),result});await save();return result
}
let created=false
try{
 await docker(['run','--detach','--name',name,'--label',label,'--network','none','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust',report.image]);created=true
 let ready=false
 for(let i=0;i<50;i++){
  try{await docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}
 }
 assert(ready,'FRESH_POSTGRES_NOT_READY')
 await query('engine',"SELECT json_build_object('version',version(),'locale',datctype,'collation',datcollate,'encoding',current_setting('server_encoding')) FROM pg_database WHERE datname=current_database()")
 const cases=[['negative_rate',0,30,-1,false],['zero_rate',0,30,0,true],['positive_rate',0,30,2.35,true],['negative_min',-1,30,2,false],['zero_min',0,30,2,true],['max_below_min',30,29,2,false],['max_equal_min',30,30,2,true],['null_rate',0,30,null,false],['null_min',null,30,2,false],['null_max',0,null,2,false],['all_null',null,null,null,false]]
 const checked=await query('taxas_predicates',`WITH cases(id,prazo_min,prazo_max,taxa_percentual,expected) AS (VALUES ${cases.map(c=>'('+c.map(v=>v===null?'NULL':typeof v==='string'?sqlString(v):String(v)).join(',')+')').join(',')}), checked AS (SELECT *, ((prazo_min>=0 AND prazo_max>=prazo_min AND taxa_percentual>=0) IS NOT FALSE) AS check_only, (prazo_min IS NOT NULL AND prazo_max IS NOT NULL AND taxa_percentual IS NOT NULL AND (prazo_min>=0 AND prazo_max>=prazo_min AND taxa_percentual>=0)) AS accepted_with_not_null, ((taxa_percentual>=0) IS NOT FALSE) AS rate_only_check FROM cases) SELECT json_agg(checked) FROM checked`)
 assert(checked.every(c=>c.accepted_with_not_null===c.expected))
 assert(checked.find(c=>c.id==='negative_min').rate_only_check)
 assert(checked.find(c=>c.id==='null_min').check_only)
 const definitions={prod:(await read('R1_15_PROD_FUNCTIONS')).rows.find(f=>f.name==='corrigir_duplicata').definition,homolog:(await read('R1_15_HOMOLOG_FUNCTIONS')).rows.find(f=>f.name==='corrigir_duplicata').definition,cleanroom:(await read('R1_13_CLEANROOM')).paths[0].applicationObjects.find(f=>f.kind==='function'&&f.name==='corrigir_duplicata').definition}
 const patterns=Object.fromEntries(Object.entries(definitions).map(([p,d])=>[p,[...d.matchAll(/lower\(p_campos->>'aceite_textual'\) LIKE '([^']+)'/g)].map(m=>m[1])]))
 for(const p of Object.values(patterns))assert.equal(p.length,3)
 report.encodingPatterns=Object.fromEntries(Object.entries(patterns).map(([p,a])=>[p,a.map(literal=>({literal,codepoints:[...literal].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase())}))]))
 const observed=[...new Set(Object.values(patterns).map(p=>p[1].slice(1,-1)))]
 const inputs=['não','NÃO','nao','NAO','sem','SEM','sem aceite','SEM ACEITE','aceite confirmado','SIM','',...observed,...observed.map(s=>s.toUpperCase())]
 // Two explicit candidate contracts; no function or historical data is rewritten.
 const canonical=['%nao%','%não%','%sem %']
 const compat=[...new Set([...canonical,...observed.map(s=>'%'+s.toLowerCase()+'%')])]
 const predicate=ps=>`CASE WHEN nullif(btrim(input),'') IS NULL THEN 'INDETERMINADO' WHEN ${ps.map(p=>'lower(input) LIKE '+sqlString(p)).join(' OR ')} THEN 'NAO' ELSE 'SIM' END`
 const encoding=await query('encoding_observed_and_candidates',`WITH cases(input) AS (VALUES ${inputs.map(i=>'('+sqlString(i)+')').join(',')}), classified AS (SELECT input,${Object.entries({...patterns,canonical,compat}).map(([p,ps])=>predicate(ps)+' AS '+p).join(',')} FROM cases) SELECT json_agg(classified) FROM classified`)
 for(const row of encoding)row.parserExpectation=/\b(?:nao|não|sem)\b/i.test(row.input)?'NAO':'SIM'
 assert.equal(encoding.find(r=>r.input==='não').canonical,'NAO')
 assert.equal(encoding.find(r=>r.input==='sem').canonical,'SIM')
 assert(encoding.filter(r=>observed.includes(r.input)).every(r=>r.compat==='NAO'))
 report.encodingAssessment={status:'CHARACTERIZED_NOT_FIXED',canonicalContract:'Correct UTF-8 plus existing ASCII/sem-space substrings; does not silently change sem-alone contract',legacyCompatibility:'Explicit lowercased observed mojibake patterns',rowsWithUiServerMismatch:encoding.filter(r=>r.parserExpectation!==r.canonical),rowsWithProdVsCanonicalDifference:encoding.filter(r=>r.prod!==r.canonical)}
 // Actual policy expressions involve nested table RLS and helpers: model inputs are explicit assumptions.
 const policyCases=[
  ['legitimate_owner','cedente',true,true,false,false],
  ['active_delegated','cedente',true,false,false,false],
  ['owner_revoked_association_nested_visible','cedente',false,true,false,false],
  ['owner_revoked_association_nested_hidden','cedente',false,false,false,false],
  ['cross_fund_non_owner','gestor',false,false,false,false],
  ['gestor_allowed_fund','gestor',false,false,true,false],
  ['consultor_operador_linked','consultor',false,false,false,true],
  ['consultor_leitor_not_operational','consultor',false,false,false,false],
  ['anonymous','anon',false,false,false,false],
  ['owner_profile_changed','gestor',false,true,false,false],
 ]
 const policies=await query('policy_boolean_model_not_rls',`WITH cases(id,app_role,helper_cedente_matches,legacy_owner_visible,gestor_fund,consultor_allowed) AS (VALUES ${policyCases.map(c=>'('+c.map(v=>typeof v==='string'?sqlString(v):String(v)).join(',')+')').join(',')}), modeled AS (SELECT *, ((app_role='cedente' AND helper_cedente_matches) OR gestor_fund) AS devedores_without, ((app_role='cedente' AND helper_cedente_matches) OR gestor_fund OR legacy_owner_visible) AS devedores_with, ((app_role='cedente' AND helper_cedente_matches) OR gestor_fund OR consultor_allowed) AS taxas_without, ((app_role='cedente' AND helper_cedente_matches) OR gestor_fund OR consultor_allowed OR (app_role='cedente' AND helper_cedente_matches)) AS taxas_with FROM cases) SELECT json_agg(modeled) FROM modeled`)
 assert(policies.every(p=>p.taxas_with===p.taxas_without))
 assert(policies.some(p=>p.devedores_with!==p.devedores_without))
 report.policyAssessment={status:'MANUAL_DECISION_REQUIRED',removalRecommended:false,blockingGate:'Real role-switched RLS A/B tests require application schema/policy setup forbidden by section 22; boolean model is not proof.',nestedRlsNotModeled:true}
 report.syntheticExplain=await query('synthetic_explain_no_index_claim',"EXPLAIN (FORMAT JSON, COSTS true) SELECT id,prazo_min FROM (VALUES (1,10,0),(2,11,30),(3,10,60)) AS synthetic_taxas(id,cedente_id,prazo_min) WHERE cedente_id=10 ORDER BY prazo_min")
 report.result='PASS_EXPRESSION_CHARACTERIZATION_ONLY'
}catch(error){report.result='FAIL';report.error=error.message;throw error}
finally{
 if(created){
  const inspect=JSON.parse(await docker(['inspect',name]))[0]
  assert.equal(inspect.Name,'/'+name)
  assert.equal(inspect.Config.Labels['bw.reconciliation.r115'],name)
  assert(!before.containers.includes(name))
  assert.equal(inspect.HostConfig.NetworkMode,'none')
  assert(inspect.Mounts.every(m=>m.Type==='tmpfs'),'UNEXPECTED_PERSISTENT_VOLUME')
  await docker(['rm','-f',name])
 }
 report.after=await inventory()
 for(const kind of Object.keys(before))assert.deepEqual(report.after[kind],before[kind],'DOCKER_INVENTORY_CHANGED:'+kind)
 report.cleanup='PASS';await save()
}
console.log(JSON.stringify({result:report.result,queries:report.queries.length,cleanup:report.cleanup,actualRlsEnforcementTest:false}))
