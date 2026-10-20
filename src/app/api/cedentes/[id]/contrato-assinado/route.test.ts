import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const service = vi.hoisted(() => ({ autorizar: vi.fn(), anexar: vi.fn() }))
vi.mock('@/lib/contratos/contrato-assinado.server', () => ({
  autorizarContratoAssinadoCedente: service.autorizar, anexarContratoAssinadoCedente: service.anexar,
}))
import { AuthorizationError } from '@/lib/auth/authorization'
import { DocumentoAssinadoOperacaoError } from '@/lib/operacoes/documentos-assinados'
import { POST } from './route'

const id = 'ab000000-0000-4000-8000-000000000001'
const origin = 'https://portal.example.invalid'
const context = () => ({ params: Promise.resolve({ id }) })
function request(form?: FormData, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/cedentes/${id}/contrato-assinado`, { method: 'POST', headers: { origin, ...headers }, body: form })
}
function form() {
  const f = new FormData(); f.append('arquivo', new File(['%PDF-1.7\n'], 'contrato.pdf', { type: 'application/pdf' })); return f
}
beforeEach(() => {
  vi.clearAllMocks(); service.autorizar.mockResolvedValue({}); service.anexar.mockResolvedValue({ path: 'privado.pdf' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
describe('API de contrato assinado do Cedente', () => {
  it('salva por entidade e nao permite cache', async () => {
    const response = await POST(request(form()), context())
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ path: 'privado.pdf' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(service.anexar).toHaveBeenCalledWith(id, expect.any(File))
  })
  it.each(['https://outro.example.invalid', 'null', ''])('nega origem %s antes de ler arquivo', async origem => {
    expect((await POST(request(form(), { origin: origem }), context())).status).toBe(403)
    expect(service.autorizar).not.toHaveBeenCalled(); expect(service.anexar).not.toHaveBeenCalled()
  })
  it('autoriza antes de processar multipart', async () => {
    service.autorizar.mockRejectedValue(new AuthorizationError('Sessão inválida', 'FORBIDDEN'))
    const req = request(form()); const parse = vi.spyOn(req, 'formData')
    expect((await POST(req, context())).status).toBe(403)
    expect(parse).not.toHaveBeenCalled(); expect(service.anexar).not.toHaveBeenCalled()
  })
  it('nega body acima do limite antes de parsear', async () => {
    const req = request(form(), { 'content-length': '5000000' }); const parse = vi.spyOn(req, 'formData')
    expect((await POST(req, context())).status).toBe(413); expect(parse).not.toHaveBeenCalled()
  })
  it.each(['bucket', 'path', 'fundo_id', 'user_id', 'cedente_id'])('nega campo nao contratado: %s', async campo => {
    const f = form(); f.append(campo, 'adulterado')
    expect((await POST(request(f), context())).status).toBe(400); expect(service.anexar).not.toHaveBeenCalled()
  })
  it('nega multiplos arquivos', async () => {
    const f = form(); f.append('arquivo', new File(['%PDF-'], 'outro.pdf'))
    expect((await POST(request(f), context())).status).toBe(400)
  })
  it('nega campo textual em lugar de arquivo', async () => {
    const f = new FormData(); f.append('arquivo', 'documento.pdf')
    expect((await POST(request(f), context())).status).toBe(400)
  })
  it('nega multipart invalido', async () => {
    expect((await POST(request(), context())).status).toBe(400)
  })
  it('retorna conflito de dominio sem mascarar com sucesso', async () => {
    service.anexar.mockRejectedValue(new DocumentoAssinadoOperacaoError('Contrato alterado. Atualize.', 409, 'CONCURRENT_REPLACEMENT'))
    const response = await POST(request(form()), context()); expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Contrato alterado. Atualize.' })
  })
  it('nao expoe erro SQL, paths ou segredos', async () => {
    service.anexar.mockRejectedValue(new Error('new row violates RLS storage/privado segredo'))
    const response = await POST(request(form()), context()); expect(response.status).toBe(500)
    const body = await response.text(); expect(body).not.toMatch(/RLS|storage|segredo/)
  })
})
