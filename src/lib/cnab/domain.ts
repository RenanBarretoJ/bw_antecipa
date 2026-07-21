import { createHash } from 'crypto'

export type CnabLayout = 'cnab444'
export type ConfiguracaoCnabStatus = 'rascunho' | 'ativa' | 'desativada'
export type ConfiguracaoCnabVersaoStatus = 'rascunho' | 'publicada' | 'substituida' | 'cancelada'
export type RemessaCnabStatus = 'gerada' | 'validada' | 'enviada' | 'aceita' | 'rejeitada' | 'cancelada' | 'erro'

export interface DadosFundo {
  id: string
  nome: string
  cnpj: string
}

export interface DadosConta {
  banco: string
  agencia: string
  conta: string
  digitoConta: string
  carteira: string
  convenio: string
}

export interface DadosCedente {
  id: string
  razaoSocial: string
  cnpj: string
  coobrigacao: boolean
}

export interface DadosOperacao {
  id: string
  cedenteId: string
  cedenteFundoId: string | null
  aprovadoEm: string | null
  createdAt: string
}

export interface TituloRemessa {
  notaFiscalId: string
  numero: string
  serie: string | null
  chaveAcesso: string | null
  dataEmissao: string
  dataVencimento: string
  valorFace: number
  valorPresente: number
  sacadoCnpj: string
  sacadoNome: string
}

export interface IdentificadoresRemessa {
  dataGeracao: string
  sequencial: number
  nomeArquivo: string
}

export interface ConfiguracaoCnabResolvida {
  configuracaoId: string
  versaoId: string
  versao: number
  hash: string
  codigo: string
  layout: CnabLayout
  versaoLayout: string
  codigoBanco: string
  banco: string
  agencia: string
  conta: string
  digitoConta: string
  carteira: string
  convenio: string
  codigoOriginador: string
  codigoEmpresa: string
  tipoInscricao: string
  numeroInscricao: string
  especieTitulo: string
  tipoRecebivel: string
  configuracao: CnabLayoutOptions
}

export interface CnabLayoutOptions {
  literalRemessa?: string
  codigoServico?: string
  literalServico?: string
  identificacaoSistema?: string
  sequencialHeaderInicial?: number
  ocorrencia?: string
  caracteristicaEspecial?: string
  modalidadeOperacao?: string
  naturezaOperacao?: string
  origemRecurso?: string
  numeroBancoCobranca?: string
  agenciaDepositaria?: string
  condicaoPapeleta?: string
  emitePapeletaDebAuto?: string
  tipoPessoaCedente?: string
  tipoInscricaoSacado?: string
  cepSacadoDefault?: string
}

export interface RemessaOperacao {
  fundo: DadosFundo
  cedente: DadosCedente
  operacoes: DadosOperacao[]
  titulos: TituloRemessa[]
  conta: DadosConta
  identificadores: IdentificadoresRemessa
  configuracao: ConfiguracaoCnabResolvida
}

export interface ResultadoValidacao {
  valido: boolean
  erros: string[]
  avisos: string[]
}

export interface ResultadoGeracao {
  conteudo: string
  linhas: string[]
  quantidadeRegistros: number
  quantidadeTitulos: number
  valorTotal: number
  sha256: string
}

export interface GeradorCnab {
  validar(input: RemessaOperacao): ResultadoValidacao
  gerar(input: RemessaOperacao): ResultadoGeracao
}

export interface CampoCnabMapping {
  registro: 'header' | 'detalhe' | 'trailer'
  campo: string
  origem: string
  transformacao: string
  posicao: string
  tamanho: number
  tipo: 'alfa' | 'num'
  alinhamento: 'esquerda' | 'direita'
  preenchimento: 'espaco' | 'zero' | 'literal'
  validacao: string
}

export const CONFIGURACAO_CNAB_LEGADO_PADRAO: Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'> = {
  layout: 'cnab444',
  versaoLayout: 'H/D/T',
  codigoBanco: '611',
  banco: 'BBBBBBBBBBBBBBB',
  agencia: '00000',
  conta: '0000000000',
  digitoConta: '0',
  carteira: '000',
  convenio: '00000000000000000000',
  codigoOriginador: '00000000000000500497',
  codigoEmpresa: '00000000000000500497',
  tipoInscricao: '02',
  numeroInscricao: '00000000000000',
  especieTitulo: '61',
  tipoRecebivel: '01',
  configuracao: {
    literalRemessa: 'REMESSA',
    codigoServico: '01',
    literalServico: 'COBRANCA',
    identificacaoSistema: 'MX',
    sequencialHeaderInicial: 1,
    ocorrencia: '01',
    caracteristicaEspecial: '00',
    modalidadeOperacao: '0000',
    naturezaOperacao: '00',
    origemRecurso: '0000',
    numeroBancoCobranca: '000',
    agenciaDepositaria: '00000',
    condicaoPapeleta: '1',
    emitePapeletaDebAuto: 'N',
    tipoPessoaCedente: '02',
    tipoInscricaoSacado: '02',
    cepSacadoDefault: '00000000',
  },
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).filter((key) => obj[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function calcularHashConfiguracaoCnab(input: Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'>): string {
  return sha256Hex(stableStringify(input))
}

export function sanitizeArquivoSegment(segment: string): string {
  return segment
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .toUpperCase() || 'FUNDO'
}
