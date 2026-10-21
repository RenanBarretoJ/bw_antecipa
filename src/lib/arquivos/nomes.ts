import type { ContratoDocumentType } from '@/lib/types/domain'

/** ASCII-only first fund word: no legal-name suffix, spaces or path/header characters. */
export function nomeCurtoFundo(nome: string): string {
  return nome.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .match(/[A-Z0-9]+/)?.[0].slice(0, 24) || 'FUNDO'
}

const prefixos: Partial<Record<ContratoDocumentType, string>> = {
  contrato: 'CONTRATO_CESSAO', contrato_assinado: 'CONTRATO_CESSAO_ASSINADO',
  termo: 'TERMO_CESSAO', termo_assinado: 'TERMO_CESSAO_ASSINADO',
  notificacao: 'NOTIFICACAO_SACADO', notificacao_assinada: 'NOTIFICACAO_SACADO_ASSINADA',
  quitacao: 'TERMO_QUITACAO', quitacao_assinada: 'TERMO_QUITACAO_ASSINADA',
}

export function nomeDocumentoDownload(input: { tipo: ContratoDocumentType; fundoNome: string; identificador: string }): string | null {
  const prefixo = prefixos[input.tipo]
  if (!prefixo) return null
  const contrato = input.tipo === 'contrato' || input.tipo === 'contrato_assinado'
  const identificador = contrato ? input.identificador.replace(/\D/g, '') : input.identificador.slice(0, 8).toUpperCase()
  if (contrato ? !/^\d{14}$/.test(identificador) : !/^[A-Z0-9]{8}$/.test(identificador)) return null
  return `${prefixo}_FIDC_${nomeCurtoFundo(input.fundoNome)}_${identificador}.PDF`
}

/** Transport name only. The CNAB sequencial and every byte of its contents remain unchanged. */
export function nomeRemessaFromtis(input: { fundoNome: string; remessaId: string; dataGeracao: string }): string {
  const id = input.remessaId.slice(0, 8).toUpperCase()
  const data = new Date(input.dataGeracao)
  if (!/^[A-Z0-9]{8}$/.test(id) || !Number.isFinite(data.getTime())) throw new Error('Identificacao de arquivo de remessa invalida.')
  return `REM_${nomeCurtoFundo(input.fundoNome)}_${id}_${data.toISOString().slice(0, 10).replaceAll('-', '')}.REM`
}
