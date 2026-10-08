import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertLocalSource,databaseName,assertOwnedDatabase,assertFaithful } from './r1-9-db-prep.mjs'
const local={host:'127.0.0.1',port:57942,database:'postgres',user:'postgres'}
test('owned loopback source accepted',()=>assertLocalSource(local,'bw_email03_r19clean_123'))
for(const [label,patch,project] of [
  ['remote',{host:'db.example.supabase.co'},'bw_email03_r19clean_123'],
  ['wrong port',{port:5432},'bw_email03_r19clean_123'],
  ['wrong database',{database:'production'},'bw_email03_r19clean_123'],
  ['admin test user',{user:'supabase_admin'},'bw_email03_r19clean_123'],
  ['old resource',{},'bw_email03_r1full_cleanroom_179137940498'],
])test(`fail closed: ${label}`,()=>assert.throws(()=>assertLocalSource({...local,...patch},project)))
test('unique names and cleanup ownership are mandatory',()=>{
  const a=databaseName('probe'),b=databaseName('probe'),owned=new Set([a])
  assert.notEqual(a,b);assertOwnedDatabase(a,owned)
  assert.throws(()=>assertOwnedDatabase(b,owned));assert.throws(()=>assertOwnedDatabase('postgres',new Set(['postgres'])))
  assert.throws(()=>databaseName('production'))
})
test('fidelity fails on missing, changed or extra objects',()=>{
  const source=[{kind:'function',name:'public.qa()',hash:'original'}]
  assertFaithful(source,structuredClone(source))
  for(const actual of [[],[{...source[0],hash:'changed'}],[...source,{kind:'table',name:'extra'}]])assert.throws(()=>assertFaithful(source,actual))
})
test('provisioning has no service termination, force drop, source template or connection ban',async()=>{
  for(const name of ['r1-8-extra-sql.mjs','r1-9-extra-sql.mjs','r1-9-db-prep.mjs']){
    const source=await readFile('scripts/qa/reconciliation/'+name,'utf8')
    assert.doesNotMatch(source,/pg_terminate_backend|ALLOW_CONNECTIONS|TEMPLATE postgres|WITH\s*\(FORCE\)|ALTER ROLE.*SUPERUSER/i)
  }
})
test('telemetry enters preparation before provisioning',async()=>{
  const source=await readFile('scripts/qa/reconciliation/r1-9-extra-sql.mjs','utf8')
  assert(source.indexOf("evidence.stage='PREPARE_EXTRA_SQL_DATABASES:DUMP_SOURCE'")<source.indexOf('await localDatabaseFactory'))
})
