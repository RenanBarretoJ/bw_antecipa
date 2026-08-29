/**
 * Resolucao/validacao cruzada PURA (sem I/O) do webhook de comprovante de
 * entrega de transportadora. Todas as funcoes aqui recebem linhas JA
 * carregadas do banco (pelo orquestrador) e decidem -- nunca fazem a
 * propria consulta. Ver docs/integracoes/webhook-comprovante-transportadora.md.
 *
 * Ordem de resolucao (regra 3 do ticket):
 *   A. chave_nfe -- match exato em notas_fiscais OU nota_fiscal_remessas;
 *   B. se A nao resolveu, chave_cte -- via cte_notas_fiscais;
 *   C. sem match univoco -> NAO_IDENTIFICADO ou AMBIGUO (REVISAO_MATCH).
 * Nunca casa por CNPJ/data/numero isolado.
 */

export type TipoVinculoComprovante = 'DIRETO_VENDA' | 'VIA_REMESSA'
export type MetodoMatchComprovante = 'CHAVE_NFE_VENDA' | 'CHAVE_NFE_REMESSA' | 'CHAVE_CTE'

export type NotaFiscalVendaPorChave = {
  id: string
  fundoId: string | null
  cedenteId: string
  cnpjEmitente: string | null
  cnpjDestinatario: string | null
}

export type NotaFiscalRemessaPorChave = {
  id: string
  notaFiscalVendaId: string
  statusValidacao: 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
  emitenteCnpj: string | null
}

export type CteVinculoPorChave = {
  notaFiscalId: string
  notaFiscalRemessaId: string | null
  tipoVinculo: TipoVinculoComprovante
}

export type ResolucaoComprovanteWebhook =
  | {
    resultado: 'RESOLVIDO'
    notaFiscalVendaId: string
    notaFiscalRemessaId: string | null
    tipoVinculo: TipoVinculoComprovante
    metodo: MetodoMatchComprovante
  }
  | { resultado: 'NAO_IDENTIFICADO' }
  /** Multiplos vinculos possiveis para a mesma chave_cte (CT-e multi-NF) -- nunca escolhe um sozinho. */
  | { resultado: 'AMBIGUO' }

/** Regra A: match exato pela chave_nfe. Uma remessa REVISAO_MANUAL/REJEITADA nunca resolve por si so (so VALIDADA vale como lastro). */
export function resolverPorChaveNfe(input: {
  vendaPorChave: NotaFiscalVendaPorChave | null
  remessaPorChave: NotaFiscalRemessaPorChave | null
}): ResolucaoComprovanteWebhook | null {
  if (input.vendaPorChave) {
    return {
      resultado: 'RESOLVIDO',
      notaFiscalVendaId: input.vendaPorChave.id,
      notaFiscalRemessaId: null,
      tipoVinculo: 'DIRETO_VENDA',
      metodo: 'CHAVE_NFE_VENDA',
    }
  }
  if (input.remessaPorChave && input.remessaPorChave.statusValidacao === 'VALIDADA') {
    return {
      resultado: 'RESOLVIDO',
      notaFiscalVendaId: input.remessaPorChave.notaFiscalVendaId,
      notaFiscalRemessaId: input.remessaPorChave.id,
      tipoVinculo: 'VIA_REMESSA',
      metodo: 'CHAVE_NFE_REMESSA',
    }
  }
  return null
}

/** Regra B: fallback pela chave_cte, apenas quando a regra A nao resolveu. Um CT-e multi-NF (mais de um vinculo em cte_notas_fiscais) e ambiguo por definicao -- nunca escolhe um lado sozinho. */
export function resolverPorChaveCte(input: {
  cteEncontrado: boolean
  vinculos: CteVinculoPorChave[]
}): ResolucaoComprovanteWebhook | null {
  if (!input.cteEncontrado) return null
  if (input.vinculos.length === 0) return null
  if (input.vinculos.length > 1) return { resultado: 'AMBIGUO' }
  const vinculo = input.vinculos[0]
  return {
    resultado: 'RESOLVIDO',
    notaFiscalVendaId: vinculo.notaFiscalId,
    notaFiscalRemessaId: vinculo.notaFiscalRemessaId,
    tipoVinculo: vinculo.tipoVinculo,
    metodo: 'CHAVE_CTE',
  }
}

/** Resolucao completa: tenta A, depois B, nunca casa por fallback estruturado alem disso (regra C: nunca CNPJ/data/numero isolado). */
export function resolverComprovanteWebhook(input: {
  chaveNfe: {
    vendaPorChave: NotaFiscalVendaPorChave | null
    remessaPorChave: NotaFiscalRemessaPorChave | null
  }
  chaveCte: {
    cteEncontrado: boolean
    vinculos: CteVinculoPorChave[]
  } | null
}): ResolucaoComprovanteWebhook {
  const porNfe = resolverPorChaveNfe(input.chaveNfe)
  if (porNfe) return porNfe
  if (input.chaveCte) {
    const porCte = resolverPorChaveCte(input.chaveCte)
    if (porCte) return porCte
  }
  return { resultado: 'NAO_IDENTIFICADO' }
}

export type ValidacaoCruzadaResultado = { ok: true } | { ok: false; motivo: string }

/** Regra 4: validacao cruzada apos o match -- qualquer divergencia material vira REVISAO_MATCH, nunca auto-anexa mesmo tendo resolvido a NF. */
export function validarCruzamentoComprovanteWebhook(input: {
  cnpjClientePayload: string
  cnpjDestinatarioVenda: string | null
  cnpjEmitentePayload: string
  /** venda.cnpjEmitente quando DIRETO_VENDA, ou remessa.emitenteCnpj quando VIA_REMESSA. */
  cnpjEmitenteEsperado: string | null
  cnpjTransportadoraPayload: string
  /** CNPJ cadastrado na integracao (quando configurado) e/ou o do CT-e resolvido -- qualquer um que exista precisa bater. */
  cnpjTransportadoraEsperado: string | null
}): ValidacaoCruzadaResultado {
  if (input.cnpjDestinatarioVenda && input.cnpjClientePayload !== input.cnpjDestinatarioVenda) {
    return { ok: false, motivo: 'CNPJ_CLIENTE_DIVERGENTE' }
  }
  if (input.cnpjEmitenteEsperado && input.cnpjEmitentePayload !== input.cnpjEmitenteEsperado) {
    return { ok: false, motivo: 'CNPJ_EMITENTE_DIVERGENTE' }
  }
  if (input.cnpjTransportadoraEsperado && input.cnpjTransportadoraPayload !== input.cnpjTransportadoraEsperado) {
    return { ok: false, motivo: 'CNPJ_TRANSPORTADORA_DIVERGENTE' }
  }
  return { ok: true }
}

/** Datas plausiveis: a entrega nunca pode ser antes da emissao da NF-e. */
export function datasComprovanteWebhookPlausiveis(dataEmissaoNfeIso: string, dataEntregaNfeIso: string): boolean {
  const emissao = Date.parse(dataEmissaoNfeIso)
  const entrega = Date.parse(dataEntregaNfeIso)
  if (!Number.isFinite(emissao) || !Number.isFinite(entrega)) return false
  return entrega >= emissao
}
