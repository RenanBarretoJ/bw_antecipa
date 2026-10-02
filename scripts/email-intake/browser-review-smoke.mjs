import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import puppeteer from 'puppeteer-core'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'
import { prepareEmailBrowserRuntime } from './browser-runtime.mjs'

export async function verifyBrowserReview({ db, human, userId, reviewFile }) {
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57841')
  const root = dirname(process.env.EMAIL_INTAKE_SMOKE_REPORT)
  const fixturePath = resolve(root, 'graph-http-fixture.json'), counter = resolve(root, 'graph-http-downloads.txt')
  const source = (await db.query(`select v.id review_id,m.external_id message_id,a.external_id attachment_id
    from private.fiscal_identity_reservations r join public.nfse_review_intents v on v.id=r.review_intent_id
    join private.email_intake_attachments a on a.id=r.attachment_id
    join private.email_intake_messages m on m.id=a.message_id
    join private.email_integrations i on i.id=m.integration_id
    where i.name='Routing QA' and v.state='REVIEW'`)).rows
  assert.equal(source.length, 1)
  const receipt = source[0]
  await writeFile(counter, '')
  await writeFile(fixturePath, JSON.stringify({
    url: `https://graph.microsoft.com/v1.0/users/qa%40example.invalid/messages/${receipt.message_id}/attachments/${receipt.attachment_id}/$value`,
    bytes: Buffer.from(await reviewFile.arrayBuffer()).toString('base64'), counter,
  }))
  await prepareEmailBrowserRuntime(process.env, root)
  const server = spawn(process.execPath, ['--import', pathToFileURL(resolve('scripts/email-intake/graph-fixture-preload.mjs')).href,
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '57849'], {
    windowsHide: true, env: { ...process.env, NODE_ENV: 'production', EMAIL_INTAKE_GRAPH_FIXTURE: fixturePath,
      EMAIL_INTAKE_QA_SYNTHETIC_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      EMAIL_INTAKE_QA_SYNTHETIC_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
      EMAIL_INTAKE_QA_SYNTHETIC_CLIENT_SECRET: 'DISPOSABLE_QA_NOT_A_CREDENTIAL' },
  })
  let browser, page, ready = false, startup = '', pageStartup = ''
  const checks = []
  let submittedPosts = 0, submissionState
  let stage = 'SERVER_START'
  // Readiness only; never write Next server output containing action arguments.
  for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => {
    if (!ready) { startup += bytes.toString(); ready = /Ready in/.test(stripVTControlCharacters(startup)) }
    if (stage === 'AUTHENTICATED_PAGE') pageStartup += bytes.toString()
  })
  try {
    // Cold Next startup on Windows can exceed 10 seconds before its first output.
    for (let attempt = 0; attempt < 600 && !ready; attempt++) {
      if (server.exitCode !== null) throw new Error('QA_NEXT_SERVER_EXITED')
      await new Promise(r => setTimeout(r, 100))
    }
    assert.ok(ready, 'QA_NEXT_SERVER_NOT_READY')
    stage = 'AUTHENTICATED_PAGE'
    browser = await puppeteer.launch({ executablePath: process.env.EMAIL_INTAKE_QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true, args: ['--no-first-run', '--disable-dev-shm-usage'] })
    const context = await browser.createBrowserContext()
    page = await context.newPage()
    page.on('request', request => {
      if (stage === 'SUBMIT_OFFICIAL_REVIEW' && request.method() === 'POST') submittedPosts++
    })
    await page.setViewport({ width: 1440, height: 1000 })
    const session = (await human.auth.getSession()).data.session
    assert.ok(session)
    const cookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
    const chunks = cookie.match(/.{1,3180}/g), name = 'sb-127-auth-token'
    await context.setCookie(...chunks.map((value, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`,
      value, domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' })))
    await page.goto('http://127.0.0.1:57849/cedente/notas-fiscais', { waitUntil: 'networkidle2', timeout: 60000 })
    assert.ok(new URL(page.url()).pathname === '/cedente/notas-fiscais', 'QA_PAGE_AUTH_REDIRECT')
    stage = 'OPEN_OFFICIAL_EMAIL_REVIEW'
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Revisar NFS-e recebida por e-mail')), { timeout: 10000 })
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Revisar NFS-e recebida por e-mail')).click())
    await page.waitForSelector('#nfse-due-0', { timeout: 20000 })
    assert.deepEqual(await page.$eval('#nfse-due-0', e => ({ value: e.value, required: e.required })), { value: '', required: true })
    checks.push('OFFICIAL_EMAIL_REVIEW_FORM_AUTHENTICATED', 'OFFICIAL_FORM_DUE_EMPTY_REQUIRED')
    stage = 'SUBMIT_OFFICIAL_REVIEW'
    const due = (await db.query('select (current_date+40)::text due')).rows[0].due
    await page.$eval('#nfse-due-0', (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }))
    }, due)
    // Let React commit the controlled date before a real browser click.
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    const submit = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Enviar 1 arquivo')))
    assert.ok(submit.asElement(), 'QA_REVIEW_SUBMIT_MISSING')
    await submit.asElement().click()
    let completed
    for (let attempt = 0; attempt < 80; attempt++) {
      completed = (await db.query(`select v.state,v.review_actor_id,n.data_vencimento::text due,r.ingest_actor,r.actor_type
        from public.nfse_review_intents v join private.fiscal_identity_reservations r on r.review_intent_id=v.id
        left join public.notas_fiscais n on n.id=r.nota_fiscal_id where v.id=$1`, [receipt.review_id])).rows[0]
      if (completed?.state === 'COMPLETED') break
      await new Promise(r => setTimeout(r, 250))
    }
    submissionState = completed?.state
    assert.equal(completed.state, 'COMPLETED'); assert.equal(completed.review_actor_id, userId)
    assert.equal(completed.due, due); assert.equal(completed.ingest_actor.type, 'SYSTEM'); assert.equal(completed.actor_type, 'HUMAN')
    const downloads = (await readFile(counter, 'utf8')).trim().split('\n').filter(Boolean).length
    assert.ok(downloads >= 2, 'Server must fetch original on open and submit')
    checks.push('OFFICIAL_ACTION_SERVER_ORIGINAL_REEXTRACTION', 'OFFICIAL_FORM_SYSTEM_TO_HUMAN_PERSISTENCE')
    return checks
  } catch (error) {
    if (stage === 'SUBMIT_OFFICIAL_REVIEW') {
      const ui = await page.evaluate(() => ({
        due: document.querySelector('#nfse-due-0')?.value ?? null,
        missingDueWarning: document.body.innerText.includes('Informe a data de vencimento das NFS-e em revisão.'),
        importFailure: document.body.innerText.includes('Não foi possível'),
        sending: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Enviando...')),
      })).catch(() => null)
      await writeFile(resolve(root, 'browser-submit.json'), JSON.stringify({ error: error.name, submittedPosts, submissionState, ui }))
    }
    if (stage === 'SERVER_START') await writeFile(resolve(root, 'next-startup.log'), redactCommandOutput(startup))
    if (stage === 'AUTHENTICATED_PAGE') {
      await writeFile(resolve(root, 'next-page-startup.log'), redactCommandOutput(pageStartup).replace(/\d{14,}/g, '[QA_IDENTIFIER]'))
      await writeFile(resolve(root, 'browser-startup.json'), JSON.stringify({ error: error.name, path: page ? new URL(page.url()).pathname : null }))
    }
    const detail = /^QA_[A-Z_]+$/.test(error.message) ? `:${error.message}` : ''
    throw new Error(`BROWSER_REVIEW_FAILED:${stage}${detail}`)
  }
  finally {
    if (browser) await browser.close()
    // Only the process tree started above; no shared/local Supabase processes.
    if (server.exitCode === null && server.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      else server.kill('SIGTERM')
    }
  }
}
