import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFiscalFile } from './parse.server'

const parsers = vi.hoisted(() => ({ danfe: vi.fn(), nfse: vi.fn(), validateDanfe: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/pdf-nf-parser', () => ({ extractDanfeFromPdf: parsers.danfe, validarDanfeParaPersistencia: parsers.validateDanfe }))
vi.mock('@/lib/nfse/pdf-dispatcher.server', () => ({ probeNfsePdf: parsers.nfse }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('identidade fiscal obrigatória nos dois canais', () => {
  it('bloqueia XML sem chave antes da validação fiscal e persistência', async () => {
    await expect(parseFiscalFile(new File(['<NFe></NFe>'], 'nota.xml'))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
  })

  it('bloqueia DANFE textual sem chave mesmo quando há número e valor', async () => {
    vi.stubEnv('NFSE_UPLOAD_ENABLED', 'false')
    parsers.danfe.mockResolvedValue({ numero_nf: '123', valor_bruto: 100 })
    await expect(parseFiscalFile(new File(['%PDF-1.7\nfixture'], 'nota.pdf'))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
    expect(parsers.validateDanfe).not.toHaveBeenCalled()
  })

  it('bloqueia NFS-e identificada sem chave e não tenta reinterpretá-la como NF-e', async () => {
    vi.stubEnv('NFSE_UPLOAD_ENABLED', 'true')
    parsers.nfse.mockResolvedValue({ dados: { numero_nf: '123', valor_bruto: 100 } })
    await expect(parseFiscalFile(new File(['%PDF-1.7\nfixture'], 'nota.pdf'))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
    expect(parsers.danfe).not.toHaveBeenCalled()
  })

  it('rejeita conteúdo não PDF sem acionar parser', async () => {
    await expect(parseFiscalFile(new File(['html'], 'nota.pdf'))).rejects.toMatchObject({ code: 'INVALID' })
    expect(parsers.danfe).not.toHaveBeenCalled()
    expect(parsers.nfse).not.toHaveBeenCalled()
  })

  it('rejeita XML com entidade externa', async () => {
    await expect(parseFiscalFile(new File(['<!DOCTYPE foo SYSTEM "https://example.invalid/">'], 'nota.xml'))).rejects.toMatchObject({ code: 'INVALID' })
  })
})
