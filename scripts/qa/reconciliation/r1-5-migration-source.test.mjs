import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,rm,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve,join } from 'node:path'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes,readSnapshotRaw,readHistoricalMigrationCanonical,readNewForwardMigrationExact,readMigrationSource } from './r1-5-migration-source.mjs'

test('snapshot preserves internal CRLF, UTF8 and raw hash',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bw-r15-snapshot-'))
  try{
    const path=join(dir,'snapshot.sql'),sql="SELECT 'ação';\r\n-- raw\n"
    await writeFile(path,sql)
    assert.equal((await readSnapshotRaw(path,hash(sql))).sql,sql)
    await assert.rejects(readSnapshotRaw(path,hash(sql.replaceAll('\r\n','\n'))))
  }finally{assert(resolve(dir).startsWith(resolve(tmpdir())+'\\bw-r15-')||resolve(dir).startsWith(resolve(tmpdir())+'/bw-r15-'));await rm(dir,{recursive:true})}
})
test('historical bytes always come from pinned blob: CRLF, LF, local edit, bad manifest',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bw-r15-git-'))
  try{
    gitBytes(['init','--quiet'],root)
    const path='supabase/migrations/123_example.sql',sql="SELECT 'histórico';\n"
    await mkdir(join(root,'supabase/migrations'),{recursive:true})
    await writeFile(join(root,path),sql)
    gitBytes(['-c','core.autocrlf=false','add',path],root)
    gitBytes(['-c','user.name=QA','-c','user.email=qa@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic source fixture'],root)
    const commit=gitBytes(['rev-parse','HEAD'],root).toString().trim()
    const blob=gitBytes(['rev-parse',`${commit}:${path}`],root).toString().trim()
    const entry={version:'123',path,source_kind:'GIT_BLOB',source_commit:commit,source_ref:'synthetic-fixture',blob_oid:blob,sha256:hash(sql)}
    await writeFile(join(root,path),sql.replaceAll('\n','\r\n'))
    let actual=await readHistoricalMigrationCanonical(entry,root)
    assert.equal(actual.sql,sql);assert.equal(actual.evidence.checkout_line_endings.kind,'CRLF')
    await writeFile(join(root,path),sql)
    actual=await readHistoricalMigrationCanonical(entry,root)
    assert.equal(actual.evidence.checkout_differs_from_blob,false)
    await writeFile(join(root,path),'SELECT 999;\n')
    actual=await readHistoricalMigrationCanonical(entry,root)
    assert.equal(actual.sql,sql);assert.equal(actual.evidence.checkout_lf_diagnostic_matches_blob,false)
    await assert.rejects(readHistoricalMigrationCanonical({...entry,sha256:'0'.repeat(64)},root),/MANIFEST_CANONICAL_HASH_MISMATCH/)
    await assert.rejects(readHistoricalMigrationCanonical({...entry,blob_oid:'0'.repeat(40)},root),/SOURCE_TREE_BLOB_MISMATCH/)
  }finally{assert(resolve(root).startsWith(resolve(tmpdir())+'\\bw-r15-')||resolve(root).startsWith(resolve(tmpdir())+'/bw-r15-'));await rm(root,{recursive:true})}
})
test('new forward rejects CRLF without silently normalizing; exact LF passes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bw-r15-forward-')),path=join(root,'forward.sql')
  try{
    const entry={version:'20261006210815',path,source_kind:'NEW_FORWARD_EXACT_LF'}
    await writeFile(path,'SELECT 1;\r\n');entry.sha256=hash(await readFile(path))
    await assert.rejects(readNewForwardMigrationExact(entry),/NEW_FORWARD_MUST_BE_LF/)
    await writeFile(path,'SELECT 1;\n');entry.sha256=hash(await readFile(path))
    assert.equal((await readNewForwardMigrationExact(entry)).sql,'SELECT 1;\n')
  }finally{assert(resolve(root).startsWith(resolve(tmpdir())+'\\bw-r15-')||resolve(root).startsWith(resolve(tmpdir())+'/bw-r15-'));await rm(root,{recursive:true})}
})
test('approved DB-only exception is limited to exact SACADO version, path and hash',async()=>{
  const entry={version:'20261005173648',path:'supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql',source_kind:'APPROVED_DB_ONLY_EXACT',sha256:'1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac'}
  const result=await readMigrationSource(entry)
  assert.equal(result.evidence.blob_oid,null)
  assert.equal(hash(result.sql),entry.sha256)
  await assert.rejects(readMigrationSource({...entry,version:'123'}),/UNAPPROVED_DB_ONLY_VERSION/)
  await assert.rejects(readMigrationSource({...entry,sha256:'0'.repeat(64)}))
})
