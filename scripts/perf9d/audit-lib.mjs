import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

export const MIGRATION_CLASSIFICATIONS = Object.freeze([
  'registered_and_equivalent',
  'materially_fully_applied_without_history',
  'materially_partially_applied',
  'absent',
  'divergent',
  'indeterminate',
  'remote_object_without_identified_local_origin',
])

export const FORBIDDEN_AUDIT_ARGUMENTS = Object.freeze([
  'repair', 'apply', 'push', 'reset', 'write', 'execute', 'production', 'prod',
])

const MIGRATION_FILE_PATTERN = /^(\d{3}|\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function parseMigrationFilename(filename) {
  const match = basename(filename).match(MIGRATION_FILE_PATTERN)
  if (!match) return null
  return { version: match[1], name: match[2] }
}

export function stripSqlComments(sql) {
  let output = ''
  let index = 0
  let state = 'normal'
  let dollarTag = ''

  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]

    if (state === 'line-comment') {
      if (current === '\n') {
        output += ' '
        state = 'normal'
      }
      index += 1
      continue
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        output += ' '
        state = 'normal'
        index += 2
      } else index += 1
      continue
    }
    if (state === 'single-quote') {
      output += current
      if (current === "'" && next === "'") {
        output += next
        index += 2
      } else {
        if (current === "'") state = 'normal'
        index += 1
      }
      continue
    }
    if (state === 'double-quote') {
      output += current
      if (current === '"' && next === '"') {
        output += next
        index += 2
      } else {
        if (current === '"') state = 'normal'
        index += 1
      }
      continue
    }
    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag
        index += dollarTag.length
        state = 'normal'
      } else {
        output += current
        index += 1
      }
      continue
    }

    if (current === '-' && next === '-') {
      state = 'line-comment'
      index += 2
      continue
    }
    if (current === '/' && next === '*') {
      state = 'block-comment'
      index += 2
      continue
    }
    if (current === "'") state = 'single-quote'
    else if (current === '"') state = 'double-quote'
    else if (current === '$') {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
      if (tag) {
        dollarTag = tag
        state = 'dollar-quote'
        output += tag
        index += tag.length
        continue
      }
    }
    output += current
    index += 1
  }

  return output
}

export function splitSqlStatements(sql) {
  const source = stripSqlComments(sql)
  const statements = []
  let buffer = ''
  let state = 'normal'
  let dollarTag = ''

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    buffer += current

    if (state === 'single-quote') {
      if (current === "'" && next === "'") {
        buffer += next
        index += 1
      } else if (current === "'") state = 'normal'
      continue
    }
    if (state === 'double-quote') {
      if (current === '"' && next === '"') {
        buffer += next
        index += 1
      } else if (current === '"') state = 'normal'
      continue
    }
    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, index)) {
        buffer += source.slice(index + 1, index + dollarTag.length)
        index += dollarTag.length - 1
        state = 'normal'
      }
      continue
    }

    if (current === "'") state = 'single-quote'
    else if (current === '"') state = 'double-quote'
    else if (current === '$') {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
      if (tag) {
        dollarTag = tag
        state = 'dollar-quote'
        buffer += source.slice(index + 1, index + tag.length)
        index += tag.length - 1
      }
    } else if (current === ';') {
      const statement = buffer.slice(0, -1).trim()
      if (statement) statements.push(statement)
      buffer = ''
    }
  }

  if (buffer.trim()) statements.push(buffer.trim())
  return statements
}

export function normalizeSql(sql) {
  return stripSqlComments(String(sql))
    .replace(/\bif\s+not\s+exists\b/gi, '')
    .replace(/\bif\s+exists\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;=])\s*/g, '$1')
    .trim()
    .replace(/;+$/, '')
    .toLowerCase()
}

export function canonicalStatementHash(sqlOrStatements) {
  const statements = Array.isArray(sqlOrStatements)
    ? sqlOrStatements
    : splitSqlStatements(sqlOrStatements)
  const canonical = statements
    .map(normalizeSql)
    .filter((statement) => statement && !['begin', 'commit'].includes(statement))
    .join(';')
  return sha256(canonical)
}

function cleanIdentifier(identifier) {
  return identifier.replaceAll('"', '').trim().toLowerCase()
}

function qualifiedName(identifier, defaultSchema = 'public') {
  const parts = cleanIdentifier(identifier).split('.')
  return parts.length === 1
    ? { schema: defaultSchema, name: parts[0] }
    : { schema: parts.at(-2), name: parts.at(-1) }
}

function addExpectation(expectations, value) {
  expectations.push({
    persistent: true,
    comparable: false,
    operation: 'ensure',
    ...value,
  })
}

export function extractExpectations(sql) {
  const expectations = []
  const statements = splitSqlStatements(sql)

  for (const statement of statements) {
    const normalized = normalizeSql(statement)
    if (!normalized || ['begin', 'commit'].includes(normalized)) continue

    let match = statement.match(/^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i)
    if (match) {
      addExpectation(expectations, { kind: 'schema', ...qualifiedName(match[1], ''), comparable: true, definition: normalized })
      continue
    }

    match = statement.match(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i)
    if (match) {
      addExpectation(expectations, { kind: 'table', ...qualifiedName(match[1]), definition: normalized })
      continue
    }

    match = statement.match(/^\s*CREATE\s+TYPE\s+([^\s]+)\s+AS\s+ENUM/i)
    if (match) {
      addExpectation(expectations, { kind: 'enum', ...qualifiedName(match[1]), definition: normalized })
      continue
    }

    match = statement.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)\s*\(([^)]*)\)/i)
    if (match) {
      const name = qualifiedName(match[1])
      addExpectation(expectations, {
        kind: 'function',
        ...name,
        identityArguments: normalizeIdentityArguments(match[2]),
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)\s+ON\s+([^\s(]+)/i)
    if (match) {
      const table = qualifiedName(match[2])
      addExpectation(expectations, {
        kind: 'index',
        schema: table.schema,
        name: cleanIdentifier(match[1]),
        table: `${table.schema}.${table.name}`,
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([^\s]+)[\s\S]+?\sON\s+([^\s;]+)/i)
    if (match) {
      const table = qualifiedName(match[2])
      addExpectation(expectations, {
        kind: 'trigger',
        schema: table.schema,
        name: cleanIdentifier(match[1]),
        table: `${table.schema}.${table.name}`,
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*CREATE\s+POLICY\s+([^\s]+)\s+ON\s+([^\s;]+)/i)
    if (match) {
      const table = qualifiedName(match[2])
      const command = statement.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toLowerCase() ?? 'all'
      const rolesSql = statement.match(/\bTO\s+([\s\S]+?)(?=\s+USING\s*\(|\s+WITH\s+CHECK\s*\(|\s*;?$)/i)?.[1] ?? 'public'
      const usingExpression = extractBalancedClause(statement, /\bUSING\s*\(/i)
      const checkExpression = extractBalancedClause(statement, /\bWITH\s+CHECK\s*\(/i)
      addExpectation(expectations, {
        kind: 'policy',
        schema: table.schema,
        name: cleanIdentifier(match[1]),
        table: `${table.schema}.${table.name}`,
        command,
        roles: splitSqlList(rolesSql).map(cleanIdentifier).sort(),
        usingExpression: usingExpression ? normalizeSql(usingExpression) : null,
        checkExpression: checkExpression ? normalizeSql(checkExpression) : null,
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+ON\s+([^\s;]+)/i)
    if (match) {
      const table = qualifiedName(match[2])
      addExpectation(expectations, {
        kind: 'policy',
        schema: table.schema,
        name: cleanIdentifier(match[1]),
        table: `${table.schema}.${table.name}`,
        operation: 'drop',
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/i)
    if (match) {
      addExpectation(expectations, {
        kind: match[2].toUpperCase() === 'FORCE' ? 'rls_force' : 'rls_enabled',
        ...qualifiedName(match[1]),
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([^\s,;]+)\s+([^\s,;]+)/i)
    if (match && cleanIdentifier(match[2]) !== 'constraint') {
      const table = qualifiedName(match[1])
      addExpectation(expectations, {
        kind: 'column',
        schema: table.schema,
        table: table.name,
        name: cleanIdentifier(match[2]),
        expectedType: cleanIdentifier(match[3]),
        comparable: true,
        definition: normalized,
      })
      continue
    }

    match = statement.match(/^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+ADD\s+CONSTRAINT\s+([^\s]+)\s+([\s\S]+)/i)
    if (match) {
      const table = qualifiedName(match[1])
      addExpectation(expectations, {
        kind: 'constraint',
        schema: table.schema,
        table: table.name,
        name: cleanIdentifier(match[2]),
        comparable: true,
        definition: normalizeSql(match[3]),
      })
      continue
    }

    match = statement.match(/^\s*(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+(TABLE|FUNCTION|SCHEMA|SEQUENCE)\s+([\s\S]+?)\s+(?:TO|FROM)\s+([^\s;]+)/i)
    if (match) {
      const [, action, privileges, targetKind, targets, role] = match
      for (const target of splitSqlList(targets)) {
        addExpectation(expectations, {
          kind: 'grant',
          schema: targetKind.toLowerCase() === 'schema' ? cleanIdentifier(target) : qualifiedName(target).schema,
          name: cleanIdentifier(target),
          targetKind: targetKind.toLowerCase(),
          role: cleanIdentifier(role),
          privileges: cleanIdentifier(privileges).split(',').map((item) => item.trim()),
          operation: action.toLowerCase(),
          comparable: true,
          definition: normalized,
        })
      }
      continue
    }

    if (/^\s*NOTIFY\s+pgrst/i.test(statement)) {
      expectations.push({ kind: 'schema_cache_reload', persistent: false, comparable: false, operation: 'notify', definition: normalized })
      continue
    }

    if (/^\s*DO\s+\$/i.test(statement)) {
      const bodyHasMutation = /\b(create|alter|drop|insert|update|delete|grant|revoke)\b/i.test(statement)
      expectations.push({
        kind: bodyHasMutation ? 'dynamic_sql_block' : 'precondition_block',
        persistent: bodyHasMutation,
        comparable: false,
        operation: 'execute',
        definition: normalized,
      })
      continue
    }

    if (/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(statement)) {
      expectations.push({ kind: 'data_mutation', persistent: true, comparable: false, operation: 'execute', definition: normalized })
      continue
    }

    if (/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE)\b/i.test(statement)) {
      expectations.push({ kind: 'unparsed_ddl', persistent: true, comparable: false, operation: 'execute', definition: normalized })
    }
  }

  return collapseFinalObjectState(expectations)
}

function collapseFinalObjectState(expectations) {
  const finalStateKinds = new Set(['policy', 'function', 'index', 'trigger'])
  const lastIndexByKey = new Map()
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index]
    if (!finalStateKinds.has(expectation.kind) || !expectation.name) continue
    const key = `${expectation.kind}:${expectation.schema}:${expectation.table ?? ''}:${expectation.name}:${expectation.identityArguments ?? ''}`
    lastIndexByKey.set(key, index)
  }
  return expectations.filter((expectation, index) => {
    if (!finalStateKinds.has(expectation.kind) || !expectation.name) return true
    const key = `${expectation.kind}:${expectation.schema}:${expectation.table ?? ''}:${expectation.name}:${expectation.identityArguments ?? ''}`
    return lastIndexByKey.get(key) === index
  })
}

function normalizeIdentityArguments(argumentsSql) {
  if (!argumentsSql.trim()) return ''
  return splitSqlList(argumentsSql)
    .map((argument) => {
      const tokens = cleanIdentifier(argument).split(/\s+/)
      return tokens.length > 1 ? tokens.slice(1).join(' ') : tokens[0]
    })
    .join(', ')
}

function splitSqlList(value) {
  const result = []
  let current = ''
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      if (current.trim()) result.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) result.push(current.trim())
  return result
}

function extractBalancedClause(statement, pattern) {
  const match = pattern.exec(statement)
  if (!match) return null
  const openIndex = statement.indexOf('(', match.index)
  let depth = 0
  let state = 'normal'
  for (let index = openIndex; index < statement.length; index += 1) {
    const char = statement[index]
    const next = statement[index + 1]
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1
      else if (char === "'") state = 'normal'
      continue
    }
    if (char === "'") {
      state = 'single'
      continue
    }
    if (char === '(') depth += 1
    if (char === ')' && --depth === 0) return statement.slice(openIndex + 1, index)
  }
  return null
}

export function analyzeRisks(sql) {
  const normalized = normalizeSql(sql)
  const createWithoutGuard = splitSqlStatements(sql).some((statement) => (
    /^\s*create\s+(table|type|index|schema|policy|trigger)\b/i.test(statement)
    && !/\bif\s+not\s+exists\b/i.test(statement)
    && !/^\s*create\s+(or\s+replace\s+)?function\b/i.test(statement)
  ))

  return {
    destructiveDrop: /\bdrop\s+(table|schema|column|type)\b/i.test(normalized),
    nonTransactional: /\b(create\s+index\s+concurrently|drop\s+index\s+concurrently|vacuum|reindex\s+concurrently)\b/i.test(normalized),
    environmentDependent: /\b(current_setting|vault\.|supabase_url|database_url|http[s]?:\/\/|storage\.buckets)\b/i.test(normalized),
    unsafeRerun: createWithoutGuard,
    explicitTransaction: /^\s*begin\b/i.test(stripSqlComments(sql)) && /\bcommit\s*;?\s*$/i.test(stripSqlComments(sql).trim()),
    dynamicSql: /\bexecute\s+(format\s*\(|[^;]+)/i.test(normalized),
    manualAssumption: /\b(manual|assum|pre[- ]?condi|must exist|deve existir|aplicad[ao])\b/i.test(sql),
  }
}

export function inventoryMigrations(directory) {
  const root = resolve(directory)
  const filenames = readdirSync(root)
    .filter((filename) => filename.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'))

  const migrations = filenames.map((filename, order) => {
    const path = join(root, filename)
    const sql = readFileSync(path, 'utf8')
    const parsed = parseMigrationFilename(filename)
    const expectations = extractExpectations(sql)
    return {
      order: order + 1,
      version: parsed?.version ?? null,
      name: parsed?.name ?? null,
      filename,
      path: relative(process.cwd(), path).replaceAll('\\', '/'),
      sha256: sha256(sql),
      canonicalStatementSha256: canonicalStatementHash(sql),
      bytes: statSync(path).size,
      statements: splitSqlStatements(sql).length,
      expectations,
      dependencies: extractDependencies(sql),
      risks: analyzeRisks(sql),
    }
  })

  const versionCounts = new Map()
  for (const migration of migrations) {
    if (!migration.version) continue
    versionCounts.set(migration.version, (versionCounts.get(migration.version) ?? 0) + 1)
  }

  return {
    generatedAt: new Date().toISOString(),
    root,
    count: migrations.length,
    duplicateVersions: [...versionCounts.entries()].filter(([, count]) => count > 1).map(([version]) => version),
    invalidFilenames: migrations.filter((migration) => !migration.version).map((migration) => migration.filename),
    canonicalOrder: migrations.map((migration) => migration.version ?? migration.filename),
    migrations,
  }
}

export function extractDependencies(sql) {
  const dependencies = new Set()
  const patterns = [
    /\bREFERENCES\s+([A-Za-z0-9_".]+)/gi,
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([A-Za-z0-9_".]+)/gi,
    /\bALTER\s+TABLE\s+(?:ONLY\s+)?([A-Za-z0-9_".]+)/gi,
    /\bON\s+(?:TABLE\s+)?([A-Za-z0-9_".]+)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of stripSqlComments(sql).matchAll(pattern)) {
      const name = cleanIdentifier(match[1])
      if (!['select', 'conflict', 'delete', 'update'].includes(name)) dependencies.add(name)
    }
  }
  return [...dependencies].sort()
}

export function extractDeclaredObjectKeys(sql) {
  const source = stripSqlComments(sql)
  const keys = new Set()

  const addQualified = (kind, identifier, defaultSchema = 'public') => {
    const object = qualifiedName(identifier, defaultSchema)
    if (object.schema && object.name) keys.add(`${kind}:${object.schema}.${object.name}`)
  }

  for (const match of source.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_".]+)/gi)) {
    addQualified('table', match[1])
  }
  for (const match of source.matchAll(/\bCREATE\s+TYPE\s+([A-Za-z0-9_".]+)\s+AS\s+ENUM/gi)) {
    addQualified('enum', match[1])
  }
  for (const match of source.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_".]+)\s*\(/gi)) {
    addQualified('function', match[1])
  }
  for (const match of source.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_".]+)\s+ON\s+([A-Za-z0-9_".]+)/gi)) {
    const table = qualifiedName(match[2])
    addQualified('index', match[1], table.schema)
  }
  for (const match of source.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([A-Za-z0-9_".]+)[\s\S]+?\sON\s+([A-Za-z0-9_".]+)/gi)) {
    const table = qualifiedName(match[2])
    addQualified('trigger', match[1], table.schema)
  }
  for (const match of source.matchAll(/\bCREATE\s+POLICY\s+([A-Za-z0-9_".]+)\s+ON\s+([A-Za-z0-9_".]+)/gi)) {
    const table = qualifiedName(match[2])
    addQualified('policy', match[1], table.schema)
  }

  return [...keys].sort()
}

export function buildMigrationDependencyGraph(inventory) {
  const ownerByObject = new Map()
  const orderByVersion = new Map(inventory.migrations.map((migration) => [migration.version, migration.order]))

  for (const migration of inventory.migrations) {
    const declared = extractDeclaredObjectKeys(readFileSync(resolve(migration.path), 'utf8'))
    for (const key of declared) {
      if (!ownerByObject.has(key)) ownerByObject.set(key, migration.version)
    }
  }

  const edges = []
  const forwardReferences = []
  const externalDependencies = []
  const unresolvedDependencies = []
  const seen = new Set()

  for (const migration of inventory.migrations) {
    for (const dependency of migration.dependencies) {
      const normalized = dependency.includes('.') ? dependency : `public.${dependency}`
      if (/^(auth|storage|pg_catalog|information_schema|extensions)\./.test(normalized)) {
        externalDependencies.push({ migration: migration.version, object: normalized })
        continue
      }

      const owner = ownerByObject.get(`table:${normalized}`)
      if (!owner) {
        unresolvedDependencies.push({ migration: migration.version, object: normalized })
        continue
      }
      if (owner === migration.version) continue

      const key = `${owner}->${migration.version}:${normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      const edge = { from: owner, to: migration.version, object: normalized }
      edges.push(edge)
      if ((orderByVersion.get(owner) ?? 0) > migration.order) forwardReferences.push(edge)
    }
  }

  return {
    canonicalOrder: inventory.canonicalOrder,
    edges,
    forwardReferences,
    externalDependencies: uniqueDependencyRows(externalDependencies),
    unresolvedDependencies: uniqueDependencyRows(unresolvedDependencies),
  }
}

export function findRemoteObjectsWithoutLocalOrigin(inventory, remote) {
  const localKeys = new Set()
  for (const migration of inventory.migrations) {
    for (const expectation of migration.expectations) {
      if (!expectation.name || !expectation.schema) continue
      localKeys.add(`${expectation.kind}:${expectation.schema}.${expectation.name}`)
    }
    const sql = readFileSync(resolve(migration.path), 'utf8')
    for (const key of extractDeclaredObjectKeys(sql)) localKeys.add(key)
  }

  const constraintBackedIndexes = new Set(remote.constraints
    .filter((item) => ['p', 'u', 'x'].includes(item.contype))
    .map((item) => `${item.schema_name}.${item.constraint_name}`))

  const candidates = [
    ...remote.relations.filter((item) => item.schema_name !== 'storage').map((item) => ({ kind: 'table', schema: item.schema_name, name: item.relation_name })),
    ...remote.enums.filter((item) => item.schema_name !== 'storage').map((item) => ({ kind: 'enum', schema: item.schema_name, name: item.type_name })),
    ...remote.indexes
      .filter((item) => item.schema_name !== 'storage' && !constraintBackedIndexes.has(`${item.schema_name}.${item.index_name}`))
      .map((item) => ({ kind: 'index', schema: item.schema_name, name: item.index_name })),
    ...remote.routines.filter((item) => item.schema_name !== 'storage').map((item) => ({ kind: 'function', schema: item.schema_name, name: item.routine_name, identityArguments: item.identity_arguments })),
    ...remote.triggers.filter((item) => item.schema_name !== 'storage').map((item) => ({ kind: 'trigger', schema: item.schema_name, name: item.trigger_name, table: item.table_name })),
    ...remote.policies.filter((item) => item.schema_name !== 'storage').map((item) => ({ kind: 'policy', schema: item.schema_name, name: item.policy_name, table: item.table_name })),
  ]

  return candidates.filter((item) => !localKeys.has(`${item.kind}:${item.schema}.${item.name}`))
}

function uniqueDependencyRows(rows) {
  const seen = new Set()
  return rows.filter((row) => {
    const key = `${row.migration}:${row.object}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function assertSafeAuditTarget({ appEnv, projectRef, expectedProjectRef, readOnly }) {
  if (!['homolog', 'homologacao'].includes(String(appEnv).toLowerCase())) {
    throw new Error('Auditoria 9D bloqueada: ambiente precisa ser homologacao.')
  }
  if (!expectedProjectRef || projectRef !== expectedProjectRef) {
    throw new Error('Auditoria 9D bloqueada: project ref diferente do homolog autorizado.')
  }
  if (readOnly !== true) {
    throw new Error('Auditoria 9D bloqueada: conexao precisa estar em transacao read-only.')
  }
  return true
}

export function assertReadOnlyAuditArguments(parsed) {
  const forbiddenSet = new Set(FORBIDDEN_AUDIT_ARGUMENTS)
  const forbidden = Object.keys(parsed).find((key) => forbiddenSet.has(key.toLowerCase()))
  if (forbidden) throw new Error(`Argumento proibido em auditoria read-only: --${forbidden}.`)
  return true
}

export function redactSensitiveText(value) {
  return String(value)
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1***@')
    .replace(/((?:service[_-]?role|password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1***')
}

export function classifyEvidence({ historyEquivalent, historyPresent, evidenceStatuses }) {
  if (historyPresent) return historyEquivalent ? 'registered_and_equivalent' : 'divergent'

  const statuses = evidenceStatuses.filter(Boolean)
  if (statuses.length === 0 || statuses.includes('indeterminate')) return 'indeterminate'
  if (statuses.every((status) => status === 'absent')) return 'absent'
  if (statuses.every((status) => status === 'equivalent')) return 'materially_fully_applied_without_history'
  if (statuses.includes('divergent')) return statuses.every((status) => status === 'divergent') ? 'divergent' : 'materially_partially_applied'
  if (statuses.includes('equivalent') && statuses.includes('absent')) return 'materially_partially_applied'
  return 'indeterminate'
}
