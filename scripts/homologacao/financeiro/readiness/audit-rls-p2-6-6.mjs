#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const { Client } = pg
const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const OUTPUT = resolve('docs/financeiro/rls-global-gestor-audit-p2-6-6.json')

const FUND_OWNED_TABLES = new Set([
  'aquisicoes', 'aquisicoes_atuais', 'canhotos', 'carteira_atual', 'cedente_fundo_politicas',
  'conciliacao_resultados', 'configuracoes_cnab', 'configuracao_cnab_versoes', 'cte_notas_fiscais',
  'ctes', 'documento_analises', 'documento_requisito_instancias', 'documento_versoes',
  'documento_vinculos', 'documentos_gerados', 'documentos_repositorio', 'estoque_atual',
  'eventos_entrega', 'exposicao_execucoes', 'integracoes_fundo', 'integracao_fundo_versoes',
  'liquidacoes_atuais', 'matching_resultados', 'nota_fiscal_entregas', 'notas_fiscais',
  'operacoes', 'politica_operacional_versoes', 'politica_requisitos_documentais',
  'politicas_operacionais', 'posicao_logistica_execucoes', 'posicao_logistica_resultados',
  'remessas_cnab', 'remessas_cnab_operacoes', 'risco_execucoes', 'sequencias_remessa',
  'templates_documentos', 'template_versoes', 'usuario_fundos',
])

const FUND_SCOPE_PATTERN = /(gestor_tem_acesso_fundo_operacional|usuario_tem_acesso_fundo|financeiro_gestor_tem_acesso_fundo|rlx_gestor_tem_acesso_fundo|gestor_tem_acesso_(contexto_documental|documento|requisito_documental|entrega|cte_contexto|cte_nota)|usuario_fundos|logistica_usuario_pode_ler_entrega|usuario_pode_ler_documento_gerado|usuario_pode_ler_remessa_cnab)/i
const GLOBAL_GESTOR_PATTERN = /(get_user_role\s*\([^)]*\)[^\n]*(gestor)|profiles?[^\n]*(role|papel)[^\n]*gestor|role[^\n]*gestor|gestor[^\n]*role)/i

if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
const dbUrl = loadHomologDbUrl()
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, application_name: 'bw_p2_6_6_rls_audit' })

await client.connect()
try {
  const policies = await client.query(`
    select schemaname as schema, tablename as table_name, policyname as policy,
           cmd as command, roles, coalesce(qual, '') as using_definition,
           coalesce(with_check, '') as check_definition
      from pg_policies
     where schemaname in ('public', 'storage')
       and (policyname ilike '%gestor%'
         or coalesce(qual, '') ilike '%gestor%'
         or coalesce(with_check, '') ilike '%gestor%'
         or array_to_string(roles, ',') ilike '%gestor%')
     order by schemaname, tablename, policyname
  `)

  const functions = await client.query(`
    select n.nspname as schema, p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments,
           pg_get_functiondef(p.oid) as definition
     from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind in ('f', 'p')
       and pg_get_functiondef(p.oid) ilike '%gestor%'
     order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  `)

  const policyInventory = policies.rows.map((row) => {
    const definition = [row.using_definition, row.check_definition].filter(Boolean).join('\n')
    const fundOwned = FUND_OWNED_TABLES.has(row.table_name) || row.schema === 'storage'
    const hasFundScope = FUND_SCOPE_PATTERN.test(definition)
    return {
      schema: row.schema,
      table: row.table_name,
      policy: row.policy,
      command: row.command,
      roles: row.roles,
      definition,
      uses_global_gestor: GLOBAL_GESTOR_PATTERN.test(definition) || /gestor/i.test(row.policy),
      has_fund_scope: hasFundScope,
      classification: fundOwned
        ? (hasFundScope ? 'MULTIFUNDO_CORRETO' : 'MULTIFUNDO_VULNERAVEL')
        : 'GLOBAL_LEGITIMO',
    }
  })

  const helperInventory = functions.rows.map((row) => {
    const hasFundScope = FUND_SCOPE_PATTERN.test(row.definition)
    return {
      schema: row.schema,
      table: null,
      policy: `${row.function_name}(${row.arguments})`,
      command: 'FUNCTION',
      definition: row.definition,
      uses_global_gestor: GLOBAL_GESTOR_PATTERN.test(row.definition) || /gestor/i.test(row.function_name),
      has_fund_scope: hasFundScope,
      classification: 'HELPER_INTERNO',
    }
  })

  const inventory = [...policyInventory, ...helperInventory]
  const classifications = inventory.reduce((acc, item) => {
    acc[item.classification] = (acc[item.classification] || 0) + 1
    return acc
  }, {})
  const vulnerable = classifications.MULTIFUNDO_VULNERAVEL || 0
  const unresolved = classifications.UNRESOLVED || 0
  const result = {
    schema: 'bw-antecipa-rls-global-gestor-audit-p2-6-6-v1',
    generated_at: new Date().toISOString(),
    environment: 'homolog',
    project_ref: HOMOLOG_REF,
    production_touched: false,
    status: vulnerable === 0 && unresolved === 0 ? 'PASS' : 'FAIL',
    summary: {
      occurrences: inventory.length,
      policies: policyInventory.length,
      helpers: helperInventory.length,
      classifications,
      multifundo_vulneravel: vulnerable,
      unresolved,
    },
    inventory,
  }
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: result.status, summary: result.summary, output: OUTPUT }, null, 2))
  if (result.status !== 'PASS') process.exitCode = 1
} finally {
  await client.end()
}

function loadHomologDbUrl() {
  const env = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = env.get('SUPABASE_DB_URL') || env.get('DATABASE_URL')
  if (!value) throw new Error('URL de homologacao ausente.')
  const ref = value.match(/^postgres(?:ql)?:\/\/postgres[.]([a-z0-9]+):.*@/i)?.[1]
    || value.match(/^postgres(?:ql)?:\/\/[^@]+@db[.]([a-z0-9]+)[.]supabase[.]co/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('Projeto remoto diferente da homologacao autorizada.')
  if (env.get('SUPABASE_PRODUCTION_PROJECT_REF') === ref) throw new Error('Projeto de producao bloqueado.')
  return value
}
