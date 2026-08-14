import {
  assertHomologEnvironment,
  connectDb,
  loadHomologEnv,
  parseArgs,
} from '../rlx-golden/helpers.mjs'

const MAIN_FUND_ID = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const OTHER_FUND_ID = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const TEST_DATE = '2026-08-09'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const db = await connectDb(env, 'p22_verify_security')
const failures = []
let checks = 0

function check(condition, label, details) {
  checks += 1
  if (!condition) failures.push({ label, details })
}

async function actor(userId, databaseRole = 'authenticated') {
  await db.query('RESET ROLE')
  await db.query(`SET LOCAL ROLE ${databaseRole}`)
  const claims = { sub: userId, role: databaseRole, aal: 'aal2' }
  await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role',$1,true)`, [databaseRole])
}

async function count(table, fundId) {
  const allowed = new Set(['rlx_estoque_atual', 'rlx_importacoes_financeiras', 'rlx_importacao_linhas'])
  if (!allowed.has(table)) throw new Error('Tabela de verificacao nao autorizada.')
  const dateFilter = table === 'rlx_estoque_atual' ? ' AND data_referencia=$2::date' : ''
  const values = table === 'rlx_estoque_atual' ? [fundId, TEST_DATE] : [fundId]
  const result = await db.query(`SELECT count(*)::integer AS total FROM public.${table} WHERE fundo_id=$1${dateFilter}`, values)
  return result.rows[0].total
}

async function mustDeny(label, operation) {
  await db.query('SAVEPOINT p22_denied')
  try {
    await operation()
    check(false, label, 'comando foi aceito')
  } catch (error) {
    check(error?.code === '42501', label, { code: error?.code, message: error?.message })
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT p22_denied')
    await db.query('RELEASE SAVEPOINT p22_denied')
  }
}

try {
  console.log('\nBW Antecipa - verificacao transacional RLS/concorrencia P2.2')
  console.log(`Projeto homolog: ${env.projectRef}`)
  await db.query('BEGIN')

  const identities = await db.query(`
    SELECT
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        WHERE p.status::text='ativo' AND up.papel::text='super_admin' AND up.ativo ORDER BY p.id LIMIT 1) AS super_admin,
      (SELECT p.id FROM public.profiles p
        WHERE p.status::text='ativo' AND p.role::text='gestor'
          AND NOT EXISTS (SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=p.id AND up.papel::text='super_admin' AND up.ativo)
          AND NOT EXISTS (SELECT 1 FROM public.usuario_fundos x WHERE x.usuario_id=p.id AND x.status='ativo' AND x.fundo_id=$2)
        ORDER BY p.id LIMIT 1) AS gestor_a,
      (SELECT p.id FROM public.profiles p JOIN public.usuario_papeis up ON up.usuario_id=p.id
        JOIN public.usuario_fundos uf ON uf.usuario_id=p.id
        WHERE p.status::text='ativo' AND up.papel::text='super_admin' AND up.ativo
          AND uf.status='ativo' AND uf.perfil_no_fundo='gestor' AND uf.fundo_id=$1
        ORDER BY p.id LIMIT 1) AS hibrido,
      (SELECT p.id FROM public.profiles p WHERE p.status::text='ativo' AND p.role::text='cedente' ORDER BY p.id LIMIT 1) AS cedente,
      (SELECT p.id FROM public.profiles p WHERE p.status::text='ativo' AND p.role::text='sacado' ORDER BY p.id LIMIT 1) AS sacado,
      (SELECT p.id FROM public.profiles p WHERE p.status::text='ativo' AND p.role::text='consultor' ORDER BY p.id LIMIT 1) AS consultor
  `, [MAIN_FUND_ID, OTHER_FUND_ID])
  const ids = identities.rows[0]
  check(Boolean(ids.super_admin), 'massa possui Super Admin ativo')
  check(Boolean(ids.gestor_a), 'massa possui Gestor restrito ao Fundo A')
  check(Boolean(ids.hibrido), 'massa possui usuario hibrido Admin/Gestor no Fundo A')
  check(Boolean(ids.cedente), 'massa possui Cedente ativo')
  check(Boolean(ids.sacado), 'massa possui Sacado ativo')
  if (failures.length) throw new Error('Perfis obrigatorios da massa nao foram encontrados.')
  await db.query(`
    INSERT INTO public.usuario_fundos (id,usuario_id,fundo_id,perfil_no_fundo,status,principal)
    VALUES (gen_random_uuid(),$1,$2,'gestor','ativo',false)
    ON CONFLICT (usuario_id,fundo_id) DO UPDATE SET perfil_no_fundo='gestor',status='ativo'
  `, [ids.gestor_a, MAIN_FUND_ID])
  // Garante um fundo sem vinculo para provar a separacao do papel hibrido.
  // A transacao inteira e revertida ao final.
  await db.query(`DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=$2`, [ids.hibrido, OTHER_FUND_ID])
  const currentImport = await db.query(`SELECT id FROM public.rlx_importacoes_financeiras WHERE fundo_id=$1 AND tipo_base='ESTOQUE' AND data_referencia=$2 AND status='PUBLICADA' LIMIT 1`, [MAIN_FUND_ID, TEST_DATE])
  check(Boolean(currentImport.rows[0]?.id), 'massa possui importacao vigente para testar publicacao')

  await actor(ids.super_admin)
  check(await count('rlx_importacoes_financeiras', MAIN_FUND_ID) > 0, 'Super Admin le importacoes tecnicas')
  check(await count('rlx_importacao_linhas', MAIN_FUND_ID) > 0, 'Super Admin le staging tecnico')

  await actor(ids.gestor_a)
  check(await count('rlx_estoque_atual', MAIN_FUND_ID) === 89, 'Gestor Fundo A le a base canonica publicada A')
  check(await count('rlx_estoque_atual', OTHER_FUND_ID) === 0, 'Gestor Fundo A nao le Fundo B')
  check(await count('rlx_importacoes_financeiras', MAIN_FUND_ID) === 0, 'Gestor nao le importacoes tecnicas')
  check(await count('rlx_importacao_linhas', MAIN_FUND_ID) === 0, 'Gestor nao le staging tecnico')

  await actor(ids.hibrido)
  check(await count('rlx_importacoes_financeiras', OTHER_FUND_ID) > 0, 'Hibrido em contexto Admin administra importacoes A e B')
  check(await count('rlx_estoque_atual', MAIN_FUND_ID) === 89, 'Hibrido le canônico do fundo com vinculo gestor')
  check(await count('rlx_estoque_atual', OTHER_FUND_ID) === 0, 'Hibrido nao ganha leitura operacional do fundo sem vinculo')

  for (const [label, id] of [
    ['Cedente', ids.cedente],
    ['Consultor', ids.consultor || '00000000-0000-0000-0000-000000000099'],
    ['Sacado', ids.sacado],
  ]) {
    await actor(id)
    check(await count('rlx_estoque_atual', MAIN_FUND_ID) === 0, `${label} nao le estoque financeiro global`)
    check(await count('rlx_importacoes_financeiras', MAIN_FUND_ID) === 0, `${label} nao le importacao tecnica`)
  }

  await actor('00000000-0000-0000-0000-000000000000', 'anon')
  await mustDeny('Anonimo nao le base canonica', () => db.query('SELECT count(*) FROM public.rlx_estoque_atual'))

  await actor(ids.gestor_a)
  await mustDeny('Gestor nao insere diretamente no canonico', () => db.query('INSERT INTO public.rlx_estoque_posicoes DEFAULT VALUES'))
  await mustDeny('Gestor nao atualiza diretamente o canonico', () => db.query(`UPDATE public.rlx_estoque_posicoes SET provedor=provedor WHERE fundo_id=$1`, [MAIN_FUND_ID]))
  await mustDeny('Gestor nao exclui diretamente do canonico', () => db.query(`DELETE FROM public.rlx_estoque_posicoes WHERE fundo_id=$1`, [MAIN_FUND_ID]))
  await mustDeny('Gestor nao publica importacao pela RPC tecnica', () => db.query('SELECT public.publicar_importacao_financeira($1,$2)', [currentImport.rows[0].id, crypto.randomUUID()]))

  await actor(ids.super_admin)
  await mustDeny('Super Admin nao insere diretamente no canonico', () => db.query('INSERT INTO public.rlx_estoque_posicoes DEFAULT VALUES'))
  await db.query('SAVEPOINT p22_admin_publish')
  await db.query('SELECT public.publicar_importacao_financeira($1,$2)', [currentImport.rows[0].id, crypto.randomUUID()])
  check(true, 'Super Admin administra publicacao pela RPC idempotente')
  await db.query('ROLLBACK TO SAVEPOINT p22_admin_publish')
  await db.query('RELEASE SAVEPOINT p22_admin_publish')

  await actor('00000000-0000-0000-0000-000000000001', 'service_role')
  const firstCycle = await db.query(`SELECT public.iniciar_ciclo_importacao_financeira_rlx($1,'2099-12-31','CRON',$2) AS id`, [MAIN_FUND_ID, crypto.randomUUID()])
  const secondCycle = await db.query(`SELECT public.iniciar_ciclo_importacao_financeira_rlx($1,'2099-12-31','CRON',$2) AS id`, [MAIN_FUND_ID, crypto.randomUUID()])
  check(Boolean(firstCycle.rows[0].id) && secondCycle.rows[0].id === null, 'lock do cron permite um unico worker por fundo/data')

  await db.query('ROLLBACK')
  if (failures.length) {
    console.error(`P2.2 security verify falhou em ${failures.length} verificacao(oes).`)
    for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
    process.exitCode = 1
  } else {
    console.log(`P2.2 security verify aprovado: ${checks} verificacoes; todas as mutacoes foram revertidas.`)
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(`P2.2 security verify falhou: ${error instanceof Error ? error.message : String(error)}`)
  if (failures.length) for (const failure of failures) console.error(`- ${failure.label}: ${JSON.stringify(failure.details)}`)
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}
