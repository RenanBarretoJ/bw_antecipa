// Preserve the first generated draft before refined feature/source attribution.
import assert from 'node:assert/strict'
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root=resolve('rehearsal/reports'),destination=resolve(root,'R1_14_attempt_01')
assert.equal(dirname(destination),root);await mkdir(destination)
const names=['CATALOG_DIFF_RAW','SCHEMA_ACL_DEPARA','RELATION_ACL_DEPARA','NULLABILITY_DEPARA','FUNCTION_DEPARA','POLICY_DEPARA','TRIGGER_DEPARA','CONSTRAINT_DEPARA','INDEX_DEPARA','ROOT_CAUSE_GROUPS','SOURCE_INDEX']
const records=[]
for(const name of names)for(const ext of ['json',...(['CATALOG_DIFF_RAW','SCHEMA_ACL_DEPARA','RELATION_ACL_DEPARA','NULLABILITY_DEPARA'].includes(name)?['md']:[])]){
 const basename='R1_14_'+name+'.'+ext,from=resolve(root,basename),to=resolve(destination,basename)
 assert.equal(dirname(from),root);assert.equal(dirname(to),destination)
 const before=hash(await readFile(from));await rename(from,to);assert.equal(hash(await readFile(to)),before)
 records.push({from,to,sha256:before})
}
await writeFile(resolve(destination,'manifest.json'),JSON.stringify({reason:'Refine feature mapping and attach exact composed-source provenance; preserve draft evidence',records},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({archived:records.length,path:destination,deleted:0}))
