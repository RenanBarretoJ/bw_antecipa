import assert from 'node:assert/strict'
import { createHash,X509Certificate } from 'node:crypto'
import { existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { manifest,previewDetails,assertPreviewDetails,repository } from './preview-runtime.mjs'

const apply=process.argv.includes('--apply'),version='20261020212422',name='vortx_operational_reports'
const path=`supabase/migrations/${version}_${name}.sql`
const read=path=>readFileSync(resolve(repository,path),'utf8').replace(/\r\n/g,'\n')
const sha=value=>createHash('sha256').update(value).digest('hex')
const sql=read(path),base=resolve(process.env.LOCALAPPDATA,'bw-antecipa-evidence/vortx-callback-20261019')
const certified=readdirSync(base).filter(p=>p.startsWith('sql-')).sort().reverse()
  .map(p=>resolve(base,p,'REPORT.json')).filter(existsSync).map(path=>({path,report:JSON.parse(readFileSync(path,'utf8'))}))
  .find(({report:r})=>!r.error&&r.DOCKER_TEST_ENV_CLEANUP&&r.stacks.length===2
    &&r.stacks.every(s=>s.cleanup&&s.checks.includes('own_fund_gestor_requests_without_sensitive_totp_nonce_and_preserves_all_nonces')
      &&s.checks.includes('machine_has_real_cron_origin_no_fake_user_no_cross_channel_transition_or_duplicate'))
    &&r.migrations.some(m=>m.path===path&&m.sha256===sha(sql)))
assert(certified,'EXACT_OPERATIONAL_MIGRATION_TWO_STACK_REHEARSAL_REQUIRED')
const output=resolve(process.env.LOCALAPPDATA,'bw-antecipa-evidence/vortx-operational-preview-20261021',`${apply?'apply':'preflight'}-${Date.now()}`)
mkdirSync(output,{recursive:true})
const report={scope:'PREVIEW_ONLY_OPERATIONAL_REPORTS',project:manifest.projectRef,apply,rehearsal:certified.path,
  migration:{version,name,path,sha256:sha(sql)},applied:false,preservedBusinessData:false,preservedOtherFunctions:false,
  preservedOtherPolicies:false,stage:'TARGET',error:null}
let db
try{
  const details=assertPreviewDetails(previewDetails());assert.equal(manifest.projectRef,'phdckowbexkkvuwnzeaf')
  report.stage='TLS_CERTIFICATE'
  const response=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{redirect:'error',signal:AbortSignal.timeout(15000)})
  assert(response.ok);const ca=await response.text(),cert=new X509Certificate(ca)
  assert(cert.ca&&cert.verify(cert.publicKey)&&Date.parse(cert.validTo)>Date.now())
  assert.equal(cert.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection=new URL(details.POSTGRES_URL)
  for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])connection.searchParams.delete(key)
  db=new pg.Client({connectionString:connection.toString(),ssl:{ca,rejectUnauthorized:true,servername:connection.hostname},connectionTimeoutMillis:20000})
  await db.connect();await db.query("set default_transaction_read_only=on;set statement_timeout='45s';set lock_timeout='3s'")
  report.stage='MIGRATION_HISTORY'
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)',[[manifest.originalA6Version,version]])).rows[0].n,0)
  for(const predecessor of ['20261019180624','20261020192527','20261020204704'])assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[predecessor])).rows[0].n,1)
  const changed=[
    ['private.vortx_relatorio_reservar_revisao','uuid,uuid,text,date,date,date,integer,text,text,uuid','20261020204704_vortx_report_request_revisions'],
    ['private.vortx_relatorio_transicionar','uuid,text,text,uuid,integer','20261019180624_vortx_report_requests_preview'],
    ['public.admin_listar_relatorios_vortx','uuid,integer','20261020204704_vortx_report_request_revisions'],
  ]
  const changedOids=[]
  for(const [fn,signature,source]of changed){
    report.stage=`BASELINE:${fn}`
    const original=read(`supabase/migrations/${source}.sql`),start=original.indexOf(`FUNCTION ${fn}(`)
    assert(start>=0);const expected=original.slice(start).split('AS $$')[1].split('$$;')[0]
    const actual=(await db.query('select oid,prosrc from pg_proc where oid=$1::regprocedure',[`${fn}(${signature})`])).rows[0]
    assert.equal(actual.prosrc,expected,'OPERATIONAL_FUNCTION_PRECONDITION_FAILED');changedOids.push(actual.oid)
  }
  const tables=['public.fundos','public.integracoes_fundo','public.integracao_fundo_versoes','public.usuario_fundos','public.profiles',
    'public.vortx_relatorio_solicitacoes','public.vortx_relatorio_eventos','public.importacoes_financeiras','public.estoque_posicoes',
    'public.vortx_posicao_ativos','public.vortx_posicao_parcelas','private.vortx_estoque_processamentos']
  const fingerprint=async()=>{
    const result={}
    for(const table of tables){
      const value=table==='public.vortx_relatorio_solicitacoes'?"to_jsonb(t)-'origem'-'data_operacional'":table==='private.vortx_estoque_processamentos'?"to_jsonb(t)-'download_concluido_em'":'to_jsonb(t)'
      result[table]=(await db.query(`select count(*)::int n,md5(coalesce(string_agg((${value})::text,'|' order by id),'')) digest from ${table} t`)).rows[0]
    }
    return result
  }
  const allFunctions=await db.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace) and not(oid=any($1::oid[])) order by oid",[changedOids])
  const functions=async()=>(await db.query('select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where oid=any($1::oid[]) order by oid',[allFunctions.rows.map(f=>f.oid)])).rows
  const policies=async()=>(await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname")).rows
  const rls=async()=>(await db.query("select oid,relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[]) order by oid",[tables])).rows
  const target=p=>p.schemaname==='public'&&p.tablename==='vortx_relatorio_solicitacoes'&&p.policyname==='vortx_relatorio_leitura_administrativa'
  report.stage='BUSINESS_FINGERPRINT'
  report.before=await fingerprint();const beforeFunctions=await functions(),beforePolicies=await policies(),beforeRls=await rls()
  assert.equal(beforePolicies.filter(target).length,1)
  report.otherFunctionsSha256=sha(JSON.stringify(beforeFunctions));report.otherPoliciesSha256=sha(JSON.stringify(beforePolicies.filter(p=>!target(p))))
  const assertPreservation=async()=>{
    assert.deepEqual(await fingerprint(),report.before,'BUSINESS_VALUES_CHANGED')
    assert.deepEqual(await functions(),beforeFunctions,'UNRELATED_FUNCTION_OR_ACL_CHANGED')
    assert.deepEqual((await policies()).filter(p=>!target(p)),beforePolicies.filter(p=>!target(p)),'UNRELATED_POLICY_CHANGED')
    assert.deepEqual(await rls(),beforeRls,'RLS_FLAGS_CHANGED')
  }
  if(apply){
    report.stage='TRANSACTION'
    await db.query('set default_transaction_read_only=off');await db.query('begin read write')
    try{
      await db.query('lock table public.vortx_relatorio_solicitacoes in access exclusive mode')
      await db.query('lock table private.vortx_estoque_processamentos in access exclusive mode')
      await assertPreservation()
      const body=sql.replace(/^BEGIN;\s*\n/m,'').replace(/\bCOMMIT;\s*$/,'')
      assert.notEqual(body,sql);assert(!/^BEGIN;|\bCOMMIT;\s*$/m.test(body))
      await db.query(body)
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)',[version,name,[sql]])
      await assertPreservation()
      const policy=(await policies()).find(target),previous=beforePolicies.find(target)
      assert.deepEqual({...policy,qual:previous.qual},previous)
      assert.equal(policy.qual,'private.vortx_relatorio_operador(fundo_id, false)')
      await db.query("notify pgrst,'reload schema';commit");report.applied=true
    }catch(error){await db.query('rollback');throw error}
  }
  await assertPreservation();report.after=await fingerprint()
  report.preservedBusinessData=true;report.preservedOtherFunctions=true;report.preservedOtherPolicies=true
  report.stage='COMPLETE'
}catch(error){report.error={name:error.name,code:error.code??null,assertion:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'PREVIEW_OPERATIONAL_APPLY_FAILED_NO_RAW_DETAILS'};process.exitCode=1}
finally{
  if(db)await db.end()
  writeFileSync(resolve(output,'REPORT.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({output,apply,applied:report.applied,preservedBusinessData:report.preservedBusinessData,preservedOtherFunctions:report.preservedOtherFunctions,preservedOtherPolicies:report.preservedOtherPolicies,stage:report.stage,error:report.error}))
}
