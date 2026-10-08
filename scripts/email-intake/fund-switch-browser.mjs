import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { generatePassword, generateTotp, generateValidCnpj } from '../perf9a/dataset.mjs'
import { inspectEmailResponses } from './browser-redaction.mjs'
import { waitCedenteFundSwitch } from './browser-navigation.mjs'

/** Real cookie action, Auth/MFA and fund-scoped list; disposable loopback only. */
export async function verifyFundSwitchBrowser({ db, browser, url, serviceKey, anonKey, root }) {
  assert.equal(url, 'http://127.0.0.1:57841')
  const origin = 'http://127.0.0.1:57849', options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(url, serviceKey, options), human = createClient(url, anonKey, options)
  const funds = [randomUUID(), randomUUID()], links = [randomUUID(), randomUUID()], notes = [randomUUID(), randomUUID()], cedente = randomUUID()
  const sequence = Date.now() % 100000000, cnpjs = [0, 1, 2].map(i => generateValidCnpj(sequence + i))
  const value = (result, label) => { assert.ok(!result.error, `${label}:${result.error?.code ?? 'UNKNOWN'}`); return result.data }
  let userId, signedIn = false, context, inspection, stage = 'SETUP', failure
  const report = { result: 'FAIL', checks: [] }
  try {
    const email = `email05-switch-${randomUUID()}@example.invalid`, password = generatePassword()
    const { user } = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'CREATE')
    userId = user.id
    await db.query("update public.profiles set role='cedente',status='ativo' where id=$1", [userId])
    await db.query("insert into public.usuario_papeis(usuario_id,papel,ativo,origem) values($1,'cedente',true,'administracao') on conflict(usuario_id,papel) do update set ativo=true,revogado_em=null", [userId])
    for (let i = 0; i < 2; i++) await db.query("insert into public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) values($1,$2,$3,'QA','98000000000277','QA','98000000000358',true)", [funds[i], 'EMAIL05 switch QA ' + i, cnpjs[i]])
    await db.query("insert into public.cedentes(id,user_id,cnpj,razao_social,status,fundo_id) values($1,$2,$3,'EMAIL05 switch QA Cedente','ativo',$4)", [cedente, userId, cnpjs[2], funds[0]])
    for (let i = 0; i < 2; i++) {
      await db.query("insert into public.cedente_fundos(id,cedente_id,fundo_id,status) values($1,$2,$3,'ativo')", [links[i], cedente, funds[i]])
      await db.query("insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,status) values($1,$2,$3,$4,$5,'1',current_date,current_date+30,$6,'EMAIL05 switch QA Cedente','11222333000181','Sacado QA',100,100,'rascunho')", [notes[i], cedente, links[i], funds[i], 'EMAIL05-SWITCH-' + i, cnpjs[2]])
    }
    value(await human.auth.signInWithPassword({ email, password }), 'LOGIN'); signedIn = true
    const factor = value(await human.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'EMAIL05 switch disposable' }), 'ENROLL')
    const challenge = value(await human.auth.mfa.challenge({ factorId: factor.id }), 'CHALLENGE')
    value(await human.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: generateTotp(factor.totp.secret) }), 'VERIFY')
    value(await human.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id }), 'SESSION')
    context = await browser.createBrowserContext()
    const page = await context.newPage(), cdp = await page.createCDPSession()
    let hardReloads = 0
    await cdp.send('Page.enable')
    cdp.on('Page.frameRequestedNavigation', event => { if (event.reason === 'reload') hardReloads++ })
    inspection = await inspectEmailResponses(page, { file: resolve(root, 'email05-fund-switch-redaction.json'), knownSecrets: [{ value: serviceKey, kind: 'SERVICE_ROLE_KEY' }] })
    const parts = ('base64-' + Buffer.from(JSON.stringify((await human.auth.getSession()).data.session)).toString('base64url')).match(/.{1,3180}/g)
    await context.setCookie(...parts.map((value, i) => ({ name: parts.length === 1 ? 'sb-127-auth-token' : `sb-127-auth-token.${i}`, value, domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' })))
    const selector = 'select[aria-label="Fundo operacional do cedente"]'
    inspection.expectReadiness(() => page.waitForSelector(selector, { timeout: 20000 }))
    await inspection.beforeNavigation(() => page.goto(origin + '/cedente/notificacoes', { waitUntil: 'networkidle2' }))
    await page.waitForSelector(selector, { timeout: 20000 })
    for (let i = 0; i < 2; i++) {
      stage = i === 0 ? 'SELECT_A' : 'SWITCH_A_TO_B'
      await inspection.beforeNavigation(() => page.select(selector, links[i]))
      await waitCedenteFundSwitch(page, inspection, { linkId: links[i], pathname: '/cedente/notificacoes', hardReloads: () => hardReloads })
      report.checks.push(i === 0 ? 'OFFICIAL_COOKIE_A_CONFIRMED' : 'OFFICIAL_COOKIE_B_CONFIRMED_NO_RELOAD')
    }
    stage = 'SERVER_CONTEXT_B'
    inspection.expectReadiness(() => page.waitForFunction(() => location.pathname === '/cedente/notas-fiscais' && document.body.innerText.includes('EMAIL05-SWITCH-1'), { timeout: 20000 }))
    await inspection.beforeNavigation(() => page.goto(origin + '/cedente/notas-fiscais', { waitUntil: 'networkidle2' }))
    await page.waitForFunction(() => document.body.innerText.includes('EMAIL05-SWITCH-1'), { timeout: 20000 })
    assert.equal(await page.evaluate(() => document.body.innerText.includes('EMAIL05-SWITCH-0')), false, 'PREVIOUS_FUND_NOTE_VISIBLE')
    report.checks.push('SERVER_CONTEXT_B_LIST_EXCLUDES_A', 'PREFETCH_CONCURRENT_FULL_INSPECTION')
    report.summary = await inspection.settleAndAssertClean()
    assert.equal(report.summary.staleDiscovered, 0)
    report.hardReloads = hardReloads
    report.result = 'PASS'
  } catch (error) { failure = error; report.errorClass = error.code ?? error.name; report.stage = stage }
  finally {
    try { if (inspection) await inspection.closeAfterDrain(() => context?.close()); else await context?.close() }
    catch (error) { failure ??= error; report.result = 'FAIL' }
    try {
      if (signedIn) value(await human.auth.signOut({ scope: 'global' }), 'SIGNOUT')
      await db.query('delete from public.notas_fiscais where id=any($1::uuid[])', [notes])
      await db.query('delete from public.eventos_dominio where fundo_id=any($1::uuid[])', [funds])
      for (const table of ['cedente_acessos', 'cedente_fundos', 'cedente_estabelecimentos']) await db.query(`delete from public.${table} where cedente_id=$1`, [cedente])
      await db.query('delete from public.cedentes where id=$1', [cedente])
      await db.query('delete from public.usuario_fundos where fundo_id=any($1::uuid[])', [funds])
      await db.query('delete from public.fundos where id=any($1::uuid[])', [funds])
      await db.query('delete from public.logs_auditoria where usuario_id=$1 or entidade_id=any($2::uuid[])', [userId, notes])
      await db.query('delete from public.seguranca_eventos where usuario_id=$1 or ator_usuario_id=$1', [userId])
      await db.query('delete from public.sessoes_elevadas where user_id=$1', [userId])
      if (userId) value(await admin.auth.admin.deleteUser(userId), 'DELETE_USER')
      report.cleanup = 'PASS'
    } catch (error) { failure ??= error; report.cleanup = 'FAIL'; report.result = 'FAIL' }
    await writeFile(resolve(root, 'email05-fund-switch.json'), JSON.stringify(report, null, 2))
  }
  if (failure) throw Error(`FUND_SWITCH_BROWSER:${stage}:${failure.code ?? failure.name}`)
  return report.checks
}
