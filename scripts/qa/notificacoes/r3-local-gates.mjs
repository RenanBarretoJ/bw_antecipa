import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

export function applicationHash() {
  const r=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','--','src','supabase/migrations','package.json','package-lock.json'],{encoding:'utf8',windowsHide:true})
  assert.equal(r.status,0)
  const hash=createHash('sha256')
  for(const file of [...new Set(r.stdout.trim().split(/\r?\n/))].sort())hash.update(file).update(readFileSync(file,'utf8').replaceAll('\r\n','\n'))
  return hash.digest('hex')
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) {
  const node='C:/Users/BrenoAlvim/AppData/Local/BWAntecipa/toolchain/node-v22.23.1-win-x64/node.exe'
  const out='rehearsal/reports/notificacoes-r3';mkdirSync(out,{recursive:true})
  const report={at:new Date().toISOString(),applicationHash:applicationHash(),success:false,gates:[]}
  const gates=[
    ['focused',['node_modules/vitest/vitest.mjs','run','src/lib/notificacoes']],
    ['typescript',['node_modules/typescript/bin/tsc','--noEmit']],
    ['lint',['node_modules/eslint/bin/eslint.js']],
    ['full-suite',['node_modules/vitest/vitest.mjs','run']],
    ['build',['node_modules/next/dist/bin/next','build','--webpack']],
    ['sql-r1',['scripts/qa/notificacoes/database.test.mjs','--producers']],
    ['sql-shared',['scripts/qa/notificacoes/shared-cadastro.test.mjs']],
    ['sql-producers',['scripts/qa/notificacoes/producers.test.mjs']],
    ['browser',['scripts/qa/notificacoes/browser-local.mjs']],
  ]
  try {
    for(const [name,args] of gates) {
      console.log(JSON.stringify({gate:name,state:'running'}));let output=''
      const code=await new Promise((res,rej)=>{
        const child=spawn(node,args,{windowsHide:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:59421',NEXT_PUBLIC_SUPABASE_ANON_KEY:'qa-build-placeholder',SUPABASE_SERVICE_ROLE_KEY:'qa-build-placeholder'}})
        child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);child.on('error',rej);child.on('exit',res)
      })
      writeFileSync(`${out}/${name}.log`,output)
      report.gates.push({name,code});console.log(JSON.stringify({gate:name,code}))
      assert.equal(code,0,'GATE_FAILED:'+name)
    }
    assert.equal(applicationHash(),report.applicationHash,'APP_CHANGED_DURING_GATES')
    report.success=true
  } finally {writeFileSync(`${out}/local-gates.json`,JSON.stringify(report,null,2))}
}
