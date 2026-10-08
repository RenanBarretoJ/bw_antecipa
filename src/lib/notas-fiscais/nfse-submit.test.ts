import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submeterNfSchema } from '@/lib/validations/nf'
import { salvarDadosNF, submeterNF } from '@/lib/actions/nota-fiscal'

const nfId = 'a1000000-0000-4000-8000-000000000001'
const cedenteId = 'a1000000-0000-4000-8000-000000000002'
const m = vi.hoisted(() => ({
  nf: {} as Record<string, unknown>, updates: [] as Record<string, unknown>[],
  auth: vi.fn(), scope: vi.fn(), validateScope: vi.fn(), checklist: vi.fn(),
  gate: vi.fn(), audit: vi.fn(), event: vi.fn(), notify: vi.fn(),
  missing: false, race: false, updateError: false, readError: false,
  filters: [] as Array<[string, unknown]>,
}))
vi.mock('@/lib/auth/authorization', () => ({ AuthorizationError: class extends Error {}, requireAuthenticated: (...args: unknown[]) => m.auth(...args), requireGestor: vi.fn() }))
vi.mock('@/lib/notas-fiscais/contexto-operacional.server', () => ({ resolverContextoOperacionalNotaFiscal: (...args: unknown[]) => m.scope(...args), validarNotaNoContextoSelecionado: (...args: unknown[]) => m.validateScope(...args) }))
vi.mock('@/lib/actions/documento-v2', () => ({ listarChecklistDaNota: (...args: unknown[]) => m.checklist(...args) }))
vi.mock('@/lib/duplicatas/gate.server', () => ({ avaliarGateDuplicatasDaNota: (...args: unknown[]) => m.gate(...args) }))
vi.mock('@/lib/actions/auditoria', () => ({ registrarLog: (...args: unknown[]) => m.audit(...args) }))
vi.mock('@/lib/actions/notificacao', () => ({ notificarGestores: (...args: unknown[]) => m.notify(...args), notificarCedente: vi.fn() }))
vi.mock('@/lib/eventos-dominio/registrar', () => ({ carregarContextoEventoNota: async () => ({}), registrarEventoDominio: (...args: unknown[]) => m.event(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => {
  const client = {
    from: (table: string) => {
      let patch: Record<string, unknown> | undefined
      const result = () => {
        if (table === 'notas_fiscais') {
          if (patch) {
            if (m.updateError) return { data: null, error: { message: 'test update failed' } }
            if (m.race) return { data: null, error: null }
            m.nf = { ...m.nf, ...patch }
          }
          return { data: m.missing ? null : structuredClone(m.nf), error: m.readError ? { message: 'test read failed' } : null }
        }
        if (table === 'cedente_fundos') return { data: { id: 'link', status: 'ativo', fundo_id: 'fund' }, error: null }
        if (table === 'fundos') return { data: { id: 'fund', ativo: true }, error: null }
        return { data: null, error: null }
      }
      const q = {
        select: () => q, limit: () => q,
        eq: (key: string, value: unknown) => { m.filters.push([key, value]); return q },
        update: (value: Record<string, unknown>) => { patch = value; m.updates.push(value); return q },
        maybeSingle: async () => result(),
      }
      return q
    },
  }
  return { createClient: async () => client, createAdminClient: vi.fn(() => { throw new Error('Admin client forbidden') }) }
})

beforeEach(() => {
  vi.clearAllMocks()
  m.updates = []; m.filters = []; m.missing = false; m.race = false; m.updateError = false; m.readError = false
  m.nf = {
    id: nfId, status: 'rascunho', cedente_id: cedenteId, cedente_fundo_id: 'link', fundo_id: 'fund',
    tipo_documento_fiscal: 'NFSE', numero_nf: 'QA-9001', serie: null, chave_acesso: null,
    data_emissao: '2026-10-02', data_vencimento: '2099-10-15',
    cnpj_emitente: '11222333000181', cnpj_destinatario: '11444777000161',
    razao_social_emitente: 'EMITENTE QA', razao_social_destinatario: 'SACADO QA',
    valor_bruto: 1234.56, valor_liquido: null, valor_liquido_origem: 'NAO_INFORMADO',
    vencimento_origem: 'MANUAL', arquivo_url: 'synthetic/original.pdf',
    fiscal_proveniencia: { source: 'PDF_VISUAL_FALLBACK', strategy: 'nfse_municipal_visual', codigo_verificacao: 'QA-CODE', vencimento_documento: null },
  }
  m.auth.mockResolvedValue({ user: { id: 'actor' }, profile: { role: 'cedente' } })
  m.scope.mockResolvedValue({ actorUserId: 'actor', actorRole: 'cedente', cedente: { id: cedenteId, razao_social: 'EMITENTE QA' }, cedenteFundoId: 'link', fundoId: 'fund' })
  m.validateScope.mockResolvedValue({ id: nfId })
  m.checklist.mockResolvedValue({ estadoChecklist: { estado: 'completo' }, gateLogisticoPreCessao: { exigido: false }, preCessao: [] })
  m.gate.mockResolvedValue({ permitido: true })
})

describe('authoritative NF submission through the real server action', () => {
  it.each([
    ['NFSE manual due / null liquid', {}],
    ['NFSE document due', { vencimento_origem: 'DOCUMENT', fiscal_proveniencia: { vencimento_documento: '2099-10-15' } }],
    ['NFSE no verification code', { fiscal_proveniencia: { codigo_verificacao: null } }],
    ['NFSE optional null provenance', { fiscal_proveniencia: null }],
    ['NFSE formatted CNPJ', { cnpj_emitente: '11.222.333/0001-81' }],
    ['NFSE serialized dates', { data_emissao: '2026-10-02T00:00:00Z' }],
    ['XML NFE', { tipo_documento_fiscal: 'NFE', arquivo_url: 'synthetic/original.xml', valor_liquido: 1234.56 }],
    ['digital DANFE', { tipo_documento_fiscal: 'NFE', fiscal_proveniencia: { source: 'PDF_TEXT' } }],
    ['visual DANFE', { tipo_documento_fiscal: 'NFE', fiscal_proveniencia: { source: 'PDF_VISUAL_FALLBACK' } }],
    ['legacy', { tipo_documento_fiscal: null, fiscal_proveniencia: null }],
  ])('submits %s without rewriting fiscal fields', async (_name, changes) => {
    Object.assign(m.nf, changes)
    const before = structuredClone(m.nf)
    expect(await submeterNF({ nfId })).toMatchObject({ success: true, code: 'NF_SUBMITTED' })
    expect(m.updates).toHaveLength(1)
    expect(Object.keys(m.updates[0]).sort()).toEqual(['status', 'submetida_em', 'submetida_por'])
    expect(m.nf).toEqual({ ...before, ...m.updates[0] })
    expect(m.filters).toContainEqual(['cedente_fundo_id', 'link'])
    expect(m.filters).toContainEqual(['fundo_id', 'fund'])
    expect(m.audit).toHaveBeenCalledOnce()
    expect(m.audit.mock.calls[0][0].tipo_evento).toBe('NF_SUBMETIDA')
    expect(m.event).toHaveBeenCalledOnce()
    expect(m.notify).toHaveBeenCalledOnce()
  })

  const tamperFields = ['valor_bruto', 'valor_liquido', 'numero_nf', 'cnpj_emitente', 'cnpj_destinatario', 'data_emissao', 'tipo_documento_fiscal', 'fiscal_proveniencia', 'chave_acesso', 'serie', 'codigo_verificacao', 'razao_social_emitente', 'razao_social_destinatario', 'data_vencimento', 'vencimento_origem', 'fundo_id']
  it.each(tamperFields)('explicitly denies extra %s, rather than stripping it', async field => {
    const input = { nfId, [field]: 'FORGED' }
    expect(submeterNfSchema.safeParse(input).success).toBe(false)
    expect(await submeterNF(input)).toMatchObject({ success: false, code: 'NF_SUBMISSAO_PAYLOAD_INVALIDO' })
    expect(m.updates).toEqual([])
    expect(m.scope).not.toHaveBeenCalled()
  })

  it.each(tamperFields)('denies legacy save payload containing %s on an imported NFSE', async field => {
    // Deliberately cross the runtime boundary without relying on TypeScript.
    const payload = JSON.parse(JSON.stringify({ [field]: 'FORGED' }))
    expect(await salvarDadosNF(nfId, payload)).toMatchObject({ success: false, code: 'NFSE_FISCAL_IMMUTABLE' })
    expect(m.updates).toEqual([])
  })
  it('denies an invalid ID', async () => {
    expect((await submeterNF({ nfId: 'invalid' }))?.success).toBe(false)
    expect(m.updates).toEqual([])
  })
  it('revalidates authentication', async () => {
    m.auth.mockRejectedValue(new Error('Unauthenticated'))
    await expect(submeterNF({ nfId })).rejects.toThrow('Unauthenticated')
    expect(m.updates).toEqual([])
  })
  it('denies a consultant without operational scope', async () => {
    m.scope.mockRejectedValue(new Error('Forbidden'))
    expect((await submeterNF({ nfId, cedenteIdInformado: cedenteId }))?.success).toBe(false)
    expect(m.updates).toEqual([])
  })
  it('denies an NF outside the selected fund/tenant', async () => {
    m.missing = true
    expect((await submeterNF({ nfId }))?.code).toBe('NF_NOT_FOUND')
    expect(m.updates).toEqual([])
  })
  it('denies duplicate submission with no extra events', async () => {
    expect((await submeterNF({ nfId }))?.success).toBe(true)
    expect((await submeterNF({ nfId }))?.code).toBe('NF_NOT_RASCUNHO')
    expect(m.updates).toHaveLength(1)
    expect(m.event).toHaveBeenCalledOnce()
  })
  it('does not submit without the persisted due date', async () => {
    m.nf.data_vencimento = null
    expect((await submeterNF({ nfId }))?.code).toBe('NF_INELEGIVEL_SUBMISSAO')
    expect(m.updates).toEqual([])
  })
  it('keeps the documentary gate', async () => {
    m.checklist.mockResolvedValue({ estadoChecklist: { estado: 'completo' }, gateLogisticoPreCessao: { exigido: true, permitidoSubmissao: false } })
    expect((await submeterNF({ nfId }))?.code).toBe('LOGISTICA_PRE_CESSAO_PENDENTE')
    expect(m.updates).toEqual([])
  })
  it('keeps the duplicate gate', async () => {
    m.gate.mockResolvedValue({ permitido: false })
    expect((await submeterNF({ nfId }))?.code).toBe('DUPLICATAS_PENDENTES')
    expect(m.updates).toEqual([])
  })
  it('does not log successful submission after a race', async () => {
    m.race = true
    expect((await submeterNF({ nfId }))?.code).toBe('NF_CONCORRENCIA')
    expect(m.audit).not.toHaveBeenCalled()
  })
  it('does not log successful submission after a database failure', async () => {
    m.updateError = true
    expect((await submeterNF({ nfId }))?.code).toBe('NF_SUBMISSAO_ERROR')
    expect(m.audit).not.toHaveBeenCalled()
  })
})
