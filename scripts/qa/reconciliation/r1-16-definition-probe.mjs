import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const report={at:new Date().toISOString(),result:'IN_PROGRESS',stacks:[],observations:[],remoteCalls:0}
let stack
try {
  stack=await freshStack('probea',report.stacks)
  const canonical=JSON.parse(await readFile('rehearsal/reports/R1_13_CLEANROOM.json','utf8')).paths[0].applicationObjects.find(o=>o.kind==='function'&&o.name==='corrigir_duplicata').definition.replaceAll('\r\n','\n')
  for(const searchPath of ['pg_catalog,public,private','pg_catalog']) {
    await stack.db.query('SET search_path='+searchPath)
    const r=(await stack.db.query("SELECT pg_get_functiondef('public.corrigir_duplicata(uuid,jsonb,text,text)'::regprocedure) AS definition,prosrc,prosecdef,proconfig,proacl::text,proowner::regrole::text AS owner FROM pg_proc WHERE oid='public.corrigir_duplicata(uuid,jsonb,text,text)'::regprocedure")).rows[0]
    const definition=r.definition.replaceAll('\r\n','\n')
    report.observations.push({searchPath,definition,hash:hash(definition),matchesCanonical:definition===canonical,bodyHash:hash(r.prosrc),security:{definer:r.prosecdef,config:r.proconfig,acl:r.proacl,owner:r.owner}})
  }
  const [visible,qualified]=report.observations
  assert.equal(visible.matchesCanonical,false)
  assert.equal(qualified.matchesCanonical,true)
  assert.equal(visible.bodyHash,qualified.bodyHash)
  assert.deepEqual(visible.security,qualified.security)
  assert.equal(visible.definition.replace(' RETURNS duplicatas\n',' RETURNS public.duplicatas\n'),qualified.definition)
  report.cause='pg_get_functiondef return-type qualification depends on search_path; body and security are identical. Canonical capture used nonvisible public schema.'
  report.result='PASS_REPRESENTATION_ONLY';stack.evidence.result='PASS'
}catch(e){report.result='FAIL_STOP';report.failure={message:e.message,code:e.code};process.exitCode=1}
finally{await stack?.close();await writeFile('rehearsal/reports/R1_16_DEFINITION_PROBE.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})}
console.log(JSON.stringify({result:report.result,cause:report.cause,failure:report.failure}))
