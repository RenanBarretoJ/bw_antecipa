// Offline capture comparison. No normalization or automatic drift allowlist.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const clean=await read('R1_13_CLEANROOM'),upgrades=await read('R1_13_FULL_UPGRADES')
assert.equal(clean.result,'PASS');assert.equal(upgrades.result,'PASS')
const paths=[...upgrades.paths,...clean.paths]
assert.deepEqual(paths.map(p=>p.name),['prod','homolog','cleanroom'])
const key=o=>JSON.stringify([o.kind,o.schema,o.name,o.signature])
for(const p of paths){
 assert.equal(p.result,'PASS');assert.equal(p.cleanup,'PASS');assert(p.catalogCapturedAfterSql)
 assert.equal(new Set(p.applicationObjects.map(key)).size,p.applicationObjects.length)
 if(p.name!=='cleanroom')await writeFile(root+`R1_13_${p.name.toUpperCase()}_FINAL_CATALOG.json`,JSON.stringify({result:'PASS',source:`R1_13_${p.name.toUpperCase()}_UPGRADE.json`,projectId:p.projectId,querySha256:hash(await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql')),objects:p.applicationObjects},null,2)+'\n',{flag:'wx'})
}
const maps=paths.map(p=>new Map(p.applicationObjects.map(o=>[key(o),o])))
const keys=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort(),differences=[]
for(const k of keys){const values=maps.map(m=>m.get(k)??null);if(values.some(v=>JSON.stringify(v)!==JSON.stringify(values[0])))differences.push({key:k,objects:Object.fromEntries(paths.map((p,i)=>[p.name,values[i]])),classification:'UNREVIEWED'})}
const report={at:new Date().toISOString(),result:'REQUIRES_CLASSIFICATION',paths:paths.map(p=>({name:p.name,objects:p.applicationObjects.length,projectId:p.projectId,sqlChecks:p.tests.reduce((n,t)=>n+(t.checks??0),0)+p.notifications.checks,municipalGroups:p.municipalChecks.length,migrations:p.applied.length})),totalKeys:keys.length,equalKeys:keys.length-differences.length,differences,normalization:false,remoteChanges:false}
await writeFile(root+'R1_13_RAW_THREE_WAY.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({paths:report.paths,totalKeys:report.totalKeys,equalKeys:report.equalKeys,differences:differences.map(d=>d.key)}))
