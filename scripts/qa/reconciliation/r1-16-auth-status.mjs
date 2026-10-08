import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/'
const read=async n=>{try{return JSON.parse(await readFile(dir+n+'.json','utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
const cp=await read('R1_16_AUTH_BASELINE_1791408722083_CHECKPOINT')
const approvedHelpers=['scripts/qa/reconciliation/r1-full-upgrades.mjs','scripts/qa/reconciliation/r1-16-rls-run.mjs','scripts/qa/reconciliation/r1-16-extra-sql.mjs','scripts/qa/reconciliation/r1-16-catalog.mjs']
const changed=[]
for(const f of [...cp.files,...cp.reports]){
  const now=hash(await readFile(f.path))
  if(now===f.sha256)continue
  assert(approvedHelpers.includes(f.path),'UNAUTHORIZED_ARTIFACT_CHANGE:'+f.path)
  changed.push({path:f.path,before:f.sha256,after:now,reason:'New authorization forward included; original reports preserved'})
}
assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),cp.head)
assert.deepEqual(await inventory(),cp.docker,'DOCKER_RESOURCES_NOT_RESTORED')
const baseline=await read('R1_16_AUTH_BASELINE_1791408722083'),candidate=await read('R1_16_AUTH_CANDIDATE_1791408849510')
assert.equal(baseline.result,'BASELINE_CAPTURED');assert.equal(candidate.result,'PASS')
const upgrades=await read('R1_16_AUTH_FULL_UPGRADES'),clean=await read('R1_16_AUTH_CLEANROOM'),extra=await read('R1_16_AUTH_EXTRA_SQL_SUITES'),catalog=await read('R1_16_AUTH_TARGET_CATALOG')
const retry=await read('R1_16_AUTH_RETRY_INTERRUPTED')
const files=await readdir(dir)
const latest=pattern=>files.filter(n=>pattern.test(n)).sort().at(-1)?.replace(/\.json$/,'')
const rlsName=latest(/^R1_16_AUTH_RLS_\d+\.json$/),qualityName=latest(/^R1_16_AUTH_QUALITY_\d+\.json$/)
const rls=rlsName?await read(rlsName):null,quality=qualityName?await read(qualityName):null
const paths=[...(upgrades?.paths??[]),...(clean?.paths??[])]
const failed=extra?.stacks?.find(s=>s.result==='FAIL')
const infra=failed?.stage==='BOOTSTRAP'
const manifest=await read('R1_16_AUTH_FORWARD_MANIFEST')
assert.equal(hash(await readFile(manifest.entry.path)),manifest.entry.sha256)
const oldManifest=await read('R1_16_FORWARD_MANIFEST')
for(const m of oldManifest.entries)assert.equal(hash(await readFile(m.path)),m.sha256)
const status={at:new Date().toISOString(),result:'AUTHORIZATION_FIXED_LOCAL_CERTIFICATION_INCOMPLETE',readyForRollout:false,
  authorization:{result:'PASS',rootCause:'SQL NULL authorization was not rejected by IF NOT; now IS NOT TRUE denies false and null',confirmedBypassActors:baseline.unexpected.map(c=>c.actor),baselineReport:'R1_16_AUTH_BASELINE_1791408722083.json',candidateReport:'R1_16_AUTH_CANDIDATE_1791408849510.json',actors:candidate.cases.length,legitimateAllowed:candidate.cases.filter(c=>c.result==='ALLOW').length,denied:candidate.cases.filter(c=>c.result==='DENY').length,unexpected:candidate.unexpected,migration:manifest.entry,behaviorOutsideAuthorization:'Unchanged exact function body except the two guard substitutions; catalog checked'},
  rehearsals:paths.map(p=>({path:p.name,result:p.result,cleanup:p.cleanup,authorizationFix:p.authorizationFix,sqlChecks:p.tests.reduce((n,t)=>n+(t.checks??0),0)+(p.notifications?.checks??0),fiscalGroups:p.municipalChecks?.length??0})),
  sqlChecks:paths.reduce((n,p)=>n+p.tests.reduce((a,t)=>a+(t.checks??0),0)+(p.notifications?.checks??0),0),
  fiscalGroups:paths.reduce((n,p)=>n+(p.municipalChecks?.length??0),0),
  supplemental:{result:extra?.result??'NOT_RUN',passed:extra?.tests??[],failure:extra?.failure??null,classification:infra?'INFRASTRUCTURE_BOOTSTRAP_BEFORE_APPLICATION_SQL':extra?.failure?'SQL_FAILURE':null,retry},
  rls:{report:rlsName,result:rls?.result??'NOT_RUN'},catalog:{result:catalog?.result??'NOT_RUN',unknown:catalog?.UNKNOWN??null},quality:{report:qualityName,result:quality?.result??'NOT_RUN'},
  preservation:{result:'PASS',priorFiles:cp.files.length,priorReports:cp.reports.length,priorMigrations:cp.files.filter(f=>f.path.startsWith('supabase/migrations/')).length,changedQaHelpers:changed,previousSevenForwards:'UNCHANGED',docker:'PREEXISTING_INVENTORY_UNCHANGED'},
  remote:{calls:0,productionChanged:false,homologChanged:false,migrationHistoryEdited:false},commit:false,push:false,deploy:false,
  notCertified:['Full SQL until all supplemental suites pass','Final RLS and three-way catalog until their reports pass','Database types final','Package/PDF/Linux final','Full application quality','Feature preservation manifest final','CI'],
}
await writeFile(dir+'R1_16_AUTH_STATUS.json',JSON.stringify(status,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:status.result,actors:status.authorization.actors,sqlChecks:status.sqlChecks,fiscalGroups:status.fiscalGroups,extra:status.supplemental.result,rls:status.rls.result,catalog:status.catalog.result,quality:status.quality.result,preservation:'PASS',ready:false}))
