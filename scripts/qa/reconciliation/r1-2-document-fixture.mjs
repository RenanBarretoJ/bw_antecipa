import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readMigrationSource } from './r1-5-migration-source.mjs'
import { assertR110OwnedConnection } from './r1-10-stack-guard.mjs'

export const documentFixtureSources = [
  'supabase/migrations/20260721132903_fase3_repositorio_documental_nf.sql',
  'supabase/migrations/20260722193500_corrigir_catalogo_documental_requisitos_nf.sql',
  'supabase/migrations/20260819220000_fase1_boleto_por_parcela.sql',
]
const ids = { nf_xml: 'f1200000-0000-4000-8000-000000000001', nf_danfe_pdf: 'f1200000-0000-4000-8000-000000000002' }
const columns = 'codigo,nome,dominio,mime_types_aceitos,extensoes_aceitas,tamanho_max_bytes,permite_multiplas_versoes,ativo'
export const FixtureMode = Object.freeze({minimal:'SCHEMA_ONLY_MINIMAL',canonical:'CANONICAL_EXISTING_CATALOG'})

export function validateCatalogRow(rows, expected) {
  assert.equal(rows.length,1,`CATALOG_CODE_CARDINALITY:${expected.codigo}`)
  const {id,...attributes}=rows[0]
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'INVALID_CATALOG_UUID')
  assert.deepEqual(attributes,expected,`CATALOG_ATTRIBUTE_DRIFT:${expected.codigo}`)
  return rows[0]
}

export async function officialDocumentContract(db) {
  const manifest=JSON.parse(await readFile('rehearsal/reports/R1_5_MANIFESTS.json','utf8')).CLEAN_ROOM_CANONICAL
  const sources=[]
  for(const path of documentFixtureSources){
    const entry=manifest.entries.find(e=>e.path===path)
    assert(entry&&entry.source_kind==='GIT_BLOB','CATALOG_SOURCE_NOT_CANONICAL')
    sources.push(await readMigrationSource(entry))
  }
  assert.match(sources[2].sql,/ADD COLUMN cardinalidade text NOT NULL DEFAULT 'por_nf'/)
  const tuples={},expected={}
  for(const code of Object.keys(ids)){
    const matches=sources[1].sql.split(/\r?\n/).filter(line=>line.trim().startsWith(`('${code}',`))
    assert.equal(matches.length,1,'OFFICIAL_CATALOG_TUPLE_NOT_UNIQUE')
    const tuple=matches[0].trim().replace(/,$/,'')
    assert.match(tuple,/^\('[a-z_]+',.*20971520, true, true\)$/)
    tuples[code]=tuple
    expected[code]=(await db.query(`select v.*,'por_nf'::text cardinalidade from (values ${tuple}) as v(${columns})`)).rows[0]
    expected[code].tamanho_max_bytes=String(expected[code].tamanho_max_bytes)
  }
  return {tuples,expected,sources:sources.map(s=>s.evidence)}
}

// Extract only the two reviewed official VALUES tuples, not the historical DDL,
// backfill, whole catalogue, or any remotely sourced business row.
export async function seedDocumentFixture(db, mode) {
  assert.equal(db.connectionParameters.host, '127.0.0.1')
  if(db.connectionParameters.application_name?.startsWith('r110_'))await assertR110OwnedConnection(db.connectionParameters)
  else assert([57842,57942].includes(db.connectionParameters.port),'LOCAL_REHEARSAL_PORT_REQUIRED')
  assert(Object.values(FixtureMode).includes(mode),'EXPLICIT_FIXTURE_MODE_REQUIRED')
  const contract=await officialDocumentContract(db)
  const duplicates=(await db.query('select codigo from public.documento_tipos group by codigo having count(*) > 1')).rows
  assert.deepEqual(duplicates,[],'CATALOG_DUPLICATE_CODE')
  const rows = []
  for (const [code,id] of Object.entries(ids)) {
    let found=(await db.query(`select id,${columns},cardinalidade from public.documento_tipos where codigo=$1`,[code])).rows
    if(mode===FixtureMode.minimal&&found.length===0){
      await db.query(`insert into public.documento_tipos(id,${columns},cardinalidade)
        select $1::uuid,v.*,'por_nf' from (values ${contract.tuples[code]}) as v(${columns}) on conflict(codigo) do nothing`,[id])
      found=(await db.query(`select id,${columns},cardinalidade from public.documento_tipos where codigo=$1`,[code])).rows
    }
    const actual=validateCatalogRow(found,contract.expected[code])
    rows.push(actual)
  }
  const count=(await db.query('select count(*)::int n from public.documento_tipos')).rows[0].n
  if(mode===FixtureMode.minimal)assert.equal(count,2,'FIXTURE_NOT_MINIMAL')
  return {mode,rows,byCode:Object.fromEntries(rows.map(r=>[r.codigo,r.id])),catalogCount:count,sources:contract.sources}
}
