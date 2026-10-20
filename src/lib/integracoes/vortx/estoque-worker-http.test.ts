import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { executarWorkerEstoque } from './estoque-worker-http.server'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token = 'a'.repeat(64)
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true',
  VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_STOCK_PROCESSING_ENABLED: 'true', VORTX_REPORT_DOWNLOAD_HOSTS: 'reports.example.invalid',
  VORTX_REPORT_STOCK_WORKER_HASH: createHash('sha256').update(token).digest('hex') }
const request = (change: RequestInit = {}, query = '') => new Request('https://example.invalid/processar' + query,
  { method: 'POST', headers: { authorization: `Bearer ${token}` }, ...change })
describe('machine-only stock processing HTTP boundary', () => {
  it.each(['production', 'development'])('does not process outside Preview: %s', async VERCEL_ENV => {
    const run = vi.fn()
    expect((await executarWorkerEstoque(request(), { ...env, VERCEL_ENV }, run)).status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
  it.each(['', 'Bearer wrong', `Bearer ${'b'.repeat(64)}`])('does not accept other credentials', async authorization => {
    const run = vi.fn()
    expect((await executarWorkerEstoque(request({ headers: { authorization } }), env, run)).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })
  it.each([request({ body: '{}' }), request({}, '?fundo=' + id), request({ method: 'GET' })])('rejects caller-selected payload/scope/method', async req => {
    const run = vi.fn()
    expect([400, 405]).toContain((await executarWorkerEstoque(req, env, run)).status)
    expect(run).not.toHaveBeenCalled()
  })
  it('accepts a zero-byte transport body and reports waiting honestly', async () => {
    const run = vi.fn().mockResolvedValue({ estado: 'AGUARDANDO_PAR' })
    const response = await executarWorkerEstoque(request({ body: '' }), env, run)
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ estado: 'AGUARDANDO_PAR' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('does not expose backend exceptions', async () => {
    const response = await executarWorkerEstoque(request(), env, vi.fn().mockRejectedValue(new Error('https://private?token=synthetic')))
    expect(response.status).toBe(503); expect(await response.text()).toBe('')
  })
})
