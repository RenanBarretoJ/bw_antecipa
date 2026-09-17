import { describe, expect, it } from 'vitest'
import { classificarIntentParaCleanup } from './p9-3-intent-decision.mjs'

const now = Date.parse('2026-09-16T12:00:00Z')
const id = '33333333-3333-4333-8333-333333333333'
const base = {
  id, cnpj: '00123456000190', tipo_documento: 'contrato_social', representante_id: null,
  storage_bucket: 'documentos-cedentes',
  storage_path: `00123456000190/contrato_social/${id}_qa.pdf`,
  status: 'FAILED', referenced: false, documento_versao_id: null,
  object_present: true, usuario_id: '55555555-5555-4555-8555-555555555555',
  storage_owner_id: '55555555-5555-4555-8555-555555555555',
  cleanup_after: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 120_000).toISOString(),
  attempt_count: 0,
}

describe('P9.3 fail-closed cleanup decision', () => {
  it('aceita somente um intent proprio e vencido', () => {
    expect(classificarIntentParaCleanup(base, now)).toBe('ELIGIBLE')
  })
  it('nao remove outro path, bucket ou representante', () => {
    expect(classificarIntentParaCleanup({ ...base, storage_path: `00123456000190/../${id}_qa.pdf` }, now)).toBe('UNKNOWN')
    expect(classificarIntentParaCleanup({ ...base, storage_path: `00999999000100/contrato_social/${id}_qa.pdf` }, now)).toBe('UNKNOWN')
    expect(classificarIntentParaCleanup({ ...base, storage_bucket: 'outro' }, now)).toBe('UNKNOWN')
    expect(classificarIntentParaCleanup({ ...base, representante_id: '44444444-4444-4444-8444-444444444444' }, now)).toBe('UNKNOWN')
  })
  it('protege versao canônica e janela da URL assinada', () => {
    expect(classificarIntentParaCleanup({ ...base, status: 'FINALIZED', referenced: true }, now)).toBe('REFERENCED')
    expect(classificarIntentParaCleanup({ ...base, status: 'FAILED', referenced: true }, now)).toBe('UNKNOWN')
    expect(classificarIntentParaCleanup({ ...base, cleanup_after: new Date(now + 60_000).toISOString() }, now)).toBe('PENDING_GRACE_PERIOD')
  })
  it('limita tentativas e aplica backoff', () => {
    expect(classificarIntentParaCleanup({ ...base, attempt_count: 3 }, now)).toBe('RETRY_EXHAUSTED')
    expect(classificarIntentParaCleanup({ ...base, status: 'CLEANUP_PENDING', attempt_count: 1, updated_at: new Date(now).toISOString() }, now)).toBe('RETRY_BACKOFF')
  })
  it('bloqueia objeto de outro usuario ou sem owner conhecido', () => {
    expect(classificarIntentParaCleanup({ ...base, storage_owner_id: '66666666-6666-4666-8666-666666666666' }, now)).toBe('UNKNOWN')
    expect(classificarIntentParaCleanup({ ...base, storage_owner_id: null }, now)).toBe('UNKNOWN')
  })
  it('nao classifica intent sem objeto como orfao para exclusao', () => {
    expect(classificarIntentParaCleanup({ ...base, object_present: false, storage_owner_id: null }, now)).toBe('NO_OBJECT')
  })
  it('mantem intent ja limpo inelegivel para nova exclusao', () => {
    expect(classificarIntentParaCleanup({ ...base, status: 'CLEANED', object_present: false, storage_owner_id: null }, now)).toBe('CLEANED')
  })
})
