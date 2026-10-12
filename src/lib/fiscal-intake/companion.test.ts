import { describe, expect, it, vi } from 'vitest'
import { extractDanfeFromText, validarDanfeParaPersistencia, validarDanfeParaVinculo } from '@/lib/pdf-nf-parser'
import { importFiscalFile, type FiscalImportInput, type FiscalImportRepository } from './service.server'
import type { FiscalFacts } from './contracts'

function key(sequence = '000950501') {
  const first = ('3526101122233300018155001' + sequence + '10000000000').slice(0, 43)
  let sum = 0, weight = 2
  for (let index = 42; index >= 0; index--) { sum += Number(first[index]) * weight; weight = weight === 9 ? 2 : weight + 1 }
  return first + (sum % 11 < 2 ? 0 : 11 - sum % 11)
}
function setup() {
  const parsed = extractDanfeFromText(`DANFE\nCHAVE DE ACESSO ${key()}`)
  const facts: FiscalFacts = {kind:'DANFE',documentType:'NFE',key:key(),issuerCnpj:key().slice(6,20),parsed}
  const scope={fundoId:'fund',cedenteId:'cedente',cedenteFundoId:'link',estabelecimentoId:'issuer',cnpj:facts.issuerCnpj,razaoSocial:'QA'}
  const claim={id:'claim',token:'owner',generation:1}
  const repository={resolveScope:vi.fn().mockResolvedValue(scope),reserve:vi.fn(),resumeReview:vi.fn(),openReview:vi.fn(),planStorage:vi.fn(),commit:vi.fn(),fail:vi.fn(),
    companion:vi.fn().mockResolvedValue({kind:'DOCUMENT',claim,intent:{id:'intent',bucket:'documentos-v2',path:'journal/path.pdf'}}),
    commitCompanion:vi.fn().mockResolvedValue({status:'COMPANION_LINKED',nfId:'nf',numero:'950501'}),failCompanion:vi.fn().mockResolvedValue({status:'CLEANUP_PENDING'})} satisfies FiscalImportRepository
  const input: FiscalImportInput={actor:{type:'SYSTEM',source:'EMAIL_INTAKE',integrationId:'integration',messageId:'message',attachmentId:'attachment',attachmentToken:'lease'},fundoId:'fund',file:new File(['%PDF-QA'],'same.pdf')}
  return {input,repository,storage:{upload:vi.fn().mockResolvedValue(undefined)},parse:vi.fn().mockResolvedValue(facts),claim,parsed}
}
describe('NFE document companions',()=>{
  it('accepts recognized identity evidence without using it to create incomplete fiscal facts',()=>{
    const {parsed}=setup()
    expect(validarDanfeParaVinculo(parsed)).toBe(true)
    expect(validarDanfeParaPersistencia(parsed).ok).toBe(false)
    expect(validarDanfeParaVinculo({...parsed,tipo_reconhecido:undefined})).toBe(false)
    expect(validarDanfeParaVinculo({...parsed,motivos_bloqueio:['invoice_key_conflict']})).toBe(false)
    expect(validarDanfeParaVinculo({...parsed,chave_acesso:'1'.repeat(44)})).toBe(false)
    expect(validarDanfeParaVinculo(extractDanfeFromText(`DANFE\n${key()}\n${key('000950502')}`))).toBe(false)
  })
  it('links one document through the journal and never calls fiscal NF commit',async()=>{
    const d=setup();expect((await importFiscalFile(d.input,d)).status).toBe('COMPANION_LINKED')
    expect(d.repository.reserve).not.toHaveBeenCalled();expect(d.repository.commit).not.toHaveBeenCalled()
    expect(d.repository.companion.mock.invocationCallOrder[0]).toBeLessThan(d.storage.upload.mock.invocationCallOrder[0])
    expect(d.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(d.repository.commitCompanion.mock.invocationCallOrder[0])
  })
  it.each(['WAITING_CANONICAL_XML','AMBIGUOUS','IN_PROGRESS','CLEANUP_PENDING'] as const)('performs no storage or NF writes for %s',async status=>{
    const d=setup();d.repository.companion.mockResolvedValue({status})
    expect(await importFiscalFile(d.input,d)).toEqual({status})
    expect(d.storage.upload).not.toHaveBeenCalled();expect(d.repository.reserve).not.toHaveBeenCalled()
  })
  it('blocks an incomplete DANFE when no canonical NF exists',async()=>{
    const d=setup();d.repository.companion.mockResolvedValue({kind:'CREATE_NF'})
    expect(await importFiscalFile(d.input,d)).toEqual({status:'AMBIGUOUS'})
    expect(d.repository.reserve).not.toHaveBeenCalled();expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it('recovers a lost document commit response without deleting its retained object',async()=>{
    const d=setup();d.repository.commitCompanion.mockRejectedValue(new Error('lost response'))
    d.repository.failCompanion.mockResolvedValue({status:'COMPANION_LINKED',nfId:'nf',numero:'950501'})
    expect((await importFiscalFile(d.input,d)).status).toBe('COMPANION_LINKED')
    expect(d.repository.failCompanion).toHaveBeenCalledWith(d.claim)
  })
  it('journals uncertain uploads for compensation rather than linking a missing object',async()=>{
    const d=setup();d.storage.upload.mockRejectedValue(new Error('uncertain'))
    expect(await importFiscalFile(d.input,d)).toEqual({status:'CLEANUP_PENDING'})
    expect(d.repository.commitCompanion).not.toHaveBeenCalled()
  })
})
