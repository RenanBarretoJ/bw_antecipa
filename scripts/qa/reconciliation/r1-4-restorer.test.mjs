import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,rm,rmdir,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { readRawRestore,hash,catalogDiff } from './r1-4-restorer.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'
test('raw restore preserves mixed line endings, Unicode and JSON roundtrip',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bw-r14-byte-proof-')),file=join(dir,'schema.sql')
  try{
    const text="SET search_path='';\nCREATE FUNCTION demo() RETURNS text AS $$\r\nSELECT 'ação';\r\n$$ LANGUAGE SQL;\n"
    await writeFile(file,Buffer.from(text,'utf8'))
    const result=await readRawRestore(file,hash(text))
    assert.equal(result.sql,text);assert.equal(JSON.parse(JSON.stringify(result)).sql,text)
    assert.notEqual(result.RAW_RESTORE_HASH,result.NORMALIZED_DIAGNOSTIC_HASH)
    await assert.rejects(readRawRestore(file,hash(text.replaceAll('\r\n','\n'))),/SOURCE_SNAPSHOT_HASH_DRIFT/)
  }finally{assert(resolve(file).startsWith(resolve(dir)+requireSeparator()));await rm(file);await rmdir(dir)}
})
function requireSeparator(){return process.platform==='win32'?'\\':'/'}
test('raw source snapshots must still match recorded hashes',async()=>{
  const report=JSON.parse(await readFile('rehearsal/reports/R1_SCHEMA_ONLY_BASELINES.json','utf8'))
  for(const t of report.targets){const r=await readRawRestore(t.schemaPath,t.schemaSha256);assert.equal(r.RAW_RESTORE_HASH,t.schemaSha256)}
})
test('catalog gate detects changed functions, constraints and missing objects',()=>{
  const a=[{kind:'function',name:'f()',hash:'raw-a'},{kind:'constraint',name:'t.c',hash:'raw-b'}]
  assert.equal(catalogDiff(a,[{...a[0],hash:'different'},a[1]]).length,1)
  assert.equal(catalogDiff(a,[a[0],{...a[1],hash:'different'}]).length,1)
  assert.equal(catalogDiff(a,[]).length,2)
  assert.deepEqual(catalogDiff(a,a),[])
})
test('Storage adapter still rejects remote origins and non-owned project namespaces',()=>{
  assert.throws(()=>localStorageFixture({API_URL:'https://example.supabase.co'},'bw_email03_r1full_prod_1'))
  assert.throws(()=>localStorageFixture({API_URL:'http://127.0.0.1:57841'},'production'))
  assert.throws(()=>localStorageFixture({API_URL:'http://127.0.0.1:57841'},'bw_email03_r1full_rlx_1'))
})
