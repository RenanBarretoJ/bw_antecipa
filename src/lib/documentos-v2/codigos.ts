export function normalizarCodigoDocumentoCatalogo(
  codigo: string,
  extensaoPreferida?: string,
): string {
  if (codigo === 'cte') return extensaoPreferida === 'pdf' ? 'cte_pdf_dacte' : 'cte_xml'
  return codigo
}
