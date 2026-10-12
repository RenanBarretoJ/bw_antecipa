import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { inspectEmailResponses } from './browser-redaction.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'email05-finalization-'))
  const gate = deferred(), started = deferred(), cdp = new EventEmitter(), page = new EventEmitter()
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const object = 'notas-fiscais/reservation/generation/original.pdf', seconds = Math.floor(Date.now() / 1000)
  const url = 'https://preview-ref.supabase.co/storage/v1/object/sign/' + object + '?token='
    + encode({ alg: 'HS512', kid: 'synthetic-key' }) + '.' + encode({ url: object, scope: 'download', iat: seconds, exp: seconds + 600 }) + '.syntheticSignature'
  cdp.send = async method => method === 'Fetch.getResponseBody' ? { body: '1:' + JSON.stringify({ success: true, url }), base64Encoded: false } : {}
  page.createCDPSession = async () => cdp
  page.content = async () => '<main>Detail ready</main>'
  const file = join(root, 'evidence.json')
  const inspection = await inspectEmailResponses(page, { file, signedUrlPolicy: {
    appOrigin: 'https://preview.invalid', storageOrigin: 'https://preview-ref.supabase.co', allowedBuckets: ['notas-fiscais'], maxTtlSeconds: 600,
    authorize: async () => { started.resolve(); await gate.promise; return { actorAuthenticated: true, authorized: true, scopeMatches: true, crossFundDenied: true } },
    verifySignature: async () => true,
  } })
  const respond = () => {
    const request = { method: 'POST', url: 'https://preview.invalid/cedente/notas-fiscais/synthetic', headers: {} }
    cdp.emit('Network.requestWillBeSent', { requestId: 'network', request, type: 'XHR' })
    cdp.emit('Fetch.requestPaused', { requestId: 'fetch', networkId: 'network', request, resourceType: 'XHR', responseStatusCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'text/x-component' }] })
  }
  try { await run({ inspection, respond, gate, started, file }) }
  finally {
    gate.resolve(); await inspection.flush()
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'email05-finalization-'))
    await rm(root, { recursive: true, force: true })
  }
}

test('late detail after visual readiness waits for destination and semantic completion before close, 20 deterministic iterations', async () => {
  for (let iteration = 0; iteration < 20; iteration++) await fixture(async ({ inspection, respond, gate, started, file }) => {
    const destination = deferred(), readyStarted = deferred()
    let closed = false
    inspection.expectReadiness(async () => { readyStarted.resolve(); await destination.promise })
    const finished = inspection.closeAfterDrain(async () => { closed = true })
    await readyStarted.promise
    assert.equal(closed, false)
    // The source already displayed success, but only now does detail request its file.
    respond(); await started.promise
    const pending = inspection.snapshot()
    assert.equal(pending.networkInspected, 1); assert.equal(pending.networkPending, 0)
    assert.equal(pending.semanticRequired, 1); assert.equal(pending.semanticPending, 1)
    if (iteration % 2) destination.resolve()
    assert.equal(closed, false)
    gate.resolve(); await inspection.flush(); destination.resolve()
    const result = await finished
    assert.equal(closed, true); assert.equal(result.semanticComplete, 1)
    assert.equal(result.pending + result.semanticPending + result.semanticFailed, 0)
    const evidence = JSON.parse(await readFile(file, 'utf8')), timeline = evidence.protocol.timeline
    const semantic = timeline.findIndex(e => e.event === 'SEMANTIC_INSPECTION_COMPLETE')
    const clean = timeline.findIndex(e => e.event === 'FINALIZATION_ASSERT_CLEAN')
    const close = timeline.findIndex(e => e.event === 'FINALIZATION_CLOSE')
    assert.ok(semantic >= 0 && semantic < clean && clean < close)
    assert.equal(evidence.rows[0].signedUrls[0].classification, 'EXPECTED_EPHEMERAL_SIGNED_URL')
    assert.ok(!JSON.stringify(evidence).includes('syntheticSignature'))
  })
})

test('semantic inspection that never completes fails before forced close; it never reaches assertClean', () => fixture(async ({ inspection, respond, started, file }) => {
  respond(); await started.promise
  let closed = false
  await assert.rejects(inspection.closeAfterDrain(async () => { closed = true }, { ready: async () => {}, timeoutMs: 30 }), /SEMANTIC_DRAIN_TIMEOUT/)
  assert.equal(closed, true)
  const evidence = JSON.parse(await readFile(file, 'utf8')), timeline = evidence.protocol.timeline
  assert.equal(evidence.summary.semanticPending, 1)
  assert.ok(!timeline.some(e => e.event === 'FINALIZATION_ASSERT_CLEAN'))
  assert.ok(timeline.findIndex(e => e.event === 'SEMANTIC_DRAIN_TIMEOUT') < timeline.findIndex(e => e.event === 'FINALIZATION_CLOSE'))
  assert.ok(evidence.failures.some(e => e.kind === 'SEMANTIC_DRAIN_TIMEOUT'))
}))

test('destination readiness cannot be omitted or replaced by a clean momentary snapshot', () => fixture(async ({ inspection }) => {
  await assert.rejects(inspection.settleAndAssertClean(), /DESTINATION_READINESS_REQUIRED/)
}))

test('blocked destination with pending semantic work reports semantic timeout before forced disposal', () => fixture(async ({ inspection, respond, started, file }) => {
  respond(); await started.promise
  await assert.rejects(inspection.closeAfterDrain(async () => {}, { ready: () => new Promise(() => {}), timeoutMs: 30 }), /SEMANTIC_DRAIN_TIMEOUT/)
  const evidence = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(evidence.protocol.timeline.at(-1).event, 'FINALIZATION_CLOSE')
  assert.equal(evidence.protocol.timeline.at(-1).forced, true)
  assert.ok(!evidence.protocol.timeline.some(e => e.event === 'FINALIZATION_ASSERT_CLEAN'))
}))
