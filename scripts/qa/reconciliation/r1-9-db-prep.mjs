import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile,writeFile } from 'node:fs/promises'
import { Client } from 'pg'
import { docker } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'

export function assertLocalSource(connection,projectId) {
  assert.match(projectId,/^bw_email03_r19(?:clean|prod|homolog)_\d+$/)
  assert.equal(connection.host,'127.0.0.1');assert.equal(connection.port,57942)
  assert.equal(connection.database,'postgres');assert.equal(connection.user,'postgres')
}
export function databaseName(suite) {
  assert(['probe','integrations','operators','automation'].includes(suite))
  return `r19_${suite}_${Date.now()}_${randomUUID().slice(0,8)}`
}
export function assertOwnedDatabase(name,owned) {
  assert.match(name,/^r19_(?:probe|integrations|operators|automation)_\d+_[0-9a-f]{8}$/)
  assert(owned.has(name),'REFUSE_UNOWNED_DATABASE')
}
export function assertFaithful(source,target) {
  assert.deepEqual(target,source,'DUMP_RESTORE_APPLICATION_CATALOG_NOT_FAITHFUL')
}
function command(container,args,input) {
  return new Promise((done,reject)=>{
    const child=spawn('docker',['exec','-i',container,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    const chunks=[];let stderr=''
    child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>{stderr+=b})
    child.on('error',reject);child.stdin.on('error',()=>{})
    child.on('exit',code=>code===0?done(Buffer.concat(chunks)):reject(new Error(`LOCAL_INFRA_COMMAND_FAILED:${args[0]}:${code}:${stderr.slice(-2400)}`)))
    child.stdin.end(input)
  })
}

export async function localDatabaseFactory(source,connection,projectId,evidence) {
  assertLocalSource(connection,projectId)
  const container=`supabase_db_${projectId}`
  assert.equal(await docker(['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}',container]),projectId)
  assert.match(await docker(['port',container,'5432/tcp']),/:57942(?:\r?\n|$)/)
  const resource=JSON.parse(await readFile(`rehearsal/reports/${projectId}-resources.json`,'utf8'))
  assert(!resource.before.containers.includes(container));assert(resource.resources.containers.includes(container))
  const catalogSql=await readFile('scripts/qa/health/schema-catalog.sql','utf8')
  const catalog=async db=>{
    await db.query("SET search_path=''")
    const result=(await db.query(catalogSql)).rows[0].objects
    await db.query('SET search_path=public,extensions');return result
  }
  const original=await catalog(source)
  const sourcePid=(await source.query('SELECT pg_backend_pid() pid')).rows[0].pid
  const watcher=new Client({...connection,application_name:'r19_simulated_service'})
  await watcher.connect();await watcher.query('SET ROLE service_role')
  const watcherPid=(await watcher.query('SELECT pg_backend_pid() pid')).rows[0].pid
  const owned=new Set(),manifest={projectId,method:'DUMP_RESTORE',LOCAL_INFRA_ADMIN_ONLY:'YES',sourcePid,watcherPid,sourceCatalogHash:hash(JSON.stringify(original)),databases:[],sourcePreserved:false}
  const manifestPath=`rehearsal/reports/${projectId}-databases.json`
  const persist=()=>writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n')
  const infra=(database,sql)=>command(container,['psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-q'],sql)
  await persist()
  let schemaDump,catalogDump
  try {
    // No platform data, migration history, credentials, jobs, connections or runtime queues.
    // auth/storage definitions are required dependencies; their live rows are not copied.
    schemaDump=await command(container,['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-publications','--no-subscriptions',
      ...['public','private','auth','storage','extensions'].flatMap(n=>['--schema',n]),
      ...['pgcrypto','uuid-ossp','unaccent','pgtap'].flatMap(n=>['--extension',n])])
    catalogDump=await command(container,['pg_dump','-U','supabase_admin','-d','postgres','--data-only','--table=public.documento_tipos','--column-inserts'])
    manifest.schemaDumpHash=hash(schemaDump);manifest.catalogDataHash=hash(catalogDump)
    manifest.copyScope={application:['public','private'],platformDefinitionsOnly:['auth','storage','extensions'],dataAllowlist:['public.documento_tipos'],excludedRuntime:['cron','net','realtime','supabase_migrations','auth data','storage objects','credentials','jobs']}
    await persist()
  } catch(e){await watcher.end();throw e}
  const checkSource=async()=>{
    assert.equal((await source.query('SELECT pg_backend_pid() pid')).rows[0].pid,sourcePid)
    assert.equal((await watcher.query('SELECT pg_backend_pid() pid')).rows[0].pid,watcherPid)
    assertFaithful(original,await catalog(source));return true
  }
  return {manifest,
    async create(suite) {
      const name=databaseName(suite)
      assert.equal((await source.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[name])).rows[0].n,0)
      const record={name,suite,method:'DUMP_RESTORE',source:'postgres',sourceCatalogHash:manifest.sourceCatalogHash,schemaDumpHash:manifest.schemaDumpHash,result:'IN_PROGRESS',cleanup:'NOT_RUN'}
      manifest.databases.push(record);await persist()
      await infra('template1',`CREATE DATABASE "${name}" WITH TEMPLATE template0 OWNER postgres;`)
      owned.add(name);await persist()
      let db
      try {
        // Only the empty public schema in this newly-created owned DB is removed.
        await infra(name,'DROP SCHEMA public;')
        await infra(name,schemaDump)
        await infra(name,catalogDump)
        db=new Client({...connection,database:name,application_name:'r19_local_sql'});await db.connect()
        const actual=await catalog(db)
        record.targetCatalogHash=hash(JSON.stringify(actual))
        record.catalogDifferences=original.filter(o=>actual.find(n=>n.kind===o.kind&&n.name===o.name)?.hash!==o.hash)
        assertFaithful(original,actual)
        for(const table of ['auth.users','auth.sessions','public.notas_fiscais','public.credenciais_integracao','private.email_integrations','storage.objects'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,`RUNTIME_DATA_COPIED:${table}`)
        assert.deepEqual((await db.query('SELECT * FROM public.documento_tipos ORDER BY codigo')).rows,(await source.query('SELECT * FROM public.documento_tipos ORDER BY codigo')).rows)
        assert.equal((await db.query("SELECT current_user name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0].super,false,'APPLICATION_TESTS_MUST_NOT_USE_SUPERUSER')
        await db.query("SET search_path=public,extensions;SET statement_timeout='120s';SET lock_timeout='5s'")
        record.result='PASS';record.sourceConnectionStillOpen=await checkSource();await persist()
        return {name,db,record,connection:{...connection,database:name,application_name:'r19_local_sql'}}
      }catch(e){record.result='FAIL';record.error=e.message;await db?.end();await persist();throw e}
    },
    async remove(name) {
      assertOwnedDatabase(name,owned)
      // Application clients must already be closed. No FORCE or session termination.
      assert.equal((await source.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n,0,'OWNED_DATABASE_CONNECTIONS_STILL_OPEN')
      await infra('template1',`DROP DATABASE "${name}";`);owned.delete(name)
      manifest.databases.find(r=>r.name===name).cleanup='PASS';await persist()
      await checkSource()
    },
    async finish() {
      try {
        assert.equal(owned.size,0,'OWNED_DATABASES_REMAIN')
        manifest.sourcePreserved=await checkSource();manifest.result='PASS';await persist()
        evidence.dbPreparation=manifest
      } finally {await watcher.end()}
    },
    async abort() {
      try {for(const name of [...owned])await this.remove(name)}
      finally {await watcher.end();evidence.dbPreparation=manifest;await persist()}
    },
  }
}
