import { describe, expect, it } from 'vitest'
import type { FiscalSnapshot } from './contracts'
import { calcularDvChaveNfe } from './key'
import { mapSerproNfeResponse } from './mapper'

const base = '3526101422486400010055002000002190112345678'
const accessKey = `${base}${calcularDvChaveNfe(base)}`
const checkedAt = '2026-10-26T15:00:00.000Z'
const snapshot: FiscalSnapshot = {
  chaveAcesso: accessKey,
  numeroNf: '2190',
  serie: '2',
  cnpjEmitente: '14.224.864/0001-00',
  cnpjDestinatario: '12.345.678/0001-90',
  dataEmissao: '2026-10-20',
  valorTotal: '71057.00',
}

function event(code: string, responseCode = '135', sequence = '1') {
  return {
    evento: { infEvento: { chNFe: accessKey, tpAmb: '1', nSeqEvento: sequence, tpEvento: code, dhEvento: '2026-10-22T10:00:00-03:00' } },
    retEvento: { infEvento: { chNFe: accessKey, tpAmb: '1', nSeqEvento: sequence, tpEvento: code, cStat: responseCode, nProt: `PROTO-${code}`, dhRegEvento: '2026-10-22T10:01:00-03:00' } },
  }
}

function documentedEvent(code: string) {
  return {
    evento: { infEvento: {
      cOrgao: 91,
      dhEvento: '2026-10-22T10:00:00-03:00',
      detEvento: { descEvento: 'Evento sintético conforme OpenAPI' },
      tpEvento: code,
    } },
    retEvento: { infEvento: {
      cOrgao: 91,
      nProt: `PROTO-${code}`,
      dhRegEvento: '2026-10-22T10:01:00-03:00',
      tpEvento: code,
    } },
  }
}

function payload(events: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    nfeProc: {
      NFe: { infNFe: {
        Id: `NFe${accessKey}`,
        ide: { tpAmb: '1', mod: '55', nNF: '2190', serie: '2', dhEmi: '2026-10-20T08:00:00-03:00' },
        emit: { CNPJ: '14224864000100' },
        dest: { CNPJ: '12345678000190' },
        total: { ICMSTot: { vNF: '71057.00' } },
      } },
      protNFe: { infProt: { chNFe: accessKey, cStat: '100', nProt: 'AUTH-1' } },
    },
    procEventosNFe: events,
    ...overrides,
  }
}

describe('mapeamento fiscal minimizado SERPRO', () => {
  it('consome o envelope oficial procEventosNFe', () => {
    const raw = payload([documentedEvent('110111')])
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'CONSULTADO', severity: 'VERMELHO' })
    expect(result.events).toHaveLength(1)
    expect(result.result.eventEnvelope).toMatchObject({
      source: 'procEventosNFe',
      state: 'OBSERVED',
      observedItems: 1,
      confirmedActionableItems: 1,
    })
    expect(result.events[0].provenance).toEqual({
      envelope: 'procEventosNFe',
      sourceIndex: 0,
      code: 'procEventosNFe[0].evento.infEvento.tpEvento|retEvento.infEvento.tpEvento',
      protocol: 'procEventosNFe[0].retEvento.infEvento.nProt',
      occurredAt: 'procEventosNFe[0].retEvento.infEvento.dhRegEvento|evento.infEvento.dhEvento',
    })
  })

  it('só fica verde com autorização, identidade integral e campos conferidos', () => {
    const result = mapSerproNfeResponse(payload(), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'CONSULTADO', severity: 'VERDE', eventCoverage: 'PARTIAL', differences: [] })
    expect(result.summary).toContain('cobertura conhecida')
  })

  it('divergência material impede verde', () => {
    const raw = payload()
    raw.nfeProc.NFe.infNFe.dest.CNPJ = '99999999000199'
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'DIVERGENTE', severity: 'AMARELO' })
    expect(result.differences).toContain('Documento do destinatário divergente.')
  })

  it.each([
    ['110111', 'Cancelamento registrado'],
    ['210220', 'Desconhecimento da operação'],
    ['210240', 'Operação não realizada'],
  ])('evento impeditivo registrado %s tem precedência vermelha', (code, description) => {
    const result = mapSerproNfeResponse(payload([event(code)]), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'CONSULTADO', severity: 'VERMELHO' })
    expect(result.events[0]).toMatchObject({ code, description, registered: true, severity: 'VERMELHO' })
  })

  it('pedido de cancelamento sem registro não é vermelho', () => {
    const result = mapSerproNfeResponse(payload([event('110111', '128')]), snapshot, checkedAt)
    expect(result.severity).toBe('AMARELO')
    expect(result.events).toEqual([])
  })

  it('CC-e registrada é amarela e evento desconhecido é inconclusivo', () => {
    expect(mapSerproNfeResponse(payload([event('110110')]), snapshot, checkedAt)).toMatchObject({ severity: 'AMARELO' })
    const unknown = mapSerproNfeResponse(payload([event('999999')]), snapshot, checkedAt)
    expect(unknown).toMatchObject({ status: 'INCONCLUSIVO', severity: 'AMARELO' })
    expect(unknown.events[0]).toMatchObject({ code: '999999', severity: 'AMARELO', registered: true })
    expect(unknown.result.eventEnvelope).toMatchObject({ unknownCodes: ['999999'] })
  })

  it('ciência e confirmação registradas são observadas sem virar evento impeditivo', () => {
    const result = mapSerproNfeResponse(payload([
      event('210210', '135', '1'),
      event('210200', '135', '2'),
    ]), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'CONSULTADO', severity: 'VERDE', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({
      state: 'OBSERVED',
      observedItems: 2,
      confirmedActionableItems: 0,
      confirmedNonBlockingItems: 2,
      observedCodes: ['210200', '210210'],
    })
  })

  it('denegação comprovada é vermelha', () => {
    const raw = payload()
    raw.nfeProc.protNFe.infProt.cStat = '301'
    expect(mapSerproNfeResponse(raw, snapshot, checkedAt)).toMatchObject({ status: 'CONSULTADO', severity: 'VERMELHO' })
  })

  it('deduplica eventos e produz fingerprint estável com reorder', () => {
    const first = mapSerproNfeResponse(payload([event('110110', '135', '1'), event('210220', '135', '2'), event('110110', '135', '1')]), snapshot, checkedAt)
    const second = mapSerproNfeResponse(payload([event('210220', '135', '2'), event('110110', '135', '1')]), snapshot, checkedAt)
    expect(first.events).toHaveLength(2)
    expect(first.responseFingerprint).toBe(second.responseFingerprint)
    expect(first.severity).toBe('VERMELHO')
    expect(first.events.map(item => item.code)).toEqual(['110110', '210220'])
  })

  it.each([
    ['sem protocolo', (item: ReturnType<typeof event>) => {
      delete (item.retEvento.infEvento as Partial<typeof item.retEvento.infEvento>).nProt
    }],
    ['sem código', (item: ReturnType<typeof event>) => {
      delete (item.evento.infEvento as Partial<typeof item.evento.infEvento>).tpEvento
      delete (item.retEvento.infEvento as Partial<typeof item.retEvento.infEvento>).tpEvento
    }],
    ['sem data', (item: ReturnType<typeof event>) => {
      delete (item.evento.infEvento as Partial<typeof item.evento.infEvento>).dhEvento
      delete (item.retEvento.infEvento as Partial<typeof item.retEvento.infEvento>).dhRegEvento
    }],
  ])('evento incompleto (%s) permanece amarelo e não é confirmado', (_label, mutate) => {
    const item = event('110111')
    mutate(item)
    const result = mapSerproNfeResponse(payload([item]), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'INCONCLUSIVO', severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({ state: 'INCOMPLETE', incompleteItems: 1 })
  })

  it('rejeita evento vinculado a outra chave', () => {
    const item = event('110111')
    item.evento.infEvento.chNFe = accessKey.replace(/^35/, '33')
    item.retEvento.infEvento.chNFe = item.evento.infEvento.chNFe
    const result = mapSerproNfeResponse(payload([item]), snapshot, checkedAt)
    expect(result).toMatchObject({ severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({
      state: 'INCOMPLETE',
      incompleteItems: 1,
      contextRejectedItems: 1,
    })
  })

  it('rejeita eventos quando a chave principal do retorno diverge da chave consultada', () => {
    const otherKey = accessKey.replace(/^35/, '33')
    const raw = payload([documentedEvent('110111')])
    raw.nfeProc.NFe.infNFe.Id = `NFe${otherKey}`
    raw.nfeProc.protNFe.infProt.chNFe = otherKey
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result).toMatchObject({ severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({
      state: 'INCOMPLETE',
      incompleteItems: 1,
      contextRejectedItems: 1,
    })
  })

  it.each([
    ['ausente', {}, 'ABSENT'],
    ['nulo', { procEventosNFe: null }, 'INVALID'],
    ['objeto', { procEventosNFe: {} }, 'INVALID'],
  ])('envelope oficial %s não produz verde', (_label, eventOverride, state) => {
    const raw = payload([], eventOverride)
    if (_label === 'ausente') delete (raw as Partial<typeof raw>).procEventosNFe
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'INCONCLUSIVO', severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({ state })
  })

  it('array oficial vazio é distinguido de envelope ausente', () => {
    const result = mapSerproNfeResponse(payload([]), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'CONSULTADO', severity: 'VERDE', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({
      source: 'procEventosNFe',
      state: 'EMPTY',
      observedItems: 0,
    })
  })

  it('item vazio dentro do array é incompleto', () => {
    const result = mapSerproNfeResponse(payload([{}]), snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'INCONCLUSIVO', severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({ state: 'INCOMPLETE', incompleteItems: 1 })
  })

  it('não aceita o envelope singular sem evidência contratual', () => {
    const raw = payload([], { procEventoNFe: [event('110111')] })
    delete (raw as Partial<typeof raw>).procEventosNFe
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result).toMatchObject({ status: 'INCONCLUSIVO', severity: 'AMARELO', events: [] })
    expect(result.result.eventEnvelope).toMatchObject({ source: null, state: 'ABSENT' })
  })

  it('resposta parcial nunca fica verde', () => {
    const result = mapSerproNfeResponse({ nfeProc: { NFe: {}, protNFe: {} } }, snapshot, checkedAt)
    expect(result.severity).toBe('AMARELO')
    expect(result.differences.length).toBeGreaterThan(0)
  })

  it('preserva apenas duplicatas efetivamente retornadas e sua proveniência', () => {
    const raw = payload() as ReturnType<typeof payload> & {
      nfeProc: { NFe: { infNFe: { cobr?: unknown } } }
    }
    raw.nfeProc.NFe.infNFe.cobr = {
      dup: [
        { nDup: '001', dVenc: '2026-11-20', vDup: '3.55285E+4' },
        { nDup: '002', dVenc: '2026-12-20', vDup: '35528.50' },
      ],
    }
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result.result.returnedInstallments).toEqual([
      {
        sequence: 1,
        number: '001',
        dueDate: '2026-11-20',
        amountInCents: 3552850,
        provenance: {
          number: 'nfeProc.NFe.infNFe.cobr.dup[0].nDup',
          dueDate: 'nfeProc.NFe.infNFe.cobr.dup[0].dVenc',
          amountInCents: 'nfeProc.NFe.infNFe.cobr.dup[0].vDup',
        },
      },
      {
        sequence: 2,
        number: '002',
        dueDate: '2026-12-20',
        amountInCents: 3552850,
        provenance: {
          number: 'nfeProc.NFe.infNFe.cobr.dup[1].nDup',
          dueDate: 'nfeProc.NFe.infNFe.cobr.dup[1].dVenc',
          amountInCents: 'nfeProc.NFe.infNFe.cobr.dup[1].vDup',
        },
      },
    ])
    expect(result.result.fieldProvenance).toMatchObject({
      valorTotalCentavos: 'nfeProc.NFe.infNFe.total.ICMSTot.vNF',
      returnedInstallments: 'nfeProc.NFe.infNFe.cobr.dup',
    })
  })

  it('não inventa duplicatas quando cobr/dup não existe e aceita total em notação científica', () => {
    const raw = payload()
    raw.nfeProc.NFe.infNFe.total.ICMSTot.vNF = '7.1057E+4'
    const result = mapSerproNfeResponse(raw, snapshot, checkedAt)
    expect(result.differences).toEqual([])
    expect(result.result).toMatchObject({
      valorTotalCentavos: 7105700,
      returnedInstallments: [],
      fieldProvenance: { returnedInstallments: null },
    })
  })
})
