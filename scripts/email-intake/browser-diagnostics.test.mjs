import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { diagnosticPath, instrumentEmailBrowser } from './browser-diagnostics.mjs'

test('diagnostics discard signed query, Storage path and dynamic identity', () => {
  assert.equal(diagnosticPath('https://qa.invalid/storage/v1/object/sign/invoices/private.xml?token=SECRET'), '/storage/[redacted]')
  assert.equal(diagnosticPath('https://qa.invalid/admin/integracoes-email?fundo=SECRET'), '/admin/integracoes-email')
  assert.equal(diagnosticPath('https://qa.invalid/gestor/notas-fiscais/12345678-1234-1234-1234-123456789abc'), '/gestor/notas-fiscais/[redacted]')
})

test('pending request evidence survives timeout without capturing headers, bodies or error text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'email05-diagnostic-'))
  try {
    const page = new EventEmitter()
    page.exposeFunction = async () => {}
    page.evaluateOnNewDocument = async () => {}
    page.createCDPSession = async () => Object.assign(new EventEmitter(), { send: async () => {} })
    page.waitForNetworkIdle = async options => { assert.equal(options.timeout, 60000); throw Error('CONTROLLED_TIMEOUT') }
    const file = join(root, 'diagnostics.json'), diagnostic = await instrumentEmailBrowser(page, file)
    const request = { method: () => 'GET', url: () => 'https://qa.invalid/admin/integracoes-email?token=SECRET', resourceType: () => 'fetch', headers: () => { throw Error('FORBIDDEN') }, postData: () => { throw Error('FORBIDDEN') } }
    page.emit('request', request)
    await assert.rejects(diagnostic.idle('INBOX'), /CONTROLLED_TIMEOUT/)
    const pending = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(pending.pending.length, 1); assert.equal(pending.pending[0].pathname, '/admin/integracoes-email')
    page.emit('response', { request: () => request, status: () => 503 })
    page.emit('requestfinished', request)
    page.emit('console', { type: () => 'error', args: () => [], location: () => ({ url: 'https://qa.invalid/?token=SECRET' }), text: () => 'Failed to fetch RSC payload for https://qa.invalid/?token=SECRET' })
    await new Promise(resolve => setImmediate(resolve))
    await diagnostic.save()
    const raw = await readFile(file, 'utf8'), completed = JSON.parse(raw)
    assert.equal(completed.pending.length, 0); assert.equal(completed.requests[0].status, 503)
    assert.equal(completed.events[0].kind, 'CONSOLE_ERROR'); assert.equal(raw.includes('SECRET'), false)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'email05-diagnostic-'))
    await rm(root, { recursive: true, force: true })
  }
})
