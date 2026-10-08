import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'

const file='supabase/migrations/20261007213327_r1_16_duplicata_authorization_fail_closed.sql'
export async function applyAuthFix(db){
  const manifest=JSON.parse(await readFile('rehearsal/reports/R1_16_AUTH_FORWARD_MANIFEST.json','utf8'))
  assert.equal(manifest.result,'PASS');assert.equal(manifest.entry.path,file)
  const bytes=await readFile(file)
  assert.equal(hash(bytes),manifest.entry.sha256);assert(!bytes.includes(13))
  const capture=async()=>{
    await db.query("SET search_path=''")
    const rows=(await db.query(await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8'))).rows
    await db.query('SET search_path=public,extensions')
    return rows
  }
  const before=await capture()
  await db.query(bytes.toString('utf8'))
  const after=await capture()
  assert.equal(after.length,before.length)
  const changed=[]
  for(let i=0;i<before.length;i++){
    const a=before[i],b=after[i]
    if(JSON.stringify(a)===JSON.stringify(b))continue
    assert.equal(a.kind,'function');assert.equal(a.schema,'public');assert.equal(a.name,'corrigir_duplicata')
    const definition=a.definition.replace('  IF NOT (\n    (v_role','  IF (\n    (v_role').replace("  ) THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'","  ) IS NOT TRUE THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'")
    assert.deepEqual({...a,definition},b,'AUTH_FIX_CHANGED_UNRELATED_CATALOG')
    changed.push({kind:a.kind,schema:a.schema,name:a.name,signature:a.signature})
  }
  assert.equal(changed.length,1)
  await db.query(bytes.toString('utf8'))
  assert.deepEqual(await capture(),after,'AUTH_FIX_NOT_IDEMPOTENT')
  // Local transactional negative control: an unexpected body must never be patched.
  await db.query('BEGIN;SET LOCAL search_path=pg_catalog')
  try {
    const current=(await db.query("SELECT pg_get_functiondef('public.corrigir_duplicata(uuid,jsonb,text,text)'::regprocedure) AS ddl")).rows[0].ddl
    await db.query(current.replace('BEGIN\n','BEGIN\n  -- unexpected QA-only definition\n'))
    await db.query('SAVEPOINT unexpected_definition')
    let code=null,message=''
    try{await db.query(bytes.toString('utf8').match(/DO \$r116_auth\$[\s\S]*?\$r116_auth\$;/)[0])}
    catch(e){code=e.code;message=e.message}
    finally{await db.query('ROLLBACK TO SAVEPOINT unexpected_definition')}
    assert.equal(code,'P0001');assert.equal(message,'R1_16_AUTH_UNEXPECTED_DEFINITION')
  }finally{await db.query('ROLLBACK')}
  assert.deepEqual(await capture(),after,'NEGATIVE_CONTROL_CHANGED_CATALOG')
  return {result:'PASS',migration:manifest.entry,changed,idempotence:'PASS',negativeControl:'PASS',rollback:'PASS',otherCatalogPreserved:true}
}
