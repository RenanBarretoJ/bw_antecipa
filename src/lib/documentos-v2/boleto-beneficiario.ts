/**
 * Regras puras para identificacao automatica do beneficiario de um boleto
 * a partir do texto extraido do PDF (usado por
 * identificarBeneficiarioBoleto em src/lib/actions/parcelas-nf.ts).
 *
 * Vive fora de parcelas-nf.ts (arquivo 'use server') porque toda funcao
 * exportada de um modulo Server Actions precisa ser assincrona -- estas
 * sao deliberadamente sincronas/puras para serem testadas em isolamento.
 */

/**
 * Extrai candidatos a CNPJ (sequencias de 14 digitos, formatadas com o
 * padrao XX.XXX.XXX/XXXX-XX ou apenas digitos) de um texto livre.
 */
export function extrairCandidatosCnpj(texto: string): string[] {
  const regex = /(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/g
  const candidatos = new Set<string>()
  for (const match of texto.matchAll(regex)) {
    const digits = match[1].replace(/\D/g, '')
    if (digits.length === 14) candidatos.add(digits)
  }
  return [...candidatos]
}

/**
 * Cruza os CNPJs candidatos (extraidos de um texto) contra a lista de
 * beneficiarios elegiveis da NF e retorna o id do unico beneficiario cujo
 * CNPJ aparece entre os candidatos. Retorna null quando nao ha match, ha
 * mais de um match (ambiguo) ou nenhum candidato/beneficiario informado --
 * nunca "adivinha" por nome/razao social.
 */
export function encontrarBeneficiarioUnico(
  candidatos: string[],
  beneficiarios: Array<{ id: string; cnpj: string }>,
): string | null {
  if (candidatos.length === 0 || beneficiarios.length === 0) return null
  const candidatosDigits = new Set(candidatos.map((c) => c.replace(/\D/g, '')))
  const idsEncontrados = new Set(
    beneficiarios
      .filter((b) => candidatosDigits.has(b.cnpj.replace(/\D/g, '')))
      .map((b) => b.id),
  )
  return idsEncontrados.size === 1 ? [...idsEncontrados][0] : null
}

/**
 * Beneficiario efetivo de uma parcela de boleto: a escolha feita nesta
 * sessao (manual ou auto-detectada) sempre prevalece; na sua ausencia, cai
 * para o beneficiario ja persistido na ultima versao enviada. Garante que
 * um boleto rejeitado/reaberto para reenvio continue mostrando o mesmo
 * beneficiario em vez de voltar para uma selecao vazia.
 */
export function resolverBeneficiarioEfetivo(
  localId: string | null | undefined,
  persistidoId: string | null | undefined,
): string {
  return localId || persistidoId || ''
}

/**
 * Decide se a deteccao automatica por CNPJ deve ser tentada: somente quando
 * NAO ha beneficiario ja resolvido (nem persistido de um envio anterior,
 * nem escolhido nesta sessao) -- nunca sobrescreve e nunca gasta uma
 * chamada ao servidor sem necessidade.
 */
export function deveTentarAutodeteccaoBeneficiario(
  localId: string | null | undefined,
  persistidoId: string | null | undefined,
): boolean {
  return !resolverBeneficiarioEfetivo(localId, persistidoId)
}
