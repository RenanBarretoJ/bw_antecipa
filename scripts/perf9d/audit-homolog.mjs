#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { Client } from 'pg'
import {
  assertHomologEnvironment,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
} from '../perf9a/common.mjs'
import {
  assertReadOnlyAuditArguments,
  assertSafeAuditTarget,
  canonicalStatementHash,
  classifyEvidence,
  findRemoteObjectsWithoutLocalOrigin,
  inventoryMigrations,
  normalizeSql,
  sha256,
} from './audit-lib.mjs'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nAuditoria 9D falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  assertReadOnlyAuditArguments(args)
  const envFile = args['env-file']
  if (!envFile) throw new Error('Informe explicitamente --env-file .env.homolog.')
  loadEnvFile(envFile)
  const env = assertHomologEnvironment()
  if (!env.dbUrl) throw new Error('SUPABASE_DB_URL ou DATABASE_URL e obrigatoria para a auditoria read-only.')

  const inventory = inventoryMigrations(resolve(process.cwd(), 'supabase/migrations'))
  const client = new Client({
    connectionString: env.dbUrl,
    application_name: 'bw_antecipa_perf9d_read_only_audit',
    statement_timeout: 120_000,
    query_timeout: 120_000,
    ssl: { rejectUnauthorized: false },
  })

  console.log('\nBW Antecipa - Escopo 9D / auditoria read-only de migrations')
  printEnvironmentSummary(env)
  console.log(`Migrations locais: ${inventory.count}`)

  await client.connect()
  let snapshot
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    const identity = (await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_setting('transaction_read_only') AS transaction_read_only,
        current_setting('server_version') AS server_version
    `)).rows[0]

    assertSafeAuditTarget({
      appEnv: env.appEnv,
      projectRef: env.projectRef,
      expectedProjectRef: EXPECTED_PROJECT_REF,
      readOnly: identity.transaction_read_only === 'on',
    })

    snapshot = await collectCatalog(client, identity)
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }

  const comparison = compareInventory(inventory, snapshot)
  const evidence = {
    metadata: {
      format: 'bw-antecipa-perf9d-migration-audit-v1',
      generatedAt: new Date().toISOString(),
      projectRef: env.projectRef,
      appEnv: env.appEnv,
      remoteReadOnly: true,
      mutationExecuted: false,
      repairAvailable: false,
      localHead: await gitValue('rev-parse HEAD'),
      localBranch: await gitValue('branch --show-current'),
    },
    inventory,
    remote: snapshot,
    comparison,
  }
  evidence.metadata.payloadSha256 = sha256(JSON.stringify(evidence))

  const timestamp = evidence.metadata.generatedAt.replace(/[:.]/g, '-')
  const evidencePath = resolve(getPerf9dLocalDir('evidence'), `migration-audit-${env.projectRef}-${timestamp}.json`)
  writeRestrictedJson(evidencePath, evidence)

  console.log(`Historico remoto: ${snapshot.history.length}`)
  for (const [classification, count] of Object.entries(comparison.counts)) {
    console.log(`- ${classification}: ${count}`)
  }
  console.log(`Objetos remotos sem origem local identificada: ${comparison.remoteObjectsWithoutLocalOrigin.length}`)
  console.log(`Evidencia local restrita: ${evidencePath}`)
  console.log(`SHA-256 do payload: ${evidence.metadata.payloadSha256}`)
  console.log('Nenhuma mutation, repair ou alteracao de historico foi executada.')
}

async function collectCatalog(client, identity) {
  const queries = {
    history: `SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version`,
    schemas: `
      SELECT nspname AS schema_name, pg_get_userbyid(nspowner) AS owner
      FROM pg_namespace
      WHERE nspname IN ('public', 'private', 'storage')
      ORDER BY nspname
    `,
    relations: `
      SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
             c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private', 'storage')
        AND c.relkind IN ('r', 'p', 'v', 'm')
      ORDER BY n.nspname, c.relname
    `,
    columns: `
      SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
             a.attnotnull AS not_null,
             pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
             a.attidentity AS identity_kind, a.attgenerated AS generated_kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname IN ('public', 'private', 'storage')
        AND c.relkind IN ('r', 'p', 'v', 'm')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY n.nspname, c.relname, a.attnum
    `,
    enums: `
      SELECT n.nspname AS schema_name, t.typname AS type_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname IN ('public', 'private', 'storage')
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname
    `,
    constraints: `
      SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
             con.contype, pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private', 'storage')
      ORDER BY n.nspname, c.relname, con.conname
    `,
    indexes: `
      SELECT ns.nspname AS schema_name, idx.relname AS index_name, tbl.relname AS table_name,
             i.indisunique AS is_unique, i.indisvalid AS is_valid,
             pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname IN ('public', 'private', 'storage')
      ORDER BY ns.nspname, idx.relname
    `,
    routines: `
      SELECT n.nspname AS schema_name, p.proname AS routine_name,
             pg_get_function_identity_arguments(p.oid) AS identity_arguments,
             pg_get_function_result(p.oid) AS result_type,
             l.lanname AS language, p.provolatile AS volatility,
             p.prosecdef AS security_definer, p.proconfig AS config,
             pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname IN ('public', 'private', 'storage')
      ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    `,
    triggers: `
      SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
             pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private', 'storage') AND NOT t.tgisinternal
      ORDER BY n.nspname, c.relname, t.tgname
    `,
    policies: `
      SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
             permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname IN ('public', 'private', 'storage')
      ORDER BY schemaname, tablename, policyname
    `,
    tableGrants: `
      SELECT table_schema AS schema_name, table_name, grantee, privilege_type, is_grantable
      FROM information_schema.role_table_grants
      WHERE table_schema IN ('public', 'private', 'storage')
      ORDER BY table_schema, table_name, grantee, privilege_type
    `,
    routineGrants: `
      SELECT n.nspname AS schema_name, p.proname AS routine_name,
             pg_get_function_identity_arguments(p.oid) AS identity_arguments,
             pg_get_userbyid(x.grantee) AS grantee, x.privilege_type, x.is_grantable
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE n.nspname IN ('public', 'private', 'storage')
      ORDER BY n.nspname, p.proname, identity_arguments, grantee, privilege_type
    `,
    schemaGrants: `
      SELECT n.nspname AS schema_name, pg_get_userbyid(x.grantee) AS grantee,
             x.privilege_type, x.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) x
      WHERE n.nspname IN ('public', 'private', 'storage')
      ORDER BY n.nspname, grantee, privilege_type
    `,
    extensions: `
      SELECT e.extname AS extension_name, e.extversion AS version, n.nspname AS schema_name
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      ORDER BY e.extname
    `,
    buckets: `
      SELECT id, name, public, file_size_limit, allowed_mime_types
      FROM storage.buckets ORDER BY id
    `,
  }

  const snapshot = { identity }
  for (const [key, sql] of Object.entries(queries)) {
    snapshot[key] = (await client.query(sql)).rows
  }
  snapshot.history = snapshot.history.map((row) => ({
    version: row.version,
    name: row.name,
    statementsCount: Array.isArray(row.statements) ? row.statements.length : null,
    canonicalStatementSha256: canonicalStatementHash(row.statements ?? []),
  }))
  return snapshot
}

function compareInventory(inventory, remote) {
  const historyByVersion = new Map(remote.history.map((item) => [item.version, item]))
  const finalOwners = buildFinalObjectOwners(inventory)
  const migrations = inventory.migrations.map((migration) => {
    const history = historyByVersion.get(migration.version)
    const evidence = migration.expectations
      .filter((expectation) => expectation.persistent)
      .map((expectation) => {
        const key = finalObjectKey(expectation)
        const finalOwner = key ? finalOwners.get(key) : null
        if (finalOwner && finalOwner !== migration.version) {
          return {
            kind: expectation.kind,
            name: expectation.name ?? null,
            object: `${expectation.schema}.${expectation.name}`,
            status: 'superseded',
            reason: `Estado final substituido pela migration ${finalOwner}.`,
          }
        }
        return evaluateExpectation(expectation, remote)
      })
    const historyEquivalent = history
      ? history.name === migration.name && history.canonicalStatementSha256 === migration.canonicalStatementSha256
      : false
    const classification = classifyEvidence({
      historyPresent: Boolean(history),
      historyEquivalent,
      evidenceStatuses: evidence.filter((item) => item.status !== 'superseded').map((item) => item.status),
    })
    return {
      version: migration.version,
      name: migration.name,
      filename: migration.filename,
      sha256: migration.sha256,
      canonicalStatementSha256: migration.canonicalStatementSha256,
      history: history ?? null,
      historyEquivalent,
      classification,
      evidence,
      risks: migration.risks,
    }
  })

  const counts = Object.fromEntries([...new Set(migrations.map((item) => item.classification))]
    .sort()
    .map((classification) => [classification, migrations.filter((item) => item.classification === classification).length]))

  return {
    counts,
    migrations,
    remoteObjectsWithoutLocalOrigin: findRemoteObjectsWithoutLocalOrigin(inventory, remote),
  }
}

function buildFinalObjectOwners(inventory) {
  const owners = new Map()
  for (const migration of inventory.migrations) {
    for (const expectation of migration.expectations) {
      const key = finalObjectKey(expectation)
      if (key) owners.set(key, migration.version)
    }
  }
  return owners
}

function finalObjectKey(expectation) {
  if (!['policy', 'function', 'index', 'trigger'].includes(expectation.kind) || !expectation.name) return null
  return `${expectation.kind}:${expectation.schema}:${expectation.table ?? ''}:${expectation.name}:${expectation.identityArguments ?? ''}`
}

function evaluateExpectation(expectation, remote) {
  const result = { kind: expectation.kind, name: expectation.name ?? null, status: 'indeterminate', reason: null }
  const fullName = `${expectation.schema}.${expectation.name}`

  if (expectation.kind === 'schema') {
    result.status = remote.schemas.some((item) => item.schema_name === expectation.name) ? 'equivalent' : 'absent'
  } else if (expectation.kind === 'table') {
    result.status = remote.relations.some((item) => item.schema_name === expectation.schema && item.relation_name === expectation.name)
      ? 'indeterminate' : 'absent'
    result.reason = result.status === 'indeterminate' ? 'Tabela existe, mas CREATE TABLE completo exige comparacao estrutural agregada.' : null
  } else if (expectation.kind === 'enum') {
    result.status = remote.enums.some((item) => item.schema_name === expectation.schema && item.type_name === expectation.name)
      ? 'indeterminate' : 'absent'
    result.reason = result.status === 'indeterminate' ? 'Enum existe; labels nao foram extraidos com seguranca do SQL local.' : null
  } else if (expectation.kind === 'column') {
    const column = remote.columns.find((item) => item.schema_name === expectation.schema && item.table_name === expectation.table && item.column_name === expectation.name)
    if (!column) result.status = 'absent'
    else {
      const actual = normalizeType(column.formatted_type)
      const expected = normalizeType(expectation.expectedType)
      result.status = actual === expected || actual.startsWith(`${expected}(`) ? 'equivalent' : 'divergent'
      result.actual = actual
      result.expected = expected
    }
  } else if (expectation.kind === 'constraint') {
    const constraint = remote.constraints.find((item) => item.schema_name === expectation.schema && item.table_name === expectation.table && item.constraint_name === expectation.name)
    if (!constraint) result.status = 'absent'
    else {
      const actual = normalizeDefinition(constraint.definition)
      const expected = normalizeDefinition(expectation.definition)
      result.status = actual === expected ? 'equivalent' : 'indeterminate'
      result.actualSha256 = sha256(actual)
      result.expectedSha256 = sha256(expected)
      result.reason = result.status === 'indeterminate' ? 'Constraint existe, mas a normalizacao nao provou equivalencia textual.' : null
    }
  } else if (expectation.kind === 'index') {
    const index = remote.indexes.find((item) => item.schema_name === expectation.schema && item.index_name === expectation.name)
    if (!index) result.status = 'absent'
    else {
      const actual = normalizeIndexDefinition(index.definition)
      const expected = normalizeIndexDefinition(expectation.definition)
      result.status = actual === expected ? 'equivalent' : 'divergent'
      result.actualSha256 = sha256(actual)
      result.expectedSha256 = sha256(expected)
    }
  } else if (expectation.kind === 'function') {
    const routine = remote.routines.find((item) => (
      item.schema_name === expectation.schema
      && item.routine_name === expectation.name
      && normalizeIdentity(item.identity_arguments) === normalizeIdentity(expectation.identityArguments)
    ))
    if (!routine) result.status = 'absent'
    else {
      const localSemantics = routineSemantics(expectation.definition)
      const remoteSemantics = routineSemantics(routine.definition, routine)
      result.status = JSON.stringify(localSemantics) === JSON.stringify(remoteSemantics) ? 'equivalent' : 'divergent'
      result.actualSemantics = remoteSemantics
      result.expectedSemantics = localSemantics
    }
  } else if (expectation.kind === 'policy') {
    const policy = remote.policies.find((item) => item.schema_name === expectation.schema && item.table_name === expectation.table.split('.').at(-1) && item.policy_name === expectation.name)
    if (expectation.operation === 'drop') {
      result.status = policy ? 'divergent' : 'equivalent'
    } else if (!policy) result.status = 'absent'
    else {
      const actual = {
        command: String(policy.cmd).toLowerCase(),
        roles: parsePgArray(policy.roles).map((role) => String(role).toLowerCase()).sort(),
        usingExpression: normalizeExpression(policy.qual, expectation.table),
        checkExpression: normalizeExpression(policy.with_check, expectation.table),
      }
      const expected = {
        command: expectation.command,
        roles: expectation.roles,
        usingExpression: normalizeExpression(expectation.usingExpression, expectation.table),
        checkExpression: normalizeExpression(expectation.checkExpression, expectation.table),
      }
      const structuralMismatch = actual.command !== expected.command
        || JSON.stringify(actual.roles) !== JSON.stringify(expected.roles)
        || (actual.usingExpression == null) !== (expected.usingExpression == null)
        || (actual.checkExpression == null) !== (expected.checkExpression == null)
      result.status = structuralMismatch
        ? 'divergent'
        : (policyFingerprint(actual) === policyFingerprint(expected) ? 'equivalent' : 'indeterminate')
      result.reason = result.status === 'indeterminate' ? 'Policy existe com comando, roles e clausulas esperadas; normalizacao lexical nao provou equivalencia semantica integral.' : null
      result.actual = actual
      result.expected = expected
    }
  } else if (expectation.kind === 'trigger') {
    const trigger = remote.triggers.find((item) => item.schema_name === expectation.schema && item.table_name === expectation.table.split('.').at(-1) && item.trigger_name === expectation.name)
    if (!trigger) result.status = 'absent'
    else {
      const actual = normalizeDefinition(trigger.definition)
      const expected = normalizeDefinition(expectation.definition)
      result.status = actual === expected ? 'equivalent' : 'indeterminate'
      result.reason = result.status === 'indeterminate' ? 'Trigger existe, mas a normalizacao nao provou equivalencia textual.' : null
    }
  } else if (expectation.kind === 'rls_enabled' || expectation.kind === 'rls_force') {
    const relation = remote.relations.find((item) => item.schema_name === expectation.schema && item.relation_name === expectation.name)
    if (!relation) result.status = 'absent'
    else result.status = (expectation.kind === 'rls_enabled' ? relation.rls_enabled : relation.rls_forced) ? 'equivalent' : 'divergent'
  } else if (expectation.kind === 'grant') {
    Object.assign(result, evaluateGrant(expectation, remote))
  } else {
    result.reason = `Expectativa persistente nao comparavel automaticamente: ${expectation.kind}.`
  }

  result.object = fullName
  return result
}

function evaluateGrant(expectation, remote) {
  const role = expectation.role === 'public' ? 'PUBLIC' : expectation.role
  let grants = []
  if (expectation.targetKind === 'table') {
    const target = expectation.name.replace(/\(.*/, '')
    const parsed = target.split('.')
    const schema = parsed.length > 1 ? parsed.at(-2) : expectation.schema
    const name = parsed.at(-1)
    grants = remote.tableGrants.filter((item) => item.schema_name === schema && item.table_name === name && item.grantee.toLowerCase() === role.toLowerCase())
  } else if (expectation.targetKind === 'function') {
    const target = expectation.name
    const name = target.replace(/^.*\./, '').replace(/\(.*/, '')
    const args = target.match(/\((.*)\)/)?.[1] ?? ''
    grants = remote.routineGrants.filter((item) => item.schema_name === expectation.schema && item.routine_name === name && normalizeIdentity(item.identity_arguments) === normalizeIdentity(args) && item.grantee.toLowerCase() === role.toLowerCase())
  } else if (expectation.targetKind === 'schema') {
    grants = remote.schemaGrants.filter((item) => item.schema_name === expectation.schema && item.grantee.toLowerCase() === role.toLowerCase())
  } else return { status: 'indeterminate', reason: `Grant ${expectation.targetKind} nao suportado.` }

  if (expectation.privileges.includes('all')) {
    return expectation.operation === 'revoke'
      ? { status: grants.length === 0 ? 'equivalent' : 'divergent', actualPrivileges: grants.map((item) => item.privilege_type) }
      : { status: 'indeterminate', reason: 'GRANT ALL exige conjunto de privilegios dependente do tipo de objeto.' }
  }

  const actual = new Set(grants.map((item) => item.privilege_type.toLowerCase()))
  const expectedPresent = expectation.privileges.every((privilege) => actual.has(privilege))
  return {
    status: expectation.operation === 'grant'
      ? (expectedPresent ? 'equivalent' : 'divergent')
      : (expectation.privileges.every((privilege) => !actual.has(privilege)) ? 'equivalent' : 'divergent'),
    actualPrivileges: [...actual].sort(),
  }
}

function routineSemantics(definition, catalog = null) {
  const normalized = normalizeSql(definition)
  const body = definition.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)([\s\S]*?)\1/i)?.[2] ?? ''
  const config = catalog?.config
    ? [...catalog.config].map((item) => normalizeSql(item)).sort()
    : [...definition.matchAll(/\bSET\s+([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*([^\n]+?)(?=\s+AS\s+\$|\s+AS\s+'|$)/gi)]
      .map((match) => normalizeSql(`${match[1]}=${match[2]}`)).sort()
  return {
    language: catalog?.language ?? normalized.match(/\blanguage\s+([a-z0-9_]+)/)?.[1] ?? null,
    volatility: catalog?.volatility ?? (normalized.includes(' immutable ') ? 'i' : normalized.includes(' stable ') ? 's' : 'v'),
    securityDefiner: catalog?.security_definer ?? /\bsecurity\s+definer\b/.test(normalized),
    config,
    bodySha256: sha256(normalizeSql(body)),
  }
}

function normalizeIndexDefinition(definition) {
  return normalizeDefinition(definition)
    .replace(/\busing btree\b/g, '')
    .replace(/\bcreate (unique )?index [a-z0-9_.]+ on /, 'create $1index on ')
    .replace(/\s+\(/g, '(')
    .replace(/where\((.*)\)$/g, 'where$1')
    .replace(/\)where\s*/g, ')where ')
    .replace(/\s+/g, ' ')
}

function normalizeDefinition(definition) {
  return normalizeSql(definition)
    .replace(/::[a-z0-9_.]+(?:\[\])?/g, '')
    .replace(/\bpublic\./g, '')
    .replace(/\s+/g, ' ')
}

function normalizeExpression(expression, table = '') {
  if (expression == null || expression === '') return null
  let value = normalizeDefinition(expression)
  if (table === 'storage.objects') value = value.replace(/\bstorage\.objects\./g, '')
  const tableName = table.split('.').at(-1)
  if (tableName) value = value.replace(new RegExp(`\\b${escapeRegExp(tableName)}\\.`, 'g'), '')
  value = value
    .replace(/\bas\s+[a-z_][a-z0-9_]*(?=[,)]|$)/g, '')
    .replace(/=any\(array\[([^\]]+)\]\)/g, 'in($1)')
  while (value.startsWith('(') && value.endsWith(')') && enclosesWholeExpression(value)) value = value.slice(1, -1)
  return value
}

function policyFingerprint(policy) {
  return JSON.stringify({
    command: policy.command,
    roles: policy.roles,
    usingExpression: policy.usingExpression ? removeWhitespaceOutsideSqlStrings(policy.usingExpression.replace(/[()]/g, '')) : null,
    checkExpression: policy.checkExpression ? removeWhitespaceOutsideSqlStrings(policy.checkExpression.replace(/[()]/g, '')) : null,
  })
}

function removeWhitespaceOutsideSqlStrings(value) {
  let output = ''
  let inString = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const next = value[index + 1]
    if (char === "'") {
      output += char
      if (inString && next === "'") {
        output += next
        index += 1
      } else inString = !inString
    } else if (!inString && /\s/.test(char)) continue
    else output += char
  }
  return output
}

function enclosesWholeExpression(value) {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')' && --depth === 0 && index !== value.length - 1) return false
  }
  return depth === 0
}

function normalizeType(type) {
  return String(type).toLowerCase().replace('character varying', 'varchar').replace('timestamp with time zone', 'timestamptz').trim()
}

function normalizeIdentity(identity) {
  return splitIdentityArguments(String(identity ?? ''))
    .map((argument) => {
      const normalized = argument.toLowerCase().replaceAll('public.', '').replace(/\s+/g, ' ').trim()
      const tokens = normalized.split(' ')
      if (['in', 'out', 'inout', 'variadic'].includes(tokens[0])) tokens.shift()
      if (tokens.length > 1 && /^[a-z_][a-z0-9_]*$/.test(tokens[0]) && !isTypePrefix(tokens[0], tokens[1])) tokens.shift()
      return tokens.join(' ')
    })
    .join(', ')
}

function splitIdentityArguments(value) {
  const result = []
  let current = ''
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) result.push(current.trim())
  return result
}

function isTypePrefix(first, second) {
  return ['double', 'character', 'timestamp', 'time', 'bit'].includes(first)
    && ['precision', 'varying', 'with', 'without'].includes(second)
}

function parsePgArray(value) {
  if (Array.isArray(value)) return value
  const text = String(value ?? '')
  if (!text.startsWith('{') || !text.endsWith('}')) return text ? [text] : []
  return text.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/g, '')).filter(Boolean)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPerf9dLocalDir(...segments) {
  const base = process.env.LOCALAPPDATA || tmpdir()
  const path = resolve(base, 'BWAntecipa', 'perf9d', ...segments)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

function writeRestrictedJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modo POSIX. */ }
}

async function gitValue(command) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const [subcommand, ...rest] = command.split(' ')
  const result = await run('git', [subcommand, ...rest], { cwd: process.cwd() })
  return result.stdout.trim()
}
