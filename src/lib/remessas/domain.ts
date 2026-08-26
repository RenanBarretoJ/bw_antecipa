import { createHash } from 'node:crypto'

export type RemessaFormato = 'CNAB444' | 'VRS_CSV'
export type EstrategiaAgrupamentoRemessa = 'POR_LOTE' | 'POR_CEDENTE'

export interface RemessaParcelaCanonica {
  id: string
  numero: number
  vencimento: string
  valorNominal: number
  valorPresente: number
  taxaMensal: number | null
}

export interface RemessaContaBancariaCanonica {
  id: string
  estabelecimentoId: string
  titular: {
    estabelecimentoId: string
    cedenteId: string
    cpfCnpj: string
    nome: string
  } | null
  bancoCodigo: string | null
  bancoIspb: string | null
  bancoNome: string | null
  agencia: string
  conta: string
  principal: boolean
  ativa: boolean
}

export interface RemessaNotaFiscalCanonica {
  id: string
  numero: string
  serie: string | null
  chaveAcesso: string | null
  dataEmissao: string
  valorBruto: number
  quantidadeParcelasOriginal: number
  emissor: {
    estabelecimentoId: string | null
    cnpj: string
    nome: string
    contasBancarias: RemessaContaBancariaCanonica[]
  }
  devedor: {
    cnpj: string
    nome: string
    cep: string | null
    endereco: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    municipio: string | null
    uf: string | null
    email: string | null
    telefone: string | null
  }
  parcelasSelecionadas: RemessaParcelaCanonica[]
}

export interface RemessaOperacaoCanonica {
  id: string
  fundoId: string
  cedenteFundoId: string
  politicaOperacionalVersaoId: string | null
  cedente: {
    id: string
    cnpj: string
    razaoSocial: string
    coobrigacao: boolean
  }
  estabelecimento: {
    id: string | null
    cnpj: string
    razaoSocial: string
  }
  notas: RemessaNotaFiscalCanonica[]
}

export interface RemessaLoteCanonico {
  fundo: { id: string; nome: string; cnpj: string }
  integracao: {
    versaoId: string
    adapterKey: string
    configuracao: Record<string, unknown>
  }
  operacoes: RemessaOperacaoCanonica[]
}

export interface GrupoRemessaCanonico {
  chave: string
  cedenteId: string | null
  operacoes: RemessaOperacaoCanonica[]
}

export function agruparRemessa(
  operacoes: readonly RemessaOperacaoCanonica[],
  estrategia: EstrategiaAgrupamentoRemessa,
): GrupoRemessaCanonico[] {
  if (estrategia === 'POR_LOTE') {
    return operacoes.length === 0 ? [] : [{ chave: 'lote', cedenteId: null, operacoes: [...operacoes] }]
  }

  const grupos = new Map<string, RemessaOperacaoCanonica[]>()
  for (const operacao of operacoes) {
    const atuais = grupos.get(operacao.cedente.id) ?? []
    atuais.push(operacao)
    grupos.set(operacao.cedente.id, atuais)
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cedenteId, itens]) => ({ chave: cedenteId, cedenteId, operacoes: itens }))
}

export function chaveUnicaAtivo(notaFiscalId: string) {
  return `ATIVO_${notaFiscalId.replace(/[^A-Za-z0-9._-]/g, '')}`.slice(0, 100)
}

export function chaveUnicaParcela(parcelaId: string) {
  return `FLUXO_${parcelaId.replace(/[^A-Za-z0-9._-]/g, '')}`.slice(0, 100)
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashRemessa(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}
