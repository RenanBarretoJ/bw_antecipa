import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const postSnapshotMigrations = [
  'supabase/migrations/20261022121028_vortx_carteira_atomic_persistence.sql',
  'supabase/migrations/20261022174904_financial_reconciliation_conditional_movements.sql',
  'supabase/migrations/20261022211047_vrs_duplicata_parcela_keys.sql',
  'supabase/migrations/20261023143138_consultor_operacao_memoria_readonly.sql',
  'supabase/migrations/20261026163837_s1_serpro_nfe_gestor.sql',
]

const sha256 = value => createHash('sha256').update(value).digest('hex')

const s1Migration = 'supabase/migrations/20261026163837_s1_serpro_nfe_gestor.sql'
const utf8RepairMigration = 'supabase/migrations/20261026212352_s1_serpro_nfe_utf8_forward_only.sql'
const productionBadStatementSha256 = 'd39004f544f25827632e8f183d35947a8949837b31896c5fd622c57a76925895'

async function s1Catalog(sql, database = 'postgres') {
  return JSON.parse(await sql(`
    WITH functions AS (
      SELECT jsonb_agg(jsonb_build_object(
        'identity', p.oid::regprocedure::text,
        'oid', p.oid,
        'owner', p.proowner::regrole::text,
        'securityDefiner', p.prosecdef,
        'volatility', p.provolatile,
        'config', p.proconfig,
        'acl', p.proacl,
        'sha256', encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex')
      ) ORDER BY p.oid::regprocedure::text) AS value
      FROM pg_proc p
      WHERE p.oid IN (
        'private.nfe_snapshot_imutavel()'::regprocedure,
        'private.nfe_enfileirar_apos_submissao()'::regprocedure,
        'public.nfe_fiscal_claim(integer)'::regprocedure,
        'public.nfe_fiscal_complete(uuid,uuid,text,text,text,timestamptz,integer,text,jsonb,jsonb,jsonb)'::regprocedure,
        'public.nfe_fiscal_fail(uuid,uuid,text,text,integer)'::regprocedure,
        'public.solicitar_reconsulta_nfe_fiscal(uuid)'::regprocedure,
        'public.obter_situacao_fiscal_nfe(uuid)'::regprocedure
      )
    ), tables AS (
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.oid::regclass::text,
        'owner', c.relowner::regrole::text,
        'rls', c.relrowsecurity,
        'forceRls', c.relforcerowsecurity,
        'acl', c.relacl
      ) ORDER BY c.oid::regclass::text) AS value
      FROM pg_class c
      WHERE c.oid IN (
        'public.nfe_fiscal_snapshots'::regclass,
        'public.nfe_fiscal_consultas'::regclass,
        'public.nfe_fiscal_eventos'::regclass,
        'public.nfe_fiscal_provider_state'::regclass
      )
    )
    SELECT jsonb_build_object(
      'functions', (SELECT value FROM functions),
      'tables', (SELECT value FROM tables),
      'snapshotComment', obj_description('public.nfe_fiscal_snapshots'::regclass, 'pg_class'),
      'consultasComment', obj_description('public.nfe_fiscal_consultas'::regclass, 'pg_class'),
      'resumoDefault', (
        SELECT pg_get_expr(d.adbin, d.adrelid)
        FROM pg_attribute a
        JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='public.nfe_fiscal_consultas'::regclass AND a.attname='resumo'
      ),
      'constraints', (
        SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(
          c.conrelid::regclass::text||':'||c.conname||':'||pg_get_constraintdef(c.oid, true), E'\\n'
          ORDER BY c.conrelid::regclass::text, c.conname), ''), 'UTF8'), 'sha256'), 'hex')
        FROM pg_constraint c WHERE c.conrelid::regclass::text LIKE 'nfe_fiscal_%'
      ),
      'indexes', (
        SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(indexdef, E'\\n' ORDER BY schemaname, tablename, indexname), ''), 'UTF8'), 'sha256'), 'hex')
        FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'nfe_fiscal_%'
      ),
      'triggers', (
        SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(
          t.tgrelid::regclass::text||':'||t.tgname||':'||pg_get_triggerdef(t.oid, true), E'\\n'
          ORDER BY t.tgrelid::regclass::text, t.tgname), ''), 'UTF8'), 'sha256'), 'hex')
        FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid::regclass::text IN (
          'notas_fiscais','nfe_fiscal_snapshots','nfe_fiscal_consultas','nfe_fiscal_eventos','nfe_fiscal_provider_state'
        )
      ),
      'policies', (
        SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(
          schemaname||':'||tablename||':'||policyname||':'||cmd||':'||COALESCE(qual,'')||':'||COALESCE(with_check,''), E'\\n'
          ORDER BY schemaname, tablename, policyname), ''), 'UTF8'), 'sha256'), 'hex')
        FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'nfe_fiscal_%'
      )
    );
  `, database))
}

async function migrationLedger(sql, database) {
  const exists = await sql("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;", database)
  if (exists !== 't') return { exists: false, count: 0, rows: [], sha256: null }
  return JSON.parse(await sql(`
    SELECT jsonb_build_object(
      'exists', true,
      'count', count(*),
      'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'version', version,
        'name', name,
        'statements', statements
      ) ORDER BY version), '[]'::jsonb),
      'sha256', encode(extensions.digest(convert_to(COALESCE(string_agg(
        version || ':' || name || ':' || COALESCE(array_to_string(statements, E'\\n'), ''),
        E'\\n' ORDER BY version), ''), 'UTF8'), 'sha256'), 'hex')
    )
    FROM supabase_migrations.schema_migrations;
  `, database))
}

async function runUtf8NegativeGuards(sql, phase, repairSql) {
  await phase('S1_UTF8_FORWARD_ONLY_NEGATIVE_GUARDS')
  const cases = [
    {
      name: 'snapshot_comment_null',
      mutation: 'COMMENT ON TABLE public.nfe_fiscal_snapshots IS NULL;',
      expected: 'Comentário inesperado em public.nfe_fiscal_snapshots',
    },
    {
      name: 'consultas_comment_null',
      mutation: 'COMMENT ON TABLE public.nfe_fiscal_consultas IS NULL;',
      expected: 'Comentário inesperado em public.nfe_fiscal_consultas',
    },
    {
      name: 'resumo_default_null',
      mutation: 'ALTER TABLE public.nfe_fiscal_consultas ALTER COLUMN resumo DROP DEFAULT;',
      expected: 'Default inesperado em public.nfe_fiscal_consultas.resumo',
    },
    {
      name: 'snapshot_comment_unexpected',
      mutation: "COMMENT ON TABLE public.nfe_fiscal_snapshots IS 'UNEXPECTED_S1_UTF8_GUARD_FIXTURE';",
      expected: 'Comentário inesperado em public.nfe_fiscal_snapshots',
    },
    {
      name: 'consultas_comment_unexpected',
      mutation: "COMMENT ON TABLE public.nfe_fiscal_consultas IS 'UNEXPECTED_S1_UTF8_GUARD_FIXTURE';",
      expected: 'Comentário inesperado em public.nfe_fiscal_consultas',
    },
    {
      name: 'resumo_default_unexpected',
      mutation: "ALTER TABLE public.nfe_fiscal_consultas ALTER COLUMN resumo SET DEFAULT 'UNEXPECTED_S1_UTF8_GUARD_FIXTURE'::text;",
      expected: 'Default inesperado em public.nfe_fiscal_consultas.resumo',
    },
    {
      name: 'function_hash_unexpected',
      mutation: `CREATE OR REPLACE FUNCTION private.nfe_snapshot_imutavel()
        RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fixture$
        BEGIN
          RAISE EXCEPTION 'UNEXPECTED_S1_UTF8_GUARD_FIXTURE' USING ERRCODE = '55000';
        END
        $fixture$;`,
      expected: 'Definição inesperada para private.nfe_snapshot_imutavel()',
    },
  ]
  const results = []
  for (const [index, item] of cases.entries()) {
    const database = `s1u8_${process.pid}_${index}`
    await sql(`
      ALTER DATABASE postgres ALLOW_CONNECTIONS false;
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = 'postgres'
         AND pid <> pg_backend_pid();
    `, 'template1')
    try {
      await sql(`CREATE DATABASE ${database} TEMPLATE postgres;`, 'template1')
    } finally {
      await sql('ALTER DATABASE postgres ALLOW_CONNECTIONS true;', 'template1')
    }
    try {
      await sql(item.mutation, database)
      const catalogBefore = await s1Catalog(sql, database)
      const ledgerBefore = await migrationLedger(sql, database)
      let error = null
      try {
        await sql(repairSql, database)
      } catch (caught) {
        error = String(caught?.message ?? caught)
      }
      assert(error, `NEGATIVE_GUARD_MUST_REJECT:${item.name}`)
      assert(error.includes(item.expected), `NEGATIVE_GUARD_WRONG_REASON:${item.name}:${error}`)
      const catalogAfter = await s1Catalog(sql, database)
      const ledgerAfter = await migrationLedger(sql, database)
      assert.deepEqual(catalogAfter, catalogBefore, `NEGATIVE_GUARD_CATALOG_ROLLBACK:${item.name}`)
      assert.deepEqual(ledgerAfter, ledgerBefore, `NEGATIVE_GUARD_LEDGER_ROLLBACK:${item.name}`)
      results.push({
        name: item.name,
        result: 'PASS',
        rejected: true,
        reasonMatched: item.expected,
        catalogUnchanged: true,
        ledgerUnchanged: true,
      })
    } finally {
      await sql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`, 'template1')
    }
  }
  return results
}

function atomicLedgerPayload(repairSql) {
  const commit = /\nCOMMIT;\s*$/.exec(repairSql)
  assert(commit, 'REPAIR_MIGRATION_TERMINAL_COMMIT_REQUIRED')
  assert(repairSql.includes('BEGIN;'), 'REPAIR_MIGRATION_BEGIN_REQUIRED')
  const delimiter = '$s17r_ledger_statement$'
  assert(!repairSql.includes(delimiter), 'LEDGER_DELIMITER_COLLISION')
  const beforeCommit = repairSql.slice(0, commit.index)
  const terminalCommit = repairSql.slice(commit.index)
  const ledger = `
INSERT INTO supabase_migrations.schema_migrations(version, statements, name, created_by)
VALUES (
  '20261026212352',
  ARRAY[${delimiter}${repairSql}${delimiter}]::text[],
  's1_serpro_nfe_utf8_forward_only',
  'codex-s1.7r atomic utf8 transport'
);
`
  return `SET client_encoding = 'UTF8';\n${beforeCommit}${ledger}${terminalCommit}`
}

async function createBadStateClone(sql, database) {
  await sql(`
    ALTER DATABASE postgres ALLOW_CONNECTIONS false;
    SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
     WHERE datname = 'postgres'
       AND pid <> pg_backend_pid();
  `, 'template1')
  try {
    await sql(`CREATE DATABASE ${database} TEMPLATE postgres;`, 'template1')
  } finally {
    await sql('ALTER DATABASE postgres ALLOW_CONNECTIONS true;', 'template1')
  }
}

async function runAtomicLedgerTransportProof(sql, phase, repairSql) {
  await phase('S1_UTF8_ATOMIC_DDL_LEDGER_TRANSPORT_PROOF')
  const payload = atomicLedgerPayload(repairSql)
  const results = []
  for (const item of [
    { name: 'commit_ddl_and_exact_ledger_together', rejectLedger: false },
    { name: 'ledger_failure_rolls_back_repair', rejectLedger: true },
  ]) {
    const database = `s1u8_${process.pid}_${item.rejectLedger ? 91 : 90}`
    await createBadStateClone(sql, database)
    try {
      await sql(`
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (
          version text PRIMARY KEY,
          statements text[],
          name text,
          created_by text,
          idempotency_key text UNIQUE,
          rollback text[]
          ${item.rejectLedger ? ", CHECK (version <> '20261026212352')" : ''}
        );
      `, database)
      const before = await s1Catalog(sql, database)
      let error = null
      try {
        await sql(payload, database)
      } catch (caught) {
        error = String(caught?.message ?? caught)
      }
      const ledgerCount = await sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261026212352';", database)
      if (item.rejectLedger) {
        assert(error, 'ATOMIC_LEDGER_FAILURE_MUST_REJECT')
        assert.equal(ledgerCount, '0', 'FAILED_LEDGER_MUST_NOT_BE_WRITTEN')
        assert.deepEqual(await s1Catalog(sql, database), before, 'FAILED_LEDGER_MUST_ROLL_BACK_REPAIR')
        results.push({ name: item.name, result: 'PASS', rejected: true, ddlRolledBack: true, ledgerRolledBack: true })
      } else {
        assert.equal(error, null, `ATOMIC_LEDGER_TRANSPORT_UNEXPECTED_FAILURE:${error}`)
        assert.equal(ledgerCount, '1', 'ATOMIC_LEDGER_VERSION_MUST_EXIST_ONCE')
        const ledgerSha = await sql(`SELECT encode(extensions.digest(convert_to(statements[1], 'UTF8'), 'sha256'), 'hex')
          FROM supabase_migrations.schema_migrations WHERE version='20261026212352';`, database)
        assert.equal(ledgerSha, sha256(repairSql), 'LEDGER_STATEMENT_MUST_MATCH_EXACT_MIGRATION_BYTES')
        const final = await s1Catalog(sql, database)
        assert.notDeepEqual(final, before, 'SUCCESSFUL_REPAIR_MUST_CHANGE_BAD_TEXT_CATALOG')
        results.push({
          name: item.name,
          result: 'PASS',
          version: '20261026212352',
          ledgerOccurrences: 1,
          statementSha256: ledgerSha,
          ddlAndLedgerCommittedTogether: true,
        })
      }
    } finally {
      await sql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`, 'template1')
    }
  }
  return { result: 'PASS', clientEncoding: 'UTF8', terminalCommitPreserved: true, cases: results }
}

function semanticCatalog(catalog) {
  return {
    ...catalog,
    functions: catalog.functions.map(({ oid, ...item }) => {
      void oid
      return item
    }),
  }
}

export async function applyS1BrowserUpgrade(sql, phase, { utf8Mode = 'good' } = {}) {
  assert(['good', 'bad-repair'].includes(utf8Mode), 'INVALID_S1_UTF8_MODE')
  const applied = []
  let badCatalog = null
  let negativeGuards = []
  let atomicLedgerTransport = null
  for (const path of postSnapshotMigrations) {
    const bytes = await readFile(path)
    let body = bytes.toString('utf8')
    let result = 'APPLIED_EXACT_BYTES_LOCAL_ONLY'
    if (path === s1Migration && utf8Mode === 'bad-repair') {
      body = new TextDecoder('windows-1252').decode(bytes) + '\r\n'
      assert.equal(sha256(body), productionBadStatementSha256, 'BAD_PRODUCTION_SQL_REPRODUCTION_HASH_MISMATCH')
      result = 'APPLIED_EXACT_PRODUCTION_BAD_STATEMENT_LOCAL_ONLY'
    }
    await phase(`S1_BROWSER_UPGRADE_${path.split('/').at(-1).slice(0, 14)}`)
    await sql(body)
    applied.push({ path, sha256: sha256(body), result })
    if (path === s1Migration && utf8Mode === 'bad-repair') {
      badCatalog = await s1Catalog(sql)
      const repair = await readFile(utf8RepairMigration, 'utf8')
      negativeGuards = await runUtf8NegativeGuards(sql, phase, repair)
      atomicLedgerTransport = await runAtomicLedgerTransportProof(sql, phase, repair)
      await phase('S1_UTF8_FORWARD_ONLY_REPAIR')
      await sql(repair)
      applied.push({ path: utf8RepairMigration, sha256: sha256(repair), result: 'APPLIED_FORWARD_ONLY_LOCAL_ONLY' })
    }
  }
  assert.equal(await sql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'nfe_fiscal_%' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;`), '0')
  assert.equal(await sql(`SELECT capability_state||':'||circuit_state||':'||daily_budget::text FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO';`), 'UNVERIFIED:OPEN:0')
  const finalCatalog = await s1Catalog(sql)
  if (badCatalog) {
    const beforeOids = badCatalog.functions.map(item => [item.identity, item.oid])
    const afterOids = finalCatalog.functions.map(item => [item.identity, item.oid])
    assert.deepEqual(afterOids, beforeOids, 'FUNCTION_OIDS_MUST_BE_PRESERVED_BY_REPAIR')
  }
  return {
    result: 'PASS', utf8Mode, migrations: applied, migrationHistoryWritten: false,
    providerState: 'UNVERIFIED_OPEN_BUDGET_ZERO', badCatalog, negativeGuards, atomicLedgerTransport,
    finalCatalog, semanticCatalog: semanticCatalog(finalCatalog),
  }
}

export async function runS1BrowserQa({ docker, names, password, anon, service, sql, phase, reports, envArgs }) {
  await phase('S1_PGTAP_RLS_FULL_STACK')
  const tap = await sql(await readFile('supabase/tests/s1_serpro_nfe_gestor.test.sql', 'utf8'))
  assert.match(tap, /1\.\.22/)
  assert.doesNotMatch(tap, /not ok/i)

  await phase('S1_PROVIDER_MOCK_NO_EGRESS')
  await docker(['exec', ...envArgs({
    SERPRO_NFE_WORKER_ENABLED: 'false', SERPRO_NFE_CONTRACT_VERIFIED: 'false', SERPRO_NFE_QUERY_ENABLED: 'false',
  }), names.runner, 'node', 'node_modules/vitest/vitest.mjs', 'run', 'src/lib/serpro-nfe',
    '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile=/reports/s1-provider.json'])

  await phase('S1_AUTH_TOTP_SYNTHETIC_FIXTURE')
  const runtimeReport = '/reports/s1-browser-runtime.json'
  const runtimeEnv = {
    LOCAL_QA_PG_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57861',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    S1_BROWSER_REPORT: runtimeReport,
    S1_BROWSER_EXECUTABLE: '/usr/bin/chromium',
  }
  await docker(['exec', ...envArgs(runtimeEnv), names.runner, 'node', 'scripts/qa/serpro/s1-browser-runtime.mjs', '--seed'])

  await phase('S1_NEXT_LOCAL_NO_EGRESS')
  const appEnv = {
    ...runtimeEnv,
    APP_BASE_URL: 'http://127.0.0.1:57860',
    NEXT_PUBLIC_APP_ENV: 'local',
    INTEGRATION_RUNTIME_ENV: 'local',
    AUTH_FLOW_COOKIE_SECRET: 'local-only-s1-cookie-secret-with-more-than-32-bytes',
    NEXT_TELEMETRY_DISABLED: '1',
    NFSE_UPLOAD_ENABLED: 'false',
    SERPRO_NFE_WORKER_ENABLED: 'false',
    SERPRO_NFE_CONTRACT_VERIFIED: 'false',
    SERPRO_NFE_QUERY_ENABLED: 'false',
    SERPRO_NFE_CONSUMER_KEY: '',
    SERPRO_NFE_CONSUMER_SECRET: '',
    SERPRO_NFE_TOKEN_URL: '',
    SERPRO_NFE_BASE_URL: '',
  }
  await docker(['exec', '-d', ...envArgs(appEnv), names.runner, 'npm', 'run', 'dev', '--', '-H', '127.0.0.1', '-p', '57860'])
  await docker(['exec', names.runner, 'node', '-e', `(async()=>{for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:57860/login');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)})()`], undefined, 90000)

  await phase('S1_REAL_BROWSER_AUTH_MFA_RLS_DOM')
  await docker(['exec', ...envArgs(appEnv), names.runner, 'node', 'scripts/qa/serpro/s1-browser-runtime.mjs', '--browser'], undefined, 180000)
  await docker(['cp', `${names.runner}:/reports/.`, reports])
  const browser = JSON.parse(await readFile(resolve(reports, 's1-browser-runtime.json'), 'utf8'))
  assert.equal(browser.result, 'PASS')
  assert.equal(browser.realBrowser, true)
  assert.equal(browser.realPasswordAndTotp, true)
  assert.equal(browser.externalRequests, 0)
  const provider = JSON.parse(await readFile(resolve(reports, 's1-provider.json'), 'utf8'))
  assert.equal(provider.numFailedTests, 0)
  await mkdir(resolve(reports, 's1'), { recursive: true })
  await writeFile(resolve(reports, 's1', 'summary.json'), JSON.stringify({ tap, provider: { passed: provider.numPassedTests }, browser }, null, 2))
  return { result: 'PASS', pgtap: 22, providerMockTests: provider.numPassedTests, ...browser }
}
