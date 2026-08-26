import { hashRemessa } from '@/lib/remessas/domain'
import type { VrsInclusaoMapeada } from './mapper'

export interface ArquivoVrsCsv {
  conteudo: Buffer
  sha256: string
  quantidadeAtivos: number
  quantidadeFluxos: number
}

export function serializarVrsInclusaoCsv(input: VrsInclusaoMapeada): ArquivoVrsCsv {
  const linhas = [
    input.header,
    ...input.ativos.map((ativo) => ativo.campos),
    ...input.fluxos.map((fluxo) => fluxo.campos),
    input.pagamento,
  ]
  if (input.header.length !== 6) throw new Error('HEADER VRS deve possuir exatamente 6 colunas.')
  if (input.ativos.some((item) => item.campos.length !== 41)) throw new Error('ATIVO VRS deve possuir exatamente 41 colunas.')
  // O arquivo oficial distribuido possui 15 colunas de FLUXO; o indice 10
  // reservado do documento textual nao aparece como coluna adicional no golden.
  if (input.fluxos.some((item) => item.campos.length !== 15)) throw new Error('FLUXO VRS deve seguir as 15 colunas do CSV oficial.')
  if (input.pagamento.length !== 8) throw new Error('PAGAMENTO VRS deve possuir exatamente 8 colunas.')
  const texto = `\uFEFF${linhas.map((linha) => linha.join(';')).join('\r\n')}\r\n`
  const conteudo = Buffer.from(texto, 'utf8')
  return {
    conteudo,
    sha256: hashRemessa(conteudo),
    quantidadeAtivos: input.ativos.length,
    quantidadeFluxos: input.fluxos.length,
  }
}
