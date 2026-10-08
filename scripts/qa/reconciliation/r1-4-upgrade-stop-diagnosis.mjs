// Offline evidence only: no database connection or migration execution.
import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { hash } from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const migration='supabase/migrations/20261006124134_notificacoes_entity_producers.sql'
const checkout=await readFile(migration,'utf8')
const committed=execFileSync('git',['show',`HEAD:${migration}`],{encoding:'utf8',windowsHide:true})
const schema=await readFile('rehearsal/tmp/reconciliation-r1-baselines/homolog-schema.sql','utf8')
const start=schema.indexOf('CREATE OR REPLACE FUNCTION "private"."notificar_cedente_ativos"(')
assert(start>=0)
const declaration=schema.slice(start)
const delimiter=declaration.match(/\bAS (\$[a-zA-Z0-9_]*\$)/)
assert(delimiter)
const bodyStart=delimiter.index+delimiter[0].length
const body=declaration.slice(bodyStart,declaration.indexOf(delimiter[1],bodyStart))
const fragment=s=>{const match=s.match(/old_fragment:=\$old\$([\s\S]*?)\$old\$/);assert(match);return match[1]}
const lf=s=>s.replaceAll('\r\n','\n')
const count=(s,f)=>(s.length-s.replaceAll(f,'').length)/f.length
const rawFragment=fragment(checkout),gitFragment=fragment(committed),normalizedBody=lf(body)
const report={at:new Date().toISOString(),scope:'OFFLINE_FIRST_FAILED_GUARD_ONLY',migration,
  checkoutSha256:hash(checkout),gitBlobSha256:hash(committed),checkoutNormalizedSha256:hash(lf(checkout)),
  gitBlobEqualsNormalizedCheckout:committed===lf(checkout),
  bodyRawSha256:hash(body),bodyCrLfCount:(body.match(/\r\n/g)||[]).length,
  fragmentRawSha256:hash(rawFragment),fragmentGitSha256:hash(gitFragment),
  fragmentCrLfCount:(rawFragment.match(/\r\n/g)||[]).length,
  rawFragmentMatches:count(normalizedBody,rawFragment),gitFragmentMatches:count(normalizedBody,gitFragment),
  normalizedFragmentMatches:count(normalizedBody,lf(rawFragment)),
  guardPreserved:true,historicalMigrationEdited:false,upgradeRerun:false,
  conclusion:'CHECKOUT_CRLF_LITERAL_VS_NORMALIZED_LF_FUNCTION_BODY',
  limitation:'Proves the first failed text guard only, not the rest of the migration or the full homolog upgrade.'}
assert.equal(report.gitBlobEqualsNormalizedCheckout,true)
assert.equal(report.rawFragmentMatches,0)
assert.equal(report.gitFragmentMatches,1)
assert.equal(report.normalizedFragmentMatches,1)
assert.equal(report.bodyCrLfCount,0)
assert(report.fragmentCrLfCount>0)
await writeFile('rehearsal/reports/R1_4_UPGRADE_STOP_DIAGNOSIS.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
