/**
 * Nomes dos buckets de Storage.
 * O isolamento entre ambientes é garantido pelo Supabase Branching —
 * cada branch tem seu próprio storage independente.
 */
export const buckets = {
  documentos: 'documentos-cedentes',
  notasFiscais: 'notas-fiscais',
  contratos: 'contratos',
  remessasCnab: 'remessas-cnab',
} as const
