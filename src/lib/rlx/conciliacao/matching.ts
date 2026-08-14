import Decimal from 'decimal.js'
import type {
  RlxExternalSource,
  RlxKnownCrosswalk,
  RlxMatchCandidate,
  RlxMatchMethod,
  RlxMatchResult,
  RlxNoteCandidate,
} from './types'

const digits = (value: string | null | undefined) => (value || '').replace(/\D/g, '')
const textKey = (value: string | null | undefined) => (value || '').trim().toUpperCase()

export function normalizarChaveNfe(value: string | null | undefined) {
  const normalized = digits(value)
  return /^\d{44}$/.test(normalized) ? normalized : null
}

export function identidadeExternaDaFonte(source: RlxExternalSource) {
  return textKey(source.externalTitleKey)
    || textKey(source.idRecebivel)
    || textKey(source.seuNumero)
    || normalizarChaveNfe(source.chaveNfe)
    || `${digits(source.cedenteDocumento)}|${digits(source.sacadoDocumento)}|${textKey(source.numeroDocumento)}|${source.dataVencimento || ''}|${source.valorReferencia || ''}`
}

function exactMoney(left: string | null, right: string | null) {
  if (!left || !right) return false
  try {
    return new Decimal(left).eq(new Decimal(right))
  } catch {
    return false
  }
}

function dedupeCandidates(candidates: RlxMatchCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.notaFiscalId, candidate])).values()]
}

function resultFromCandidates(
  source: RlxExternalSource,
  method: RlxMatchMethod,
  candidates: RlxMatchCandidate[],
  knownByNote = new Map<string, RlxKnownCrosswalk>(),
): RlxMatchResult | null {
  const unique = dedupeCandidates(candidates)
  if (unique.length === 0) return null
  if (unique.length > 1) {
    return {
      source,
      status: 'AMBIGUO',
      metodo: 'AMBIGUO',
      notaFiscalId: null,
      vinculoId: null,
      candidates: unique,
      evidencias: { regra: method, candidateCount: unique.length },
    }
  }
  const known = knownByNote.get(unique[0].notaFiscalId)
  return {
    source,
    status: 'MATCH_FORTE',
    metodo: method,
    notaFiscalId: unique[0].notaFiscalId,
    vinculoId: known?.vinculoId || null,
    candidates: unique,
    evidencias: { ...unique[0].evidencias, regra: method, candidateCount: 1, origemVinculo: known?.origem || null },
  }
}

function candidatesFromKnown(
  source: RlxExternalSource,
  crosswalk: RlxKnownCrosswalk[],
  type: RlxKnownCrosswalk['tipoChave'],
  rawValue: string | null,
) {
  const value = type === 'CHAVE_NFE' ? normalizarChaveNfe(rawValue) : textKey(rawValue)
  if (!value) return []
  return crosswalk
    .filter((item) => item.fundoId === source.fundoId && item.provedor === source.provedor && item.tipoChave === type && item.valorNormalizado === value)
    .map((item): RlxMatchCandidate => ({
      notaFiscalId: item.notaFiscalId,
      metodo: type === 'ID_RECEBIVEL' ? 'ID_RECEBIVEL' : type === 'SEU_NUMERO' ? 'SEU_NUMERO' : 'CHAVE_NFE',
      evidencias: { tipoChave: type, valorNormalizado: value, vinculoId: item.vinculoId, origem: item.origem },
    }))
}

export function executarMatchDeterministico(
  source: RlxExternalSource,
  notes: RlxNoteCandidate[],
  crosswalk: RlxKnownCrosswalk[] = [],
): RlxMatchResult {
  const scopedNotes = notes.filter((note) => note.fundoId === source.fundoId)

  const scopedKnown = crosswalk.filter((item) =>
    item.fundoId === source.fundoId && item.provedor === source.provedor,
  )
  const manual = scopedKnown.filter((item) => item.origem === 'MANUAL')
  const manualByNote = new Map(manual.map((item) => [item.notaFiscalId, item]))
  const manualCandidates = dedupeCandidates([
    ...candidatesFromKnown(source, manual, 'ID_RECEBIVEL', source.idRecebivel),
    ...candidatesFromKnown(source, manual, 'SEU_NUMERO', source.seuNumero),
    ...candidatesFromKnown(source, manual, 'CHAVE_NFE', source.chaveNfe),
  ])
  const manualResult = resultFromCandidates(source, manualCandidates[0]?.metodo || 'ID_RECEBIVEL', manualCandidates, manualByNote)
  if (manualResult) return manualResult

  const key = normalizarChaveNfe(source.chaveNfe)
  if (key) {
    const candidates = scopedNotes
      .filter((note) => normalizarChaveNfe(note.chaveAcesso) === key)
      .map((note): RlxMatchCandidate => ({ notaFiscalId: note.id, metodo: 'CHAVE_NFE', evidencias: { chaveNfe: key } }))
    const resolved = resultFromCandidates(source, 'CHAVE_NFE', candidates)
    if (resolved?.status === 'MATCH_FORTE') {
      const conflictingLinks = scopedKnown.filter((item) =>
        item.origem !== 'MANUAL'
        && item.notaFiscalId !== resolved.notaFiscalId
        && (
          (item.tipoChave === 'ID_RECEBIVEL' && item.valorNormalizado === textKey(source.idRecebivel))
          || (item.tipoChave === 'SEU_NUMERO' && item.valorNormalizado === textKey(source.seuNumero))
        ),
      )
      if (conflictingLinks.length > 0) {
        return {
          source,
          status: 'CONFLITO',
          metodo: 'CONFLITO',
          notaFiscalId: null,
          vinculoId: null,
          candidates: dedupeCandidates([
            ...resolved.candidates,
            ...conflictingLinks.map((item) => ({
              notaFiscalId: item.notaFiscalId,
              metodo: item.tipoChave === 'ID_RECEBIVEL' ? 'ID_RECEBIVEL' as const : 'SEU_NUMERO' as const,
              evidencias: { vinculoId: item.vinculoId, tipoChave: item.tipoChave, valorNormalizado: item.valorNormalizado },
            })),
          ]),
          evidencias: {
            motivo: 'CHAVE_NFE diverge de crosswalk ativo',
            chaveNfe: key,
            vinculosConflitantes: conflictingLinks.map((item) => item.vinculoId),
          },
        }
      }
    }
    if (resolved) return resolved
  }

  for (const [type, value, method] of [
    ['SEU_NUMERO', source.seuNumero, 'SEU_NUMERO'],
    ['ID_RECEBIVEL', source.idRecebivel, 'ID_RECEBIVEL'],
  ] as const) {
    const known = scopedKnown.filter((item) => item.origem !== 'MANUAL')
    const byNote = new Map(known.map((item) => [item.notaFiscalId, item]))
    const resolved = resultFromCandidates(source, method, candidatesFromKnown(source, known, type, value), byNote)
    if (resolved) return resolved
  }

  const compoundCandidates = scopedNotes
    .filter((note) =>
      digits(note.cedenteDocumento) === digits(source.cedenteDocumento)
      && digits(note.sacadoDocumento) === digits(source.sacadoDocumento)
      && textKey(note.numero) === textKey(source.numeroDocumento)
      && note.dataVencimento === source.dataVencimento
      && exactMoney(note.valorBruto, source.valorReferencia),
    )
    .map((note): RlxMatchCandidate => ({
      notaFiscalId: note.id,
      metodo: 'COMPOSTO',
      evidencias: {
        cedenteDocumento: digits(source.cedenteDocumento),
        sacadoDocumento: digits(source.sacadoDocumento),
        numeroDocumento: textKey(source.numeroDocumento),
        dataVencimento: source.dataVencimento,
        valor: source.valorReferencia,
      },
    }))
  const compound = resultFromCandidates(source, 'COMPOSTO', compoundCandidates)
  if (compound) return compound

  return {
    source,
    status: 'NAO_CONCILIADO',
    metodo: 'NAO_CONCILIADO',
    notaFiscalId: null,
    vinculoId: null,
    candidates: [],
    evidencias: { motivo: 'Nenhuma candidata deterministica no mesmo fundo' },
  }
}

export function chavesPropagaveis(source: RlxExternalSource) {
  const values: Array<{ tipo: RlxKnownCrosswalk['tipoChave']; valor: string }> = []
  const add = (
    tipo: RlxKnownCrosswalk['tipoChave'],
    value: string | null | undefined,
    normalize: (candidate: string | null | undefined) => string | null = textKey,
  ) => {
    const normalized = normalize(value)
    if (normalized) values.push({ tipo, valor: normalized })
  }
  add('ID_RECEBIVEL', source.idRecebivel)
  add('SEU_NUMERO', source.seuNumero)
  add('CHAVE_NFE', source.chaveNfe, normalizarChaveNfe)
  add('EXTERNAL_TITLE_KEY', source.externalTitleKey)
  add('DOCUMENTO', source.numeroDocumento)
  return values
}
