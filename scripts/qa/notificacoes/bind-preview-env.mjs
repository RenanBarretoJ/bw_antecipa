// Secrets stay in process memory/stdin. Only this exact Vercel Preview branch.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { details,branch,base } from './preview-runtime.mjs'
assert.deepEqual(process.argv.slice(2),['--apply'])
const d=details()
for(const [key,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:d.SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:d.SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:d.SUPABASE_SERVICE_ROLE_KEY,APP_BASE_URL:base})){
  const r=spawnSync(process.execPath,[resolve(process.env.APPDATA,'npm/node_modules/vercel/dist/vc.js'),'env','add',key,'preview','--git-branch',branch,'--project','prj_nKt7FiU3FWHrmRyf0mbDudM0AVIF','--scope','renanbarretoj','--yes','--force',...(key==='SUPABASE_SERVICE_ROLE_KEY'?['--sensitive']:['--no-sensitive'])],{input:value,encoding:'utf8',windowsHide:true,timeout:30000})
  assert.equal(r.status,0,`PREVIEW_ENV_BIND_FAILED:${key}`)
  console.log(JSON.stringify({key,target:'preview',branch,success:true}))
}
