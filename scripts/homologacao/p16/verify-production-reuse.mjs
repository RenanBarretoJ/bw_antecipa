import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'

// Somente leitura: verifica as solicitacoes reais ja feitas pelo Cedente.
const file = process.argv.find(arg => arg.startsWith('--env='))?.slice(6)
assert.ok(file, 'Informe o arquivo local da conexao de producao')
const env = {}
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
}
const ref = 'wwsndnuvnjuabpbjwlck'
assert.equal(env.REHEARSAL_PRODUCTION_PROJECT_REF, ref)
const url = new URL(env.REHEARSAL_PRODUCTION_DB_URL)
assert.ok(url.hostname === `db.${ref}.supabase.co` ||
  (url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${ref}`))
assert.equal(url.pathname, '/postgres')
const oldId = '8cbb79f2-7829-462e-b350-518b459092d6'
const newIds = ['90c3df7c-89d7-47e5-9b6b-1a8a82bc2cdc', '9976ae7f-3cb4-4b0c-881f-ab2f2fd03da2']
const checkpoint = JSON.parse(readFileSync('docs/analises/p16-prod-checkpoint.json', 'utf8'))
const applied = JSON.parse(readFileSync('docs/analises/p16-prod-migration.json', 'utf8'))
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()
try {
  await db.query('begin isolation level repeatable read read only')
  await db.query("set local statement_timeout='30s'")
  for (const expected of applied.after.functions) {
    const actual = (await db.query('select md5(pg_get_functiondef($1::regprocedure)) as md5,proacl::text as acl from pg_proc where oid=$1::regprocedure', [expected.signature])).rows[0]
    assert.equal(actual.md5, expected.md5)
    assert.equal(actual.acl, expected.acl)
  }
  const migration = (await db.query("select version,encode(extensions.digest(array_to_string(statements,''),'sha256'),'hex') as sha256 from supabase_migrations.schema_migrations where version=$1", [applied.version])).rows
  assert.equal(migration.length, 1)
  assert.equal(migration[0].sha256, applied.hash)
  const historical = (await db.query(`select
    (select status from operacoes where id=$1) as status,
    (select md5(row_to_json(o)::text) from operacoes o where id=$1) as case_operation_digest,
    (select md5(string_agg(md5(row_to_json(l)::text),'' order by l.nota_fiscal_id)) from operacoes_nfs l where operacao_id=$1) as case_links_digest,
    (select md5(string_agg(md5(row_to_json(a)::text),'' order by a.id)) from logs_auditoria a where entidade_id=$1) as case_audit_digest`, [oldId])).rows[0]
  assert.equal(historical.status, 'cancelada')
  for (const key of ['case_operation_digest', 'case_links_digest', 'case_audit_digest']) assert.equal(historical[key], checkpoint.counts[key])
  const notes = (await db.query(`select nf.id,nf.numero_nf,nf.status,
    (select array_agg(o.id order by o.id) from operacoes_nfs l join operacoes o on o.id=l.operacao_id
      where l.nota_fiscal_id=nf.id and private.operacao_status_reserva_nf(o.status)) as active_operations
    from notas_fiscais nf join operacoes_nfs l on l.nota_fiscal_id=nf.id where l.operacao_id=$1 order by nf.numero_nf`, [oldId])).rows
  assert.equal(notes.length, 20)
  for (const nf of notes) {
    assert.equal(nf.status, 'em_antecipacao')
    assert.equal(nf.active_operations.length, 1)
    assert.ok(newIds.includes(nf.active_operations[0]))
  }
  const operations = []
  for (const id of newIds) {
    const operation = (await db.query(`select o.id,o.status,o.created_at,
      o.cedente_id=old.cedente_id as same_cedente,o.cedente_fundo_id=old.cedente_fundo_id as same_cedente_fundo
      from operacoes o cross join operacoes old where o.id=$1 and old.id=$2`, [id, oldId])).rows[0]
    assert.equal(operation.status, 'solicitada')
    assert.ok(operation.same_cedente && operation.same_cedente_fundo)
    assert.ok(new Date(operation.created_at) > new Date(applied.appliedAt))
    const linkedIds = (await db.query('select nota_fiscal_id from operacoes_nfs where operacao_id=$1 order by nota_fiscal_id', [id])).rows.map(row => row.nota_fiscal_id)
    assert.equal(linkedIds.length, 10)
    assert.deepEqual(linkedIds, notes.filter(nf => nf.active_operations[0] === id).map(nf => nf.id).sort())
    const audit = (await db.query(`select a.tipo_evento,a.created_at,p.role as actor_role,
      a.usuario_id=c.user_id as actor_matches_cedente,a.dados_depois->>'solicitado_por_role' as recorded_role,
      a.dados_depois->'nota_fiscal_ids' as nf_ids from logs_auditoria a
      join profiles p on p.id=a.usuario_id join operacoes o on o.id=a.entidade_id join cedentes c on c.id=o.cedente_id
      where a.entidade_id=$1 and a.tipo_evento='OPERACAO_SOLICITADA'`, [id])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].actor_role, 'cedente')
    assert.equal(audit[0].recorded_role, 'cedente')
    assert.equal(audit[0].actor_matches_cedente, true)
    assert.deepEqual(audit[0].nf_ids.sort(), linkedIds)
    assert.equal(new Date(audit[0].created_at).getTime(), new Date(operation.created_at).getTime())
    operations.push({ ...operation, nfCount: linkedIds.length, audit: audit[0] })
  }
  await db.query('rollback')
  const report = { checkedAt: new Date().toISOString(), projectRef: ref, result: 'PASS',
    historical, migration, functionsAndAclsUnchanged: true, operations, notes,
    note: 'Duas solicitacoes reais sequenciais de 10 NFs distintas, feitas fora da conducao do agente. Nenhuma nova tentativa foi executada nesta verificacao. Evidencia UI deve ser atribuida ao relato do usuario e aos logs, nao a observacao do agente.' }
  writeFileSync('docs/analises/p16-prod-real-reuse.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ result: 'PASS', operations: operations.map(op => ({ id: op.id, nfCount: op.nfCount })), notes: notes.length, historyPreserved: true, activeExclusive: true, audit: 'PASS' }))
} finally {
  await db.query('rollback').catch(() => {})
  await db.end()
}
