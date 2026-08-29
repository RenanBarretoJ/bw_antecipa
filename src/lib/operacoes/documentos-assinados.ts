import { createHash } from 'node:crypto'

export const TIPOS_DOCUMENTO_ASSINADO_OPERACAO = [
  'TERMO_CESSAO_ASSINADO',
  'NOTIFICACAO_SACADO_ASSINADA',
  'COMPROVANTE_DESEMBOLSO_TED',
] as const

export type TipoDocumentoAssinadoOperacao = (typeof TIPOS_DOCUMENTO_ASSINADO_OPERACAO)[number]

export type ColunaDocumentoAssinadoOperacao =
  | 'termo_assinado_url'
  | 'notificacao_assinada_url'
  | 'comprovante_pagamento_url'

export const TAMANHO_MAXIMO_DOCUMENTO_ASSINADO = 20 * 1024 * 1024

export const DOCUMENTOS_ASSINADOS_OPERACAO: Record<TipoDocumentoAssinadoOperacao, {
  coluna: ColunaDocumentoAssinadoOperacao
  slug: string
  label: string
}> = {
  TERMO_CESSAO_ASSINADO: {
    coluna: 'termo_assinado_url',
    slug: 'termo-cessao-assinado',
    label: 'Termo de Cessao Assinado',
  },
  NOTIFICACAO_SACADO_ASSINADA: {
    coluna: 'notificacao_assinada_url',
    slug: 'notificacao-sacado-assinada',
    label: 'Notificacao ao Sacado Assinada',
  },
  COMPROVANTE_DESEMBOLSO_TED: {
    coluna: 'comprovante_pagamento_url',
    slug: 'comprovante-desembolso-ted',
    label: 'Comprovante de Desembolso (TED)',
  },
}

export class DocumentoAssinadoOperacaoError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    readonly code: string,
  ) {
    super(message)
    this.name = 'DocumentoAssinadoOperacaoError'
  }
}

export function isTipoDocumentoAssinadoOperacao(value: unknown): value is TipoDocumentoAssinadoOperacao {
  return typeof value === 'string' && TIPOS_DOCUMENTO_ASSINADO_OPERACAO.includes(value as TipoDocumentoAssinadoOperacao)
}

export function isUuid(value: string): boolean {
  // PostgreSQL aceita UUIDs sintaticamente validos mesmo quando nao carregam
  // bits RFC de versao/variante (caso da massa deterministica PERF9A).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function exigirGestorAtivoParaDocumentoAssinado(role: string | null, status: string | null): void {
  if (role !== 'gestor' || status !== 'ativo') {
    throw new DocumentoAssinadoOperacaoError('Acesso negado.', 403, 'GESTOR_ACTIVE_REQUIRED')
  }
}

export function exigirContextoFundoAtivoParaDocumentoAssinado(input: {
  vinculoAtivo: boolean
  fundoAtivo: boolean
  usuarioFundoAtivo: boolean
}): void {
  if (!input.vinculoAtivo || !input.fundoAtivo || !input.usuarioFundoAtivo) {
    throw new DocumentoAssinadoOperacaoError('Acesso negado.', 403, 'ACTIVE_FUND_MEMBERSHIP_REQUIRED')
  }
}

export function construirPathDocumentoAssinado(
  operacaoId: string,
  tipo: TipoDocumentoAssinadoOperacao,
  versaoId: string,
): string {
  if (!isUuid(operacaoId) || !isUuid(versaoId)) {
    throw new DocumentoAssinadoOperacaoError('Identificador invalido.', 400, 'INVALID_IDENTIFIER')
  }

  return `operacoes/${operacaoId}/assinados/${DOCUMENTOS_ASSINADOS_OPERACAO[tipo].slug}/${versaoId}.pdf`
}

export function nomeOriginalSeguro(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'documento.pdf'
}

export async function validarPdfAssinado(arquivo: File): Promise<{ buffer: Buffer; sha256: string; nomeOriginal: string }> {
  const nome = arquivo.name || ''
  if (arquivo.type.toLowerCase() !== 'application/pdf') {
    throw new DocumentoAssinadoOperacaoError('Envie um arquivo PDF valido.', 400, 'INVALID_MIME_TYPE')
  }
  if (!nome.toLowerCase().endsWith('.pdf')) {
    throw new DocumentoAssinadoOperacaoError('O arquivo precisa ter extensao .pdf.', 400, 'INVALID_EXTENSION')
  }
  if (arquivo.size <= 0) {
    throw new DocumentoAssinadoOperacaoError('O arquivo esta vazio.', 400, 'EMPTY_FILE')
  }
  if (arquivo.size > TAMANHO_MAXIMO_DOCUMENTO_ASSINADO) {
    throw new DocumentoAssinadoOperacaoError('O arquivo excede o limite de 20 MB.', 400, 'FILE_TOO_LARGE')
  }

  const buffer = Buffer.from(await arquivo.arrayBuffer())
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new DocumentoAssinadoOperacaoError('O conteudo enviado nao e um PDF valido.', 400, 'INVALID_PDF_SIGNATURE')
  }

  return {
    buffer,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    nomeOriginal: nomeOriginalSeguro(nome),
  }
}

export type SubstituicaoDocumentoAssinadoAdapter = {
  uploadNovo: () => Promise<void>
  atualizarReferencia: () => Promise<boolean>
  registrarAuditoria: () => Promise<void>
  restaurarReferencia: () => Promise<boolean>
  removerNovo: () => Promise<void>
  removerAnterior: () => Promise<void>
}

export async function persistirDocumentoAssinadoComCompensacao(
  adapter: SubstituicaoDocumentoAssinadoAdapter,
  possuiAnterior: boolean,
): Promise<{ limpezaAnteriorPendente: boolean }> {
  await adapter.uploadNovo()

  let referenciaAtualizada = false
  try {
    referenciaAtualizada = await adapter.atualizarReferencia()
    if (!referenciaAtualizada) {
      throw new DocumentoAssinadoOperacaoError(
        'O documento foi alterado por outra solicitacao. Atualize a pagina e tente novamente.',
        409,
        'CONCURRENT_REPLACEMENT',
      )
    }

    await adapter.registrarAuditoria()
  } catch (error) {
    if (referenciaAtualizada) {
      const restaurado = await adapter.restaurarReferencia().catch(() => false)
      if (restaurado) await adapter.removerNovo().catch(() => undefined)
    } else {
      await adapter.removerNovo().catch(() => undefined)
    }
    throw error
  }

  if (!possuiAnterior) return { limpezaAnteriorPendente: false }

  try {
    await adapter.removerAnterior()
    return { limpezaAnteriorPendente: false }
  } catch {
    // O objeto anterior deixa de ser referenciado e permanece privado. Uma
    // limpeza posterior pode remove-lo sem afetar a versao vigente.
    return { limpezaAnteriorPendente: true }
  }
}
