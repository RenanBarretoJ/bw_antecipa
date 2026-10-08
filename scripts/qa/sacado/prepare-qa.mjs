// Explicitly authorized QA setup, pinned to the empty SACADO Preview. Never production.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { details, connect, ref, saveCredentials, migration } from './preview-runtime.mjs'

assert.deepEqual(process.argv.slice(2),['--prepare'])
migration()
const d=details(), db=await connect(d)
const admin=createClient(d.SUPABASE_URL,d.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const state={ref,actors:{},ids:{},seeded:false}
try {
  const counts=(await db.query('select (select count(*) from auth.users)::int users,(select count(*) from public.notas_fiscais)::int nfs,(select count(*) from supabase_migrations.schema_migrations)::int history')).rows[0]
  assert.deepEqual(counts,{users:0,nfs:0,history:0},'EMPTY_PREVIEW_REQUIRED')
  const roles=[['consultor','consultor','21000000-0000-4000-8000-000000000001'],['leitor','consultor','21000000-0000-4000-8000-000000000002'],['cedente','cedente','21000000-0000-4000-8000-000000000003'],['gestor','gestor','21000000-0000-4000-8000-000000000004'],['sacadoA','sacado','31000000-0000-4000-8000-000000000001'],['sacadoB','sacado','31000000-0000-4000-8000-000000000002']]
  for(const [name,role,oldId] of roles) {
    const email=`qa-sacado-r2-${name.toLowerCase()}@example.invalid`,password=`Sacado!A1${randomBytes(24).toString('base64url')}`
    const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:`QA SACADO ${name}`}})
    assert(!r.error && r.data.user,'QA_AUTH_CREATE_FAILED')
    state.actors[name]={id:r.data.user.id,email,password,role}
    state.ids[oldId]=r.data.user.id
    saveCredentials(state)
  }
  let setup=readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8').replace(/  INSERT INTO auth.users[\s\S]*?(?=  INSERT INTO public.profiles)/,'')
  setup+='\n'+readFileSync('supabase/tests/fixtures/sacado_multi.sql','utf8').replace(/INSERT INTO auth.users[\s\S]*?(?=UPDATE public.profiles)/,'')
  for(const uuid of new Set(setup.match(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g))) state.ids[uuid] ||= randomUUID()
  for(const [from,to] of Object.entries(state.ids)) setup=setup.replaceAll(from,to)
  setup=setup.replaceAll('Fundo QA C2.1','HEALTH QA SACADO')
  saveCredentials(state)
  await db.query('BEGIN')
  await db.query(setup)
  for(const [name,a] of Object.entries(state.actors)) await db.query('update public.profiles set nome_completo=$1,email=$2 where id=$3',[`QA SACADO ${name}`,a.email,a.id])
  await db.query('COMMIT')
  state.seeded=true;saveCredentials(state)
  writeFileSync('rehearsal/reports/SACADO_R2_QA_IDS.json',JSON.stringify({ref,ids:state.ids,actors:Object.fromEntries(Object.entries(state.actors).map(([k,v])=>[k,{id:v.id,role:v.role}]))},null,2))
  console.log(JSON.stringify({success:true,ref,qaActors:6,legacyCompanies:1,productionChanged:false}))
} catch(e) {
  await db.query('ROLLBACK').catch(()=>{})
  console.error(JSON.stringify({success:false,code:e.code || 'ASSERTION',message:String(e.message).slice(0,180)}));process.exitCode=1
} finally { await db.end() }
