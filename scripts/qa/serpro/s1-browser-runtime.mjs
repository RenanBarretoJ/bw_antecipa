import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { nfeFixtureKey } from '../../../scripts/email-intake/nfe-fixture-key.mjs'

assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57861')
assert.match(process.env.S1_BROWSER_REPORT ?? '', /^\/reports\//)
const mode = process.argv[2]
assert.ok(['--seed', '--browser'].includes(mode))

const db = new Client({ host: '127.0.0.1', port: 57862, user: 'postgres', password: process.env.LOCAL_QA_PG_PASSWORD, database: 'postgres' })
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, authOptions)
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const credentialsPath = '/tmp/s1-browser-credentials.json'
const fundA = 'a1000000-0000-4000-8000-000000000001'
const fundB = 'a1000000-0000-4000-8000-000000000002'
const cedente = 'a2000000-0000-4000-8000-000000000001'
const linkA = 'a3000000-0000-4000-8000-000000000001'
const linkB = 'a3000000-0000-4000-8000-000000000002'

function totp(secret) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(char => chars.indexOf(char).toString(2).padStart(5, '0')).join('')
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map(value => Number.parseInt(value, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', bytes).update(counter).digest()
  const offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

function value(result, stage) {
  assert.ok(!result.error, `${stage}:${result.error?.code ?? result.error?.message ?? 'UNKNOWN'}`)
  return result.data
}

async function createActor(role, suffix) {
  const email = `s1-${suffix}-${randomUUID()}@example.invalid`
  const password = `S1!${randomBytes(24).toString('base64url')}`
  const created = value(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `CREATE_${suffix}`).user
  assert.ok(created?.id)
  await db.query(`UPDATE public.profiles SET role=$2,status='ativo',nome_completo=$3 WHERE id=$1`, [created.id, role, `S1 ${suffix}`])
  const human = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, authOptions)
  value(await human.auth.signInWithPassword({ email, password }), `LOGIN_${suffix}`)
  const factor = value(await human.auth.mfa.enroll({ factorType: 'totp', friendlyName: `S1 ${suffix}` }), `ENROLL_${suffix}`)
  const challenge = value(await human.auth.mfa.challenge({ factorId: factor.id }), `CHALLENGE_${suffix}`)
  value(await human.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: totp(factor.totp.secret) }), `VERIFY_${suffix}`)
  value(await human.rpc('registrar_sessao_mfa_atual', { p_factor_id: factor.id }), `CANONICAL_MFA_${suffix}`)
  const session = value(await human.auth.getSession(), `SESSION_${suffix}`).session
  assert.equal(session?.user.id, created.id)
  assert.equal(session?.user.aud, 'authenticated')
  const token = session.access_token
  await human.auth.signOut({ scope: 'local' })
  return { id: created.id, role, email, password, secret: factor.totp.secret, factorId: factor.id, token }
}

async function seed() {
  await db.connect()
  try {
    const actors = {
      gestor: await createActor('gestor', 'gestor-a'),
      gestorOther: await createActor('gestor', 'gestor-b'),
      admin: await createActor('super_admin', 'admin'),
      cedente: await createActor('cedente', 'cedente'),
      consultor: await createActor('consultor', 'consultor'),
      sacado: await createActor('sacado', 'sacado'),
    }
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.usuario_papeis(usuario_id,papel,ativo,origem) VALUES($1,'super_admin',true,'administracao')`, [actors.admin.id])
    await db.query(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      VALUES($1,'S1 QA Fundo A','98010000000110','QA Admin A','98010000000209','QA Gestora A','98010000000381',true),
            ($2,'S1 QA Fundo B','98020000000165','QA Admin B','98020000000246','QA Gestora B','98020000000327',true)`, [fundA, fundB])
    await db.query(`INSERT INTO public.usuario_fundos(usuario_id,fundo_id,perfil_no_fundo,status,principal)
      VALUES($1,$2,'gestor','ativo',true),($3,$4,'gestor','ativo',true)`, [actors.gestor.id, fundA, actors.gestorOther.id, fundB])
    await db.query(`INSERT INTO public.cedentes(id,user_id,cnpj,razao_social,status,fundo_id)
      VALUES($1,$2,'98992300000280','S1 QA CEDENTE SEM VALOR FISCAL','ativo',$3)`, [cedente, actors.cedente.id, fundA])
    await db.query(`INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
      VALUES($1,$2,$3,'ativo'),($4,$2,$5,'ativo')`, [linkA, cedente, fundA, linkB, fundB])
    await db.query(`INSERT INTO public.cedente_acessos(cedente_id,user_id,perfil,status,ativo,aceito_em)
      VALUES($1,$2,'ADMIN','ATIVO',true,now())`, [cedente, actors.cedente.id])

    const issued = '2026-10-26'
    const due = '2026-11-25'
    const severities = [
      ['verde', 'CONSULTADO', 'VERDE', 'Conferida na cobertura parcial do mock local.'],
      ['amarelo', 'DIVERGENTE', 'AMARELO', 'Carta de correção exige análise humana.'],
      ['vermelho', 'DIVERGENTE', 'VERMELHO', 'Cancelamento fiscal confirmado no mock local.'],
      ['neutro', 'INCONCLUSIVO', 'NEUTRO', 'Cobertura insuficiente; nenhuma conclusão fiscal.'],
    ]
    const notes = {}
    let number = 810100
    for (const [name, status, severity, summary] of severities) {
      const id = randomUUID()
      const key = nfeFixtureKey({ issuer: '98992300000280', number, issued })
      notes[name] = id
      await db.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
        data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
        valor_bruto,valor_liquido,status,tipo_documento_fiscal,fiscal_proveniencia)
        VALUES($1,$2,$3,$4,$5,'1',$6,$7,$8,'98992300000280','S1 QA CEDENTE','98110000000175','S1 QA SACADO',100,100,'submetida','NFE',$9)`,
      [id, cedente, linkA, fundA, String(number), key, issued, due, { sha256: 'a'.repeat(64), source: 'SYNTHETIC_LOCAL_ONLY' }])
      await db.query(`UPDATE public.nfe_fiscal_consultas SET status=$2,severidade=$3,resumo=$4,checked_at=now(),event_coverage='PARTIAL',
        resultado_minimo=jsonb_build_object('fixture','SYNTHETIC_LOCAL_ONLY') WHERE nota_fiscal_id=$1`, [id, status, severity, summary])
      number += 1
    }
    const otherId = randomUUID()
    const otherKey = nfeFixtureKey({ issuer: '98992300000280', number, issued })
    notes.otherFund = otherId
    await db.query(`INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
      valor_bruto,valor_liquido,status,tipo_documento_fiscal,fiscal_proveniencia)
      VALUES($1,$2,$3,$4,$5,'1',$6,$7,$8,'98992300000280','S1 QA CEDENTE','98110000000175','S1 QA SACADO',200,200,'submetida','NFE',$9)`,
    [otherId, cedente, linkB, fundB, String(number), otherKey, issued, due, { sha256: 'b'.repeat(64), source: 'SYNTHETIC_LOCAL_ONLY' }])

    const yellowQuery = (await db.query(`SELECT id FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id=$1`, [notes.amarelo])).rows[0].id
    const redQuery = (await db.query(`SELECT id FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id=$1`, [notes.vermelho])).rows[0].id
    await db.query(`INSERT INTO public.nfe_fiscal_eventos(consulta_id,fundo_id,nota_fiscal_id,codigo,descricao,protocolo,fato_em,observado_em,registrado,severidade,fingerprint)
      VALUES($1,$2,$3,'110110','Carta de correcao sintetica',NULL,now()-interval '1 hour',now(),true,'AMARELO',$4),
            ($5,$2,$6,'110111','Cancelamento sintetico confirmado',NULL,now()-interval '1 hour',now(),true,'VERMELHO',$7)`,
    [yellowQuery, fundA, notes.amarelo, 'c'.repeat(64), redQuery, notes.vermelho, 'd'.repeat(64)])
    await db.query('COMMIT')

    const actorEntries = Object.entries(actors)
    const direct = {}
    for (const [name, actor] of actorEntries) {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${actor.token}` } },
      })
      const rows = await client.from('nfe_fiscal_consultas').select('nota_fiscal_id')
      const rpc = await client.rpc('obter_situacao_fiscal_nfe', { p_nota_fiscal_id: notes.verde })
      direct[name] = { rows: rows.data?.length ?? null, selectError: rows.error?.code ?? null, rpcAllowed: !rpc.error }
    }
    const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, authOptions)
    const anonymousRows = await anonymous.from('nfe_fiscal_consultas').select('id')
    direct.anonymous = { rows: anonymousRows.data?.length ?? null, selectError: anonymousRows.error?.code ?? null }
    assert.deepEqual({
      gestor: direct.gestor.rows,
      gestorOther: direct.gestorOther.rows,
      admin: direct.admin.rows,
      cedente: direct.cedente.rows,
      consultor: direct.consultor.rows,
      sacado: direct.sacado.rows,
    }, { gestor: 4, gestorOther: 1, admin: 5, cedente: 0, consultor: 0, sacado: 0 })
    assert.equal(direct.gestor.rpcAllowed, true)
    assert.equal(direct.gestorOther.rpcAllowed, false)
    assert.equal(direct.cedente.rpcAllowed, false)
    assert.equal(direct.consultor.rpcAllowed, false)
    assert.equal(direct.sacado.rpcAllowed, false)
    assert.ok(direct.anonymous.selectError)
    const persistedProvider = (await db.query(`SELECT capability_state,circuit_state,daily_budget,calls_today FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO'`)).rows[0]
    assert.deepEqual(persistedProvider, { capability_state: 'UNVERIFIED', circuit_state: 'OPEN', daily_budget: 0, calls_today: 0 })

    await writeFile(credentialsPath, JSON.stringify({ actors, notes, fundA, fundB }))
    await writeFile(process.env.S1_BROWSER_REPORT, JSON.stringify({
      result: 'SEEDED', syntheticOnly: true, realAuth: true, realTotpEnrollment: true, direct,
      providerState: persistedProvider, actorIds: Object.fromEntries(actorEntries.map(([name, actor]) => [name, actor.id])), notes,
    }, null, 2))
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.end()
  }
}

async function browserQa() {
  const fixture = JSON.parse(await readFile(credentialsPath, 'utf8'))
  const seedReport = JSON.parse(await readFile(process.env.S1_BROWSER_REPORT, 'utf8'))
  const executablePath = process.env.S1_BROWSER_EXECUTABLE
  assert.equal(executablePath, '/usr/bin/chromium')
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    dumpio: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  let externalRequests = 0
  const screenshots = []
  async function pageFor(actorName) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = request.url()
      if (/^https?:/.test(url) && new URL(url).hostname !== '127.0.0.1') {
        externalRequests += 1
        void request.abort()
      } else void request.continue()
    })
    const actor = fixture.actors[actorName]
    await page.goto('http://127.0.0.1:57860/login', { waitUntil: 'networkidle0' })
    await page.type('#email', actor.email)
    await page.type('#password', actor.password)
    await page.click('button[type=submit]')
    await page.waitForFunction(() => location.pathname === '/mfa/desafio', { timeout: 30000 })
    await page.waitForSelector('input[name="code"]', { timeout: 45000 })
    const seconds = Math.floor(Date.now() / 1000) % 30
    if (seconds > 26) await new Promise(resolve => setTimeout(resolve, (31 - seconds) * 1000))
    await page.type('input[name="code"]', totp(actor.secret))
    await page.click('button[type=submit]')
    await page.waitForFunction(() => !location.pathname.startsWith('/mfa'), { timeout: 30000 })
    return { context, page }
  }
  async function body(page) {
    return page.$eval('body', element => element.innerText)
  }
  async function waitPortalReady(page) {
    await page.waitForFunction(
      () => !document.body.innerText.includes('Carregando portal...'),
      { timeout: 45000 },
    )
  }
  try {
    const gestor = await pageFor('gestor')
    const expected = {
      verde: 'Conferida na cobertura disponível',
      amarelo: 'Requer análise',
      vermelho: 'Impedimento fiscal identificado',
      neutro: 'Sem conclusão',
    }
    const severityDom = {}
    for (const [name, label] of Object.entries(expected)) {
      const url = `http://127.0.0.1:57860/gestor/notas-fiscais/${fixture.notes[name]}`
      await gestor.page.goto(url, { waitUntil: 'networkidle0' })
      await waitPortalReady(gestor.page)
      const text = await body(gestor.page)
      assert.match(text, /Situação fiscal da NF-e/)
      assert.ok(text.includes(label), `DOM_SEVERITY_MISSING:${name}`)
      severityDom[name] = { url, label, passed: true }
    }
    const gestorShot = '/reports/s1-gestor-neutro.png'
    await gestor.page.screenshot({ path: gestorShot, fullPage: true })
    screenshots.push(gestorShot)
    await gestor.page.setCookie({ name: 'bw_fundo_ativo_id', value: fixture.fundB, url: 'http://127.0.0.1:57860' })
    await gestor.page.goto(`http://127.0.0.1:57860/gestor/notas-fiscais/${fixture.notes.otherFund}`, { waitUntil: 'networkidle0' })
    await waitPortalReady(gestor.page)
    const forgedFundBody = await body(gestor.page)
    assert.ok(forgedFundBody.includes('Nota fiscal nao encontrada.') || forgedFundBody.includes('Nota fiscal não encontrada.'))
    assert.ok(!forgedFundBody.includes('Situação fiscal da NF-e'))
    await gestor.context.close()

    const adminPage = await pageFor('admin')
    const adminUrl = `http://127.0.0.1:57860/admin/notas-fiscais/${fixture.notes.vermelho}`
    await adminPage.page.goto(adminUrl, { waitUntil: 'networkidle0' })
    await waitPortalReady(adminPage.page)
    const adminBody = await body(adminPage.page)
    assert.match(adminBody, /Visão fiscal privativa do Super Admin/)
    assert.match(adminBody, /Impedimento fiscal identificado/)
    const adminShot = '/reports/s1-admin-vermelho.png'
    await adminPage.page.screenshot({ path: adminShot, fullPage: true })
    screenshots.push(adminShot)
    await adminPage.context.close()

    const negativeDom = {}
    for (const name of ['cedente', 'consultor', 'sacado']) {
      const actorPage = await pageFor(name)
      await actorPage.page.goto(`http://127.0.0.1:57860/gestor/notas-fiscais/${fixture.notes.verde}`, { waitUntil: 'networkidle0' })
      await waitPortalReady(actorPage.page)
      const text = await body(actorPage.page)
      const denied = !text.includes('Situação fiscal da NF-e')
      assert.equal(denied, true, `NEGATIVE_DOM_EXPOSED:${name}`)
      negativeDom[name] = { finalPath: new URL(actorPage.page.url()).pathname, fiscalCardAbsent: true }
      await actorPage.context.close()
    }
    const anonContext = await browser.createBrowserContext()
    const anonPage = await anonContext.newPage()
    await anonPage.goto(`http://127.0.0.1:57860/gestor/notas-fiscais/${fixture.notes.verde}`, { waitUntil: 'networkidle0' })
    assert.equal(new URL(anonPage.url()).pathname, '/login')
    negativeDom.anonymous = { finalPath: '/login', fiscalCardAbsent: true }
    await anonContext.close()
    assert.equal(externalRequests, 0)
    const report = {
      ...seedReport,
      result: 'PASS', realBrowser: true, browserEngine: 'Chromium', realPasswordAndTotp: true,
      localEvidenceBaseUrl: 'http://127.0.0.1:57860', severityDom, negativeDom,
      crossFundDom: { forgedCookieRejected: true, fiscalCardAbsent: true },
      screenshots: screenshots.map(path => path.replace('/reports/', '')), externalRequests,
      serproHttpCalls: 0,
    }
    await writeFile(process.env.S1_BROWSER_REPORT, JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

if (mode === '--seed') await seed()
else await browserQa()
