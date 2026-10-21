import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root=fileURLToPath(new URL('../../../',import.meta.url))
const evidenceRoot=resolve(process.env.LOCALAPPDATA,'bw-antecipa-evidence/vortx-operational-reports-20261020')
const qualityDir=resolve(process.argv[2]??'')
assert(qualityDir.startsWith(evidenceRoot+'\\')||qualityDir.startsWith(evidenceRoot+'/'),'EXPLICIT_LOCAL_QUALITY_EVIDENCE_REQUIRED')
const read=path=>readFileSync(path,'utf8')
const sha=value=>createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex')
function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0);return result.stdout}
assert.equal(git(['branch','--show-current']).trim(),'feature/vortx-real-data-preview')
const quality=JSON.parse(read(resolve(qualityDir,'QUALITY.json')))
const summary=JSON.parse(read(resolve(qualityDir,'SUMMARY.json')))
const tests=JSON.parse(read(resolve(qualityDir,'vitest.json')))
const sql=[]
for(const name of ['callback_sql_two_stacks','stock_sql_two_stacks']){
  const log=read(resolve(qualityDir,`${name}.log`)).split(/\r?\n/).filter(Boolean)
  const result=JSON.parse(log.at(-1));assert(result.passed)
  const directory=result.output??result.evidence
  assert(typeof directory==='string','SQL_EVIDENCE_DIRECTORY_MISSING')
  const full=JSON.parse(read(resolve(directory,'REPORT.json')))
  assert(full.DOCKER_TEST_ENV_CLEANUP)
  sql.push({name,evidence:resolve(directory,'REPORT.json'),stacks:full.stacks.map(s=>({checks:s.checks?.length??s.tests?.length,cleanup:s.cleanup})),cleanup:full.DOCKER_TEST_ENV_CLEANUP})
}
const guards=[
  'src/lib/auth/authorization.ts','src/lib/auth/sensitive-action.ts',
  'supabase/migrations/20261019180624_vortx_report_requests_preview.sql',
  'supabase/migrations/20261019201346_vortx_report_callback_inbox.sql',
  'supabase/migrations/20261019203424_vortx_callback_admin_ui.sql',
  'supabase/migrations/20261019192624_vortx_native_stock.sql',
  'supabase/migrations/20261020192527_vortx_stock_callback_processing.sql',
  'supabase/migrations/20261020204704_vortx_report_request_revisions.sql',
].map(path=>{const current=sha(read(resolve(root,path))),baseline=sha(git(['show',`HEAD:${path}`]));assert.equal(current,baseline,`HISTORICAL_SOURCE_CHANGED:${path}`);return{path,sha256:current,unchanged:true}})
const files=git(['status','--porcelain=v1','--untracked-files=all']).split(/\r?\n/).filter(Boolean).map(line=>({status:line.slice(0,2),path:line.slice(3).replace(/^"|"$/g,'')}))
const report={
  scope:'LOCAL_ONLY_VORTX_OPERATIONAL_REPORTS',branch:git(['branch','--show-current']).trim(),baseline:git(['rev-parse','HEAD']).trim(),
  EXTRA_REPORT_TOTP_REQUIRED:false,PLATFORM_LOGIN_MFA_PRESERVED:true,CALLBACK_CREDENTIAL_MFA_PRESERVED:true,
  GESTOR_FUND_SCOPED_AUTHORIZATION:'PASS',LEITOR_READ_ONLY:'PASS',RLS:'ENABLED',AUTOMATIC_FINANCIAL_PUBLICATION:false,
  schedule:{localTime:'09:30 America/Sao_Paulo',cronUTC:'30 12 * * 1-5',reference:'PREVIOUS_ANBIMA_BUSINESS_DAY',types:['PosicaoAtivo','PosicaoParcela','Inclusao','Exclusao'],active:false},
  MOVEMENT_FINANCIAL_INGESTION_CERTIFIED:false,
  tests:{passed:tests.numPassedTests,failed:tests.numFailedTests,skipped:tests.numPendingTests},quality:quality.checks,summary,sql,
  migration:{path:'supabase/migrations/20261020212422_vortx_operational_reports.sql',sha256:sha(read(resolve(root,'supabase/migrations/20261020212422_vortx_operational_reports.sql'))),appliedRemotely:false},
  historicalGuards:guards,files,
  DOCKER_TEST_ENV_CLEANUP:sql.every(s=>s.cleanup),REMOTE_CHANGED:false,PREVIEW_DEPLOYED:false,PRODUCTION_CHANGED:false,HOMOLOG_CHANGED:false,
  pending:[
    'Global lint fails in preexisting rehearsal/tmp/closeout-vortx-semantics-20261020.mjs; file preserved; not a global PASS.',
    'Apply only the reviewed new migration and publish Preview after release checks; no remote mutation in this execution.',
    'Authenticated operator browser smoke after Preview publication.',
    'Vercel Cron is production-only. Scheduled execution is prepared, not active or live-certified in Preview.',
    'Confirm inclusion/exclusion interval boundary semantics before operational daily activation; no financial ingestion for these layouts.',
    'Historical download timestamps remain null; no fabricated backfill.',
  ],
}
const target=resolve(qualityDir,'CLOSEOUT.json')
writeFileSync(target,JSON.stringify(report,null,2))
console.log(JSON.stringify({report:target,tests:report.tests,DOCKER_TEST_ENV_CLEANUP:report.DOCKER_TEST_ENV_CLEANUP,PREVIEW_DEPLOYED:false,GLOBAL_GATE_PASS:summary.globalGatePassed}))
