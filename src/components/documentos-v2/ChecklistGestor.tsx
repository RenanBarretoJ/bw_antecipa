'use client'

import { ChecklistDocumentalNota } from './ChecklistCedente'

export function ChecklistGestor({ notaFiscalId }: { notaFiscalId: string }) {
  return <ChecklistDocumentalNota notaFiscalId={notaFiscalId} mode="gestor" />
}
