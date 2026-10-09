import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { verifyExtraSql } from './r1-8-extra-sql.mjs'

test('R1.8 A5 changes exactly the two obsolete messages, retaining SQLSTATE and inputs',async()=>{
  const file='supabase/tests/guibor_a5_base.test.sql'
  const before=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n')
  const old='Antecipacao pelo liquido exige valor positivo explicitamente informado no documento'
  const current='Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas'
  assert.equal(before.split(old).length-1,2)
  assert.equal((await readFile(file,'utf8')).replaceAll('\r\n','\n'),before.replaceAll(old,current))
  assert((await readFile('supabase/migrations/20261005204958_nfse_calculated_net_audited_correction.sql','utf8')).includes(`raise exception '${current}'`))
})
for(const [label,connection,project] of [
  ['remote host',{host:'example.invalid',port:57942,database:'postgres'},'bw_email03_r18clean_123'],
  ['wrong port',{host:'127.0.0.1',port:5432,database:'postgres'},'bw_email03_r18clean_123'],
  ['wrong database',{host:'127.0.0.1',port:57942,database:'production'},'bw_email03_r18clean_123'],
  ['unowned project',{host:'127.0.0.1',port:57942,database:'postgres'},'nfse-submit-20261005'],
])test(`extra SQL rejects ${label} before Docker or database access`,async()=>{
  await assert.rejects(verifyExtraSql(null,connection,project,{}),{code:'ERR_ASSERTION'})
})
