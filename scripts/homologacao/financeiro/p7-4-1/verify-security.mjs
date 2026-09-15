#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

const MIGRATION_PATH = resolve('supabase/migrations/20260915175435_p7_4_1_rls_importacoes_financeiras_gestor.sql')
const POLICY_NAME = 'importacoes_gestor_fundo_select'
const args = parseArgs()
const mode = String(args.mode || 'verify')

if (!['rehearsal', 'verify'].includes(mode)) {
  throw new Error('Modo invalido. Use --mode rehearsal ou --mode verify.')
}

loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, `p741_${mode}`)
const failures = []
let checks = 0

function check(condition, label, details) {
  checks += 1
  if (!condition) failures.push({ label, details })
}

async function actor(userId, databaseRole = 'authenticated') {
  await db.query('RESET ROLE')
  const claims = { sub: userId, role: databaseRole, aal: 'aal2', session_id: randomUUID() }
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role',$1,true)`, [databaseRole])
  if (databaseRole === 'authenticated') await db.query('SET LOCAL ROLE authenticated')
  else await db.query('SET LOCAL ROLE anon')
}

async function visible(fundId) {
  const result = await db.query(
    `SELECT count(*)::integer AS total
       FROM public.importacoes_financeiras
      WHERE fundo_id = $1`,
    [fundId],
  )
  return result.rows[0].total
}

async function mustDeny(label, operation) {
  await db.query('SAVEPOINT p741_denied')
  try {
    await operation()
    check(false, label, 'comando foi aceito')
  } catch (error) {
    check(error?.code === '42501', label, { code: error?.code })
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT p741_denied')
    await db.query('RELEASE SAVEPOINT p741_denied')
  }
}

function migrationWithoutTransaction() {
  return readFileSync(MIGRATION_PATH, 'utf8')
    .replace(/^BEGIN;\s*$/m, '')
    .replace(/^COMMIT;\s*$/m, '')
}

async function loadFixtures() {
  const gestor = await db.query(`
    SELECT p.id AS user_id, uf.fundo_id
    FROM public.profiles p
    JOIN public.usuario_fundos uf
      ON uf.usuario_id = p.id
     AND uf.status = 'ativo'
    JOIN public.fundos f
      ON f.id = uf.fundo_id
     AND f.ativo
    WHERE p.status::text = 'ativo'
      AND (
        p.role::text = 'gestor'
        OR EXISTS (
          SELECT 1 FROM public.usuario_papeis up
          WHERE up.usuario_id = p.id
            AND up.papel::text = 'gestor'
            AND up.ativo
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.importacoes_financeiras i
        WHERE i.fundo_id = uf.fundo_id
      )
      AND EXISTS (
        SELECT 1 FROM public.importacoes_financeiras other_import
        WHERE other_import.fundo_id <> uf.fundo_id
          AND NOT EXISTS (
            SELECT 1 FROM public.usuario_fundos other_link
            WHERE other_link.usuario_id = p.id
              AND other_link.fundo_id = other_import.fundo_id
              AND other_link.status = 'ativo'
          )
      )
    ORDER BY p.id, uf.fundo_id
    LIMIT 1
  `)

  const gestorRow = gestor.rows[0]
  if (!gestorRow) throw new Error('Massa de homologacao sem Gestor/fundos adequada ao teste multifundo.')

  const crossFund = await db.query(`
    SELECT i.fundo_id
    FROM public.importacoes_financeiras i
    WHERE i.fundo_id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM public.usuario_fundos uf
        WHERE uf.usuario_id = $2
          AND uf.fundo_id = i.fundo_id
          AND uf.status = 'ativo'
      )
    GROUP BY i.fundo_id
    ORDER BY i.fundo_id
    LIMIT 1
  `, [gestorRow.fundo_id, gestorRow.user_id])

  const identities = await db.query(`
    SELECT
      (
        SELECT p.id FROM public.profiles p
        WHERE p.status::text = 'ativo'
          AND (
            p.role::text = 'super_admin'
            OR EXISTS (
              SELECT 1 FROM public.usuario_papeis up
              WHERE up.usuario_id = p.id
                AND up.papel::text = 'super_admin'
                AND up.ativo
            )
          )
        ORDER BY p.id LIMIT 1
      ) AS super_admin,
      (SELECT p.id FROM public.profiles p WHERE p.status::text = 'ativo' AND p.role::text = 'cedente' ORDER BY p.id LIMIT 1) AS cedente,
      (SELECT p.id FROM public.profiles p WHERE p.status::text = 'ativo' AND p.role::text = 'consultor' ORDER BY p.id LIMIT 1) AS consultor,
      (SELECT p.id FROM public.profiles p WHERE p.status::text = 'ativo' AND p.role::text = 'sacado' ORDER BY p.id LIMIT 1) AS sacado
  `)

  const ids = identities.rows[0]
  if (!crossFund.rows[0]) throw new Error('Massa de homologacao sem fundo adversarial para o Gestor selecionado.')
  if (!ids.super_admin) throw new Error('Massa de homologacao sem Super Admin para preservar a policy existente.')

  for (const role of ['cedente', 'consultor', 'sacado']) {
    if (!ids[role]) ids[role] = await createTransactionalProfile(role)
  }

  return {
    gestor: gestorRow.user_id,
    ownFund: gestorRow.fundo_id,
    crossFund: crossFund.rows[0].fundo_id,
    ...ids,
  }
}

async function createTransactionalProfile(role) {
  const id = randomUUID()
  const email = `p741-${role}-${id}@example.invalid`
  await db.query(`
    INSERT INTO auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      $1, 'authenticated', 'authenticated', $2, clock_timestamp(),
      '{}'::jsonb, $3::jsonb, clock_timestamp(), clock_timestamp()
    )
  `, [id, email, JSON.stringify({ role, nome_completo: `P7.4.1 ${role}` })])

  const profile = await db.query('SELECT id FROM public.profiles WHERE id=$1 AND role::text=$2', [id, role])
  if (profile.rowCount !== 1) throw new Error(`Nao foi possivel criar perfil transacional ${role}.`)
  return id
}

async function runCycle(label, applyMigration) {
  await db.query('BEGIN')
  try {
    if (applyMigration) await db.query(migrationWithoutTransaction())

    const fixtures = await loadFixtures()
    const totals = await db.query(`
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE fundo_id = $1)::integer AS own_total,
        count(*) FILTER (WHERE fundo_id = $2)::integer AS cross_total
      FROM public.importacoes_financeiras
    `, [fixtures.ownFund, fixtures.crossFund])
    check(totals.rows[0].own_total > 0, `${label}: fundo autorizado possui importacoes`)
    check(totals.rows[0].cross_total > 0, `${label}: fundo adversarial possui importacoes`)

    await actor(fixtures.gestor)
    check(await visible(fixtures.ownFund) === totals.rows[0].own_total, `${label}: Gestor autorizado le o proprio fundo`)
    check(await visible(fixtures.crossFund) === 0, `${label}: Gestor nao le fundo sem vinculo`)

    await actor(fixtures.super_admin)
    const superAdminRows = await db.query('SELECT count(*)::integer AS total FROM public.importacoes_financeiras')
    check(superAdminRows.rows[0].total === totals.rows[0].total, `${label}: Super Admin preserva leitura integral`)

    for (const [profileLabel, userId] of [
      ['Cedente', fixtures.cedente],
      ['Consultor', fixtures.consultor],
      ['Sacado', fixtures.sacado],
    ]) {
      await actor(userId)
      const result = await db.query('SELECT count(*)::integer AS total FROM public.importacoes_financeiras')
      check(result.rows[0].total === 0, `${label}: ${profileLabel} permanece sem leitura`)
    }

    await actor('00000000-0000-0000-0000-000000000000', 'anon')
    await mustDeny(`${label}: anon permanece sem leitura`, () => db.query('SELECT count(*) FROM public.importacoes_financeiras'))

    await actor(fixtures.gestor)
    await mustDeny(`${label}: Gestor nao recebe INSERT`, () => db.query('INSERT INTO public.importacoes_financeiras DEFAULT VALUES'))
    await mustDeny(`${label}: Gestor nao recebe UPDATE`, () => db.query(
      'UPDATE public.importacoes_financeiras SET fundo_id=fundo_id WHERE fundo_id=$1',
      [fixtures.ownFund],
    ))
    await mustDeny(`${label}: Gestor nao recebe DELETE`, () => db.query(
      'DELETE FROM public.importacoes_financeiras WHERE fundo_id=$1',
      [fixtures.ownFund],
    ))

    await db.query('RESET ROLE')
    const policy = await db.query(`
      SELECT cmd, roles, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'importacoes_financeiras'
        AND policyname = $1
    `, [POLICY_NAME])
    check(policy.rowCount === 1, `${label}: policy foi criada uma unica vez`, policy.rows)
    check(policy.rows[0]?.cmd === 'SELECT', `${label}: policy permanece somente SELECT`, policy.rows)
    check(
      policy.rows[0]?.qual === 'private.financeiro_gestor_tem_acesso_fundo(fundo_id)',
      `${label}: policy usa helper canonico`,
      policy.rows,
    )
  } finally {
    await db.query('RESET ROLE').catch(() => undefined)
    await db.query('ROLLBACK')
  }
}

try {
  console.log(`\nBW Antecipa - P7.4.1 RLS (${mode})`)
  console.log(`Projeto homolog: ${env.projectRef}`)

  if (mode === 'rehearsal') {
    await runCycle('ciclo 1', true)
    await runCycle('ciclo 2', true)
  } else {
    await runCycle('homologacao', false)
  }

  if (failures.length) {
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    throw new Error(`${failures.length} verificacao(oes) RLS falharam.`)
  }

  console.log(`P7.4.1 RLS aprovado: ${checks} verificacoes; nenhuma mutacao persistida.`)
} catch (error) {
  console.error(`P7.4.1 RLS falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
