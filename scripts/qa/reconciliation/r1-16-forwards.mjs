import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
const read=async n=>JSON.parse(await readFile('rehearsal/reports/'+n+'.json','utf8'))
const key=o=>JSON.stringify([o.kind,o.schema,o.name,o.signature])
async function capture(db) {
  await db.query("SET search_path=''")
  const rows=(await db.query(await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8'))).rows
  await db.query('SET search_path=public,extensions')
  return rows
}
function expectedChange(o) {
  if(o.schema!=='public') return false
  return {
    column:['cedentes.sacado_agencia_escrow','cedentes.sacado_banco_escrow','cedentes.sacado_conta_escrow','cedentes.sacado_tipo_conta_escrow','consultor_cedente.created_at','taxas_cedente.created_at','taxas_cedente.updated_at'],
    constraint:['taxas_cedente.taxas_prazo_check','taxas_cedente.taxas_cedente_taxa_percentual_check','usuario_papeis.usuario_papeis_origem_check'],
    function:['corrigir_duplicata'],
    policy:['taxas_cedente.taxas_cedente_select','devedores_solidarios.Cedentes podem ver seus devedores'],
    index:['idx_taxas_cedente_id'],
  }[o.kind]?.includes(o.name)??false
}
export async function applyR116(db,evidence) {
  const manifest=await read('R1_16_FORWARD_MANIFEST')
  assert.equal(manifest.result,'PASS');assert.equal(manifest.entries.length,7)
  const acl=(await read('R1_15_ACL_CONSUMERS')).rows
  const before=await capture(db),map=new Map(before.map(o=>[key(o),o]))
  evidence.r116={stage:'APPLY',applied:[],review:[],idempotence:'NOT_RUN'}
  for(const e of manifest.entries) {
    assert.equal(e.source,'NEW_R1_16_FORWARD')
    const bytes=await readFile(e.path);assert.equal(hash(bytes),e.sha256);assert(!bytes.includes(13))
    console.log(JSON.stringify({stage:'R116_FORWARD',version:e.version}))
    await db.query(bytes.toString('utf8'))
    evidence.r116.applied.push({version:e.version,sha256:e.sha256})
  }
  const after=await capture(db),next=new Map(after.map(o=>[key(o),o]))
  for(const k of new Set([...map.keys(),...next.keys()])) {
    const a=map.get(k),b=next.get(k),o=b??a
    if(JSON.stringify(a)===JSON.stringify(b))continue
    if(a&&b)assert.equal(a.owner,b.owner,'UNEXPECTED_OWNER_CHANGE:'+k)
    if(expectedChange(o)) { evidence.r116.review.push({key:k,change:'APPROVED_TARGET'});continue }
    const rel=o.schema+'.'+(o.kind==='relation'?o.name:o.name.split('.')[0])
    const target=acl.find(r=>r.relation===rel)
    assert(a&&b&&target,'UNEXPECTED_FORWARD_OBJECT_CHANGE:'+k)
    assert.deepEqual(b.acl,[...target.proposedTargetAcl].sort(),'UNEXPECTED_FINAL_ACL:'+k)
    assert.deepEqual({...a,acl:b.acl},b,'CHANGE_BEYOND_APPROVED_ACL:'+k)
    evidence.r116.review.push({key:k,change:'APPROVED_RELATION_ACL'})
  }
  for(const r of acl) {
    const o=after.find(o=>o.kind==='relation'&&o.schema+'.'+o.name===r.relation)
    assert.deepEqual(o.acl,[...r.proposedTargetAcl].sort(),'FINAL_ACL:'+r.relation)
  }
  for(const e of manifest.entries)await db.query((await readFile(e.path)).toString('utf8'))
  assert.deepEqual(await capture(db),after,'R116_NOT_IDEMPOTENT')
  evidence.r116.idempotence='PASS';evidence.r116.securityComposition='PASS'
  evidence.r116.stage='PASS'
  return after
}
