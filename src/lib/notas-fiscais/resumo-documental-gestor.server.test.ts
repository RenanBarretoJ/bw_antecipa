import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const state = vi.hoisted(() => ({
  notas: [] as Record<string, unknown>[],
  notaError: null as unknown,
  rpc: vi.fn(),
  notaIds: [] as unknown[],
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: state.rpc }) }))

import { carregarResumoDocumentalDasNotas } from './resumo-documental-gestor.server'

function client(): AppSupabaseClient {
  return createClient<Database>('https://qa.invalid', 'synthetic-no-access', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        const table = url.pathname.split('/').pop()
        if (table === 'notas_fiscais') state.notaIds = (url.searchParams.get('id') || '').slice(4, -1).split(',')
        const data = table === 'notas_fiscais' ? state.notas
          : table === 'cedente_fundo_politicas' ? [{ cedente_fundo_id: 'cf', politica_operacional_id: 'policy' }]
            : table === 'politicas_operacionais' ? [{ id: 'policy', fundo_id: 'fund' }]
              : table === 'politica_operacional_versoes' ? [{ id: 'version', politica_operacional_id: 'policy', fundo_id: 'fund', versao: 1 }]
                : []
        const error = table === 'notas_fiscais' ? state.notaError : null
        return new Response(JSON.stringify(error || data), { status: error ? 500 : 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.notaError = null
  state.notaIds = []
  state.notas = [{ id: 'nf', cedente_id: 'cedente', cedente_fundo_id: 'cf', fundo_id: 'fund',
    arquivo_url: null, fiscal_reservation_id: 'reservation' }]
  state.rpc.mockResolvedValue({ data: [{ nota_fiscal_id: 'nf', bucket: 'documentos-v2', path: 'canonical/original.pdf' }], error: null })
})

describe('aprovação individual e em lote com original canônico', () => {
  it('reproduz NF submetida sem arquivo_url: reconhece o PDF canônico', async () => {
    const result = await carregarResumoDocumentalDasNotas(client(), ['nf'])
    expect(result.avaliacoes.get('nf')).toMatchObject({ elegivel: true, arquivoOriginalValido: true, estado: 'nao_aplicavel' })
  })

  it('preserva legado PDF/XML sem reserva e sem consultar o journal', async () => {
    state.notas = ['pdf', 'xml'].map(ext => ({ ...state.notas[0], id: ext, fiscal_reservation_id: null, arquivo_url: `legacy/original.${ext}` }))
    const result = await carregarResumoDocumentalDasNotas(client(), ['pdf', 'xml'])
    expect([...result.avaliacoes.values()].every(item => item.elegivel)).toBe(true)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('não usa legado divergente nem DANFE companheiro quando falta original canônico', async () => {
    state.notas[0].arquivo_url = 'legacy/fallback.pdf'
    state.rpc.mockResolvedValue({ data: [], error: null })
    expect((await carregarResumoDocumentalDasNotas(client(), ['nf'])).avaliacoes.get('nf'))
      .toMatchObject({ elegivel: false, estado: 'arquivo_original_ausente' })
  })

  it('resolve um lote inteiro em uma chamada e não envia IDs invisíveis pela RLS', async () => {
    state.notas = Array.from({ length: 50 }, (_, index) => ({ ...state.notas[0], id: `nf-${index}` }))
    state.rpc.mockResolvedValue({ data: state.notas.map(nota => ({ nota_fiscal_id: nota.id, bucket: 'documentos-v2', path: 'original.xml' })), error: null })
    const result = await carregarResumoDocumentalDasNotas(client(), [...state.notas.map(n => String(n.id)), 'foreign'])
    expect(state.notaIds).toContain('foreign')
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('fiscal_intake_get_originals', { p_nf_ids: state.notas.map(n => n.id) })
    expect(result.avaliacoes.size).toBe(50)
    expect(result.avaliacoes.has('foreign')).toBe(false)
  })

  it('interrompe antes da consulta privilegiada se a leitura autorizada falhar', async () => {
    state.notaError = { message: 'read failed' }
    await expect(carregarResumoDocumentalDasNotas(client(), ['nf'])).rejects.toThrow('Nao foi possivel carregar o contexto')
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
