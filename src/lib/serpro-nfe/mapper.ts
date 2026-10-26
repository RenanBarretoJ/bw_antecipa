import { createHash } from 'node:crypto'
import type { FiscalAssessment, FiscalEventView, FiscalSnapshot } from './contracts'
import { identidadeDaChaveNfe, somenteDigitos, validarChaveNfe55 } from './key'

type JsonObject = Record<string, unknown>

const acceptedEventStatus = new Set(['135', '155'])
const redProtocolStatus = new Set(['101', '151', '155', '110', '301', '302', '303'])
const authorizedProtocolStatus = new Set(['100', '150'])
const redEvents = new Set(['110111', '210220', '210240'])
const yellowEvents = new Set(['110110'])
const knownNonBlockingEvents = new Set(['210200', '210210'])

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function list(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function normalizedIdentifier(value: unknown) {
  const digits = somenteDigitos(text(value))
  return digits.replace(/^0+/, '') || (digits ? '0' : '')
}

function normalizedDate(value: unknown) {
  const raw = text(value)
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? ''
}

function amountInCents(value: unknown) {
  const raw = text(value).replace(',', '.')
  const match = raw.match(/^\+?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)
  if (!match) return null

  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? '0')
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null

  const digits = `${match[1]}${fraction}`.replace(/^0+/, '') || '0'
  let cents = BigInt(digits)
  const shift = exponent - fraction.length + 2
  if (shift >= 0) {
    cents *= BigInt(10) ** BigInt(shift)
  } else {
    const divisor = BigInt(10) ** BigInt(-shift)
    const quotient = cents / divisor
    const remainder = cents % divisor
    cents = quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0))
  }

  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}

function extractReturnedInstallments(inf: JsonObject) {
  const billing = object(inf.cobr)
  return list(billing.dup).flatMap((value, index) => {
    const duplicate = object(value)
    if (!Object.keys(duplicate).length) return []
    const amount = amountInCents(duplicate.vDup)
    const dueDate = normalizedDate(duplicate.dVenc)
    const number = text(duplicate.nDup)
    return [{
      sequence: index + 1,
      number: number || null,
      dueDate: dueDate || null,
      amountInCents: amount,
      provenance: {
        number: number ? `nfeProc.NFe.infNFe.cobr.dup[${index}].nDup` : null,
        dueDate: dueDate ? `nfeProc.NFe.infNFe.cobr.dup[${index}].dVenc` : null,
        amountInCents: amount !== null ? `nfeProc.NFe.infNFe.cobr.dup[${index}].vDup` : null,
      },
    }]
  })
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex')
}

function document(node: JsonObject) {
  return somenteDigitos(text(node.CNPJ || node.CPF))
}

function eventDescription(code: string) {
  const descriptions: Record<string, string> = {
    '110111': 'Cancelamento registrado',
    '110110': 'Carta de Correção eletrônica',
    '210200': 'Confirmação da operação',
    '210210': 'Ciência da operação',
    '210220': 'Desconhecimento da operação',
    '210240': 'Operação não realizada',
  }
  return descriptions[code] ?? `Evento fiscal não mapeado (${code || 'sem código'})`
}

function extractEvents(raw: JsonObject, checkedAt: string, key: string) {
  const events: FiscalEventView[] = []
  let hasUncertainEvent = false

  for (const value of list(raw.procEventoNFe)) {
    const event = object(value)
    const request = object(object(event.evento).infEvento)
    const response = object(object(event.retEvento).infEvento)
    const code = text(request.tpEvento || response.tpEvento)
    const responseCode = text(response.cStat)
    const sameContext = text(request.chNFe) === key
      && text(response.chNFe) === key
      && text(request.tpEvento) === text(response.tpEvento)
      && text(request.nSeqEvento) === text(response.nSeqEvento)
      && text(request.tpAmb) === '1'
      && text(response.tpAmb) === '1'
    const registered = sameContext && acceptedEventStatus.has(responseCode)

    if (!code || (!redEvents.has(code) && !yellowEvents.has(code) && !knownNonBlockingEvents.has(code))) {
      hasUncertainEvent = true
    }
    if ((redEvents.has(code) || yellowEvents.has(code)) && !registered) {
      hasUncertainEvent = true
      continue
    }
    if (!registered || knownNonBlockingEvents.has(code)) continue

    if (!/^\d{6}$/.test(code)) continue
    const severity = redEvents.has(code) ? 'VERMELHO' : 'AMARELO'
    const occurredAt = text(response.dhRegEvento || request.dhEvento) || null
    const protocol = text(response.nProt) || null
    const fingerprint = sha256({ code, protocol, occurredAt, key })
    events.push({
      code,
      description: eventDescription(code),
      protocol,
      occurredAt,
      observedAt: checkedAt,
      registered: true,
      severity,
      fingerprint,
    })
  }

  const deduplicated = [...new Map(events.map(event => [event.fingerprint, event])).values()]
    .sort((a, b) => `${a.occurredAt ?? ''}|${a.code}`.localeCompare(`${b.occurredAt ?? ''}|${b.code}`))
  return { events: deduplicated, hasUncertainEvent }
}

export function mapSerproNfeResponse(raw: unknown, snapshot: FiscalSnapshot, checkedAt: string): FiscalAssessment {
  if (!validarChaveNfe55(snapshot.chaveAcesso)) throw new Error('INVALID_LOCAL_NFE_KEY')
  const data = object(raw)
  const process = object(data.nfeProc)
  const inf = object(object(process.NFe).infNFe)
  const ide = object(inf.ide)
  const protocol = object(object(process.protNFe).infProt)
  const key = somenteDigitos(snapshot.chaveAcesso)
  const identity = identidadeDaChaveNfe(key)
  if (!identity) throw new Error('INVALID_LOCAL_NFE_IDENTITY')

  const remoteKey = somenteDigitos(text(protocol.chNFe))
  const infId = text(inf.Id || inf['@Id']).replace(/^NFe/, '')
  const protocolStatus = text(protocol.cStat)
  const issuer = document(object(inf.emit))
  const recipient = document(object(inf.dest))
  const total = amountInCents(object(object(inf.total).ICMSTot).vNF)
  const localTotal = amountInCents(snapshot.valorTotal)
  const returnedInstallments = extractReturnedInstallments(inf)
  const differences: string[] = []

  if (remoteKey !== key || infId !== key) differences.push('Chave principal divergente ou ausente no retorno.')
  if (text(ide.mod) !== '55' || text(ide.tpAmb) !== '1') differences.push('Modelo ou ambiente fiscal divergente.')
  if (issuer !== somenteDigitos(snapshot.cnpjEmitente) || issuer !== identity.cnpjEmitente) differences.push('CNPJ do emitente divergente.')
  if (recipient !== somenteDigitos(snapshot.cnpjDestinatario)) differences.push('Documento do destinatário divergente.')
  if (normalizedIdentifier(ide.nNF) !== normalizedIdentifier(snapshot.numeroNf) || normalizedIdentifier(ide.nNF) !== identity.numero) differences.push('Número da NF-e divergente.')
  if (normalizedIdentifier(ide.serie) !== normalizedIdentifier(snapshot.serie) || normalizedIdentifier(ide.serie) !== identity.serie) differences.push('Série da NF-e divergente.')
  if (normalizedDate(ide.dhEmi || ide.dEmi) !== normalizedDate(snapshot.dataEmissao)) differences.push('Data de emissão divergente.')
  if (total === null || localTotal === null || total !== localTotal) differences.push('Valor total fiscal divergente ou ausente.')

  const { events, hasUncertainEvent } = extractEvents(data, checkedAt, key)
  const hasRedEvent = events.some(event => event.severity === 'VERMELHO')
  const hasYellowEvent = events.some(event => event.severity === 'AMARELO')
  const redProtocol = redProtocolStatus.has(protocolStatus)
  const authorized = authorizedProtocolStatus.has(protocolStatus) && Boolean(text(protocol.nProt))

  let severity: FiscalAssessment['severity'] = 'AMARELO'
  let status: FiscalAssessment['status'] = differences.length ? 'DIVERGENTE' : 'INCONCLUSIVO'
  let summary = 'A consulta exige análise; regularidade fiscal não comprovada.'

  if (redProtocol || hasRedEvent) {
    severity = 'VERMELHO'
    status = 'CONSULTADO'
    summary = redProtocolStatus.has(protocolStatus) && ['110', '301', '302', '303'].includes(protocolStatus)
      ? 'Denegação fiscal comprovada pelo protocolo retornado.'
      : 'Evento impeditivo registrado e vinculado à NF-e.'
  } else if (differences.length) {
    summary = 'Consulta concluída com divergências fiscais; revisão do Gestor necessária.'
  } else if (!authorized || hasUncertainEvent || hasYellowEvent) {
    summary = hasYellowEvent
      ? 'Consulta autorizada com evento fiscal que requer análise.'
      : 'Autorização ou cobertura de eventos inconclusiva; revisar antes de decidir.'
  } else {
    severity = 'VERDE'
    status = 'CONSULTADO'
    summary = 'Autorização e dados conferidos dentro da cobertura conhecida desta consulta.'
  }

  const result = {
    chaveAcesso: key,
    protocoloStatus: protocolStatus || null,
    protocolo: text(protocol.nProt) || null,
    cnpjEmitente: issuer || null,
    documentoDestinatario: recipient || null,
    numeroNf: normalizedIdentifier(ide.nNF) || null,
    serie: normalizedIdentifier(ide.serie) || null,
    dataEmissao: normalizedDate(ide.dhEmi || ide.dEmi) || null,
    valorTotalCentavos: total,
    ambiente: text(ide.tpAmb) || null,
    modelo: text(ide.mod) || null,
    returnedInstallments,
    fieldProvenance: {
      chaveAcesso: [
        'nfeProc.protNFe.infProt.chNFe',
        'nfeProc.NFe.infNFe.Id',
      ],
      protocoloStatus: 'nfeProc.protNFe.infProt.cStat',
      protocolo: 'nfeProc.protNFe.infProt.nProt',
      cnpjEmitente: 'nfeProc.NFe.infNFe.emit.CNPJ|CPF',
      documentoDestinatario: 'nfeProc.NFe.infNFe.dest.CNPJ|CPF',
      numeroNf: 'nfeProc.NFe.infNFe.ide.nNF',
      serie: 'nfeProc.NFe.infNFe.ide.serie',
      dataEmissao: 'nfeProc.NFe.infNFe.ide.dhEmi|dEmi',
      valorTotalCentavos: 'nfeProc.NFe.infNFe.total.ICMSTot.vNF',
      ambiente: 'nfeProc.NFe.infNFe.ide.tpAmb',
      modelo: 'nfeProc.NFe.infNFe.ide.mod',
      returnedInstallments: returnedInstallments.length ? 'nfeProc.NFe.infNFe.cobr.dup' : null,
      eventos: list(data.procEventoNFe).length ? 'procEventoNFe' : null,
    },
  }
  return {
    status,
    severity,
    summary,
    checkedAt,
    responseFingerprint: sha256({ result, differences: [...differences].sort(), events }),
    result,
    differences,
    events,
    eventCoverage: 'PARTIAL',
  }
}
