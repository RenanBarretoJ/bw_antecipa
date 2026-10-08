// Local-only final query plans and effective producer catalog; QA is rolled back.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
assert.equal(process.argv.length, 2)
const label = spawnSync('docker', ['inspect', 'supabase_db_notificacoes-r1-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(label.stdout.trim(), 'notificacoes-r1-20261005')
const db = new pg.Client({ host:'127.0.0.1', port:59422, user:'postgres', password:'postgres', database:'postgres' })
const user='21000000-0000-4000-8000-000000000004', fund='22000000-0000-4000-8000-000000000001'
await db.connect()
try {
  const catalog = (await db.query("SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' ORDER BY p.oid")).rows
  const producers=catalog.filter(r=>/notifica(?:r|co)/i.test(r.def)).map(r=>({
    signature:r.signature,
    directInserts:[...r.def.matchAll(/insert\s+into\s+(?:public\.)?notificacoes\s*\(/gi)].length,
    globalGestorBroadcasts:[...r.def.matchAll(/FROM\s+public\.profiles\s+\w+\s+WHERE\s+\w+\.role\s*=\s*'gestor'/gi)].length,
  }))
  assert.equal(producers.reduce((n,p)=>n+p.globalGestorBroadcasts,0),0)
  const writers=producers.filter(p=>p.directInserts)
  assert.equal(writers.length,2)
  assert(writers.every(p=>/criar_notificacao_fundo|notificar_seguranca_global/.test(p.signature)))
  await db.query('BEGIN')
  await db.query(readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
  await db.query(`INSERT INTO public.notificacoes(usuario_id,fundo_id,scope_type,titulo,mensagem,tipo,lida,created_at)
    SELECT $1,$2,'FUNDO','QA perf','Synthetic','operacao_aprovada',g%3=0,now()-g*interval '1 second' FROM generate_series(1,20000) g`,[user,fund])
  await db.query('ANALYZE public.notificacoes')
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated',aal:'aal2'})])
  await db.query('SET LOCAL ROLE authenticated')
  const where="usuario_id=$1 AND fundo_id=$2 AND scope_type='FUNDO'"
  const queries={
    badge:`SELECT count(*) AS total,count(*) FILTER(WHERE NOT lida) AS nao_lidas FROM public.notificacoes WHERE ${where}`,
    list:`SELECT id,created_at FROM public.notificacoes WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 20`,
    pagination:`SELECT id,created_at FROM public.notificacoes WHERE ${where} AND (created_at,id)<(now()-interval '1 hour','ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid) ORDER BY created_at DESC,id DESC LIMIT 20`,
    markAll:`UPDATE public.notificacoes SET lida=true WHERE ${where} AND NOT lida`,
  }
  const plans={}
  for(const [name,sql] of Object.entries(queries)) plans[name]=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,[user,fund])).rows[0]['QUERY PLAN'][0]
  for(const key of ['list','pagination']) assert(/Index (Only )?Scan/.test(JSON.stringify(plans[key])),key+' must use scoped index')
  const report={success:true,target:'127.0.0.1:59422',rows:20000,plans,producers,rawWriters:writers.map(p=>p.signature),globalBroadcasts:0,productionQueried:false,homologQueried:false}
  writeFileSync('rehearsal/reports/NOTIFICACOES_PERFORMANCE_LOCAL.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({success:true,plans:Object.fromEntries(Object.entries(plans).map(([k,v])=>[k,v['Execution Time']])),rawWriters:report.rawWriters,globalBroadcasts:0}))
} finally { await db.query('ROLLBACK'); await db.end() }
