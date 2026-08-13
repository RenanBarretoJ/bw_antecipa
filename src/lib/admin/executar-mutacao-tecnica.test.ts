import { describe, expect, it, vi } from 'vitest'
import { executarMutacaoTecnica } from '@/lib/admin/executar-mutacao-tecnica'

describe('executarMutacaoTecnica', () => {
  it('preserva o resultado de sucesso retornado pela Server Action', async () => {
    const result = await executarMutacaoTecnica(async () => ({
      success: true,
      message: 'Credencial cadastrada.',
      data: { id: crypto.randomUUID() },
      notification: { type: 'success', message: 'Credencial cadastrada.' },
    }))

    expect(result.success).toBe(true)
    expect(result.notification).toEqual({ type: 'success', message: 'Credencial cadastrada.' })
  })

  it('preserva erros funcionais retornados pela Server Action', async () => {
    const result = await executarMutacaoTecnica(async () => ({
      success: false,
      message: 'Codigo TOTP invalido.',
      notification: { type: 'error', message: 'Codigo TOTP invalido.' },
    }))

    expect(result).toMatchObject({
      success: false,
      notification: { type: 'error', message: 'Codigo TOTP invalido.' },
    })
  })

  it('converte rejeicao de transporte em feedback visivel e sanitizado', async () => {
    const mutation = vi.fn().mockRejectedValue(new Error('fetch failed: secret-value'))
    const result = await executarMutacaoTecnica(mutation)

    expect(mutation).toHaveBeenCalledOnce()
    expect(result.success).toBe(false)
    expect(result.notification?.type).toBe('error')
    expect(result.notification?.message).toContain('Nao foi possivel concluir')
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })
})
