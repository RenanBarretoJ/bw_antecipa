import { createHash } from 'node:crypto'

export const DOCUMENTO_V2_BUCKET = 'documentos-v2'
export const DOCUMENTOS_V2_SUPORTADOS = ['nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra'] as const
export type CodigoDocumentoV2 = (typeof DOCUMENTOS_V2_SUPORTADOS)[number]

export interface TipoDocumentoV2 {
  id: string
  codigo: string
  nome: string
  mime_types_aceitos: string[]
  extensoes_aceitas: string[]
  tamanho_max_bytes: number
  permite_multiplas_versoes: boolean
  ativo: boolean
}

export function extensaoArquivo(nome: string): string {
  const index = nome.lastIndexOf('.')
  return index >= 0 ? nome.slice(index + 1).toLowerCase() : ''
}

export function mimeArquivo(file: File): string {
  if (file.type) return file.type.toLowerCase()
  const ext = extensaoArquivo(file.name)
  if (ext === 'xml') return 'application/xml'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  return 'application/octet-stream'
}

export function validarArquivoContraTipo(file: File, tipo: TipoDocumentoV2): string | null {
  const mime = mimeArquivo(file)
  const ext = extensaoArquivo(file.name)
  const mimeAceito = tipo.mime_types_aceitos.map((item) => item.toLowerCase()).includes(mime)
  const extensaoAceita = tipo.extensoes_aceitas.map((item) => item.toLowerCase()).includes(ext)
  if (!mimeAceito && !extensaoAceita) return `Formato invalido para ${tipo.nome}.`
  if (file.size <= 0) return 'O arquivo esta vazio.'
  if (file.size > tipo.tamanho_max_bytes) return `O arquivo excede o limite de ${Math.ceil(tipo.tamanho_max_bytes / 1024 / 1024)}MB.`
  return null
}

export async function sha256Arquivo(file: File): Promise<string> {
  return createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')
}

export function nomeSeguro(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'arquivo'
}
