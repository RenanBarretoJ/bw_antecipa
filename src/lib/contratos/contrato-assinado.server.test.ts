import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), fundo: vi.fn(), admin: vi.fn(), mfa: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ exigirSessaoElevada: mocks.mfa }))
vi.mock('@/lib/auth/authorization', async original => ({ ...await original<typeof import('@/lib/auth/authorization')>(), requireGestor: mocks.auth }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: mocks.fundo }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: mocks.admin, createClient: vi.fn() }))
import { AuthorizationError } from '@/lib/auth/authorization'
import { anexarContratoAssinadoCedente } from './contrato-assinado.server'
import { MAX_CONTRATO_ASSINADO_BYTES } from './contrato-assinado-config'

const cedenteId = 'ab000000-0000-4000-8000-000000000001'
const fundoId = 'ab000000-0000-4000-8000-000000000002'
const usuarioId = 'ab000000-0000-4000-8000-000000000003'
const file = () => new File(['%PDF-1.7\n'], 'assinado.pdf', { type: 'application/pdf' })
let upload: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>
let consulta: ReturnType<typeof vi.fn>
let cedente: { id: string; contrato_assinado_url: string | null } | null
let vinculo: { id: string } | null
let consultaError: { message: string } | null

function query(tabela: string) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: tabela === 'cedentes' ? cedente : vinculo, error: consultaError })),
  }
  return builder
}
beforeEach(() => {
  cedente = { id: cedenteId, contrato_assinado_url: null }; vinculo = { id: 'vinculo' }; consultaError = null
  upload = vi.fn().mockResolvedValue({ error: null }); remove = vi.fn().mockResolvedValue({ error: null })
  rpc = vi.fn(async (_nome, args) => ({ data: args.p_path_novo, error: null }))
  consulta = vi.fn(query)
  mocks.auth.mockResolvedValue({ user: { id: usuarioId }, supabase: { from: consulta, rpc } })
  mocks.mfa.mockResolvedValue(undefined)
  mocks.fundo.mockResolvedValue({ fundoId, perfilNoFundo: 'gestor' })
  mocks.admin.mockReturnValue({ storage: { from: vi.fn(() => ({ upload, remove })) } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('upload canonico de contrato do Cedente', () => {
  it('usa objeto imutavel e RPC com JWT real, depois de autorizar', async () => {
    const result = await anexarContratoAssinadoCedente(cedenteId, file())
    expect(result.path).toMatch(new RegExp(`^cedentes/${cedenteId}/assinados/contrato-cessao/[a-f0-9-]+\\.pdf$`))
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.mock.invocationCallOrder[0])
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false, contentType: 'application/pdf', metadata: { usuario_id: usuarioId, fundo_id: fundoId } })
    expect(rpc).toHaveBeenCalledWith('registrar_contrato_assinado_cedente', expect.objectContaining({ p_cedente_id: cedenteId, p_fundo_id: fundoId, p_path_anterior: null }))
    expect(remove).not.toHaveBeenCalled()
  })
  it.each(['UNAUTHENTICATED', 'FORBIDDEN'] as const)('nega sessao/perfil/MFA: %s antes de acessar Storage', async code => {
    mocks.auth.mockRejectedValue(new AuthorizationError('Negado', code))
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toThrow('Negado')
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('nega identificador adulterado', async () => {
    await expect(anexarContratoAssinadoCedente('../outro', file())).rejects.toMatchObject({ status: 400 })
    expect(mocks.auth).not.toHaveBeenCalled()
  })
  it('nega fluxo restrito de autenticacao antes de criar cliente de Storage', async () => {
    mocks.mfa.mockRejectedValue(new AuthorizationError('Sessão restrita', 'FORBIDDEN'))
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toMatchObject({ status: 403 })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('nega auditor no Fundo ativo', async () => {
    mocks.fundo.mockResolvedValue({ fundoId, perfilNoFundo: 'auditor' })
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toMatchObject({ status: 403 })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it.each(['sem cedente', 'sem vinculo'] as const)('nega cross-fund/RLS: %s', async caso => {
    if (caso === 'sem cedente') cedente = null; else vinculo = null
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toMatchObject({ status: 404 })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('falha fechada se a consulta RLS falhar', async () => {
    consultaError = { message: 'erro interno' }
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toThrow()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it.each([
    new File(['nao pdf'], 'f.pdf', { type: 'application/pdf' }),
    new File(['%PDF-'], 'f.exe', { type: 'application/pdf' }),
    new File(['%PDF-'], 'f.pdf', { type: 'text/plain' }),
    new File([], 'f.pdf', { type: 'application/pdf' }),
    new File([new Uint8Array(MAX_CONTRATO_ASSINADO_BYTES + 1)], 'f.pdf', { type: 'application/pdf' }),
  ])('valida PDF antes do backend privado: %s', async arquivo => {
    await expect(anexarContratoAssinadoCedente(cedenteId, arquivo)).rejects.toMatchObject({ status: 400 })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('falha no upload nao tenta registrar nem apagar historico', async () => {
    upload.mockResolvedValue({ error: { message: 'RLS' } })
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toThrow('CONTRACT_UPLOAD_FAILED')
    expect(rpc).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
  })
  it('substitui referencia preservando o objeto anterior', async () => {
    cedente!.contrato_assinado_url = 'cedentes/legado/contrato.pdf'
    await anexarContratoAssinadoCedente(cedenteId, file())
    expect(rpc.mock.calls[0][1].p_path_anterior).toBe('cedentes/legado/contrato.pdf')
    expect(remove).not.toHaveBeenCalled()
  })
  it('compensa apenas objeto novo apos conflito confirmado', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001' } })
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toMatchObject({ status: 409 })
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]])
  })
  it('falha de auditoria transacional compensa o novo arquivo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toThrow()
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]])
  })
  it('nao apaga arquivo quando o commit esta incerto', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'timeout' } })
    await expect(anexarContratoAssinadoCedente(cedenteId, file())).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
  })
  it('reconhece commit confirmado apos perda de resposta, sem excluir o objeto', async () => {
    rpc.mockImplementation(async (_nome, args) => {
      cedente!.contrato_assinado_url = args.p_path_novo
      return { data: null, error: { code: '', message: 'timeout' } }
    })
    expect((await anexarContratoAssinadoCedente(cedenteId, file())).path).toBe(cedente!.contrato_assinado_url)
    expect(remove).not.toHaveBeenCalled()
  })
})
