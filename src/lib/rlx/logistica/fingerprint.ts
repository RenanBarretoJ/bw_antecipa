import { createHash } from 'node:crypto'
import type { ClassificacaoLogisticaPreCessao } from '@/lib/logistica/evidencias-logisticas'

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function criarFingerprintLogistico(classificacoes: Map<string, ClassificacaoLogisticaPreCessao>) {
  return sha256([...classificacoes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([notaFiscalId, classificacao]) => ({ notaFiscalId, ...classificacao })))
}

export function criarAssinaturaPosicaoLogistica(input: {
  fundoId: string
  estoqueImportacaoId: string
  matchingExecucaoId: string
  fingerprintLogistico: string
  regraVersao: string
}) {
  return sha256(input)
}
