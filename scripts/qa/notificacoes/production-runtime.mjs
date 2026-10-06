// R4 explicit production target. Credentials exist in process memory only.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import pg from 'pg'
export const productionRef='wwsndnuvnjuabpbjwlck'
export const productionBase='https://bw-antecipa.better-with.tech'
export const certified='c93f88196614c41299b03175851cc2be3feda030'
export const out='rehearsal/reports/NOTIFICACOES_R4'
export const ident=v=>'"'+v.replaceAll('"','""')+'"'
export function command(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:20*1024*1024});assert.equal(r.status,0,'COMMAND_FAILED_NO_RAW_OUTPUT');return r.stdout.trim()}
export function assertSource(){assert.equal(command('git',['diff',certified,'--','src','supabase/migrations','package.json','package-lock.json','next.config.ts']),'','UNCERTIFIED_FUNCTIONAL_DELTA')}
export async function connectProduction(){
  const linked=resolve('../bw_antecipa_guibor_prod_02')
  assert.equal(readFileSync(resolve(linked,'supabase/.temp/project-ref'),'utf8').trim(),productionRef)
  // CLI dry-run obtains its existing database connection; never execute the emitted shell.
  const script=command(process.execPath,['node_modules/supabase/dist/supabase.js','db','dump','--linked','--workdir',linked,'--schema','public,private','--dry-run'])
  const vars=Object.fromEntries([...script.matchAll(/^export (PG[A-Z_]+)="([^"\r\n]+)"\r?$/gm)].map(m=>[m[1],m[2]]))
  for(const name of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'])assert(vars[name]&&!/[\\`$]/.test(vars[name]),'UNSUPPORTED_CONNECTION_ENVELOPE')
  assert(vars.PGHOST===`db.${productionRef}.supabase.co`||vars.PGUSER.endsWith('.'+productionRef),'WRONG_PRODUCTION_TARGET')
  const db=new pg.Client({host:vars.PGHOST,port:Number(vars.PGPORT),user:vars.PGUSER,password:vars.PGPASSWORD,database:vars.PGDATABASE,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:20000})
  await db.connect()
  try{
    // The CLI temporary login is already a member of its pg_dump --role postgres.
    assert.equal((await db.query("SELECT pg_has_role(current_user,'postgres','MEMBER') AS allowed")).rows[0].allowed,true,'CLI_ADMIN_ROLE_NOT_GRANTED')
    await db.query("SET ROLE postgres; SET statement_timeout='60s'; SET lock_timeout='5s'; SET search_path=''")
    assert.equal(Number((await db.query("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260929193129'")).rows[0].count),0,'ORIGINAL_A6_PRESENT')
    return db
  }catch(e){await db.end();throw new Error('PRODUCTION_CONNECTION_GATE_FAILED:'+e.code)}
}
export function productionKeys(){
  const keys=JSON.parse(command(process.execPath,['node_modules/supabase/dist/supabase.js','projects','api-keys','--project-ref',productionRef,'-o','json']))
  const result={SUPABASE_URL:`https://${productionRef}.supabase.co`,SUPABASE_ANON_KEY:keys.find(k=>k.name==='anon')?.api_key,SUPABASE_SERVICE_ROLE_KEY:keys.find(k=>k.name==='service_role')?.api_key}
  for(const name of ['SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])assert.equal(JSON.parse(Buffer.from(result[name].split('.')[1],'base64url')).ref,productionRef,'WRONG_KEY_TARGET')
  return result
}
export async function fingerprints(db,{legacyNotifications=false}={}){
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private') UNION ALL SELECT 'storage','objects' ORDER BY 1,2")).rows
  const query=tables.map(t=>{
    const expr=legacyNotifications&&t.tablename==='notificacoes'?"to_jsonb(t)-ARRAY['fundo_id','cedente_fundo_id','cedente_id','scope_type']":'to_jsonb(t)'
    return `SELECT '${t.schemaname}.${t.tablename}' AS name,count(*)::int AS count,md5(coalesce(string_agg((${expr})::text,'' ORDER BY (${expr})::text),'')) AS hash FROM ${ident(t.schemaname)}.${ident(t.tablename)} t`
  }).join(' UNION ALL ')
  return (await db.query(query)).rows.sort((a,b)=>a.name.localeCompare(b.name))
}
