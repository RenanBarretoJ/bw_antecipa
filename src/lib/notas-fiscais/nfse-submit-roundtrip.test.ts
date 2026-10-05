import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { notaFiscalSchema } from '@/lib/validations/nf'

// Synthetic reproduction of the original UI round trip, not production data.
describe('NFSE submit: original round-trip diagnosis', () => {
  it('isolates NULL_TO_EMPTY in the guard, not NULL_TO_ZERO', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'))
    try {
      const source = readFileSync('src/app/cedente/notas-fiscais/[id]/page.tsx', 'utf8')
      const initializer = source.match(/setForm\((\{\s*numero_nf: nfData[\s\S]*?)\n\s*\}\)/)?.[1]
      expect(initializer).toBeTruthy()
      const stored = {
        numero_nf: 'QA-9001', serie: null, chave_acesso: null,
        data_emissao: '2026-10-02', data_vencimento: '2026-10-15',
        cnpj_emitente: '11222333000181', cnpj_destinatario: '11444777000161',
        razao_social_emitente: 'EMITENTE SINTETICO', razao_social_destinatario: 'SACADO SINTETICO',
        valor_bruto: 1234.56, valor_liquido: null,
      }
      const form = runInNewContext(`(${initializer}\n})`, { nfData: stored })
      expect(form.chave_acesso).toBe('')
      expect(form.serie).toBe('')
      // Prior UI initialized null net to zero, then handleSave replaced it with gross.
      const payload = notaFiscalSchema.parse({ ...form, valor_liquido: Number(form.valor_bruto) })
      const guardFields = ['numero_nf', 'chave_acesso', 'data_emissao', 'cnpj_emitente', 'cnpj_destinatario', 'valor_bruto'] as const
      expect(guardFields.filter(key => payload[key] !== stored[key])).toEqual(['chave_acesso'])
      expect(payload.valor_liquido).toBe(stored.valor_bruto)
      expect(payload.serie).toBe('')
    } finally { vi.useRealTimers() }
  })
})
