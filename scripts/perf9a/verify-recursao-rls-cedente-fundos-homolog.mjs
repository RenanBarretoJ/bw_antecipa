#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { assertHomologEnvironment, loadEnvFile, parseArgs, printEnvironmentSummary } from './common.mjs'

const args = parseArgs()
loadEnvFile(args['env-file'])

try {
  await main()
} catch (error) {
  console.error(`\nValidacao RLS falhou: ${safeError(error)}\n`)
  process.exitCode = 1
}

async function main() {
  const env = assertHomologEnvironment()
  const databaseUrl = process.env.SUPABASE_DB_URL
  if (!databaseUrl) throw new Error('SUPABASE_DB_URL ausente.')

  console.log('\nBW Antecipa - validacao transacional da recursao RLS')
  printEnvironmentSummary(env)

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  const cases = []

  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(loadMigrationBody())
    const fixtures = await loadFixtures(client)

    await runSuccess(cases, client, 'gestor vinculado cria vinculo em seu fundo', 'authenticated', fixtures.gestorA, async () => {
      const result = await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      assert(result.rowCount === 1, 'o INSERT autorizado nao retornou uma linha')
    })

    await runSuccess(cases, client, 'gestor multifundo cria vinculo para cedente ja vinculado a outro fundo', 'authenticated', fixtures.gestorMulti, async () => {
      const result = await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      assert(result.rowCount === 1, 'o gestor multifundo nao criou o vinculo adicional')
    })

    await runDenied(cases, client, 'gestor de B nao cria vinculo em A', 'authenticated', fixtures.gestorB, '42501', () =>
      insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
    )

    await runDenied(cases, client, 'usuario sem vinculo nao cria cedente_fundos', 'authenticated', crypto.randomUUID(), '42501', () =>
      insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
    )

    await runDenied(cases, client, 'cedente nao cria o proprio vinculo', 'authenticated', fixtures.usuarioCedenteB, '42501', () =>
      insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
    )

    await runDenied(cases, client, 'consultor nao cria vinculo', 'authenticated', fixtures.consultorA, '42501', () =>
      insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
    )

    await runDenied(cases, client, 'anonimo nao cria vinculo', 'anon', null, '42501', () =>
      insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
    )

    await runDenied(
      cases,
      client,
      'perfil inativo nao administra fundo',
      'authenticated',
      fixtures.gestorA,
      '42501',
      () => insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
      () => client.query(`UPDATE public.profiles SET status = 'inativo' WHERE id = $1`, [fixtures.gestorA]),
    )

    await runDenied(
      cases,
      client,
      'fundo inativo nao recebe novo vinculo',
      'authenticated',
      fixtures.gestorA,
      '42501',
      () => insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA),
      () => client.query(`UPDATE public.fundos SET ativo = false WHERE id = $1`, [fixtures.fundoA]),
    )

    await runDenied(cases, client, 'cedente inexistente preserva integridade referencial', 'authenticated', fixtures.gestorA, '23503', () =>
      insertLink(client, crypto.randomUUID(), fixtures.fundoA),
    )

    await runDenied(cases, client, 'duplicidade do mesmo par permanece bloqueada', 'authenticated', fixtures.gestorA, '23505', async () => {
      await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      return insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
    })

    await runSuccess(cases, client, 'gestor atualiza vinculo de seu fundo', 'authenticated', fixtures.gestorA, async () => {
      const link = await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      const updated = await client.query(
        `UPDATE public.cedente_fundos SET status = 'suspenso' WHERE id = $1 RETURNING id`,
        [link.rows[0].id],
      )
      assert(updated.rowCount === 1, 'o UPDATE autorizado nao alterou a linha')
    })

    await runDenied(cases, client, 'gestor nao move vinculo para fundo nao autorizado', 'authenticated', fixtures.gestorA, '42501', async () => {
      const link = await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      return client.query(`UPDATE public.cedente_fundos SET fundo_id = $1 WHERE id = $2`, [fixtures.fundoExterno, link.rows[0].id])
    })

    await runSuccess(cases, client, 'gestor remove vinculo de seu fundo', 'authenticated', fixtures.gestorA, async () => {
      const link = await insertLink(client, fixtures.cedenteLivreB, fixtures.fundoA)
      const deleted = await client.query(`DELETE FROM public.cedente_fundos WHERE id = $1 RETURNING id`, [link.rows[0].id])
      assert(deleted.rowCount === 1, 'o DELETE autorizado nao removeu a linha')
    })

    await runSuccess(cases, client, 'listagem de fundos do gestor permanece isolada', 'authenticated', fixtures.gestorA, async () => {
      const result = await client.query(`SELECT id FROM public.fundos ORDER BY id`)
      const ids = new Set(result.rows.map((row) => row.id))
      assert(ids.has(fixtures.fundoA), 'fundo autorizado nao ficou visivel')
      assert(!ids.has(fixtures.fundoB), 'fundo nao autorizado ficou visivel')
    })

    await runSuccess(cases, client, 'gestor multifundo ve A e B', 'authenticated', fixtures.gestorMulti, async () => {
      const result = await client.query(`SELECT id FROM public.fundos WHERE id = ANY($1::uuid[])`, [[fixtures.fundoA, fixtures.fundoB]])
      assert(result.rowCount === 2, 'gestor multifundo nao visualizou os dois fundos')
    })

    await runSuccess(cases, client, 'cedente ve somente fundos de seus vinculos', 'authenticated', fixtures.usuarioCedenteB, async () => {
      const result = await client.query(`SELECT id FROM public.fundos ORDER BY id`)
      const ids = new Set(result.rows.map((row) => row.id))
      assert(ids.has(fixtures.fundoB), 'fundo vinculado ao cedente nao ficou visivel')
      assert(!ids.has(fixtures.fundoA), 'fundo sem vinculo ficou visivel ao cedente')
    })

    await runSuccess(cases, client, 'cedente ve somente seus cedente_fundos', 'authenticated', fixtures.usuarioCedenteB, async () => {
      const identity = await client.query(`SELECT public.get_user_cedente_id() AS cedente_id`)
      const cedenteId = identity.rows[0]?.cedente_id
      assert(cedenteId, 'identidade canonica do cedente nao foi resolvida')
      const result = await client.query(`SELECT DISTINCT cedente_id FROM public.cedente_fundos`)
      assert(result.rowCount > 0, 'nenhum vinculo proprio ficou visivel')
      assert(result.rows.every((row) => row.cedente_id === cedenteId), 'vinculo de outro cedente ficou visivel')
    })

    await runSuccess(cases, client, 'consultor preserva visibilidade da carteira', 'authenticated', fixtures.consultorA, async () => {
      const result = await client.query(`SELECT id FROM public.fundos ORDER BY id`)
      const ids = new Set(result.rows.map((row) => row.id))
      assert(fixtures.fundosConsultorA.every((id) => ids.has(id)), 'fundo da carteira nao ficou visivel ao consultor')
      assert([...ids].every((id) => fixtures.fundosConsultorA.includes(id)), 'consultor visualizou fundo fora da carteira')
    })

    await validateCatalog(cases, client)
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }

  for (const testCase of cases) console.log(`- [OK] ${testCase}`)
  console.log(`\n${cases.length} verificacoes aprovadas; migration revertida integralmente.`)
}

async function loadFixtures(client) {
  const funds = await client.query(`SELECT id, nome FROM public.fundos WHERE nome IN ('PERF9A_FUNDO A', 'PERF9A_FUNDO B')`)
  const fundoA = funds.rows.find((row) => row.nome === 'PERF9A_FUNDO A')?.id
  const fundoB = funds.rows.find((row) => row.nome === 'PERF9A_FUNDO B')?.id
  assert(fundoA && fundoB, 'fundos PERF9A A/B ausentes')

  const managers = await client.query(`
    SELECT p.id, array_agg(uf.fundo_id ORDER BY uf.fundo_id) FILTER (WHERE uf.status = 'ativo') AS fundos
    FROM public.profiles p
    JOIN public.usuario_fundos uf ON uf.usuario_id = p.id
    WHERE p.role::text = 'gestor' AND p.status::text = 'ativo'
      AND uf.fundo_id IN ($1, $2)
    GROUP BY p.id
  `, [fundoA, fundoB])
  const gestorA = managers.rows.find((row) => row.fundos.length === 1 && row.fundos[0] === fundoA)?.id
  const gestorB = managers.rows.find((row) => row.fundos.length === 1 && row.fundos[0] === fundoB)?.id
  const gestorMulti = managers.rows.find((row) => row.fundos.includes(fundoA) && row.fundos.includes(fundoB))?.id
  assert(gestorA && gestorB && gestorMulti, 'gestores PERF9A esperados nao foram encontrados')

  const cedente = await client.query(`
    SELECT c.id, c.user_id
    FROM public.cedentes c
    WHERE c.razao_social LIKE 'PERF9A_CEDENTE B %'
      AND c.user_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.cedente_fundos cf
        WHERE cf.cedente_id = c.id AND cf.fundo_id = $1 AND cf.status = 'ativo'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.cedente_fundos cf
        WHERE cf.cedente_id = c.id AND cf.fundo_id = $2 AND cf.status = 'ativo'
      )
    ORDER BY c.razao_social
    LIMIT 1
  `, [fundoB, fundoA])
  assert(cedente.rowCount === 1, 'cedente PERF9A B livre para o fundo A nao foi encontrado')

  const consultant = await client.query(`
    SELECT p.id
    FROM public.profiles p
    JOIN public.consultor_cedente cc ON cc.consultor_id = p.id
    WHERE p.role::text = 'consultor' AND p.status::text = 'ativo'
    GROUP BY p.id
    ORDER BY p.id
    LIMIT 1
  `)
  assert(consultant.rowCount === 1, 'consultor ativo com carteira nao encontrado')
  const consultorA = consultant.rows[0].id
  const consultantFunds = await client.query(`
    SELECT DISTINCT cf.fundo_id
    FROM public.consultor_cedente cc
    JOIN public.cedente_fundos cf ON cf.cedente_id = cc.cedente_id AND cf.status = 'ativo'
    WHERE cc.consultor_id = $1
  `, [consultorA])

  const externalFund = await client.query(`
    SELECT f.id
    FROM public.fundos f
    WHERE f.ativo IS TRUE
      AND f.id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM public.usuario_fundos uf
        WHERE uf.usuario_id = $2 AND uf.fundo_id = f.id AND uf.status = 'ativo'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.cedente_fundos cf
        WHERE cf.cedente_id = $3 AND cf.fundo_id = f.id AND cf.status = 'ativo'
      )
    LIMIT 1
  `, [fundoA, gestorA, cedente.rows[0].id])
  assert(externalFund.rowCount === 1, 'fundo externo para teste de adulteracao nao encontrado')

  return {
    fundoA,
    fundoB,
    fundoExterno: externalFund.rows[0].id,
    gestorA,
    gestorB,
    gestorMulti,
    cedenteLivreB: cedente.rows[0].id,
    usuarioCedenteB: cedente.rows[0].user_id,
    consultorA,
    fundosConsultorA: consultantFunds.rows.map((row) => row.fundo_id),
  }
}

async function validateCatalog(cases, client) {
  await asOwner(client, async () => {
    const policies = await client.query(`
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname IN (
          'cedente_fundos_gestor_insert',
          'cedente_fundos_gestor_update',
          'fundos_cedente_vinculado_select',
          'fundos_consultor_vinculado_select'
        )
    `)
    const serializedPolicies = JSON.stringify(policies.rows)
    assert(!serializedPolicies.includes('FROM fundos f'), 'policy de cedente_fundos ainda consulta fundos diretamente')
    assert(!serializedPolicies.includes('FROM cedente_fundos cf'), 'policy de fundos ainda consulta cedente_fundos diretamente')

    const functions = await client.query(`
      SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN (
          'usuario_tem_acesso_fundo',
          'usuario_pode_administrar_fundo_ativo',
          'cedente_tem_acesso_fundo',
          'consultor_tem_acesso_fundo'
        )
    `)
    assert(functions.rowCount === 4, 'helpers privados esperados nao foram criados')
    assert(functions.rows.every((row) => row.prosecdef === true), 'helper sem SECURITY DEFINER')
    assert(functions.rows.every((row) => row.owner === 'postgres'), 'helper com owner inesperado')
    assert(
      functions.rows.every((row) => row.proconfig?.some((config) => config.startsWith('search_path=') && config.includes('""'))),
      'helper sem search_path vazio',
    )

    const unsafeGrants = await client.query(`
      SELECT routine_name, grantee
      FROM information_schema.role_routine_grants
      WHERE routine_schema = 'private'
        AND routine_name IN (
          'usuario_tem_acesso_fundo',
          'usuario_pode_administrar_fundo_ativo',
          'cedente_tem_acesso_fundo',
          'consultor_tem_acesso_fundo'
        )
        AND grantee IN ('PUBLIC', 'anon')
    `)
    assert(unsafeGrants.rowCount === 0, 'PUBLIC ou anon manteve EXECUTE nos helpers')

    const authenticatedGrants = await client.query(`
      SELECT DISTINCT routine_name
      FROM information_schema.role_routine_grants
      WHERE routine_schema = 'private'
        AND routine_name IN (
          'usuario_tem_acesso_fundo',
          'usuario_pode_administrar_fundo_ativo',
          'cedente_tem_acesso_fundo',
          'consultor_tem_acesso_fundo'
        )
        AND grantee = 'authenticated'
        AND privilege_type = 'EXECUTE'
    `)
    assert(authenticatedGrants.rowCount === 4, 'authenticated nao recebeu EXECUTE em todos os helpers')

    const rls = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE oid IN ('public.fundos'::regclass, 'public.cedente_fundos'::regclass)
    `)
    assert(rls.rows.every((row) => row.relrowsecurity === true), 'RLS foi desabilitada')
  })
  cases.push('catalogo final sem ciclo, helpers restritos e RLS habilitada')
}

async function runSuccess(cases, client, name, role, userId, operation) {
  await runScenario(client, role, userId, async () => {
    await operation()
  })
  cases.push(name)
}

async function runDenied(cases, client, name, role, userId, expectedCode, operation, setup) {
  let obtainedError = null
  try {
    await runScenario(client, role, userId, operation, setup)
  } catch (error) {
    obtainedError = error
  }
  assert(obtainedError, `${name}: operacao foi permitida`)
  assert(!String(obtainedError.message).includes('infinite recursion'), `${name}: recursao infinita ainda ocorreu`)
  assert(obtainedError.code === expectedCode, `${name}: esperado ${expectedCode}, obtido ${obtainedError.code || 'sem codigo'}`)
  cases.push(name)
}

async function runScenario(client, role, userId, operation, setup) {
  const savepoint = `scenario_${crypto.randomUUID().replaceAll('-', '')}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    if (setup) await setup()
    await setIdentity(client, role, userId)
    const result = await operation()
    await client.query('RESET ROLE')
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    return result
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query('RESET ROLE')
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    throw error
  }
}

async function setIdentity(client, role, userId) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({
    sub: userId ?? undefined,
    role,
    aal: userId ? 'aal2' : undefined,
  })])
  if (role === 'authenticated') await client.query('SET LOCAL ROLE authenticated')
  else if (role === 'anon') await client.query('SET LOCAL ROLE anon')
  else throw new Error(`Role de teste nao suportada: ${role}`)
}

async function asOwner(client, operation) {
  await client.query('RESET ROLE')
  return operation()
}

function insertLink(client, cedenteId, fundoId) {
  return client.query(
    `INSERT INTO public.cedente_fundos (cedente_id, fundo_id, status)
     VALUES ($1, $2, 'ativo') RETURNING id`,
    [cedenteId, fundoId],
  )
}

function loadMigrationBody() {
  const path = resolve(process.cwd(), 'supabase/migrations/20260804171538_corrigir_recursao_rls_cedente_fundos.sql')
  return readFileSync(path, 'utf8')
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error)
  return error.message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
