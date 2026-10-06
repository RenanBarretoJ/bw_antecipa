// Notification Preview only. No production/homolog DB connection is possible.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import pg from 'pg'
export const ref='twmxvhddqbderjzgmcjo'
export const branch='feature/notificacoes-fund-scope'
export const base='https://bw-antecipa-git-feature-notificacoes-fund-scope-renanbarretoj.vercel.app'
export const migrationList=[
  ['20261005213812_notificacoes_fund_scope.sql','6a82c232659985cd9be4e73d80c26f6ec8a431d84c505b18856982008b578010'],
  ['20261006114841_notificacoes_shared_cedente_producers.sql','e8a259a8c5a1df6d14ece3c887ee12b008c8cbcc4a1c510f1634ef7016931748'],
  ['20261006124134_notificacoes_entity_producers.sql','c0fda0f0893b7a8cd51d48a713ffdfd832f46f951a3f2ac8c32bcd5974ddf8f0'],
  ['20261006130657_notificacoes_scoped_ui.sql','6acafc295bfcf998bdae0058cd3f59c0822a4d78ac5ed7928c487893f1e71ea0'],
]
export function migrations(){return migrationList.map(([file,sha256])=>{
  const source=readFileSync('supabase/migrations/'+file,'utf8').replaceAll('\r\n','\n')
  assert.equal(createHash('sha256').update(source).digest('hex'),sha256,'MIGRATION_HASH_MISMATCH')
  return {file,sha256,source,version:file.slice(0,14),name:file.slice(15,-4)}
})}
export function details(){
  assert.equal(spawnSync('git',['branch','--show-current'],{encoding:'utf8',windowsHide:true}).stdout.trim(),branch)
  const config=readFileSync('supabase/config.toml','utf8').replaceAll('\r\n','\n')
  for(const section of ['db.migrations','db.seed'])assert(config.includes(`[remotes."${branch}".${section}]\nenabled = false`))
  const r=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','branches','get','64676d52-3b99-433e-bd90-9d2e2a04f0cb','--project-ref','wwsndnuvnjuabpbjwlck','-o','json'],{encoding:'utf8',windowsHide:true,timeout:30000})
  assert.equal(r.status,0,'PREVIEW_LOOKUP_FAILED')
  const d=JSON.parse(r.stdout)
  assert.equal(new URL(d.SUPABASE_URL).hostname,ref+'.supabase.co')
  const url=new URL(d.POSTGRES_URL)
  assert(url.hostname===`db.${ref}.supabase.co`||decodeURIComponent(url.username).endsWith('.'+ref),'WRONG_DATABASE_TARGET')
  for(const k of ['SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])assert.equal(JSON.parse(Buffer.from(d[k].split('.')[1],'base64url')).ref,ref)
  return d
}
export async function connect(d){
  const db=new pg.Client({connectionString:d.POSTGRES_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:20000})
  await db.connect()
  assert.equal(Number((await db.query("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260929193129'")).rows[0].count),0,'ORIGINAL_A6_PRESENT')
  return db
}
export async function empty(db){
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private') ORDER BY 1,2")).rows
  for(const t of tables){
    const name='"'+t.schemaname.replaceAll('"','""')+'"."'+t.tablename.replaceAll('"','""')+'"'
    assert.equal(Number((await db.query(`SELECT count(*) FROM ${name}`)).rows[0].count),0,'APPLICATION_DATA_PRESENT:'+t.tablename)
  }
  for(const t of ['auth.users','storage.objects'])assert.equal(Number((await db.query(`SELECT count(*) FROM ${t}`)).rows[0].count),0,'QA_DATA_PRESENT')
  return tables.length
}
