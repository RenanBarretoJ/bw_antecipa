import { describe, expect, it, vi } from 'vitest'
import { buscarBancos, sincronizarBancosBrasilApi } from './bancos.server'
import type { AppSupabaseClient } from '@/lib/auth/authorization'

function fakeQuery(resultado: { data: unknown; error: unknown }) {
  const chamadas: { metodo: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'order', 'limit', 'or']) {
    builder[metodo] = (...args: unknown[]) => {
      chamadas.push({ metodo, args })
      return builder
    }
  }
  builder.then = (resolve: (value: typeof resultado) => unknown) => resolve(resultado)
  return { builder, chamadas }
}

function fakeClient(query: ReturnType<typeof fakeQuery>['builder']): AppSupabaseClient {
  return {
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn(),
  } as unknown as AppSupabaseClient
}

describe('buscarBancos (combobox pesquisavel por codigo/nome/ISPB)', () => {
  it('busca sem termo retorna o catalogo ativo ordenado por codigo', async () => {
    const bancos = [{ id: '1', codigo: '001', ispb: null, nome: 'Banco do Brasil', nome_completo: null }]
    const { builder, chamadas } = fakeQuery({ data: bancos, error: null })
    const client = fakeClient(builder)
    const resultado = await buscarBancos(client, '')
    expect(resultado).toEqual(bancos)
    expect(chamadas.some((c) => c.metodo === 'or')).toBe(false)
  })

  it('filtra por codigo, nome ou ISPB quando um termo e informado', async () => {
    const { builder, chamadas } = fakeQuery({ data: [], error: null })
    const client = fakeClient(builder)
    await buscarBancos(client, '341')
    const chamadaOr = chamadas.find((c) => c.metodo === 'or')
    expect(chamadaOr).toBeDefined()
    expect(chamadaOr?.args[0]).toContain('codigo.ilike.%341%')
    expect(chamadaOr?.args[0]).toContain('ispb.ilike.%341%')
  })

  it('busca por nome nao inclui filtro de ISPB quando o termo nao e numerico', async () => {
    const { builder, chamadas } = fakeQuery({ data: [], error: null })
    const client = fakeClient(builder)
    await buscarBancos(client, 'Nubank')
    const chamadaOr = chamadas.find((c) => c.metodo === 'or')
    expect(chamadaOr?.args[0]).toContain('nome.ilike.%Nubank%')
    expect(chamadaOr?.args[0]).not.toContain('ispb.ilike')
  })

  it('propaga erro do banco de dados como excecao com mensagem util', async () => {
    const { builder } = fakeQuery({ data: null, error: { message: 'timeout' } })
    const client = fakeClient(builder)
    await expect(buscarBancos(client, '')).rejects.toThrow(/timeout/)
  })
})

describe('sincronizarBancosBrasilApi (sync administrativo idempotente)', () => {
  it('mapeia a resposta da BrasilAPI e faz upsert via RPC gated a super_admin', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { ispb: '00000000', code: 1, fullName: 'Banco do Brasil S.A.', name: 'Banco do Brasil' },
        { ispb: '18236120', code: 260, fullName: 'Nu Pagamentos S.A.', name: 'Nu Pagamentos' },
      ],
    }) as unknown as typeof fetch
    const rpc = vi.fn().mockResolvedValue({ data: [{ total_recebido: 2, total_upsertado: 2 }], error: null })
    const client = { rpc } as unknown as AppSupabaseClient

    const resultado = await sincronizarBancosBrasilApi(client, fetchFn)

    expect(resultado).toEqual({ totalRecebido: 2, totalUpsertado: 2 })
    expect(rpc).toHaveBeenCalledWith('sincronizar_bancos_super_admin', {
      p_bancos: [
        { codigo: '001', ispb: '00000000', nome: 'Banco do Brasil', nome_completo: 'Banco do Brasil S.A.' },
        { codigo: '260', ispb: '18236120', nome: 'Nu Pagamentos', nome_completo: 'Nu Pagamentos S.A.' },
      ],
    })
  })

  it('nao falha silenciosamente quando a BrasilAPI de bancos esta indisponivel', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const client = { rpc: vi.fn() } as unknown as AppSupabaseClient
    await expect(sincronizarBancosBrasilApi(client, fetchFn)).rejects.toThrow(/BrasilAPI/)
  })

  it('propaga erro da RPC de sincronizacao (ex.: chamador nao e super_admin)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ code: 1, name: 'Banco' }] }) as unknown as typeof fetch
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Apenas Super Admin pode sincronizar o catalogo de bancos.' } })
    const client = { rpc } as unknown as AppSupabaseClient
    await expect(sincronizarBancosBrasilApi(client, fetchFn)).rejects.toThrow(/Super Admin/)
  })
})
