import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { hash,readRawRestore } from './r1-4-restorer.mjs'

export const readSnapshotRaw=readRawRestore
export function gitBytes(args,cwd=process.cwd()){
  return execFileSync('git',args,{cwd,windowsHide:true,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']})
}
export function lineEndings(bytes){
  const text=bytes.toString('utf8'),crlf=(text.match(/\r\n/g)||[]).length
  const lf=(text.match(/\n/g)||[]).length-crlf,cr=(text.match(/\r/g)||[]).length-crlf
  return {crlf,lf,cr,kind:cr?'BARE_CR':crlf?(lf?'MIXED':'CRLF'):'LF'}
}
function exactUtf8(bytes){
  const sql=bytes.toString('utf8')
  assert(Buffer.from(sql,'utf8').equals(bytes),'UTF8_MATERIALIZATION_CHANGED_BYTES')
  return sql
}
export async function readHistoricalMigrationCanonical(entry,cwd=process.cwd()){
  assert.equal(entry.source_kind,'GIT_BLOB')
  assert.match(entry.source_commit,/^[a-f0-9]{40}$/)
  assert.match(entry.blob_oid,/^[a-f0-9]{40}$/)
  assert.match(entry.path,/^supabase\/migrations\/[0-9]+_[\w.-]+\.sql$/)
  const actualOid=gitBytes(['rev-parse',`${entry.source_commit}:${entry.path}`],cwd).toString().trim()
  assert.equal(actualOid,entry.blob_oid,'SOURCE_TREE_BLOB_MISMATCH')
  const bytes=gitBytes(['cat-file','blob',entry.blob_oid],cwd)
  const checkout=await readFile(resolve(cwd,entry.path))
  const executed=hash(bytes)
  assert.equal(executed,entry.sha256,'MANIFEST_CANONICAL_HASH_MISMATCH')
  const sql=exactUtf8(bytes)
  const evidence={version:entry.version,path:entry.path,source_kind:entry.source_kind,
    source_commit:entry.source_commit,source_ref:entry.source_ref,blob_oid:entry.blob_oid,
    git_blob_sha256:executed,checkout_raw_sha256:hash(checkout),canonical_executed_sha256:hash(Buffer.from(sql)),
    checkout_line_endings:lineEndings(checkout),canonical_line_endings:lineEndings(bytes),
    expected_manifest_sha256:entry.sha256,canonical_matches_manifest:true,
    checkout_differs_from_blob:!checkout.equals(bytes),
    // Diagnostic only: this transformed text is never returned or executed.
    checkout_lf_diagnostic_matches_blob:hash(checkout.toString('utf8').replaceAll('\r\n','\n'))===executed}
  return {sql,evidence}
}
export async function readNewForwardMigrationExact(entry){
  assert.equal(entry.source_kind,'NEW_FORWARD_EXACT_LF')
  assert(['20261006201914','20261006210815'].includes(entry.version),'UNREVIEWED_NEW_FORWARD')
  const bytes=await readFile(entry.path)
  assert.equal(lineEndings(bytes).kind,'LF','NEW_FORWARD_MUST_BE_LF')
  assert.equal(hash(bytes),entry.sha256,'MANIFEST_FORWARD_HASH_MISMATCH')
  const sql=exactUtf8(bytes)
  return {sql,evidence:{version:entry.version,path:entry.path,source_kind:entry.source_kind,
    source_commit:null,blob_oid:null,git_blob_sha256:null,checkout_raw_sha256:hash(bytes),
    canonical_executed_sha256:hash(Buffer.from(sql)),expected_manifest_sha256:entry.sha256,
    canonical_matches_manifest:true,canonical_line_endings:lineEndings(bytes)}}
}
export async function readMigrationSource(entry,cwd){
  if(entry.source_kind==='GIT_BLOB')return readHistoricalMigrationCanonical(entry,cwd)
  if(entry.source_kind==='NEW_FORWARD_EXACT_LF')return readNewForwardMigrationExact(entry)
  if(entry.source_kind==='APPROVED_DB_ONLY_EXACT'){
    assert.equal(entry.version,'20261005173648','UNAPPROVED_DB_ONLY_VERSION')
    assert.equal(entry.path,'supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql')
    assert.equal(entry.sha256,'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
    const bytes=await readFile(entry.path)
    assert.equal(hash(bytes),entry.sha256,'DB_ONLY_ARTIFACT_DRIFT')
    return {sql:exactUtf8(bytes),evidence:{version:entry.version,path:entry.path,source_kind:entry.source_kind,
      authorization:entry.authorization,source_commit:null,blob_oid:null,git_blob_sha256:null,
      checkout_raw_sha256:hash(bytes),canonical_executed_sha256:hash(bytes),expected_manifest_sha256:entry.sha256,
      canonical_matches_manifest:true,canonical_line_endings:lineEndings(bytes)}}
  }
  throw new Error(`UNAPPROVED_MIGRATION_SOURCE:${entry.version}`)
}
