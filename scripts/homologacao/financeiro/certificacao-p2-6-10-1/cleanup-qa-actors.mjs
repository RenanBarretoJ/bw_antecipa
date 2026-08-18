#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import {
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  loadEnvFile,
  writeRestrictedJson,
} from '../../../perf9a/common.mjs'

const PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const PHASE = 'P2.6.10.1'
const ARTIFACT_PATH = resolve('docs/financeiro/qa-cleanup-p2-6-10-1.json')

loadEnvFile('.env.homolog')
const env = assertHomologEnvironment()
if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto bloqueado: ${env.projectRef}`)

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Credencial PostgreSQL direta de homologacao ausente.')
const parsedDatabaseUrl = new URL(databaseUrl)
if (!`${parsedDatabaseUrl.hostname} ${decodeURIComponent(parsedDatabaseUrl.username)}`.includes(PROJECT_REF)) {
  throw new Error('A conexao PostgreSQL nao aponta para homologacao autorizada.')
}

const credentialPath = resolve(getPerf9aLocalDir('p2-6-10-1'), `actors-${PROJECT_REF}.json`)
if (!existsSync(credentialPath)) throw new Error('Arquivo local dos atores QA nao encontrado.')
const credentialState = JSON.parse(readFileSync(credentialPath, 'utf8'))
const actors = Array.isArray(credentialState?.actors) ? credentialState.actors : []
if (actors.length === 0) throw new Error('Nenhum ator QA foi informado para cleanup.')

const admin = createAdminClient(env)
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

const results = []
try {
  const uuidColumns = await listUuidColumns(client)
  for (const actor of actors) results.push(await cleanupActor(client, admin, uuidColumns, actor))
} finally {
  await client.end()
}

const unresolved = results.filter((result) => result.final_classification === 'UNRESOLVED')
const artifact = {
  phase: PHASE,
  generated_at: new Date().toISOString(),
  environment: 'homolog',
  target_project_ref: PROJECT_REF,
  production_accessed: false,
  policy: {
    blind_cascade_used: false,
    audit_history_deleted: false,
    physical_deletion_requires_zero_non_identity_references: true,
    retained_actors_have_access_revoked: true,
  },
  actors: results,
  summary: {
    inventoried: results.length,
    safe_to_delete: results.filter((result) => result.final_classification === 'SAFE_TO_DELETE').length,
    retained_for_audit: results.filter((result) => result.final_classification === 'RETAINED_FOR_AUDIT').length,
    business_fixture_required: results.filter((result) => result.final_classification === 'BUSINESS_FIXTURE_REQUIRED').length,
    unresolved: unresolved.length,
    unresolved_qa_actors_gate: unresolved.length === 0 ? 'PASS' : 'FAIL',
  },
  local_credential_file_removed: false,
}

if (unresolved.length === 0) {
  const normalizedCredentialPath = credentialPath.toLowerCase()
  const expectedRoot = resolve(getPerf9aLocalDir('p2-6-10-1')).toLowerCase()
  if (!normalizedCredentialPath.startsWith(`${expectedRoot}\\`) || !normalizedCredentialPath.endsWith(`actors-${PROJECT_REF}.json`)) {
    throw new Error('Caminho do arquivo de credenciais QA nao passou pela validacao de seguranca.')
  }
  unlinkSync(credentialPath)
  artifact.local_credential_file_removed = true
}

writeRestrictedJson(ARTIFACT_PATH, artifact)
console.log(JSON.stringify({
  status: unresolved.length === 0 ? 'PASS' : 'FAIL',
  target_project_ref: PROJECT_REF,
  actors_inventoried: results.length,
  retained_for_audit: artifact.summary.retained_for_audit,
  safe_to_delete: artifact.summary.safe_to_delete,
  unresolved: unresolved.length,
  local_credential_file_removed: artifact.local_credential_file_removed,
}))

if (unresolved.length > 0) process.exitCode = 1

async function cleanupActor(db, authAdmin, uuidColumns, actor) {
  if (!isUuid(actor.id)) throw new Error(`Ator QA ${actor.key} possui UUID invalido.`)
  const references = await inventoryReferences(db, uuidColumns, actor.id)
  const nonIdentityReferences = references.filter((reference) => !isIdentityReference(reference))
  const auditReferences = nonIdentityReferences.filter(isAuditReference)
  const businessReferences = nonIdentityReferences.filter((reference) => !isAuditReference(reference))

  const result = {
    actor_key: actor.key,
    actor_id: actor.id,
    actor_role: actor.role,
    qa_classification: 'QA_EPHEMERAL',
    references,
    reference_summary: {
      identity: references.filter(isIdentityReference).reduce(sumReferences, 0),
      audit_history: auditReferences.reduce(sumReferences, 0),
      business_fixture: businessReferences.reduce(sumReferences, 0),
    },
    action: null,
    access_revoked: false,
    factors_removed: 0,
    final_classification: 'UNRESOLVED',
    verification: {},
  }

  try {
    if (nonIdentityReferences.length === 0) {
      await revokeMutableAccess(db, actor.id)
      result.factors_removed = await removeFactors(authAdmin, actor.id)
      const { error } = await authAdmin.auth.admin.deleteUser(actor.id)
      if (error) throw new Error(`Auth delete falhou: ${error.message}`)
      result.action = 'PHYSICALLY_DELETED'
      result.access_revoked = true
      result.final_classification = 'SAFE_TO_DELETE'
      result.verification = await verifyDeleted(db, authAdmin, actor.id)
    } else {
      await revokeMutableAccess(db, actor.id)
      result.factors_removed = await removeFactors(authAdmin, actor.id)
      const password = randomBytes(48).toString('base64url')
      const { error } = await authAdmin.auth.admin.updateUserById(actor.id, {
        password,
        ban_duration: '876000h',
        user_metadata: { qa_phase: PHASE, qa_access_revoked: true },
      })
      if (error) throw new Error(`Revogacao Auth falhou: ${error.message}`)
      result.action = 'RETAINED_AND_DISABLED'
      result.access_revoked = true
      result.final_classification = businessReferences.length > 0
        ? 'BUSINESS_FIXTURE_REQUIRED'
        : 'RETAINED_FOR_AUDIT'
      result.verification = await verifyDisabled(db, authAdmin, actor.id)
    }

    if (!Object.values(result.verification).every(Boolean)) {
      result.final_classification = 'UNRESOLVED'
      result.error = 'A verificacao final de revogacao/exclusao nao foi integralmente satisfeita.'
    }
  } catch (error) {
    result.final_classification = 'UNRESOLVED'
    result.error = error instanceof Error ? error.message : String(error)
  }

  return result
}

async function revokeMutableAccess(db, actorId) {
  await db.query('BEGIN')
  try {
    await db.query(`DELETE FROM public.usuario_fundos WHERE usuario_id = $1`, [actorId])
    await db.query(`
      UPDATE public.usuario_papeis
      SET ativo = false,
          revogado_em = COALESCE(revogado_em, now())
      WHERE usuario_id = $1
    `, [actorId])
    await db.query(`UPDATE public.profiles SET status = 'inativo' WHERE id = $1`, [actorId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function removeFactors(authAdmin, userId) {
  const { data, error } = await authAdmin.auth.admin.mfa.listFactors({ userId })
  if (error) throw new Error(`Falha ao listar fatores MFA: ${error.message}`)
  let removed = 0
  for (const factor of data?.factors || []) {
    const { error: deleteError } = await authAdmin.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
    if (deleteError) throw new Error(`Falha ao remover fator MFA: ${deleteError.message}`)
    removed += 1
  }
  return removed
}

async function verifyDisabled(db, authAdmin, userId) {
  const publicState = await db.query(`
    SELECT
      NOT EXISTS (SELECT 1 FROM public.usuario_fundos WHERE usuario_id = $1) AS no_fund_links,
      NOT EXISTS (SELECT 1 FROM public.usuario_papeis WHERE usuario_id = $1 AND ativo) AS no_active_roles,
      EXISTS (SELECT 1 FROM public.profiles WHERE id = $1 AND status::text = 'inativo') AS profile_inactive
  `, [userId])
  const { data: factors, error: factorError } = await authAdmin.auth.admin.mfa.listFactors({ userId })
  const { data: userData, error: userError } = await authAdmin.auth.admin.getUserById(userId)
  const bannedUntil = userData?.user?.banned_until ? Date.parse(userData.user.banned_until) : Number.NaN
  return {
    no_fund_links: publicState.rows[0]?.no_fund_links === true,
    no_active_roles: publicState.rows[0]?.no_active_roles === true,
    profile_inactive: publicState.rows[0]?.profile_inactive === true,
    no_mfa_factors: !factorError && (factors?.factors || []).length === 0,
    auth_user_banned: !userError && Number.isFinite(bannedUntil) && bannedUntil > Date.now(),
  }
}

async function verifyDeleted(db, authAdmin, userId) {
  const publicState = await db.query(`
    SELECT
      NOT EXISTS (SELECT 1 FROM public.usuario_fundos WHERE usuario_id = $1) AS no_fund_links,
      NOT EXISTS (SELECT 1 FROM public.usuario_papeis WHERE usuario_id = $1) AS no_roles,
      NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = $1) AS no_profile
  `, [userId])
  const { data: userData, error: userError } = await authAdmin.auth.admin.getUserById(userId)
  return {
    no_fund_links: publicState.rows[0]?.no_fund_links === true,
    no_roles: publicState.rows[0]?.no_roles === true,
    no_profile: publicState.rows[0]?.no_profile === true,
    no_auth_user: Boolean(userError) || !userData?.user,
  }
}

async function listUuidColumns(db) {
  const { rows } = await db.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND t.typname = 'uuid'
    ORDER BY n.nspname, c.relname, a.attname
  `)
  return rows
}

async function inventoryReferences(db, columns, actorId) {
  const references = []
  for (let offset = 0; offset < columns.length; offset += 100) {
    const batch = columns.slice(offset, offset + 100)
    const unions = batch.map((column, index) => `
      SELECT
        ${index}::integer AS column_index,
        count(*)::integer AS total
      FROM ${quoteIdentifier(column.schema_name)}.${quoteIdentifier(column.table_name)}
      WHERE ${quoteIdentifier(column.column_name)} = $1::uuid
    `).join('\nUNION ALL\n')
    const { rows } = await db.query(unions, [actorId])
    for (const row of rows) {
      const total = Number(row.total || 0)
      if (total === 0) continue
      const column = batch[Number(row.column_index)]
      references.push({ ...column, rows: total, classification: classifyReference(column) })
    }
  }
  return references
}

function classifyReference(reference) {
  if (isIdentityReference(reference)) return 'QA_EPHEMERAL'
  if (isAuditReference(reference)) return 'AUDIT_HISTORY_REQUIRED'
  return 'BUSINESS_FIXTURE_REQUIRED'
}

function isIdentityReference(reference) {
  return ['profiles', 'usuario_papeis', 'usuario_fundos'].includes(reference.table_name)
}

function isAuditReference(reference) {
  return /(auditoria|logs?|eventos?|historico|revis|execu|analises?|memorias?|concorrencia)/i.test(reference.table_name)
}

function sumReferences(total, reference) {
  return total + reference.rows
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
