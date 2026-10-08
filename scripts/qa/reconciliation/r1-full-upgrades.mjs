// No URL, linked project or remote options. Two schema-only upgrades in owned Docker stacks.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { configureDisposableToml, sanitizedLocalEnvironment, fileSha256, redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
import { disposableResources, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { seedDocumentFixture } from './r1-2-document-fixture.mjs'
import { target } from './r1-3-catalog.mjs'
import { verifyNotificationRegression } from './r1-3-notifications.mjs'
import { verifyMunicipalCompatibility } from './r1-1-municipal-db.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'
import { readRawRestore,certifyRestore } from './r1-4-restorer.mjs'
import { readMigrationSource } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { restoreAndCertifyApplicationTriggers,applicationTriggers } from './r1-6-trigger-restore.mjs'
import { certifyCanonicalFixture } from './r1-7-fixture-certification.mjs'
import { applyR116 } from './r1-16-forwards.mjs'
import { applyAuthFix } from './r1-16-auth-forward.mjs'
assert([['--local-only'],['--local-only','--restore-only'],['--local-only','--r15'],['--local-only','--r15','--prod-only'],['--local-only','--r16'],['--local-only','--r16','--cleanroom'],['--local-only','--r17','--cleanroom'],['--local-only','--r17'],['--local-only','--r18','--a5-only'],['--local-only','--r18','--cleanroom'],['--local-only','--r18'],['--local-only','--r19','--cleanroom'],['--local-only','--r19'],['--local-only','--r110','--cleanroom'],['--local-only','--r110'],['--local-only','--r112','--cleanroom'],['--local-only','--r112'],['--local-only','--r113','--cleanroom'],['--local-only','--r113'],['--local-only','--r116'],['--local-only','--r116','--cleanroom']].concat([['--local-only','--r116auth'],['--local-only','--r116auth','--cleanroom']]).concat([['--local-only','--r118final'],['--local-only','--r118final','--cleanroom']]).map(JSON.stringify).includes(JSON.stringify(process.argv.slice(2))))
const r118final=process.argv.includes('--r118final')
if(r118final){const {requireR118Bootstrap}=await import('./r1-18-bootstrap-gate.mjs');await requireR118Bootstrap();assert.equal(JSON.parse(await readFile('rehearsal/reports/R1_18_SUPPLEMENTAL_SUITES.json','utf8')).result,'PASS')}
const r116auth=process.argv.includes('--r116auth')||r118final
const r116=process.argv.includes('--r116')||r116auth
const r113=process.argv.includes('--r113')||r116
const r112=process.argv.includes('--r112')||r113
const r110=process.argv.includes('--r110')||r112
const r19=process.argv.includes('--r19')||r110,r18=process.argv.includes('--r18')||r19,a5Only=process.argv.includes('--a5-only')
const r17=process.argv.includes('--r17')||r18,revision=r118final?'18_FINAL':r116auth?'16_AUTH':r116?'16':r113?'13':r112?'12':r110?'10':r19?'9':r18?'8':r17?'7':'6'
const r16=process.argv.includes('--r16')||r17
const cleanroom=process.argv.includes('--cleanroom')
const r15=process.argv.includes('--r15')||r16,prodOnly=process.argv.includes('--prod-only')||a5Only
const restoreOnly=process.argv.includes('--restore-only')
const reportPath=a5Only?'rehearsal/reports/R1_8_A5_SQL.json':cleanroom?`rehearsal/reports/R1_${revision}_CLEANROOM.json`:r16?`rehearsal/reports/R1_${revision}_FULL_UPGRADES.json`:r15?'rehearsal/reports/R1_5_FULL_UPGRADES.json':restoreOnly?'rehearsal/reports/R1_4_RESTORE.json':'rehearsal/reports/R1_FULL_UPGRADES.json'
try{const old=await readFile(reportPath);await writeFile(reportPath.replace('.json',`_attempt_${Date.now()}.json`),old,{flag:'wx'})}catch(e){if(e.code!=='ENOENT')throw e}
const read=p=>readFile(p,'utf8')
if(r113){
  const queryTests=JSON.parse(await read('rehearsal/reports/R1_13_CATALOG_QUERY_TESTS.json'))
  assert.equal(queryTests.result,'PASS','R113_QUERY_PROOF_REQUIRED')
  assert.equal(fileSha256('scripts/qa/reconciliation/r1-9-target-catalog.sql'),queryTests.newHash,'R113_QUERY_HASH_DRIFT')
}
const manifest=JSON.parse(await read(r15?'rehearsal/reports/R1_5_MANIFESTS.json':'rehearsal/reports/R1_UPGRADE_MANIFESTS.json'))
if(cleanroom){
  if(r18)assert.equal(JSON.parse(await read('rehearsal/reports/R1_8_A5_SQL.json')).result,'PASS','ISOLATED_A5_REQUIRED_FIRST')
  const upgrades=JSON.parse(await read('rehearsal/reports/R1_6_FULL_UPGRADES.json'))
  assert.equal(upgrades.result,'PASS','BOTH_R16_UPGRADES_REQUIRED')
  assert.deepEqual(upgrades.paths.map(p=>[p.name,p.result,p.cleanup]),[['prod','PASS','PASS'],['homolog','PASS','PASS']])
  const c=manifest.CLEAN_ROOM_CANONICAL
  assert.equal(c.applyOrder.length,264)
  assert.equal(c.entries.filter(m=>m.classification.endsWith('DO_NOT_APPLY')).length,13)
  assert.equal(new Set(c.applyOrder).size,264)
  assert.equal(c.applyOrder[0],'002')
  assert(c.applyOrder.indexOf('20260922182301')>=0&&c.applyOrder.indexOf('20260922182301')<c.applyOrder.indexOf('20260928185439'),'P14_MUST_PRECEDE_P16')
  for(const version of c.applyOrder){const m=c.entries.find(x=>x.version===version);await readMigrationSource(m)}
  await writeFile(`rehearsal/reports/R1_${revision}_MANIFEST_C.json`,JSON.stringify({at:new Date().toISOString(),result:'PASS',applicable:264,excluded:13,sourceManifestSha256:fileSha256('rehearsal/reports/R1_5_MANIFESTS.json'),historicalPolicy:'Fresh canonical construction only; no P14/C5/A6 replay in either upgrade',entries:c.entries},null,2)+'\n')
}
assert.equal(JSON.parse(await read('rehearsal/reports/R1_3_FOCUSED_SQL.json')).result,'PASS')
const catalogSql=await read('scripts/qa/health/schema-catalog.sql')
const cli=await nativeSupabaseCli(),env=sanitizedLocalEnvironment()
for(const key of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key))delete env[key]
const ident=s=>'"'+s.replaceAll('"','""')+'"'
const connection={host:'127.0.0.1',port:r17?57942:57842,user:'postgres',password:'postgres',database:'postgres'}
const report={at:new Date().toISOString(),scope:a5Only?'ISOLATED_A5_ON_FRESH_SCHEMA_UPGRADE':cleanroom?'CANONICAL_CLEANROOM_NOT_FULL_SQL_SUITE':'TWO_FULL_SCHEMA_UPGRADES_NOT_CLEAN_ROOM_OR_FULL_SQL_SUITE',result:'IN_PROGRESS',productionChanged:false,homologChanged:false,historyFaked:false,paths:[]}
const diff=(a,b)=>{
  const old=new Map(a.map(x=>[x.kind+':'+x.name,x])),next=new Map(b.map(x=>[x.kind+':'+x.name,x]))
  return [...new Set([...old.keys(),...next.keys()])].sort().filter(k=>old.get(k)?.hash!==next.get(k)?.hash).map(k=>({key:k,before:old.get(k)?.hash??null,after:next.get(k)?.hash??null}))
}
async function catalog(db){await db.query("SET search_path=''");const r=(await db.query(catalogSql)).rows[0].objects;await db.query('SET search_path=public,extensions');return r}
async function tap(db,file,prefix=''){
  let sql=(await read('supabase/tests/'+file)).replace(/^\\set.*$/mg,'')
  for(const m of [...sql.matchAll(/^\\ir (.+)$/mg)])sql=sql.replace(m[0],await read('supabase/tests/'+m[1].trim()))
  const r=await db.query(prefix+sql)
  const lines=(Array.isArray(r)?r:[r]).flatMap(x=>x.rows).flatMap(Object.values).filter(x=>typeof x==='string')
  const failures=lines.filter(x=>/^not ok|^# Looks like/.test(x))
  if(failures.length){const error=new Error(file+': '+failures.join('\n'));error.tap={file,lines,failures,passed:lines.filter(x=>/^ok \d+/.test(x)).length};throw error}
  const checks=lines.filter(x=>/^ok \d+/.test(x)).length;assert(checks>0)
  await db.query('ROLLBACK');return {file,checks,result:'PASS',...(r18?{lines,sha256:fileSha256('supabase/tests/'+file)}:{})}
}
async function path(name,key){
  const plan=manifest[key],baseline=cleanroom?manifest.PROD_TO_RECONCILED_UPGRADE.baseline:plan.baseline
  if(r15)assert.deepEqual(plan.unresolved,[],`UNRESOLVED_MIGRATION_SOURCE:${name}`)
  assert.equal(fileSha256(baseline.schemaPath),baseline.schemaSha256)
  assert.equal(fileSha256(baseline.metadataPath),baseline.metadataSha256)
  const metadata=JSON.parse(await read(baseline.metadataPath)),raw=await readRawRestore(baseline.schemaPath,baseline.schemaSha256),schema=raw.sql
  assert(!/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema))
  // R1.13 uses a fresh nonce in the already-approved local namespace; Storage guards stay unchanged.
  const projectId=r17?`bw_email03_r1${r113?'12':revision}${name==='cleanroom'?'clean':name}_${Date.now()}`:`bw_email03_r1full_${name}_${Date.now()}`,root=resolve('rehearsal/tmp',projectId)
  if(r17)assert(projectId.length<=36,'PROJECT_ID_MUST_NOT_BE_TRUNCATED')
  const evidence={name,projectId,baseline:cleanroom?null:baseline,RAW_RESTORE_HASH:cleanroom?null:raw.RAW_RESTORE_HASH,NORMALIZED_DIAGNOSTIC_HASH:cleanroom?null:raw.NORMALIZED_DIAGNOSTIC_HASH,result:'IN_PROGRESS',stage:'BOOTSTRAP',applied:[],tests:[],cleanup:'NOT_RUN'}
  report.paths.push(evidence)
  await mkdir(resolve(root,'supabase/migrations'),{recursive:true})
  await writeFile(resolve(root,'supabase/config.toml'),configureDisposableToml(await read('supabase/config.toml'),{
    projectId,apiPort:r17?57941:57841,dbPort:connection.port,shadowPort:r17?57940:57840,studioPort:r17?57943:57843,mailPort:r17?57944:57844,analyticsPort:r17?57947:57847}))
  const owned=await disposableResources({projectId,file:`rehearsal/reports/${projectId}-resources.json`,tempDirs:[root]})
  const run=args=>new Promise((done,reject)=>{
    const child=spawn(cli,[...args,'--workdir',root],{env,windowsHide:true});let output=''
    for(const s of [child.stdout,child.stderr])s.on('data',b=>{output+=b})
    child.on('error',reject);child.on('exit',code=>done({code,output}))
  })
  let db
  try{
    console.log(JSON.stringify({path:name,stage:evidence.stage,projectId}))
    const started=await run(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    await owned.capture();assert.equal(started.code,0,redactCommandOutput(started.output).slice(-2000))
    if(r17){assert(!/Auto-fixing to/.test(started.output),'PROJECT_ID_REWRITTEN');assert(owned.manifest.resources.containers.some(n=>n===`supabase_db_${projectId}`),'EXACT_OWNED_DB_CONTAINER_MISSING')}
    db=new Client(connection);await db.connect()
    evidence.stage='RESTORE_SCHEMA_ONLY'
    await db.query("SET statement_timeout='120s';SET lock_timeout='5s';BEGIN")
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname IN('public','private')")).rows[0].n,0)
    for(const k of ['TABLES','SEQUENCES','FUNCTIONS'])await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${k} FROM anon,authenticated,service_role`)
    const installed=new Set((await db.query('SELECT extname FROM pg_extension')).rows.map(x=>x.extname))
    for(const e of metadata.extensions)if(!installed.has(e.name)){
      assert(['unaccent','pgcrypto','uuid-ossp','pg_cron','pg_net'].includes(e.name),'UNREVIEWED_EXTENSION')
      await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)
    }
    if(!cleanroom){
    await db.query(schema)
    await db.query('SET LOCAL search_path=public,extensions')
    for(const p of metadata.storagePolicies??[])await db.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':ident(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''}`)
    for(const t of metadata.authTriggers??[])await db.query(t)
    for(const b of metadata.buckets??[]){
      assert.equal(b.public,false)
      await db.query('INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES($1,$2,$3,$4,$5)',[b.id,b.name,b.public,b.file_size_limit,b.allowed_mime_types])
    }
    }
    await db.query("COMMIT;SET search_path=public,extensions;SET row_security=on;SET statement_timeout='120s';SET lock_timeout='5s'")
    if(!cleanroom){
    if(r16)evidence.triggerFidelity=await restoreAndCertifyApplicationTriggers(db,name)
    evidence.baselineCatalog=await catalog(db)
    evidence.baselineCatalogDifferences=diff(metadata.catalog,evidence.baselineCatalog)
    evidence.fidelity=await certifyRestore(db,name,schema,metadata.catalog,evidence.baselineCatalog)
    assert.equal(evidence.fidelity.result,'PASS','BASELINE_REQUIRED_BEFORE_UPGRADE')
    console.log(JSON.stringify({path:name,stage:'BASELINE_FIDELITY_PASS',rawFunctions:evidence.fidelity.functions,constraintChecks:evidence.fidelity.constraints.reduce((n,c)=>n+c.behavior.reduce((s,b)=>s+b.cases.length,0),0)}))
    if(restoreOnly){evidence.result='PASS';return}
    evidence.fixture=await seedDocumentFixture(db,'SCHEMA_ONLY_MINIMAL')
    }
    for(const version of plan.applyOrder){
      const m=plan.entries.find(x=>x.version===version)
      if(cleanroom)assert(['BOOTSTRAP_CANONICAL','APPLY_CANONICAL','APPLY_HISTORICAL_CLEANROOM_ONLY'].includes(m.classification))
      else assert.equal(m.classification,'APPLY_REQUIRED')
      if(!r15)assert.equal(fileSha256(m.path),m.sha256)
      if(!cleanroom)assert(!['20260929193129','20260929215557','20260922182301','20260925212843','20260928130825','20260928143646'].includes(version),'FORBIDDEN_REPLAY')
      evidence.stage='APPLY:'+version;console.log(JSON.stringify({path:name,stage:evidence.stage}))
      if(r15){
        const source=await readMigrationSource(m)
        assert.equal(hash(Buffer.from(source.sql,'utf8')),m.sha256,'EXECUTED_BYTES_DIFFER_FROM_MANIFEST')
        evidence.sourceAttempts??=[];evidence.sourceAttempts.push(source.evidence)
        if(version==='20261006124134'){
          const body=(await db.query("SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='notificar_cedente_ativos' AND p.pronargs=6")).rows[0].prosrc.replaceAll('\r\n','\n')
          const fragment=s=>s.match(/old_fragment:=\$old\$([\s\S]*?)\$old\$/)[1]
          const count=f=>(body.length-body.replaceAll(f,'').length)/f.length
          evidence.notificationGuard={checkoutMatches:count(fragment(await read(m.path))),canonicalMatches:count(fragment(source.sql)),result:'PRECHECK_ONLY'}
          assert.equal(evidence.notificationGuard.canonicalMatches,1,'CANONICAL_FIRST_NOTIF_GUARD_PRECHECK')
        }
        await db.query(source.sql)
        if(version==='20261006124134')evidence.notificationGuard.result='PASS_FULL_MIGRATION'
        evidence.applied.push({version,sha256:m.sha256,source:source.evidence})
      }else{await db.query(await read(m.path));evidence.applied.push({version,sha256:m.sha256})}
    }
    if(r116){evidence.stage='R116_FORWARDS';await applyR116(db,evidence)}
    if(r116auth){evidence.stage='R116_AUTH_FORWARD';evidence.authorizationFix=await applyAuthFix(db)}
    if(cleanroom){evidence.stage='SEED_DOCUMENT_FIXTURE';evidence.fixture=r17?await certifyCanonicalFixture(db):await seedDocumentFixture(db,'SCHEMA_ONLY_MINIMAL')}
    evidence.stage='FINAL_CATALOG';evidence.finalCatalog=await catalog(db);evidence.critical=await target(db)
    if(r16){
      evidence.finalTriggers=await applicationTriggers(db)
      evidence.finalFunctionDefinitions=(await db.query("SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f' ORDER BY 1,2,3")).rows
      await db.query('SET search_path=public,extensions')
    }
    assert(evidence.critical.sacadoShortCircuit.every(x=>x.lanname==='plpgsql'&&x.prosrc.includes("IS DISTINCT FROM 'sacado'")))
    const p16=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='private.operacao_status_reserva_nf(public.operacao_status)'::regprocedure")).rows[0].prosrc
    assert(!p16.includes("'cancelada'"),'P16_REGRESSION')
    const reservations=(await db.query("SELECT status::text status,private.operacao_status_reserva_nf(status) reserved FROM unnest(enum_range(NULL::public.operacao_status)) status")).rows
    assert.deepEqual(reservations.filter(x=>!x.reserved).map(x=>x.status).sort(),['cancelada','reprovada'])
    evidence.p16={signature:'private.operacao_status_reserva_nf(public.operacao_status)',reservations,result:'PASS'}
    await db.query('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions')
    if(a5Only){
      evidence.stage='SQL_REGRESSION:guibor_a5_base.test.sql'
      const a5=await tap(db,'guibor_a5_base.test.sql');assert.equal(a5.checks,36)
      evidence.tests.push(a5);evidence.result='PASS';return
    }
    evidence.stage='SQL_REGRESSIONS'
    for(const f of [...(r17?['guibor_a5_base.test.sql',...(r18?['r1_8_fiscal_net_contract.test.sql']:[]),'c2_1_r2_taxa_consultor.test.sql']:[]),'guibor_a6_comissao.test.sql','guibor_a6_r2_analytics_scope.test.sql','c1_1_organizacao_consultora.test.sql','c2_1_r2_fluxo_taxa.test.sql','r1_3_c5_a6_compat.test.sql']){evidence.stage='SQL_REGRESSION:'+f;evidence.tests.push(await tap(db,f))}
    evidence.tests.push(await tap(db,'notificacoes_shared_cedente.sql',`BEGIN;${await read('supabase/tests/fixtures/guibor_a5_a6.sql')}\n`))
    evidence.tests.push(await tap(db,'sacado_multi.assert.sql',`BEGIN;${await read('supabase/tests/fixtures/guibor_a5_a6.sql')}\n${await read('supabase/tests/fixtures/sacado_multi.sql')}\nINSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES('31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;\n`))
    evidence.notifications=await verifyNotificationRegression(db)
    if(r18){
      evidence.stage='SQL_REGRESSION:health_nfse_municipal.assert.sql'
      evidence.tests.push(await tap(db,'health_nfse_municipal.assert.sql',`BEGIN;${await read('supabase/tests/fixtures/guibor_a5_a6.sql')}\n`))
      evidence.stage='SQL_REGRESSION:guibor_nfse_review_intents.assert.sql'
      const fixture=await read('supabase/tests/c2_1_r2_fluxo_taxa.test.sql'),setup=fixture.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
      assert(setup);const boundary=setup.indexOf('  INSERT INTO public.notas_fiscais (');assert(boundary>0)
      await db.query('BEGIN;'+setup.slice(0,boundary)+'END;\n$setup$;'+await read('supabase/tests/guibor_nfse_review_intents.assert.sql'))
      await db.query('ROLLBACK');evidence.tests.push({file:'guibor_nfse_review_intents.assert.sql',result:'PASS',kind:'ASSERTION_BLOCKS'})
      if(!r110){
        evidence.stage='PREPARE_EXTRA_SQL_DATABASES'
        const {verifyExtraSql}=await import('./r1-8-extra-sql.mjs')
        db=await verifyExtraSql(db,connection,projectId,evidence)
      }else evidence.extraSql={method:'FRESH_STACK',result:'SEPARATE_EVIDENCE_REQUIRED',report:r112?'R1_12_EXTRA_SQL_SUITES.json':'R1_10_EXTRA_SQL_SUITES.json'}
    }
    evidence.stage='MUNICIPAL_REAL_STORAGE'
    const status=await run(['status','--output','json']);assert.equal(status.code,0)
    const local=JSON.parse(status.output.slice(status.output.indexOf('{'),status.output.lastIndexOf('}')+1))
    evidence.municipalChecks=[]
    evidence.storageTrace=[]
    await verifyMunicipalCompatibility(db,connection,localStorageFixture(local,projectId),x=>evidence.municipalChecks.push(x),x=>evidence.storageTrace.push(x))
    if(r19){
      evidence.stage='FINAL_APPLICATION_CATALOG_AFTER_SQL'
      evidence.finalCatalog=await catalog(db)
      await db.query("SET search_path=''")
      evidence.applicationObjects=(await db.query(await read('scripts/qa/reconciliation/r1-9-target-catalog.sql'))).rows.map(o=>({...o,hash:hash(JSON.stringify(o))}))
      evidence.catalogCapturedAfterSql=true
    }
    evidence.result='PASS'
  }catch(error){
    evidence.result='FAIL';evidence.failure={code:error.code??'ASSERTION',message:redactCommandOutput(error.message).slice(0,4500),where:error.where,storageStage:error.storageStage,tap:error.tap,stack:redactCommandOutput(error.stack??'').slice(0,3500)}
    await db?.query('ROLLBACK').catch(()=>{})
  }finally{
    await db?.end().catch(()=>{})
    try{await owned.cleanup(async()=>{const r=await run(['stop','--project-id',projectId,'--no-backup']);assert.equal(r.code,0)});evidence.cleanup='PASS'}catch(e){evidence.cleanup='FAIL';evidence.cleanupFailure=e.message}
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
    if(r15&&!a5Only)await writeFile(`rehearsal/reports/R1_${r16?revision:'5'}_${name.toUpperCase()}_UPGRADE.json`,JSON.stringify(evidence,null,2)+'\n')
    if(r16&&!cleanroom&&!a5Only){
      await writeFile(`rehearsal/reports/R1_${revision}_STORAGE_TRIGGER_FIDELITY.json`,JSON.stringify(report.paths.map(p=>({name:p.name,proof:p.triggerFidelity})),null,2)+'\n')
      await writeFile(`rehearsal/reports/R1_${revision}_STORAGE_SCENARIO_TRACE.json`,JSON.stringify(report.paths.map(p=>({name:p.name,trace:p.storageTrace??[]})),null,2)+'\n')
    }
    console.log(JSON.stringify({path:name,result:evidence.result,stage:evidence.stage,failure:evidence.failure,cleanup:evidence.cleanup,baselineDifferences:evidence.baselineCatalogDifferences?.length}))
  }
  assert.equal(evidence.result,'PASS',`${name}:UPGRADE_STOP`);assert.equal(evidence.cleanup,'PASS','CLEANUP_STOP')
}
try{
  if(cleanroom)await path('cleanroom','CLEAN_ROOM_CANONICAL')
  else{
  await path('prod','PROD_TO_RECONCILED_UPGRADE')
  if(!prodOnly)await path('homolog','HOMOLOG_TO_RECONCILED_UPGRADE')
  }
  assert(report.paths.every(p=>p.result==='PASS'&&p.cleanup==='PASS'),'PATH_OR_CLEANUP_FAILED')
  if(!restoreOnly&&!prodOnly&&!cleanroom){
    report.targetCatalogDifferences=diff(report.paths[0].finalCatalog,report.paths[1].finalCatalog)
    if(!r16){
      assert.deepEqual(report.paths[0].critical,report.paths[1].critical,'CRITICAL_TARGET_DIVERGENCE_STOP')
      assert.deepEqual(report.targetCatalogDifferences,[],'FULL_TARGET_DIVERGENCE_REQUIRES_REVIEW')
    }else report.catalogCertification='PENDING_THREE_WAY_CLASSIFICATION_AFTER_CLEANROOM'
  }
  report.result='PASS'
}catch(e){report.result='FAIL';report.stopReason=e.message;process.exitCode=1}
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({result:report.result,stopReason:report.stopReason}))
