// Historical 49 producer identities, not a claim that 49 direct writers remain.
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applicationProducers } from '../notificacoes/inventory.mjs'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const historicalPath='../bw_antecipa_notificacoes/rehearsal/reports/NOTIFICACOES_R1_INVENTORY.json'
const old=JSON.parse(await readFile(historicalPath,'utf8'))
async function walk(path){const out=[];for(const f of await readdir(path,{withFileTypes:true})){const p=join(path,f.name);out.push(...f.isDirectory()?await walk(p):[p])}return out}
const app=[]
for(const p of (await walk('src')).filter(p=>/\.tsx?$/.test(p)&&!/[.](test|spec)[.]/.test(p)))app.push(...applicationProducers(await readFile(p,'utf8'),p.replaceAll('\\','/')))
const units=list=>[...new Set(list.map(x=>x.path+':'+x.function))].sort()
// PR95 replaced the old cron-local writers with fund-scoped delegates.
// AST enclosingFunction identifies their local result variable as "aviso".
const reviewedReplacements={
  'src/app/api/cron/documentos-vencidos/route.ts:GET':'src/app/api/cron/documentos-vencidos/route.ts:aviso',
  'src/app/api/cron/documentos-vencidos/route.ts:notificarGestoresCron':'src/app/api/cron/documentos-vencidos/route.ts:aviso',
  'src/app/api/cron/vencimentos/route.ts:GET':'src/app/api/cron/vencimentos/route.ts:aviso',
  'src/app/api/cron/vencimentos/route.ts:notificarGestoresCron':'src/app/api/cron/vencimentos/route.ts:aviso',
  'src/app/api/cron/vencimentos/route.ts:notificarSacadosVinculados':'src/app/api/cron/vencimentos/route.ts:aviso',
}
const mappings=units(old.application).map(from=>({from,to:reviewedReplacements[from]??from}))
for(const m of mappings)assert(units(app).includes(m.to),`APPLICATION_PRODUCER_MISSING:${m.from}`)
for(const path of [...new Set(app.map(x=>x.path))]){
  const main=execFileSync('git',['show',`2e8146ebe7582c5bdc10ddee1f8862d806607ee2:${path}`],{encoding:'utf8',windowsHide:true})
  const semantic=x=>({path:x.path,function:x.function,kind:x.kind,helper:x.helper})
  assert.deepEqual(app.filter(x=>x.path===path).map(semantic),applicationProducers(main,path).map(semantic),'PRODUCTION_PRODUCER_CHANGED')
}
assert.equal(app.filter(x=>x.kind==='direct-write').length,0)
const schemaPath='rehearsal/tmp/reconciliation-r1-baselines/prod-schema.sql'
const schema=await readFile(schemaPath,'utf8')
const declarations=[...schema.matchAll(/CREATE OR REPLACE FUNCTION ("(?:public|private)"\."[^"]+"\([\s\S]*?\)) RETURNS/g)].map(x=>x[1])
const sqlUnits=old.sql.map(x=>x.signature.slice(0,x.signature.indexOf(' RETURNS')))
assert.equal(sqlUnits.length,11)
for(const signature of sqlUnits)assert(declarations.includes(signature),`SQL_PRODUCER_SIGNATURE_MISSING:${signature}`)
assert.equal(units(old.application).length+sqlUnits.length,49)
const report={result:'PASS',historicalPath,historicalSha256:fileSha256(historicalPath),schemaSha256:fileSha256(schemaPath),
  applicationProducerFunctions:units(app).length,applicationCallSites:app.length,applicationDirectWrites:0,
  historicalSqlSignatures:sqlUnits.length,historicalProducerUnits:49,applicationUnits:units(app),sqlUnits,mappings,
  interpretation:'Historical identities retained. Legacy notificar_cedente_ativos stays restricted; notification behavior, canonical writers and zero global Gestor broadcasts are separately covered by R1.3 runtime tests.'}
await writeFile('rehearsal/reports/R1_3_NOTIFICATION_PRODUCERS.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({...report,applicationUnits:undefined,sqlUnits:undefined,mappings:undefined}))
