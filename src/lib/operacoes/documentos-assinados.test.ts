import { describe, expect, it, vi } from 'vitest'
import {
  construirPathDocumentoAssinado,
  DocumentoAssinadoOperacaoError,
  exigirContextoFundoAtivoParaDocumentoAssinado,
  exigirGestorAtivoParaDocumentoAssinado,
  isTipoDocumentoAssinadoOperacao,
  persistirDocumentoAssinadoComCompensacao,
  TAMANHO_MAXIMO_DOCUMENTO_ASSINADO,
  validarPdfAssinado,
} from './documentos-assinados'

const operacaoId = '22608637-7555-40dc-b4d7-0c9d2a551256'
const versaoId = '1302f508-094e-47d0-97b1-77636c552447'

function pdf(nome = 'documento.pdf', tipo = 'application/pdf', conteudo = '%PDF-1.7\n') {
  return new File([conteudo], nome, { type: tipo })
}

describe('documentos assinados da operacao', () => {
  it('mantem allowlist fechada', () => {
    expect(isTipoDocumentoAssinadoOperacao('TERMO_CESSAO_ASSINADO')).toBe(true)
    expect(isTipoDocumentoAssinadoOperacao('NOTIFICACAO_SACADO_ASSINADA')).toBe(true)
    expect(isTipoDocumentoAssinadoOperacao('COMPROVANTE_DESEMBOLSO_TED')).toBe(true)
    expect(isTipoDocumentoAssinadoOperacao('../contrato')).toBe(false)
    expect(isTipoDocumentoAssinadoOperacao('QUITACAO')).toBe(false)
  })

  it('constroi path versionado apenas com ids e tipo controlados', () => {
    expect(construirPathDocumentoAssinado(operacaoId, 'TERMO_CESSAO_ASSINADO', versaoId))
      .toBe(`operacoes/${operacaoId}/assinados/termo-cessao-assinado/${versaoId}.pdf`)
    expect(() => construirPathDocumentoAssinado('../operacao', 'TERMO_CESSAO_ASSINADO', versaoId))
      .toThrow(DocumentoAssinadoOperacaoError)
  })

  it.each([
    ['cedente', 'ativo'],
    ['consultor', 'ativo'],
    ['sacado', 'ativo'],
    ['gestor', 'inativo'],
    ['gestor', 'bloqueado'],
    [null, null],
  ])('nega perfil %s com status %s', (role, status) => {
    expect(() => exigirGestorAtivoParaDocumentoAssinado(role, status)).toThrow(/Acesso negado/)
  })

  it('aceita somente gestor ativo com vinculo e fundo ativos', () => {
    expect(() => exigirGestorAtivoParaDocumentoAssinado('gestor', 'ativo')).not.toThrow()
    expect(() => exigirContextoFundoAtivoParaDocumentoAssinado({
      vinculoAtivo: true,
      fundoAtivo: true,
      usuarioFundoAtivo: true,
    })).not.toThrow()
  })

  it.each([
    { vinculoAtivo: false, fundoAtivo: true, usuarioFundoAtivo: true },
    { vinculoAtivo: true, fundoAtivo: false, usuarioFundoAtivo: true },
    { vinculoAtivo: true, fundoAtivo: true, usuarioFundoAtivo: false },
  ])('nega contexto multifundo invalido: %o', (contexto) => {
    expect(() => exigirContextoFundoAtivoParaDocumentoAssinado(contexto)).toThrow(/Acesso negado/)
  })

  it('valida PDF por MIME, extensao, conteudo, tamanho e hash', async () => {
    const resultado = await validarPdfAssinado(pdf('termo assinado.pdf'))
    expect(resultado.nomeOriginal).toBe('termo_assinado.pdf')
    expect(resultado.sha256).toMatch(/^[a-f0-9]{64}$/)

    await expect(validarPdfAssinado(pdf('termo.png'))).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
    await expect(validarPdfAssinado(pdf('termo.pdf', 'image/png'))).rejects.toMatchObject({ code: 'INVALID_MIME_TYPE' })
    await expect(validarPdfAssinado(pdf('termo.pdf', 'application/pdf', 'nao-e-pdf'))).rejects.toMatchObject({ code: 'INVALID_PDF_SIGNATURE' })
    await expect(validarPdfAssinado(pdf('termo.pdf', 'application/pdf', ''))).rejects.toMatchObject({ code: 'EMPTY_FILE' })

    const grande = new File([new Uint8Array(TAMANHO_MAXIMO_DOCUMENTO_ASSINADO + 1)], 'grande.pdf', { type: 'application/pdf' })
    await expect(validarPdfAssinado(grande)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  it('nao atualiza banco quando upload falha', async () => {
    const atualizar = vi.fn()
    await expect(persistirDocumentoAssinadoComCompensacao({
      uploadNovo: vi.fn().mockRejectedValue(new Error('storage')),
      atualizarReferencia: atualizar,
      registrarAuditoria: vi.fn(),
      restaurarReferencia: vi.fn(),
      removerNovo: vi.fn(),
      removerAnterior: vi.fn(),
    }, false)).rejects.toThrow('storage')
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('remove o novo objeto quando banco falha ou perde corrida concorrente', async () => {
    const removerNovo = vi.fn().mockResolvedValue(undefined)
    await expect(persistirDocumentoAssinadoComCompensacao({
      uploadNovo: vi.fn().mockResolvedValue(undefined),
      atualizarReferencia: vi.fn().mockResolvedValue(false),
      registrarAuditoria: vi.fn(),
      restaurarReferencia: vi.fn(),
      removerNovo,
      removerAnterior: vi.fn(),
    }, true)).rejects.toMatchObject({ code: 'CONCURRENT_REPLACEMENT' })
    expect(removerNovo).toHaveBeenCalledOnce()
  })

  it('restaura a referencia anterior se a auditoria falhar', async () => {
    const restaurar = vi.fn().mockResolvedValue(true)
    const removerNovo = vi.fn().mockResolvedValue(undefined)
    await expect(persistirDocumentoAssinadoComCompensacao({
      uploadNovo: vi.fn().mockResolvedValue(undefined),
      atualizarReferencia: vi.fn().mockResolvedValue(true),
      registrarAuditoria: vi.fn().mockRejectedValue(new Error('auditoria')),
      restaurarReferencia: restaurar,
      removerNovo,
      removerAnterior: vi.fn(),
    }, true)).rejects.toThrow('auditoria')
    expect(restaurar).toHaveBeenCalledOnce()
    expect(removerNovo).toHaveBeenCalledOnce()
  })

  it('substitui e limpa a versao anterior somente apos banco e auditoria', async () => {
    const ordem: string[] = []
    const resultado = await persistirDocumentoAssinadoComCompensacao({
      uploadNovo: async () => { ordem.push('upload') },
      atualizarReferencia: async () => { ordem.push('banco'); return true },
      registrarAuditoria: async () => { ordem.push('auditoria') },
      restaurarReferencia: vi.fn(),
      removerNovo: vi.fn(),
      removerAnterior: async () => { ordem.push('limpeza') },
    }, true)
    expect(ordem).toEqual(['upload', 'banco', 'auditoria', 'limpeza'])
    expect(resultado.limpezaAnteriorPendente).toBe(false)
  })

  it('preserva a versao vigente quando a limpeza antiga falha', async () => {
    const resultado = await persistirDocumentoAssinadoComCompensacao({
      uploadNovo: vi.fn().mockResolvedValue(undefined),
      atualizarReferencia: vi.fn().mockResolvedValue(true),
      registrarAuditoria: vi.fn().mockResolvedValue(undefined),
      restaurarReferencia: vi.fn(),
      removerNovo: vi.fn(),
      removerAnterior: vi.fn().mockRejectedValue(new Error('cleanup')),
    }, true)
    expect(resultado.limpezaAnteriorPendente).toBe(true)
  })
})
