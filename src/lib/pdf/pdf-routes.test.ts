import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/auth/authorization'
import { POST as contrato } from '@/app/api/contratos/gerar-contrato/route'
import { POST as termo } from '@/app/api/contratos/gerar-termo/route'
import { POST as notificacao } from '@/app/api/contratos/gerar-notificacao/route'
import { POST as quitacao } from '@/app/api/contratos/gerar-quitacao/route'
import { PDF_PUBLIC_ERROR } from './pdf-telemetry'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), generate: vi.fn() }))
vi.mock('@/lib/auth/authorization', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/authorization')>(), requireGestor: mocks.auth,
}))
vi.mock('@/lib/pdf/gerarContrato', () => ({
  gerarContratoCessao: mocks.generate, gerarTermoCessao: mocks.generate,
  gerarNotificacaoCessao: mocks.generate, gerarTermoQuitacao: mocks.generate,
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'gestor-id' } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
const request = (payload: object) => new NextRequest('https://example.test/api/contratos/gerar', {
  method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
})

describe.each([['contrato', contrato], ['termo', termo], ['notificacao', notificacao], ['quitacao', quitacao]] as const)('rota PDF %s', (_, handler) => {
  it('retorna mensagem amigável sem erro técnico, caminho ou stack', async () => {
    mocks.generate.mockRejectedValue(Object.assign(new Error('spawn ETXTBSY /tmp/chromium secret'), { code: 'ETXTBSY', path: '/tmp/chromium' }))
    const response = await handler(request({ cedente_id: 'cedente-id', operacao_id: 'operacao-id' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: PDF_PUBLIC_ERROR })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })

  it('preserva autorização e não chama o gerador sem acesso', async () => {
    mocks.auth.mockRejectedValue(new AuthorizationError('Acesso negado.', 'FORBIDDEN'))
    const response = await handler(request({ cedente_id: 'id', operacao_id: 'id' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Acesso negado.' })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('preserva validação de payload e resposta de sucesso', async () => {
    expect((await handler(request({}))).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
    mocks.generate.mockResolvedValue({ url: 'signed-existing-contract', path: 'stored-path' })
    const response = await handler(request({ cedente_id: 'id', operacao_id: 'id' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'signed-existing-contract', path: 'stored-path', sucesso: true })
    expect(mocks.generate.mock.calls[0][1]).toBe('gestor-id')
  })
})
