import assert from 'node:assert/strict'
import { seedDocumentFixture,FixtureMode,validateCatalogRow } from './r1-2-document-fixture.mjs'
import { hash } from './r1-4-restorer.mjs'
export async function certifyCanonicalFixture(db){
  await db.query('BEGIN READ ONLY')
  try{
    const snapshot=async()=>(await db.query('SELECT * FROM public.documento_tipos ORDER BY codigo,id')).rows
    const before=await snapshot()
    const fixture=await seedDocumentFixture(db,FixtureMode.canonical)
    assert.deepEqual(await seedDocumentFixture(db,FixtureMode.canonical),fixture,'CANONICAL_FIXTURE_NOT_IDEMPOTENT')
    assert.deepEqual(await snapshot(),before,'CANONICAL_CATALOG_WAS_MODIFIED')
    const negatives=[]
    for(const row of fixture.rows){
      const {id,...expected}=row
      assert.equal(validateCatalogRow([{...row,id:'78123456-1234-4123-8123-123456789abc'}],expected).id,'78123456-1234-4123-8123-123456789abc')
      for(const [field,value] of Object.entries({dominio:'invalid',ativo:false,cardinalidade:'invalid',mime_types_aceitos:[],extensoes_aceitas:[],tamanho_max_bytes:'0',permite_multiplas_versoes:false})){
        assert.throws(()=>validateCatalogRow([{...row,[field]:value}],expected),/CATALOG_ATTRIBUTE_DRIFT/)
        negatives.push({code:row.codigo,field,result:'PASS'})
      }
      assert.throws(()=>validateCatalogRow([],expected),/CATALOG_CODE_CARDINALITY/)
      assert.throws(()=>validateCatalogRow([row,{...row,id:'78123456-1234-4123-8123-123456789abc'}],expected),/CATALOG_CODE_CARDINALITY/)
      assert.equal(fixture.byCode[row.codigo],id)
    }
    const unique=(await db.query("SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c WHERE c.conrelid='public.documento_tipos'::regclass AND c.contype='u'")).rows
    assert(unique.some(u=>u.definition==='UNIQUE (codigo)'),'CODE_UNIQUE_CONSTRAINT_MISSING')
    await db.query('COMMIT')
    return {...fixture,certification:{result:'PASS',readOnlyTransaction:true,catalogBeforeSha256:hash(JSON.stringify(before)),catalogAfterSha256:hash(JSON.stringify(before)),negativeAttributes:negatives,missingAndDuplicateRejected:true,uniqueConstraints:unique,resolvedIds:fixture.byCode}}
  }catch(e){await db.query('ROLLBACK');throw e}
}
