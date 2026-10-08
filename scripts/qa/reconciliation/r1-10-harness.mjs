import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { freshStack } from './r1-10-fresh-stack.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
try{const old=await readFile('rehearsal/reports/R1_10_STACK_HARNESS.json');await writeFile(`rehearsal/reports/R1_10_STACK_HARNESS_attempt_${Date.now()}.json`,old,{flag:'wx'})}catch(e){if(e.code!=='ENOENT')throw e}
const report={at:new Date().toISOString(),result:'IN_PROGRESS',method:'FRESH_STACK',stacks:[],checks:[]}
const save=()=>writeFile('rehearsal/reports/R1_10_STACK_HARNESS.json',JSON.stringify(report,null,2)+'\n')
let a,b
try{
  // Nested ownership: B predates A, so removing A first preserves A's baseline.
  b=await freshStack('probeb',report.stacks);a=await freshStack('probea',report.stacks)
  assert.notEqual(a.spec.dbPort,b.spec.dbPort);assert.notEqual(a.spec.apiPort,b.spec.apiPort)
  assert.deepEqual(a.evidence.applied.map(x=>[x.version,x.sha256]),b.evidence.applied.map(x=>[x.version,x.sha256]))
  for(const s of [a,b])assert.equal(s.evidence.fixture.certification.result,'PASS')
  for(const code of ['nf_xml','nf_danfe_pdf'])assert.notEqual(a.evidence.fixture.byCode[code],b.evidence.fixture.byCode[code])
  await a.db.query('CREATE SCHEMA r110_probe;CREATE TABLE r110_probe.marker(value text);INSERT INTO r110_probe.marker VALUES(\'A_ONLY\')')
  assert.equal((await b.db.query("SELECT to_regclass('r110_probe.marker') value")).rows[0].value,null)
  const bucket='r110-owned-probe'
  const create=await a.api.storage.createBucket(bucket,{public:false});assert(!create.error,create.error?.message)
  const upload=await a.api.storage.from(bucket).upload('a-only.txt',Buffer.from('synthetic isolation probe'),{contentType:'text/plain'});assert(!upload.error,upload.error?.message)
  assert.equal((await a.db.query('SELECT count(*)::int n FROM storage.objects WHERE bucket_id=$1',[bucket])).rows[0].n,1)
  assert.equal((await b.db.query('SELECT count(*)::int n FROM storage.objects WHERE bucket_id=$1',[bucket])).rows[0].n,0)
  const download=await b.api.storage.from(bucket).download('a-only.txt');assert(download.error,'CROSS_STACK_STORAGE_LEAK')
  report.checks.push('DISTINCT_PORTS','DISTINCT_PROJECTS','SAME_CANONICAL_HASHES','LOCAL_CANONICAL_IDS','DB_MUTATION_ISOLATED','STORAGE_ISOLATED')
  a.evidence.result='PASS';await a.close()
  assert.equal((await b.db.query('SELECT 1 n')).rows[0].n,1)
  const buckets=await b.api.storage.listBuckets();assert(!buckets.error,buckets.error?.message)
  report.checks.push('CLEANUP_A_PRESERVES_B_DB_AND_STORAGE')
  b.evidence.result='PASS';report.result='PASS'
}catch(e){report.result='FAIL';report.failure={message:e.message,code:e.code??'ASSERTION'};process.exitCode=1}
finally{for(const s of [a,b])if(s)try{await s.close()}catch(e){report.result='FAIL';report.cleanupFailure=e.message;process.exitCode=1}await save()}
console.log(JSON.stringify({result:report.result,checks:report.checks,failure:report.failure}))
