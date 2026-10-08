// Pure, reproducible composition of a NEW migration; historical bytes are never edited.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gitBytes} from './r1-5-migration-source.mjs'
import {hash} from './r1-4-restorer.mjs'
export const migrationPath='supabase/migrations/20261008183349_r2_2_sacado_explicit_mapping_bootstrap.sql'
export const oldPath='supabase/migrations/20261005154435_sacado_multi_cnpj_acessos.sql'
export const oldHash='a1ed6af47e99fa4cc1c9a4edd7ac35666fe8d5416e4252283fa337d6c08c0128'
export const mapping=JSON.parse(await readFile('scripts/qa/reconciliation/ci/r2-2-sacado-mapping.json','utf8'))
export async function render(){
 const old=gitBytes(['show','2e8146ebe7582c5bdc10ddee1f8862d806607ee2:'+oldPath]).toString('utf8')
 assert.equal(hash(old),oldHash)
 const start=old.indexOf('-- Backfill evidence'),end=old.indexOf('-- Private definer lookup')
 assert(start>0&&end>start)
 const replacement=await readFile('scripts/qa/reconciliation/ci/r2-2-mapping-backfill.sql','utf8')
 assert.equal(replacement.includes('\r'),false)
 assert(replacement.includes('__APPROVED_MAPPING__'))
 return '-- R2.2: explicitly approved HOMOLOG QA legacy mapping. Not for automatic replay.\n'+
  '-- Original 20261005154435 is preserved, superseded ONLY in the explicit homolog plan.\n'+
  '-- New version records its own execution; never fake-mark the original.\n'+
  old.slice(0,start)+replacement.replace('__APPROVED_MAPPING__',JSON.stringify(mapping.actors))+'\n'+old.slice(end)
}
