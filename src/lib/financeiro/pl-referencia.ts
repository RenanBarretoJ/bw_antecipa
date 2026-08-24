import Decimal from 'decimal.js'
import { adicionarDiasCivis, diaUtilAnteriorOuIgual } from '@/lib/comunicacoes/calendario'

export const PL_REFERENCE_RULE_VERSION = 'PL_REFERENCIA_TEMPORAL_V1' as const

export type PlReferenciaCandidato = {
  fundoId: string
  snapshotId: string
  importacaoId: string
  dataBase: string
  patrimonioLiquido: string
  snapshotVigente: boolean
  snapshotPublicadaEm: string | null
  importacaoPublicadaEm: string | null
  importacaoStatus: string
  importacaoTipoBase: string
  importacaoCompletude: string
  importacaoOrigem: string | null
  importacaoProvedor: string | null
  importacaoHashConteudo: string | null
}

export type PlReferenciaResolvido = {
  fundoId: string
  snapshotId: string
  importacaoId: string
  dataBase: string
  patrimonioLiquido: string
  defasagem: string | null
  origem: string | null
  origemCodigo: string | null
  provedor: string | null
  hashConteudo: string | null
  regraVersao: typeof PL_REFERENCE_RULE_VERSION
}

function dataCivilValida(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function rotuloOrigemPl(origem: string | null, provedor: string | null): string | null {
  if (origem === 'GOLDEN_DATASET' || /(^|[_-])(qa|golden)([_-]|$)/i.test(provedor || '')) {
    return 'QA SYNTHETIC'
  }
  return [origem, provedor].filter(Boolean).join(' · ') || null
}

export function calcularDefasagemPl(dataOperacional: string, dataBase: string): string | null {
  if (!dataCivilValida(dataOperacional) || !dataCivilValida(dataBase) || dataBase >= dataOperacional) return null

  let cursor = dataOperacional
  let diasUteis = 0
  while (cursor > dataBase && diasUteis < 10_000) {
    cursor = diaUtilAnteriorOuIgual(adicionarDiasCivis(cursor, -1))
    diasUteis += 1
  }

  return cursor === dataBase ? `D-${diasUteis}` : null
}

export function selecionarPlReferenciaTemporal(input: {
  fundoId: string
  dataOperacional: string
  candidatos: PlReferenciaCandidato[]
}): PlReferenciaResolvido | null {
  const candidato = input.candidatos
    .filter((item) => {
      if (item.fundoId !== input.fundoId || !item.snapshotVigente || item.dataBase >= input.dataOperacional) return false
      if (item.importacaoStatus !== 'PUBLICADA' || item.importacaoTipoBase !== 'CARTEIRA') return false
      if (item.importacaoCompletude !== 'COMPLETO_COM_DADOS') return false
      try {
        return new Decimal(item.patrimonioLiquido).gt(0)
      } catch {
        return false
      }
    })
    .sort((left, right) => (
      right.dataBase.localeCompare(left.dataBase)
      || String(right.snapshotPublicadaEm || '').localeCompare(String(left.snapshotPublicadaEm || ''))
      || String(right.importacaoPublicadaEm || '').localeCompare(String(left.importacaoPublicadaEm || ''))
      || right.snapshotId.localeCompare(left.snapshotId)
    ))[0]

  if (!candidato) return null
  return {
    fundoId: candidato.fundoId,
    snapshotId: candidato.snapshotId,
    importacaoId: candidato.importacaoId,
    dataBase: candidato.dataBase,
    patrimonioLiquido: new Decimal(candidato.patrimonioLiquido).toFixed(4),
    defasagem: calcularDefasagemPl(input.dataOperacional, candidato.dataBase),
    origem: rotuloOrigemPl(candidato.importacaoOrigem, candidato.importacaoProvedor),
    origemCodigo: candidato.importacaoOrigem,
    provedor: candidato.importacaoProvedor,
    hashConteudo: candidato.importacaoHashConteudo,
    regraVersao: PL_REFERENCE_RULE_VERSION,
  }
}
