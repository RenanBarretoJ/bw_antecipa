import { randomUUID } from 'node:crypto'

import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

const MAIN_FUND_ID = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const OTHER_FUND_ID = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, 'p23_verify_security')
const failures = []
let checks = 0

function check(condition, label, details) {
  checks += 1
  if (!condition) failures.push({ label, details })
}

async function actor(userId, databaseRole = 'authenticated') {
  await db.query('RESET ROLE')
  await db.query(`SET LOCAL ROLE ${databaseRole}`)
  const claims = { sub: userId, role: databaseRole, aal: 'aal2', session_id: randomUUID() }
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role',$1,true)`, [databaseRole])
}

async function mustDeny(label, operation) {
  await db.query('SAVEPOINT p23_denied')
  try {
    await operation()
    check(false, label, 'comando foi aceito')
  } catch (error) {
    check(error?.code === '42501', label, { code: error?.code, message: error?.message })
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT p23_denied')
    await db.query('RELEASE SAVEPOINT p23_denied')
  }
}

async function visible(fundId) {
  const result = await db.query('SELECT count(*)::integer AS total FROM public.matching_resultados WHERE fundo_id=$1', [fundId])
  return result.rows[0].total
}

try {
  console.log('\nBW Antecipa - verificacao transacional RLS/MFA P2.3')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN')

  const identities = await db.query(`
    SELECT
      ARRAY(SELECT p.id FROM public.profiles p WHERE p.status::text='ativo' AND p.role::text='gestor'
        AND NOT EXISTS (SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=p.id AND up.papel::text='super_admin' AND up.ativo)
        ORDER BY p.id LIMIT 2) AS gestores,
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        WHERE p.status::text='ativo' AND p.role::text='super_admin'
          AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) AS super_admin_puro,
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        WHERE p.status::text='ativo' AND p.role::text='gestor'
          AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) AS super_admin_gestor,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='cedente' ORDER BY id LIMIT 1) AS cedente,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='sacado' ORDER BY id LIMIT 1) AS sacado,
      (SELECT id FROM public.profiles WHERE status::text='ativo' AND role::text='consultor' ORDER BY id LIMIT 1) AS consultor
  `)
  const ids = identities.rows[0]
  const gestorA = ids.gestores?.[0]
  const gestorB = ids.gestores?.[1] || ids.gestores?.[0]
  check(Boolean(gestorA), 'massa possui Gestor para Fundo A')
  check(Boolean(gestorB), 'massa possui Gestor para Fundo B')
  check(Boolean(ids.super_admin_puro), 'massa possui Super Admin puro')
  check(Boolean(ids.super_admin_gestor), 'massa possui Super Admin com papel operacional gestor')
  check(Boolean(ids.cedente), 'massa possui Cedente')
  check(Boolean(ids.sacado), 'massa possui Sacado')
  if (failures.length) throw new Error('Perfis obrigatorios da massa nao foram encontrados')

  const inputs = await db.query(`
    SELECT DISTINCT ON (fundo_id) fundo_id,id
    FROM public.importacoes_financeiras
    WHERE fundo_id=ANY($1) AND status='PUBLICADA'
    ORDER BY fundo_id,publicada_em DESC
  `, [[MAIN_FUND_ID, OTHER_FUND_ID]])
  const inputByFund = new Map(inputs.rows.map((row) => [row.fundo_id, row.id]))
  const notes = await db.query(`
    SELECT DISTINCT ON (fundo_id) fundo_id,id FROM public.notas_fiscais
    WHERE fundo_id=ANY($1) ORDER BY fundo_id,id
  `, [[MAIN_FUND_ID, OTHER_FUND_ID]])
  const noteByFund = new Map(notes.rows.map((row) => [row.fundo_id, row.id]))
  check(inputByFund.has(MAIN_FUND_ID) && inputByFund.has(OTHER_FUND_ID), 'massa possui inputs publicados nos dois fundos')
  check(noteByFund.has(MAIN_FUND_ID) && noteByFund.has(OTHER_FUND_ID), 'massa possui NFs nos dois fundos')
  if (failures.length) throw new Error('Inputs/NFs obrigatorios da massa nao foram encontrados')

  const fixtures = new Map()
  for (const fundId of [MAIN_FUND_ID, OTHER_FUND_ID]) {
    const executionId = randomUUID()
    const resultId = randomUUID()
    await db.query(`
      INSERT INTO public.matching_execucoes (
        id,fundo_id,data_referencia,input_import_ids,assinatura_execucao,status,correlation_id
      ) VALUES ($1,$2,'2099-12-31',ARRAY[$3::uuid],$4,'PROCESSANDO',$5)
    `, [executionId, fundId, inputByFund.get(fundId), `P23_SECURITY_${randomUUID()}`, randomUUID()])
    await db.query(`
      INSERT INTO public.matching_resultados (
        id,execucao_id,fundo_id,provedor,origem_registro,origem_registro_id,
        identidade_externa,status,metodo,candidate_count,evidencias
      ) VALUES ($1,$2,$3,'P23_SECURITY','ESTOQUE',$4,$5,'NAO_CONCILIADO','NAO_CONCILIADO',0,'{}')
    `, [resultId, executionId, fundId, randomUUID(), `SECURITY_${fundId}`])
    fixtures.set(fundId, { executionId, resultId })
  }

  for (const userId of new Set([gestorA, gestorB, ids.super_admin_puro, ids.super_admin_gestor])) {
    await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=ANY($2)', [userId, [MAIN_FUND_ID, OTHER_FUND_ID]])
  }
  await db.query(`
    INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
  `, [gestorA, MAIN_FUND_ID])
  if (gestorB !== gestorA) {
    await db.query(`
      INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
      VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
    `, [gestorB, OTHER_FUND_ID])
  }

  await actor(gestorA)
  check(await visible(MAIN_FUND_ID) === 1, 'Gestor Fundo A le resultados A')
  check(await visible(OTHER_FUND_ID) === 0, 'Gestor Fundo A nao le resultados B')

  if (gestorB === gestorA) {
    await db.query('RESET ROLE')
    await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=$2', [gestorA, MAIN_FUND_ID])
    await db.query(`
      INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
      VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
    `, [gestorB, OTHER_FUND_ID])
  }
  await actor(gestorB)
  check(await visible(OTHER_FUND_ID) === 1, 'Gestor Fundo B le resultados B')
  if (gestorB !== gestorA) check(await visible(MAIN_FUND_ID) === 0, 'Gestor Fundo B nao le resultados A')

  await actor(ids.super_admin_puro)
  check(await visible(MAIN_FUND_ID) === 0 && await visible(OTHER_FUND_ID) === 0, 'Super Admin puro nao recebe acesso operacional')
  await db.query('RESET ROLE')
  await db.query(`
    INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
  `, [ids.super_admin_gestor, MAIN_FUND_ID])
  await actor(ids.super_admin_gestor)
  check(await visible(MAIN_FUND_ID) === 1 && await visible(OTHER_FUND_ID) === 0, 'Hibrido le apenas o fundo com vinculo gestor ativo')

  for (const [label, id] of [
    ['Cedente', ids.cedente],
    ['Consultor', ids.consultor || '00000000-0000-0000-0000-000000000099'],
    ['Sacado', ids.sacado],
  ]) {
    await actor(id)
    check(await visible(MAIN_FUND_ID) === 0 && await visible(OTHER_FUND_ID) === 0, `${label} nao acessa conciliacao global`)
  }

  await actor('00000000-0000-0000-0000-000000000000', 'anon')
  await mustDeny('Anon nao le resultados P2.3', () => db.query('SELECT count(*) FROM public.matching_resultados'))

  await db.query('RESET ROLE')
  await db.query('DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=ANY($2)', [gestorA, [MAIN_FUND_ID, OTHER_FUND_ID]])
  await db.query(`
    INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
  `, [gestorA, MAIN_FUND_ID])
  await actor(gestorA)
  await mustDeny('Gestor nao insere resultado diretamente', () => db.query('INSERT INTO public.matching_resultados DEFAULT VALUES'))
  await mustDeny('Gestor nao executa RPC interna de matching', () => db.query(`SELECT public.persistir_matching_execucao('{}'::jsonb)`))
  await mustDeny('Match manual cross-fund e bloqueado antes da mutacao', () => db.query(
    'SELECT public.confirmar_match_manual($1,$2,$3,$4)',
    [fixtures.get(OTHER_FUND_ID).resultId, noteByFund.get(OTHER_FUND_ID), 'Teste cross-fund', randomUUID()],
  ))
  await mustDeny('Match manual sem TOTP fresco e bloqueado', () => db.query(
    'SELECT public.confirmar_match_manual($1,$2,$3,$4)',
    [fixtures.get(MAIN_FUND_ID).resultId, noteByFund.get(MAIN_FUND_ID), 'Teste sem TOTP', randomUUID()],
  ))

  await db.query('RESET ROLE')
  const manualLink = randomUUID()
  await db.query(`
    INSERT INTO public.titulo_nf_vinculos (
      id,fundo_id,provedor,identidade_externa,nota_fiscal_id,origem,metodo,
      evidencias,candidate_count,confirmado_em,confirmado_por,correlation_id
    ) VALUES ($1,$2,'P23_SECURITY',$3,$4,'MANUAL','MANUAL','{}',1,clock_timestamp(),$5,$6)
  `, [manualLink, MAIN_FUND_ID, `MANUAL_${randomUUID()}`, noteByFund.get(MAIN_FUND_ID), gestorA, randomUUID()])
  await actor(gestorA)
  await mustDeny('Revogacao manual sem TOTP fresco e bloqueada', () => db.query(
    'SELECT public.revogar_match_manual($1,$2,$3)', [manualLink, 'Teste sem TOTP', randomUUID()],
  ))

  await db.query('ROLLBACK')
  if (failures.length) {
    console.error(`P2.3 security verify falhou em ${failures.length} verificacao(oes).`)
    for (const item of failures) console.error(`- ${item.label}: ${JSON.stringify(item.details)}`)
    process.exitCode = 1
  } else {
    console.log(`P2.3 security verify aprovado: ${checks} verificacoes; todas as mutacoes foram revertidas.`)
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`P2.3 security verify falhou: ${error instanceof Error ? error.message : String(error)}`)
  if (failures.length) for (const item of failures) console.error(`- ${item.label}: ${JSON.stringify(item.details)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
