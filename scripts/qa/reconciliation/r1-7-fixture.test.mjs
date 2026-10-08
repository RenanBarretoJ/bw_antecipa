import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCatalogRow,FixtureMode,seedDocumentFixture } from './r1-2-document-fixture.mjs'
const expected={codigo:'nf_xml',nome:'XML da NF-e',dominio:'nf',mime_types_aceitos:['application/xml','text/xml','application/octet-stream'],extensoes_aceitas:['xml'],tamanho_max_bytes:'20971520',permite_multiplas_versoes:true,ativo:true,cardinalidade:'por_nf'}
const row=()=>({id:'78123456-1234-4123-8123-123456789abc',...structuredClone(expected)})
test('canonical row with a non-QA UUID resolves that exact technical key',()=>assert.equal(validateCatalogRow([row()],expected).id,row().id))
test('missing or duplicate code fails closed',()=>{
  assert.throws(()=>validateCatalogRow([],expected),/CATALOG_CODE_CARDINALITY/)
  assert.throws(()=>validateCatalogRow([row(),row()],expected),/CATALOG_CODE_CARDINALITY/)
})
for(const [field,value] of Object.entries({nome:'Other',dominio:'cadastro',mime_types_aceitos:['application/pdf'],extensoes_aceitas:['pdf'],tamanho_max_bytes:'1',permite_multiplas_versoes:false,ativo:false,cardinalidade:'por_parcela'})){
  test(`official attribute drift rejected: ${field}`,()=>assert.throws(()=>validateCatalogRow([{...row(),[field]:value}],expected),/CATALOG_ATTRIBUTE_DRIFT/))
}
test('modes are explicit and canonical branch contains no write path',async()=>{
  assert.deepEqual(Object.values(FixtureMode),['SCHEMA_ONLY_MINIMAL','CANONICAL_EXISTING_CATALOG'])
  const source=await readFile('scripts/qa/reconciliation/r1-2-document-fixture.mjs','utf8')
  assert.match(source,/mode===FixtureMode.minimal&&found.length===0/)
  assert(!/\bUPDATE\b|\bDELETE\b|LIMIT 1/i.test(source))
  assert.match(source,/if\(mode===FixtureMode.minimal\)assert.equal\(count,2/)
})
function fakeCatalog(initial){
  const rows=structuredClone(initial),writes=[]
  const definitions={nf_xml:expected,nf_danfe_pdf:{...expected,codigo:'nf_danfe_pdf',nome:'DANFE em PDF',mime_types_aceitos:['application/pdf'],extensoes_aceitas:['pdf']}}
  return {rows,writes,connectionParameters:{host:'127.0.0.1',port:57942},async query(sql,args=[]){
    if(sql.startsWith('select v.*'))return {rows:[structuredClone(definitions[sql.includes("('nf_xml',")?'nf_xml':'nf_danfe_pdf'])]}
    if(sql.includes('having count(*) > 1'))return {rows:rows.filter((r,i)=>rows.findIndex(x=>x.codigo===r.codigo)!==i).map(r=>({codigo:r.codigo}))}
    if(sql.startsWith('select id,'))return {rows:rows.filter(r=>r.codigo===args[0])}
    if(sql.startsWith('insert into public.documento_tipos')){const code=sql.includes("('nf_xml',")?'nf_xml':'nf_danfe_pdf';writes.push(code);rows.push({id:args[0],...structuredClone(definitions[code])});return {rows:[]}}
    if(sql.startsWith('select count(*)'))return {rows:[{n:rows.length}]}
    throw new Error('UNREVIEWED_TEST_QUERY')
  }}
}
const pdf=()=>({...row(),id:'78123456-1234-4123-8123-123456789abd',codigo:'nf_danfe_pdf',nome:'DANFE em PDF',mime_types_aceitos:['application/pdf'],extensoes_aceitas:['pdf']})
test('canonical mode accepts additional unique types and never writes',async()=>{
  const db=fakeCatalog([row(),pdf(),{...row(),codigo:'additional_type'}])
  const result=await seedDocumentFixture(db,FixtureMode.canonical)
  assert.equal(result.catalogCount,3);assert.deepEqual(db.writes,[])
  assert.equal(result.byCode.nf_danfe_pdf,pdf().id)
})
test('minimal mode inserts only absent codes and preserves an existing valid UUID',async()=>{
  const db=fakeCatalog([row()])
  const result=await seedDocumentFixture(db,FixtureMode.minimal)
  assert.deepEqual(db.writes,['nf_danfe_pdf']);assert.equal(result.byCode.nf_xml,row().id)
  assert.deepEqual(await seedDocumentFixture(db,FixtureMode.minimal),result)
  assert.deepEqual(db.writes,['nf_danfe_pdf'])
})
test('minimal mode empty creates precisely the minimal catalog',async()=>{
  const db=fakeCatalog([]);const result=await seedDocumentFixture(db,FixtureMode.minimal)
  assert.equal(result.catalogCount,2);assert.deepEqual(db.writes,['nf_xml','nf_danfe_pdf'])
})
test('canonical mode does not fill missing entries or select the first duplicate',async()=>{
  for(const initial of [[],[row(),row(),pdf()]]){
    const db=fakeCatalog(initial)
    await assert.rejects(seedDocumentFixture(db,FixtureMode.canonical),/CATALOG_CODE_CARDINALITY|CATALOG_DUPLICATE_CODE/)
    assert.deepEqual(db.writes,[])
  }
})
