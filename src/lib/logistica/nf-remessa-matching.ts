// ============================================================
// NF de Remessa como lastro logistico auxiliar
// ------------------------------------------------------------
// A NF de venda e o UNICO ativo financeiro. A NF de remessa e um
// documento fiscal/logistico auxiliar e opcional que pode se
// interpor entre a venda e o CT-e (venda -> remessa -> CT-e) quando
// a mercadoria sai de um operador/galpao terceiro em vez do proprio
// emitente da venda. Este modulo contem regras puras (sem I/O) de
// matching venda<->remessa e de classificacao do tomador do CT-e.
// ============================================================

export type StatusValidacaoRemessa = 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
export type ClassificacaoTomador = 'ALLOW' | 'REVISAO_MANUAL' | 'DENY'
export type TipoVinculoCte = 'DIRETO_VENDA' | 'VIA_REMESSA'

export interface ItemComparavel {
  descricao: string
  /** cProd. Primeiro criterio deterministico. */
  codigo?: string
  /** NCM. Segundo criterio deterministico (usado quando cProd nao casa -- catalogos de emitentes diferentes divergem). */
  ncm?: string
  unidade?: string
  quantidade: number
}

export interface VendaParaMatchingRemessa {
  chave_acesso: string | null
  cnpj_destinatario: string | null
  valor_bruto: number
  /** Null quando a venda foi cadastrada sem itens estruturados (ex.: cadastro manual, extracao de PDF). */
  quantidade_total: number | null
  itens: ItemComparavel[]
}

export interface RemessaParaMatching {
  nf_ref_chaves: string[]
  destinatario_cnpj: string | null
  valor_total: number
  quantidade_total: number | null
  itens: ItemComparavel[]
}

export type ResultadoCompatibilidadeProdutos = 'DETERMINISTICO' | 'HEURISTICO' | 'INCOMPATIVEL' | 'NAO_VERIFICAVEL'

export interface ResultadoMatchingRemessa {
  status: StatusValidacaoRemessa
  referenciaNfVendaConfirmada: boolean
  produtosCompativeis: ResultadoCompatibilidadeProdutos
  motivos: string[]
}

const STOPWORDS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'PARA', 'COM', 'SEM'])
const TOLERANCIA_QUANTIDADE = 0.01

function tokenizarDescricao(descricao: string): Set<string> {
  const normalizada = descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
  const tokens = normalizada.match(/[A-Z0-9]{3,}/g) || []
  return new Set(tokens.filter((token) => !STOPWORDS.has(token)))
}

function compativelPorDescricao(vendaItens: ItemComparavel[], remessaItens: ItemComparavel[]): boolean {
  const tokensVenda = vendaItens.map((item) => tokenizarDescricao(item.descricao))
  return remessaItens.every((itemRemessa) => {
    const tokensRemessa = tokenizarDescricao(itemRemessa.descricao)
    return tokensVenda.some((tv) => [...tokensRemessa].some((token) => tv.has(token)))
  })
}

/**
 * Matching determinístico de produtos entre venda e remessa (regra 4 do
 * ticket de ajustes finais). Prioridade: cProd -> NCM -> unidade+quantidade
 * -> descricao normalizada (fallback heuristico). A heuristica de descricao
 * sozinha nunca produz 'DETERMINISTICO' -- so 'HEURISTICO' (compativel) ou
 * 'INCOMPATIVEL' -- porque nomes de produto entre documentos diferentes nao
 * sao uma prova, so um indicio.
 */
export function avaliarCompatibilidadeProdutos(vendaItens: ItemComparavel[], remessaItens: ItemComparavel[]): ResultadoCompatibilidadeProdutos {
  if (vendaItens.length === 0 || remessaItens.length === 0) return 'NAO_VERIFICAVEL'

  const temCodigo = vendaItens.some((item) => item.codigo) && remessaItens.some((item) => item.codigo)
  if (temCodigo) {
    const todosCasam = remessaItens.every((r) => vendaItens.some((v) => v.codigo && r.codigo && v.codigo === r.codigo))
    return todosCasam ? 'DETERMINISTICO' : 'INCOMPATIVEL'
  }

  const temNcm = vendaItens.some((item) => item.ncm) && remessaItens.some((item) => item.ncm)
  if (temNcm) {
    const todosCasam = remessaItens.every((r) => vendaItens.some((v) => v.ncm && r.ncm && v.ncm === r.ncm))
    return todosCasam ? 'DETERMINISTICO' : 'INCOMPATIVEL'
  }

  const temUnidade = vendaItens.some((item) => item.unidade) && remessaItens.some((item) => item.unidade)
  if (temUnidade) {
    const todosCasam = remessaItens.every((r) => vendaItens.some((v) => (
      v.unidade && r.unidade && v.unidade.toUpperCase() === r.unidade.toUpperCase()
      && Math.abs(v.quantidade - r.quantidade) <= TOLERANCIA_QUANTIDADE
    )))
    return todosCasam ? 'DETERMINISTICO' : 'INCOMPATIVEL'
  }

  return compativelPorDescricao(vendaItens, remessaItens) ? 'HEURISTICO' : 'INCOMPATIVEL'
}

/**
 * Matching venda<->remessa (regra D do ticket, endurecido pelos ajustes
 * finais). A ausencia de remessa nunca bloqueia por si so -- esta funcao so
 * e chamada quando uma remessa foi efetivamente enviada.
 */
export function avaliarMatchingRemessaVenda(input: {
  venda: VendaParaMatchingRemessa
  remessa: RemessaParaMatching
  /** Soma de quantidade_total das remessas ja VALIDADAS para esta venda, sem incluir a remessa atual. Valor monetario NUNCA e usado como substituto -- ver regra 3 dos ajustes finais. */
  acumuladoAnterior: number
}): ResultadoMatchingRemessa {
  const motivos: string[] = []
  const { venda, remessa } = input

  const referenciaNfVendaConfirmada = Boolean(venda.chave_acesso) && remessa.nf_ref_chaves.includes(venda.chave_acesso as string)

  const destinatarioOk = Boolean(venda.cnpj_destinatario) && Boolean(remessa.destinatario_cnpj) && venda.cnpj_destinatario === remessa.destinatario_cnpj
  if (!destinatarioOk) {
    motivos.push('Destinatario da remessa diverge do sacado da NF de venda.')
    return { status: 'REJEITADA', referenciaNfVendaConfirmada, produtosCompativeis: 'NAO_VERIFICAVEL', motivos }
  }

  const produtos = avaliarCompatibilidadeProdutos(venda.itens, remessa.itens)
  if (produtos === 'INCOMPATIVEL') motivos.push('Produtos da remessa nao correspondem aos produtos da NF de venda.')
  if (produtos === 'HEURISTICO') motivos.push('Produtos comparados apenas por heuristica de descricao (sem cProd/NCM/unidade+quantidade estruturados em comum) -- nunca suficiente para validar automaticamente.')
  if (produtos === 'NAO_VERIFICAVEL') motivos.push('Produtos nao puderam ser comparados (NF de venda ou remessa sem itens estruturados).')

  // Regra 3 dos ajustes finais: quantidade e SEMPRE avaliada por quantidade
  // estruturada; nunca ha fallback para valor monetario. Quantidade nao
  // verificavel em qualquer um dos lados forca REVISAO_MANUAL (nunca
  // VALIDADA so porque o valor financeiro coincide).
  const quantidadeVerificavel = venda.quantidade_total !== null && remessa.quantidade_total !== null
  let saldoExcedido = false
  if (quantidadeVerificavel) {
    const acumuladoComEstaRemessa = input.acumuladoAnterior + (remessa.quantidade_total as number)
    if (acumuladoComEstaRemessa > (venda.quantidade_total as number) + TOLERANCIA_QUANTIDADE) {
      saldoExcedido = true
      motivos.push('Quantidade acumulada das remessas excede a quantidade da NF de venda.')
    }
  } else {
    motivos.push('Quantidade nao verificavel: NF de venda ou remessa sem quantidade estruturada -- saldo nao pode ser confirmado automaticamente (valor monetario nunca e usado como substituto).')
  }

  if (saldoExcedido) {
    return { status: 'REJEITADA', referenciaNfVendaConfirmada, produtosCompativeis: produtos, motivos }
  }

  if (!referenciaNfVendaConfirmada) {
    motivos.push('Remessa nao referencia estruturalmente a NF de venda (NFref/refNFe ausente ou divergente).')
    return { status: 'REVISAO_MANUAL', referenciaNfVendaConfirmada, produtosCompativeis: produtos, motivos }
  }

  if (!quantidadeVerificavel) {
    return { status: 'REVISAO_MANUAL', referenciaNfVendaConfirmada, produtosCompativeis: produtos, motivos }
  }

  if (produtos === 'INCOMPATIVEL' || produtos === 'HEURISTICO') {
    return { status: 'REVISAO_MANUAL', referenciaNfVendaConfirmada, produtosCompativeis: produtos, motivos }
  }

  return { status: 'VALIDADA', referenciaNfVendaConfirmada, produtosCompativeis: produtos, motivos }
}

export interface ClassificarTomadorInput {
  tomadorCnpj: string | null
  emitenteVendaCnpj: string | null
  cedenteId: string
  /** Estabelecimentos com status='aprovado' e ativo=true do MESMO cedente da venda. */
  estabelecimentosAprovadosDoCedente: Array<{ cnpj: string; cedente_id: string }>
}

export interface ResultadoClassificacaoTomador {
  classificacao: ClassificacaoTomador
  motivo: string
}

/**
 * Regra 6 do ticket: tomador do CT-e quando o vinculo e via remessa.
 * Fail-closed: tomador nao identificavel no XML -> DENY (nunca ALLOW por
 * omissao).
 */
export function classificarTomadorCte(input: ClassificarTomadorInput): ResultadoClassificacaoTomador {
  if (!input.tomadorCnpj) {
    return { classificacao: 'DENY', motivo: 'Tomador do CT-e nao pode ser identificado no XML.' }
  }
  if (input.emitenteVendaCnpj && input.tomadorCnpj === input.emitenteVendaCnpj) {
    return { classificacao: 'ALLOW', motivo: 'Tomador e o emitente exato da NF de venda.' }
  }
  const outroEstabelecimentoAprovado = input.estabelecimentosAprovadosDoCedente.some(
    (estabelecimento) => estabelecimento.cedente_id === input.cedenteId && estabelecimento.cnpj === input.tomadorCnpj,
  )
  if (outroEstabelecimentoAprovado) {
    return { classificacao: 'REVISAO_MANUAL', motivo: 'Tomador e outro estabelecimento aprovado do mesmo Cedente da operacao.' }
  }
  return { classificacao: 'DENY', motivo: 'Tomador e um terceiro nao vinculado ao Cedente da operacao.' }
}

/**
 * Regra 5: sem remessa, CT-e -> venda direto (comportamento preservado).
 * Com remessa validada, o CT-e deve referenciar a chave da remessa.
 */
export function resolverTipoVinculoCte(input: { chaveReferenciadaEhDaVenda: boolean; chaveReferenciadaEhDeRemessaValidada: boolean }): TipoVinculoCte | null {
  if (input.chaveReferenciadaEhDaVenda) return 'DIRETO_VENDA'
  if (input.chaveReferenciadaEhDeRemessaValidada) return 'VIA_REMESSA'
  return null
}

export interface RemessaValidadaParaVinculoCte {
  id: string
  chave_acesso: string
  emitente_cnpj: string | null
  emitente_razao_social: string | null
  valor_total: number
  quantidade_total: number | null
  itens: ItemComparavel[]
}

export type ResolucaoVinculoCtePorNf =
  | { tipoVinculo: 'DIRETO_VENDA'; notaFiscalRemessaId: null; remessa: null }
  | { tipoVinculo: 'VIA_REMESSA'; notaFiscalRemessaId: string; remessa: RemessaValidadaParaVinculoCte }
  | { tipoVinculo: null; notaFiscalRemessaId: null; remessa: null }

/**
 * Resolve, para uma NF de venda especifica, se o CT-e a referencia
 * diretamente (regra 4: sem remessa, fluxo atual) ou via uma NF de remessa
 * VALIDADA vinculada a ela (regra 5: com remessa, o CT-e referencia a
 * chave da remessa). Quando nenhum dos dois casos se aplica, retorna
 * tipoVinculo=null -- o caller deve tratar como chave nao referenciada
 * (comportamento hoje ja bloqueado por validarCteContraNfes).
 */
export function resolverVinculoCtePorNf(input: {
  vendaChaveAcesso: string | null
  chavesReferenciadasNoCte: string[]
  remessasValidadasDaVenda: RemessaValidadaParaVinculoCte[]
}): ResolucaoVinculoCtePorNf {
  if (input.vendaChaveAcesso && input.chavesReferenciadasNoCte.includes(input.vendaChaveAcesso)) {
    return { tipoVinculo: 'DIRETO_VENDA', notaFiscalRemessaId: null, remessa: null }
  }
  const remessa = input.remessasValidadasDaVenda.find((r) => input.chavesReferenciadasNoCte.includes(r.chave_acesso))
  if (remessa) {
    return { tipoVinculo: 'VIA_REMESSA', notaFiscalRemessaId: remessa.id, remessa }
  }
  return { tipoVinculo: null, notaFiscalRemessaId: null, remessa: null }
}
