// Read-only repository/catalog inventory. No network, DB connection or environment loading.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'

export function sqlProducers(sql) {
  const functions = []
  const pattern = /CREATE (?:OR REPLACE )?FUNCTION ([\s\S]*?)\s+AS (\$[a-zA-Z_]*\$)([\s\S]*?)\2;/gi
  for (const match of sql.matchAll(pattern)) {
    const body = match[3]
    const writes = [...body.matchAll(/insert\s+into\s+(?:"?public"?\.)?"?notificacoes"?\s*\(/gi)].length
    const delegates = [...body.matchAll(/(?:private\.)?(?:notificar_cedente_ativos|criar_notificacao_fundo|notificar_gestores_fundo|notificar_cedente_fundo|notificar_gestores_cadastro_cedente|notificar_entidade|notificar_cedente_cadastro|notificar_seguranca_global)\s*\(/gi)].length
    if (writes || delegates) functions.push({
      signature: match[1].trim().split('\n')[0],
      line: sql.slice(0, match.index).split('\n').length,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      directInserts: writes,
      delegatedCalls: delegates,
      globalGestorBroadcasts: [...body.matchAll(/FROM\s+public\.profiles\s+\w+\s+WHERE\s+\w+\.role\s*=\s*'gestor'/gi)].length,
    })
  }
  return functions
}

function enclosingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  }
  return '<module>'
}

export function applicationProducers(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const calls = []
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast)
      const delegated = /^(criarNotificacao|notificarCedente|notificarGestores|notificarGestoresCron|notificarSacadosVinculados|notificarGestoresCadastro|notificarCedenteCadastro|notificarEntidade)$/.test(callee)
      const rpcName = node.arguments[0]
      const rpc = /\.rpc$/.test(callee) && rpcName && ts.isStringLiteral(rpcName)
        && /^(notificar_gestores_cadastro_cedente|notificar_entidade|notificar_cedente_cadastro|notificar_seguranca_global)$/.test(rpcName.text)
      const direct = /\.from\(['"]notificacoes['"]\)[\s\S]*\.(?:insert|upsert)$/.test(callee)
      if (direct || delegated || rpc) calls.push({
        path,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        function: enclosingFunction(node),
        kind: direct ? 'direct-write' : rpc ? 'rpc' : 'delegated',
        helper: delegated ? callee : rpc ? rpcName.text : null,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return calls
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

function main() {
  const schemaPath = process.argv[2]
  if (!schemaPath || process.argv.length !== 3) throw new Error('Usage: node scripts/qa/notificacoes/inventory.mjs <local-schema-only.sql>')
  const schema = readFileSync(schemaPath, 'utf8')
  if (/^COPY\s|^INSERT INTO\s|^SELECT pg_catalog.setval/m.test(schema)) throw new Error('DATA_DUMP_REFUSED')
  const sql = sqlProducers(schema)
  const sourceFiles = files('src').filter(p => /\.tsx?$/.test(p) && !/\.(test|spec)\./.test(p))
  const application = sourceFiles.flatMap(p => applicationProducers(readFileSync(p, 'utf8'), p.replaceAll('\\', '/')))
  const historicalMigrations = files('supabase/migrations').filter(p => /\.sql$/.test(p)).flatMap(path => {
    const text = readFileSync(path, 'utf8')
    return /insert\s+into\s+(?:"?public"?\.)?"?notificacoes"?\s*\(/i.test(text)
      ? [relative(process.cwd(), resolve(path)).replaceAll('\\', '/')] : []
  })
  const report = {
    generatedAt: new Date().toISOString(),
    evidence: 'Local schema snapshot, not a live production catalog. Revalidate on the isolated baseline.',
    schemaSha256: createHash('sha256').update(schema).digest('hex'),
    sqlProducerSignatures: sql.length,
    sqlGlobalGestorBroadcasts: sql.reduce((sum, f) => sum + f.globalGestorBroadcasts, 0),
    applicationProducerFunctions: new Set(application.map(p => `${p.path}:${p.function}`)).size,
    applicationCallSites: application.length,
    applicationDirectWrites: application.filter(p => p.kind === 'direct-write').length,
    historicalMigrations, sql, application,
  }
  mkdirSync('rehearsal/reports', { recursive: true })
  writeFileSync('rehearsal/reports/NOTIFICACOES_R1_INVENTORY.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, sql: undefined, application: undefined, historicalMigrations: report.historicalMigrations.length }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
