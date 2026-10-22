export function chaveAtivoVrs(notaFiscalId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(notaFiscalId)) {
    throw new Error('NF sem UUID persistido valido para a identidade VRS.')
  }
  return notaFiscalId
}

export function chaveParcelaVrs(notaFiscalId: string, numeroOriginal: number | string): string {
  const numero = numeroOriginalParcelaVrs(numeroOriginal)
  return `${chaveAtivoVrs(notaFiscalId)}_${String(numero).padStart(3, '0')}`
}

function numeroOriginalParcelaVrs(numeroOriginal: number | string): number {
  const texto = String(numeroOriginal)
  const numero = Number(texto)
  if (!/^\d+$/.test(texto) || !Number.isSafeInteger(numero) || numero < 1 || numero > 999) {
    throw new Error('Numero original da parcela invalido para VRS: esperado inteiro entre 1 e 999.')
  }
  return numero
}

export function identidadeDuplicataVrs(numeroNf: string, numeroOriginal: number | string) {
  if (!/^\d+$/.test(numeroNf)) throw new Error('Numero da NF invalido para a duplicata VRS: esperado somente digitos.')
  const parcela = String(numeroOriginalParcelaVrs(numeroOriginal))
  const chaveAtivo = `${numeroNf}/${parcela}`
  // O fluxo tem o sufixo -1 e deve caber no limite persistido de 100 caracteres.
  if (chaveAtivo.length > 98) throw new Error('Identidade da duplicata VRS excede o limite de 100 caracteres do fluxo.')
  return { chaveAtivo, chaveFluxo: `${chaveAtivo}-1`, numeroEmissao: `${numeroNf}${parcela}` }
}
