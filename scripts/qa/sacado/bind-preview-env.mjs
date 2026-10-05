// One-off Preview-only binding. Secrets travel in memory/stdin, never in output/files.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

assert.deepEqual(process.argv.slice(2), ['--apply'])
const manifest=JSON.parse(readFileSync('scripts/qa/sacado/preview-manifest.json','utf8'))
assert.equal(manifest.projectRef,'yynlrtonrqxoatmuclrt')
assert.equal(manifest.gitBranch,'hotfix/sacado-multi-cnpj')
const detailsResult=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'branches','get',manifest.branchId,'--project-ref',manifest.parentProjectRef,'-o','json'],{encoding:'utf8',windowsHide:true,timeout:30000})
assert.equal(detailsResult.status,0,'BRANCH_LOOKUP_FAILED')
const details=JSON.parse(detailsResult.stdout)
assert.equal(new URL(details.SUPABASE_URL).hostname,`${manifest.projectRef}.supabase.co`)
for (const key of ['SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']) assert.equal(JSON.parse(Buffer.from(details[key].split('.')[1],'base64url').toString()).ref,manifest.projectRef,'KEY_TARGET_MISMATCH')
const vc=resolve(process.env.APPDATA,'npm/node_modules/vercel/dist/vc.js')
const project='prj_nKt7FiU3FWHrmRyf0mbDudM0AVIF'
const entries={
  NEXT_PUBLIC_SUPABASE_URL:details.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:details.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:details.SUPABASE_SERVICE_ROLE_KEY,
  APP_BASE_URL:'https://bw-antecipa-git-hotfix-sacado-multi-cnpj-renanbarretoj.vercel.app',
}
for (const [key,value] of Object.entries(entries)) {
  const r=spawnSync(process.execPath,[vc,'env','add',key,'preview','--git-branch',manifest.gitBranch,'--project',project,'--scope','renanbarretoj','--yes','--force',...(key==='SUPABASE_SERVICE_ROLE_KEY'?['--sensitive']:['--no-sensitive'])],{input:value,encoding:'utf8',windowsHide:true,timeout:30000})
  if(r.status!==0) {
    let message=(r.stderr+r.stdout)
    for(const secret of Object.values(entries)) message=message.replaceAll(secret,'[REDACTED]')
    message=message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[REDACTED]')
    console.error(message.slice(-800))
  }
  assert.equal(r.status,0,`PREVIEW_ENV_ADD_FAILED:${key}`)
  console.log(JSON.stringify({key,target:'preview',gitBranch:manifest.gitBranch,success:true}))
}
