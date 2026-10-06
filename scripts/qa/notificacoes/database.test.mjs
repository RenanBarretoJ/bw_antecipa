// Local-only integration tests; every scenario is rolled back, including DDL.
// No production/Preview credentials or network targets are accepted.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

// Keep PostgreSQL microseconds, as PostgREST does. JS Date truncates the cursor.
pg.types.setTypeParser(1184, value => value)

const includeProducers = process.argv.length === 3 && process.argv[2] === '--producers'
const includeR2 = includeProducers || (process.argv.length === 3 && process.argv[2] === '--r2')
assert(process.argv.length === 2 || includeR2, 'THIS_TEST_ACCEPTS_NO_TARGET_ARGUMENTS')
const inspect = spawnSync('docker', ['inspect', 'supabase_db_notificacoes-r1-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(inspect.status, 0)
assert.equal(inspect.stdout.trim(), 'notificacoes-r1-20261005')
const db = new pg.Client({ host: '127.0.0.1', port: 59422, user: 'postgres', password: 'postgres', database: 'postgres' })
const migrationFile = 'supabase/migrations/20261005213812_notificacoes_fund_scope.sql'
const migration = readFileSync(migrationFile, 'utf8')
const r2MigrationFile = 'supabase/migrations/20261006114841_notificacoes_shared_cedente_producers.sql'
const r2Migration = includeR2 ? readFileSync(r2MigrationFile, 'utf8') : null
const producersFile = 'supabase/migrations/20261006124134_notificacoes_entity_producers.sql'
const producersMigration = includeProducers ? readFileSync(producersFile, 'utf8') : null
const uiFile = 'supabase/migrations/20261006130657_notificacoes_scoped_ui.sql'
const uiMigration = includeProducers ? readFileSync(uiFile, 'utf8') : null
const fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8')
const A = '22000000-0000-4000-8000-000000000001'
const B = '22000000-0000-4000-8000-000000000002'
const C = '22000000-0000-4000-8000-000000000003'
const CF = '24000000-0000-4000-8000-000000000001'
const CFB = '24000000-0000-4000-8000-000000000002'
const cedente = '23000000-0000-4000-8000-000000000001'
const org = '29000000-0000-4000-8000-000000000001'
const NF = '2a000000-0000-4000-8000-000000000001'
const OP = '2c000000-0000-4000-8000-000000000001'
const entrega = '2d000000-0000-4000-8000-000000000001'
const evento = '2e000000-0000-4000-8000-000000000001'
const users = {
  consultor: '21000000-0000-4000-8000-000000000001',
  leitor: '21000000-0000-4000-8000-000000000002',
  cedente: '21000000-0000-4000-8000-000000000003',
  gestor: '21000000-0000-4000-8000-000000000004',
  sacado: '21000000-0000-4000-8000-000000000005',
  gestorB: '21000000-0000-4000-8000-000000000006',
  delegado: '21000000-0000-4000-8000-000000000007',
  admin: '21000000-0000-4000-8000-000000000008',
}
const checks = []
let scenario
async function test(name, fn) {
  await fn()
  checks.push(`${scenario}:${name}`)
}
async function value(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0] }
async function deny(sql, params = [], code = '42501') {
  await db.query('SAVEPOINT negative_case')
  let caught
  try { await db.query(sql, params) } catch (error) { caught = error }
  await db.query('ROLLBACK TO SAVEPOINT negative_case')
  await db.query('RELEASE SAVEPOINT negative_case')
  assert(caught, 'Expected request to fail')
  assert.equal(caught.code, code, caught.message)
}
async function actor(id) {
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal2' })])
  await db.query('SET LOCAL ROLE authenticated')
}
async function admin() { await db.query('RESET ROLE') }
async function notify(user, fund, key) {
  return value("SELECT private.criar_notificacao_fundo($1,$2,'QA','Evento sintetico','operacao_aprovada',$3)", [user,fund,key])
}
async function setup() {
  await db.query(fixture)
  for (const [fund, cnpj] of [[B,'98000000000439'],[C,'98000000000510']]) {
    await db.query(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      VALUES($1,'QA notificacoes',$2,'QA','98000000000277','QA','98000000000358',true)`, [fund,cnpj])
  }
  for (const [name,role] of [['sacado','sacado'],['gestorB','gestor'],['delegado','cedente'],['admin','gestor']]) {
    const id = users[name]
    await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,'{}')`, [id,`${name}@example.invalid`])
    await db.query(`UPDATE public.profiles SET role=$2,status='ativo' WHERE id=$1`, [id,role])
  }
  await db.query('INSERT INTO public.usuario_fundos(usuario_id,fundo_id) VALUES($1,$2),($3,$2)', [users.gestor,B,users.gestorB])
  await db.query('INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id) VALUES($1,$2,$3)', [CFB,cedente,B])
  await db.query('INSERT INTO public.consultor_fundos(consultor_id,fundo_id,concedido_por) VALUES($1,$2,$3)', [org,B,users.gestor])
  await db.query("INSERT INTO public.sacados(id,cnpj,razao_social) VALUES('2b000000-0000-4000-8000-000000000001','11222333000181','QA Sacado')")
  await db.query(`INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id)
    VALUES($1,'2b000000-0000-4000-8000-000000000001',$2),($1,'2b000000-0000-4000-8000-000000000001',$3)`, [users.sacado,A,B])
  await db.query("INSERT INTO public.usuario_papeis(usuario_id,papel,ativo) VALUES($1,'super_admin',true)", [users.admin])
  await db.query(`INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento)
    VALUES($1,$2,$3,1000,30,current_date+30)`,[OP,cedente,CF])
  await db.query('INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES($1,$2)',[OP,NF])
  await db.query(`INSERT INTO public.nota_fiscal_entregas(id,operacao_id,nota_fiscal_id,status_entrega)
    VALUES($1,$2,$3,'em_transito')`,[entrega,OP,NF])
  await db.query(`INSERT INTO public.eventos_dominio(id,fundo_id,cedente_id,cedente_fundo_id,operacao_id,nota_fiscal_id,tipo_evento,categoria,descricao)
    VALUES($1,$2,$3,$4,$5,$6,'QA_NOTIFICACAO','operacao','Evento sintetico')`,[evento,A,cedente,CF,OP,NF])
}
async function matrix() {
  for (const name of ['gestor','cedente','sacado','consultor','leitor','admin']) {
    const user = users[name]
    await admin()
    const a1 = await notify(user,A,`${name}:1`)
    await notify(user,A,`${name}:2`)
    const b1 = await notify(user,B,`${name}:1`)
    await db.query(`INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,scope_type)
      VALUES($1,'QA seguranca','QA','seguranca_senha_alterada','GLOBAL')`, [user])
    await actor(user)
    await test(`${name}:authorized-context-list`, async () => {
      const funds=(await db.query('SELECT id FROM public.listar_fundos_notificacoes()')).rows.map(r=>r.id).sort()
      assert.deepEqual(funds,name==='admin'?[A,B,C]:[A,B])
    })
    await test(`${name}:list-A-not-B`, async () => {
      const rows = (await db.query("SELECT * FROM public.listar_notificacoes('FUNDO',$1)", [A])).rows
      assert.equal(rows.length,2); assert(rows.every(r=>r.fundo_id===A && r.usuario_id===user))
    })
    await test(`${name}:badge-separated`, async () => {
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('FUNDO',$1)",[A]),2)
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('FUNDO',$1)",[B]),1)
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('GLOBAL',NULL)"),1)
    })
    await test(`${name}:mark-wrong-context-denied`, () => deny("SELECT public.marcar_notificacoes_lidas('FUNDO',$1,$2)", [A,b1]))
    await test(`${name}:mark-all-A-only`, async () => {
      assert.equal(await value("SELECT public.marcar_notificacoes_lidas('FUNDO',$1)",[A]),2)
      assert.equal(await value("SELECT public.marcar_notificacoes_lidas('FUNDO',$1,$2)",[A,a1]),0)
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('FUNDO',$1)",[B]),1)
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('GLOBAL',NULL)"),1)
    })
    await test(`${name}:global-action-separated`, async () => {
      assert.equal(await value("SELECT public.marcar_notificacoes_lidas('GLOBAL',NULL)"),1)
      assert.equal(await value("SELECT nao_lidas::int FROM public.contar_notificacoes('FUNDO',$1)",[B]),1)
      await deny("SELECT public.marcar_notificacoes_lidas('GLOBAL',$1)",[A])
    })
    if (name !== 'admin') {
      await test(`${name}:fund-C-denied`, async () => {
        await deny("SELECT * FROM public.listar_notificacoes('FUNDO',$1)", [C])
        await deny("SELECT * FROM public.contar_notificacoes('FUNDO',$1)", [C])
        await deny("SELECT public.marcar_notificacoes_lidas('FUNDO',$1)", [C])
      })
    }
    await test(`${name}:null-and-legacy-denied`, async () => {
      await deny("SELECT * FROM public.listar_notificacoes('FUNDO',NULL)")
      await deny("SELECT * FROM public.listar_notificacoes('LEGACY_UNSCOPED',NULL)")
    })
    await test(`${name}:cannot-forge-notification`, () => deny(`INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,scope_type)
      VALUES($1,'Forged','Forged','seguranca_senha_alterada','GLOBAL')`, [user]))
    await test(`${name}:cannot-reassign-scope`, () => deny('UPDATE public.notificacoes SET fundo_id=$1 WHERE id=$2',[A,b1]))
    await test(`${name}:pagination-bounded`, async () => {
      await deny("SELECT * FROM public.listar_notificacoes('FUNDO',$1,41)",[A],'22023')
      await deny("SELECT * FROM public.listar_notificacoes('FUNDO',$1,20,now(),NULL)",[A],'22023')
      const first=(await db.query("SELECT * FROM public.listar_notificacoes('FUNDO',$1,1)",[A])).rows[0]
      const second=(await db.query("SELECT * FROM public.listar_notificacoes('FUNDO',$1,1,$2,$3)",[A,first.created_at,first.id])).rows[0]
      assert(second); assert.notEqual(first.id,second.id)
    })
  }
}
async function invariants() {
  await admin()
  await test('dedupe-in-fund-and-across-funds', async () => {
    assert(await notify(users.gestor,A,'dedupe'))
    assert.equal(await notify(users.gestor,A,'dedupe'),null)
    assert(await notify(users.gestor,B,'dedupe'))
  })
  await test('business-scope-required', async () => {
    await deny("INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo) VALUES($1,'QA','QA','nf_aprovada')",[users.gestor],'23514')
    await deny("INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,scope_type) VALUES($1,'QA','QA','nf_aprovada','GLOBAL')",[users.gestor],'23514')
    await deny("INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,scope_type) VALUES($1,'QA','QA','nf_aprovada','LEGACY_UNSCOPED')",[users.gestor],'23514')
    await deny("SELECT private.criar_notificacao_fundo($1,NULL,'QA','QA','nf_aprovada')",[users.gestor],'23514')
  })
  await test('recipient-outside-fund-denied', () => deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','nf_aprovada')",[users.gestorB,A]))
  await test('gestor-producer-does-not-broadcast', async () => {
    assert.equal(await value("SELECT private.notificar_gestores_fundo($1,'QA','QA','nf_aprovada','recipient-check')",[A]),1)
    assert.equal(await value("SELECT count(*)::int FROM public.notificacoes WHERE usuario_id=$1",[users.gestorB]),0)
  })
  await test('entity-and-link-mismatch-denied', async () => {
    await deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','nf_aprovada',NULL,$3,$4,'nota_fiscal',$5)",[users.gestor,B,CF,cedente,NF],'23514')
    await deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','nf_aprovada',NULL,NULL,NULL,'nota_fiscal',$3)",[users.gestor,B,NF],'23514')
    assert(await value("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','nf_aprovada',NULL,$3,$4,'nota_fiscal',$5)",[users.gestor,A,CF,cedente,NF]))
  })
  await test('all-canonical-entity-types-validated', async () => {
    for (const [type,id] of [['operacao',OP],['entrega',entrega],['evento_dominio',evento],['cedente_fundo',CF]]) {
      assert(await value("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','operacao_aprovada',NULL,NULL,NULL,$3,$4)",[users.gestor,A,type,id]))
      await deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','operacao_aprovada',NULL,NULL,NULL,$3,$4)",[users.gestor,B,type,id],'23514')
    }
    await deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','operacao_aprovada',NULL,NULL,NULL,'operacoes',$3)",[users.gestor,A,OP],'23514')
  })
  await test('context-immutable-even-for-service', async () => {
    await deny("UPDATE public.notificacoes SET fundo_id=$1 WHERE usuario_id=$2 AND scope_type='FUNDO'",[B,users.gestor],'23514')
  })
  await test('cedente-active-delegation-no-revoked-owner-fallback', async () => {
    await db.query("INSERT INTO public.cedente_acessos(cedente_id,user_id,perfil,status) VALUES($1,$2,'OPERACIONAL','ATIVO'),($1,$3,'ADMIN','REVOGADO')",[cedente,users.delegado,users.cedente])
    assert.equal(await value("SELECT private.notificar_cedente_fundo($1,'QA','QA','nf_aprovada','delegation')",[CF]),1)
    assert.equal(await value("SELECT private.notificar_cedente_fundo($1,'QA','QA','nf_aprovada','admin-only',true)",[CF]),0)
    await actor(users.cedente)
    await deny("SELECT * FROM public.listar_notificacoes('FUNDO',$1)",[A])
    await actor(users.delegado)
    assert.equal(await value("SELECT count(*)::int FROM public.listar_notificacoes('FUNDO',$1)",[A]),1)
    await admin()
  })
  await test('revoked-gestor-cannot-read-or-update-old-notification', async () => {
    const id=await notify(users.gestor,B,'before-revocation')
    await db.query("UPDATE public.usuario_fundos SET status='revogado' WHERE usuario_id=$1 AND fundo_id=$2",[users.gestor,B])
    await actor(users.gestor)
    assert.equal(await value('SELECT count(*)::int FROM public.notificacoes WHERE id=$1',[id]),0)
    assert.equal((await db.query('UPDATE public.notificacoes SET lida=true WHERE id=$1 RETURNING id',[id])).rowCount,0)
    await deny("SELECT public.marcar_notificacoes_lidas('FUNDO',$1,$2)",[B,id])
    await admin()
  })
  await test('superadmin-own-user-not-everyones', async () => {
    await actor(users.admin)
    assert.equal(await value('SELECT count(*)::int FROM public.notificacoes WHERE usuario_id<>$1',[users.admin]),0)
    await admin()
  })
  await test('private-producers-not-exposed', async () => {
    await actor(users.gestor)
    await deny("SELECT private.criar_notificacao_fundo($1,$2,'QA','QA','nf_aprovada')",[users.gestor,A])
    await deny('SELECT private.notificacao_usuario_acessa_fundo($1,$2)',[users.gestorB,B])
    await admin()
  })
  await test('anon-denied', async () => {
    await db.query('SET LOCAL ROLE anon')
    await deny("SELECT * FROM public.listar_notificacoes('FUNDO',$1)",[A])
    await deny('SELECT * FROM public.notificacoes')
    await admin()
  })
  await test('inactive-user-global-and-fund-denied', async () => {
    await db.query("UPDATE public.profiles SET status='inativo' WHERE id=$1",[users.gestor])
    await actor(users.gestor)
    await deny("SELECT * FROM public.listar_notificacoes('GLOBAL',NULL)")
    assert.equal(await value('SELECT count(*)::int FROM public.notificacoes'),0)
    assert.equal(await value('SELECT count(*)::int FROM public.listar_fundos_notificacoes()'),0)
    await admin()
  })
}

const report={ at:new Date().toISOString(), target:'127.0.0.1:59422', migration:migrationFile,
  sha256:createHash('sha256').update(migration).digest('hex'), checks, success:false }
try {
  await db.connect()
  await db.query("SET statement_timeout='30s'; SET lock_timeout='3s'")
  for (scenario of ['empty-schema','upgrade-with-history']) {
    await db.query('BEGIN')
    if (scenario === 'upgrade-with-history') {
      await setup()
      await db.query(`INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,entidade_tipo,entidade_id,dedupe_key,href)
        VALUES($1,'NF','QA','nf_aprovada','nota_fiscal',$2,'hist-nf',NULL),
        ($1,'Fundo A','Fundo A','operacao_aprovada',NULL,NULL,'fund:A:guess','/gestor/operacoes')`,[users.gestor,NF])
      for (const [type,id] of [['operacao',OP],['entrega',entrega],['evento_dominio',evento],['cedente_fundo',CF]]) {
        await db.query(`INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,entidade_tipo,entidade_id,dedupe_key)
          VALUES($1,'QA','QA','operacao_aprovada',$2,$3,$4)`,[users.gestor,type,id,`hist-${type}`])
      }
    }
    await db.query(migration)
    if (r2Migration) await db.query(r2Migration)
    if (producersMigration) await db.query(producersMigration)
    if (uiMigration) await db.query(uiMigration)
    if (scenario === 'empty-schema') await setup()
    if (scenario === 'upgrade-with-history') {
      await test('deterministic-backfill-only', async () => {
        assert.equal(await value("SELECT scope_type FROM public.notificacoes WHERE dedupe_key='hist-nf'"),'FUNDO')
        assert.equal(await value("SELECT fundo_id FROM public.notificacoes WHERE dedupe_key='hist-nf'"),A)
        assert.equal(await value("SELECT scope_type FROM public.notificacoes WHERE dedupe_key='fund:A:guess'"),'LEGACY_UNSCOPED')
        assert.equal(await value('SELECT count(*)::int FROM public.notificacoes'),6)
        assert.equal(await value("SELECT count(*)::int FROM public.notificacoes WHERE scope_type='FUNDO' AND fundo_id=$1",[A]),5)
        await actor(users.gestor)
        assert.equal(await value("SELECT count(*)::int FROM public.notificacoes WHERE scope_type='LEGACY_UNSCOPED'"),0)
        await admin()
        // Discard only synthetic history inside the test transaction to reuse exact matrix counts.
        await db.query('DELETE FROM public.notificacoes')
      })
    }
    await matrix()
    await invariants()
    await db.query('ROLLBACK')
  }
  scenario='index-experiment'
  await db.query('BEGIN')
  await db.query(migration)
  if (r2Migration) await db.query(r2Migration)
  if (producersMigration) await db.query(producersMigration)
  if (uiMigration) await db.query(uiMigration)
  await setup()
  // Compare the new index with the pre-feature query plan, in a rollback-only DB.
  await db.query('DROP INDEX public.idx_notificacoes_fundo_contexto')
  await db.query(`INSERT INTO public.notificacoes(usuario_id,fundo_id,scope_type,titulo,mensagem,tipo,created_at)
    SELECT $1,CASE WHEN g%2=0 THEN $2::uuid ELSE $3::uuid END,'FUNDO','QA','QA','operacao_aprovada',
      now()-g*interval '1 second' FROM generate_series(1,20000) g`,[users.gestor,A,B])
  await db.query('ANALYZE public.notificacoes')
  const explain=`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,created_at FROM public.notificacoes
    WHERE usuario_id=$1 AND scope_type='FUNDO' AND fundo_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20`
  await actor(users.gestor)
  const before=await value(explain,[users.gestor,B])
  await admin()
  const indexDdl=migration.match(/CREATE INDEX idx_notificacoes_fundo_contexto[\s\S]*?;/)?.[0]
  assert(indexDdl,'MIGRATION_INDEX_DDL_MISSING')
  await db.query(indexDdl)
  await actor(users.gestor)
  const after=await value(explain,[users.gestor,B])
  assert(JSON.stringify(after).includes('idx_notificacoes_fundo_contexto'),'INDEX_NOT_USED')
  report.indexExperiment={ rows:20000,before,after }
  await db.query('ROLLBACK')
  assert.equal(await value("SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='notificacoes' AND column_name='scope_type'"),0)
  assert.equal(await value('SELECT count(*)::int FROM auth.users'),0)
  report.success=true
} catch(error) {
  await db.query('ROLLBACK').catch(()=>{})
  report.error={ code:error.code, message:error.message, scenario, detail:error.detail, where:error.where }
  process.exitCode=1
} finally {
  await db.end()
  mkdirSync('rehearsal/reports',{recursive:true})
  if (r2Migration) report.r2Migration = { file: r2MigrationFile, sha256: createHash('sha256').update(r2Migration).digest('hex') }
  if (producersMigration) report.producersMigration = { file: producersFile, sha256: createHash('sha256').update(producersMigration).digest('hex') }
  if (uiMigration) report.uiMigration = { file: uiFile, sha256: createHash('sha256').update(uiMigration).digest('hex') }
  writeFileSync(`rehearsal/reports/NOTIFICACOES_DATABASE${includeProducers ? '_PRODUCERS' : includeR2 ? '_R2' : ''}_TEST.json`,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({ ...report, checks:checks.length, indexExperiment:report.indexExperiment && {
    rows:report.indexExperiment.rows,
    beforeMs:report.indexExperiment.before[0]['Execution Time'],
    afterMs:report.indexExperiment.after[0]['Execution Time'],
  } }))
}
