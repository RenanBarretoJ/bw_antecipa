import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syntheticDanfePdf } from '@/test/synthetic-danfe-pdf.mjs'
import { nfeFixtureKey } from '../../../scripts/email-intake/nfe-fixture-key.mjs'
import { parseFiscalFile } from '@/lib/fiscal-intake/parse.server'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('repeated native parsing of the same synthetic PDF', () => {
  it.each([61000001, 64025017, 70233991, 78999999])('preserves identity and bytes across retries: %i', async number => {
    vi.stubEnv('NFSE_UPLOAD_ENABLED', 'false')
    let externalRequests = 0
    vi.stubGlobal('fetch', async () => { externalRequests++; throw new Error('EXTERNAL_REQUEST_FORBIDDEN') })
    const key = nfeFixtureKey({ issuer: '98300000000101', number, issued: '2026-10-26' })
    const bytes = syntheticDanfePdf(['DANFE', 'IDENTIFICACAO DO EMITENTE', 'CNPJ/CPF', '98.300.000/0001-01',
      'CHAVE DE ACESSO', key, `NF-e No ${number}`, 'SERIE 1', 'DATA DA EMISSAO 26/10/2026',
      'DESTINATARIO/REMETENTE', 'SACADO QA 11.222.333/0001-81', 'FATURA', 'CALCULODOIMPOSTO', 'V.TOTALDANOTA',
      '1.234,56', 'TRANSPORTADOR', 'DADOS DOS PRODUTOS', 'ITEM A 100,00', 'ITEM B 1.134,56',
      'INFORMACOES COMPLEMENTARES', 'PAGAMENTO DA FATURA: 60 DIAS'])
    const file = new File([bytes], 'synthetic.pdf', { type: 'application/pdf' })
    const hash = createHash('sha256').update(bytes).digest('hex')
    for (let attempt = 0; attempt < 8; attempt++) {
      expect(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')).toBe(hash)
      const facts = await parseFiscalFile(file)
      expect(facts.key, `REPEATED_NATIVE_IDENTITY_${attempt}`).toBe(key)
      expect(facts.kind).toBe('DANFE')
    }
    expect(externalRequests).toBe(0)
  })
})
