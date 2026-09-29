export function chaveAtivoVrs(notaFiscalId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(notaFiscalId)) {
    throw new Error('NF sem UUID persistido valido para a identidade VRS.')
  }
  return notaFiscalId
}

export function chaveParcelaVrs(notaFiscalId: string, numeroOriginal: number | string): string {
  const texto = String(numeroOriginal)
  const numero = Number(texto)
  if (!/^\d+$/.test(texto) || !Number.isSafeInteger(numero) || numero < 1 || numero > 999) {
    throw new Error('Numero original da parcela invalido para VRS: esperado inteiro entre 1 e 999.')
  }
  return `${chaveAtivoVrs(notaFiscalId)}_${String(numero).padStart(3, '0')}`
}
