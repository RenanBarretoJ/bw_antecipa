import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {command,productionRef,productionBase,certified,out} from './production-runtime.mjs'
assert.equal(process.argv.length,2)
const gh='C:/Program Files/GitHub CLI/gh.exe',vc='C:/Users/BrenoAlvim/AppData/Roaming/npm/node_modules/vercel/dist/vc.js'
const apply=JSON.parse(readFileSync(out+'/apply-production.json','utf8'))
assert(apply.success&&apply.committed&&apply.steps.length===4)
const pr=JSON.parse(command(gh,['pr','view','95','--json','state,headRefOid,mergeCommit']))
assert.equal(pr.state,'MERGED');assert.equal(pr.headRefOid,apply.sha)
const release=pr.mergeCommit.oid
command('git',['fetch','origin',release])
assert.equal(command('git',['diff',certified,release,'--','src','supabase/migrations','package.json','package-lock.json','next.config.ts']),'','SOURCE_DRIFT')
assert.equal(command('git',['ls-remote','origin','refs/heads/main']).split(/\s/)[0],release)
const deployment=JSON.parse(command(process.execPath,[vc,'inspect',new URL(productionBase).hostname,'--scope','renanbarretoj','--json']))
assert.equal(deployment.target,'production');assert.equal(deployment.readyState,'READY')
const status=JSON.parse(command(gh,['api',`repos/RenanBarretoJ/bw_antecipa/commits/${release}/status`]))
assert(status.statuses.some(s=>s.context==='Vercel'&&s.state==='success'&&'dpl_'+s.target_url.split('/').pop()===deployment.id),'DEPLOYMENT_SHA_NOT_READY')
const r=await fetch(productionBase+'/login');assert.equal(r.status,200)
const csp=r.headers.get('content-security-policy')??''
assert(csp.includes(productionRef+'.supabase.co'));assert(!/twmxvhddqbderjzgmcjo|fhgkmggthxikfpogrvaa|inkyqlmusvorcmibmrhp/.test(csp))
const report={success:true,at:new Date().toISOString(),ref:productionRef,base:productionBase,release,head:apply.sha,sourceEquivalent:true,deploymentId:deployment.id,url:deployment.url,target:deployment.target,readyState:deployment.readyState,aliasVerified:true,cspProduction:true}
writeFileSync(out+'/deploy.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
