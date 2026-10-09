import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {objectKey,equal,functionSemantics,functionSecurity} from './r1-14-analysis.mjs'
import {hash} from './r1-4-restorer.mjs'
const r118=process.argv.includes('--r118')
assert.deepEqual(process.argv.slice(2),r118?['--local-only','--r118']:['--local-only'])
const dir='rehearsal/reports/',read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
const upgrade=await read(r118?'R1_18_FINAL_FULL_UPGRADES':'R1_16_AUTH_FULL_UPGRADES'),clean=await read(r118?'R1_18_FINAL_CLEANROOM':'R1_16_AUTH_CLEANROOM')
assert.equal(upgrade.result,'PASS');assert.equal(clean.result,'PASS')
const paths=[...upgrade.paths,...clean.paths]
assert.deepEqual(paths.map(p=>p.name),['prod','homolog','cleanroom'])
for(const p of paths){assert.equal(p.result,'PASS');assert.equal(p.cleanup,'PASS');assert(p.catalogCapturedAfterSql);assert.equal(p.r116.idempotence,'PASS');assert.equal(p.authorizationFix.result,'PASS')}
const prior=await read('R1_13_RAW_THREE_WAY')
const maps=paths.map(p=>new Map(p.applicationObjects.map(o=>[objectKey(o),o])))
for(let i=0;i<paths.length;i++)assert.equal(maps[i].size,paths[i].applicationObjects.length,'DUPLICATE_CATALOG_KEY')
const keys=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort(),differences=[]
for(const key of keys) {
  const values=maps.map(m=>m.get(key)??null)
  if(values.every(v=>equal(v,values[0])))continue
  const o=values.find(Boolean),objects=Object.fromEntries(paths.map((p,i)=>[p.name,values[i]]))
  let classification='UNKNOWN',proof=null
  if(values.every(Boolean)&&o.kind==='function') {
    const security=values.map(functionSecurity),semantic=values.map(v=>functionSemantics(v.definition))
    if(security.every(s=>equal(s,security[0]))&&semantic.every(s=>equal(s,semantic[0]))) {
      classification='REPRESENTATION_ONLY';proof={method:'EXACT_LEXICAL_BODY_HEADER_TAIL_AND_SECURITY',literalChangesAllowed:false,semanticHash:hash(JSON.stringify(semantic[0]))}
    }
  }
  if(o.kind==='constraint'&&values.every(Boolean)) {
    // Only the two exact R1.4 independently evaluated AND-reassociation pairs.
    const priorDifference=prior.differences.find(d=>d.key===key)
    const targetNames=['comunicacoes.comunicacoes_remetente_nome_check','documento_upload_intents.documento_upload_intents_storage_path_check']
    if(targetNames.includes(o.name)&&priorDifference&&paths.every((p,i)=>equal(values[i].definition,priorDifference.objects[p.name]?.definition))
       &&values.every(v=>v.owner===values[0].owner&&equal(v.acl,values[0].acl))) {
      for(const p of paths.filter(p=>p.name!=='cleanroom')) {
        const c=p.fidelity.constraints.find(c=>c.name===o.name.split('.').at(-1))
        assert.equal(c?.result,'PASS');assert.equal(c?.negativeControl,'PASS')
      }
      classification='REPRESENTATION_ONLY';proof={method:'EXACT_PRIOR_DEFINITION_PAIR_WITH_FRESH_REPARSED_TREE_AND_BEHAVIOR',source:'R1.4 + current R1.16 restore fidelity'}
    }
  }
  if(o.kind==='function'&&o.schema==='private'&&o.name==='email04_dispatch'&&values[0]===null&&values[2]===null&&values[1]) {
    const original=prior.differences.find(d=>d.key===key)
    assert(original&&equal(original.objects.homolog,values[1]),'ENV_SPECIFIC_FUNCTION_CHANGED')
    classification='ENV_SPECIFIC_EXPECTED';proof={target:'HOMOLOG_ONLY',productionCopied:false,schedulerActivated:false}
  }
  differences.push({key,classification,proof,objects})
}
const unknown=differences.filter(d=>d.classification==='UNKNOWN')
const report={at:new Date().toISOString(),result:unknown.length?'FAIL':'PASS',paths:paths.map(p=>({name:p.name,objects:p.applicationObjects.length,stack:p.projectId,forwards:p.r116.applied})),totalKeys:keys.length,equalKeys:keys.length-differences.length,differences,UNKNOWN:unknown.length,REAL_FUNCTIONAL_DRIFT:unknown.length?null:0,remoteWrites:0}
await writeFile(dir+(r118?'R1_18_TARGET_CATALOG':'R1_16_AUTH_TARGET_CATALOG')+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,objects:keys.length,differences:differences.length,unknown:unknown.map(d=>d.key)}))
assert.equal(report.result,'PASS','THREE_WAY_CATALOG_STOP')
