import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepararSolicitacaoRelatorioVortx } from './relatorios-contrato'
import { interpretarCallbackRelatorio, prepararEventoCallback } from './relatorios-callback'
import { normalizarTipoCallbackVortx } from './relatorios-tipos'
import { criarRepositorioCallbackRelatorio } from './relatorios-callback-repository.server'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const raw = { tipoWebhook: 'statusRelatorio', idRelatorio: id, idCarteira: 'qa-wallet', tipoRelatorio: 'posicao parcela',
  dataReferencia: '2026-10-19', dataInicio: '1900-01-01', dataFim: '1900-01-01', statusRelatorio: 'Disponível',
  urlRelatorio: 'https://example.invalid/report?synthetic=true', dataExpiracao: '2026-10-22T17:55:36Z' }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('report-specific Vortx semantics', () => {
  it.each([['posicao parcela', 'PosicaoParcela'], ['posição ativo', 'PosicaoAtivo'], ['inclusao', 'Inclusao'],
    ['INCLUSÃO', 'Inclusao'], ['exclusao', 'Exclusao'], ['Exclusão', 'Exclusao']])('maps the explicit vocabulary %s to %s', (input, canonical) => {
    expect(normalizarTipoCallbackVortx(input)).toBe(canonical)
  })
  it.each(['inclusao-evil', 'posicao ativo extra', 'posicao par cela', 'Consolidado', '__proto__', 'constructor', 'Devolucao'])('never guesses %s', input => {
    expect(normalizarTipoCallbackVortx(input)).toBeNull()
  })
  it('normalizes the observed position shape while keeping metadata exactly nine fields', () => {
    const input = structuredClone(raw), result = interpretarCallbackRelatorio(input)
    expect(result).toMatchObject({ tipoRelatorio: 'PosicaoParcela', dataReferencia: '2026-10-19', dataInicio: '2026-10-19', dataFim: '2026-10-19' })
    expect(input).toEqual(raw); expect(result).not.toHaveProperty('tipoWebhook')
    expect(Object.keys(prepararEventoCallback(id, result).metadados)).toHaveLength(9)
  })
  it.each(['PosicaoAtivo', 'PosicaoParcela'])('uses one business date for %s, including omitted/sentinel ranges', tipo => {
    const base = prepararSolicitacaoRelatorioVortx({ codigoCarteira: 'qa-wallet', tipoRelatorio: tipo, dataReferencia: '2026-10-19' }, '2026-10-20')
    expect(base).toMatchObject({ dataInicio: '2026-10-18', dataFim: '2026-10-19', dataReferencia: '2026-10-19' })
    expect(prepararSolicitacaoRelatorioVortx({ ...base, dataInicio: '2020-01-01' }, '2026-10-20')).toEqual(base)
    const callback = interpretarCallbackRelatorio({ ...raw, tipoRelatorio: tipo, dataInicio: undefined, dataFim: null })
    expect(callback.dataInicio).toBe(callback.dataReferencia); expect(callback.dataFim).toBe(callback.dataReferencia)
  })
  it('deduplicates equivalent position sentinel periods without changing movements', () => {
    expect(prepararEventoCallback(id, interpretarCallbackRelatorio(raw))).toEqual(
      prepararEventoCallback(id, interpretarCallbackRelatorio({ ...raw, dataInicio: '2026-01-01', dataFim: '2026-10-19' })))
    expect(() => interpretarCallbackRelatorio({ ...raw, tipoRelatorio: 'Inclusao', dataInicio: undefined })).toThrow()
    expect(() => interpretarCallbackRelatorio({ ...raw, tipoRelatorio: 'Exclusao', dataInicio: '2026-10-20', dataFim: '2026-10-19' })).toThrow()
  })
  it.each([{ tipoWebhook: 'anotherEvent' }, { extra: true }, { tipoRelatorio: 'unknown' }, { dataReferencia: '2026-02-30' }])('keeps the strict boundary for %j', change => {
    expect(() => interpretarCallbackRelatorio({ ...raw, ...change })).toThrow()
  })
  it('preserves the original authenticated JSON inside encryption alongside normalized metadata', async () => {
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: 'b'.repeat(64) }))
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
    const rpc = vi.fn().mockResolvedValue({ data: { recebido: true, duplicado: false }, error: null })
    const repo = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    const original = JSON.stringify(raw)
    await repo.persistir({ endpointId: id, fundoId: id, ambiente: 'producao', codigoCarteira: 'qa-wallet', revisao: 1 }, 'c'.repeat(64), interpretarCallbackRelatorio(raw), original)
    const args = rpc.mock.calls[0][1]
    expect(JSON.stringify(args)).not.toContain('1900-01-01'); expect(args.p_metadados.dataInicio).toBe('2026-10-19')
    const envelope = JSON.parse(descriptografarPortalFidcValor(args.p_ciphertext, args.p_chave_versao))
    expect(envelope.corpoOriginal).toBe(original); expect(envelope.evento.tipoRelatorio).toBe('PosicaoParcela')
  })
})
