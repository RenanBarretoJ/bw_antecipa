import { describe, expect, it } from 'vitest'
import { compactHistorySummary, shouldShowPrazoBlock } from './ChecklistCedente'

describe('ChecklistCedente compact helpers', () => {
  it('nao mostra prazo quando o marco ainda nao foi iniciado', () => {
    expect(shouldShowPrazoBlock({
      dataLimite: '2026-08-02',
      marcoPrazo: 'desembolso',
      prazoDetalhe: 'Não iniciado',
      statusPrazo: 'nao_iniciado' as never,
    })).toBe(false)
  })

  it('nao mostra prazo sem data limite', () => {
    expect(shouldShowPrazoBlock({
      dataLimite: null,
      marcoPrazo: 'desembolso',
      prazoDetalhe: 'Restam 3 dias',
      statusPrazo: 'em_dia' as never,
    })).toBe(false)
  })

  it('mostra prazo vencido quando existe data limite e marco iniciado', () => {
    expect(shouldShowPrazoBlock({
      dataLimite: '2026-08-02',
      marcoPrazo: 'desembolso',
      prazoDetalhe: '2 dias em atraso',
      statusPrazo: 'vencido' as never,
    })).toBe(true)
  })

  it('resume historico de versao unica em uma linha', () => {
    expect(compactHistorySummary({
      versoes: [{
        id: 'versao-1',
        numero: 1,
        nome: 'arquivo.pdf',
        status: 'aprovado',
        enviadoEm: '2026-07-24T10:30:00',
        enviadoPorId: 'usuario-1',
        enviadoPorNome: 'Breno',
        sha256: 'hash',
        ultimaAnalise: null,
      }],
    } as never)).toContain('v1 · arquivo.pdf · enviado em 24/07/2026, 10:30')
  })

  it('resume historico multiplo pela quantidade de versoes', () => {
    const versao = {
      id: 'versao',
      numero: 1,
      nome: 'arquivo.pdf',
      status: 'enviado',
      enviadoEm: '2026-07-24T10:30:00',
      enviadoPorId: 'usuario-1',
      enviadoPorNome: 'Breno',
      sha256: 'hash',
      ultimaAnalise: null,
    }

    expect(compactHistorySummary({
      versoes: [
        { ...versao, id: 'v3', numero: 3 },
        { ...versao, id: 'v2', numero: 2 },
        { ...versao, id: 'v1', numero: 1 },
      ],
    } as never)).toBe('3 versões · Ver histórico')
  })
})
