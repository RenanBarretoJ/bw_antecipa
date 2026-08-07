import { describe, expect, it } from 'vitest'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { NF_STATUSES, OPERACAO_STATUSES, isNfStatus, type NfStatus } from '@/lib/types/domain'
import {
  carregarNfsCandidatasCteSeAplicavel,
  NF_STATUS_CANCELADA_CTE,
  possuiRequisitoCteAntecipavel,
  statusNfPermiteCandidaturaCte,
} from './candidatas-cte.server'

type QueryCall = {
  table: string
  method: string
  column?: string
  value?: unknown
}

type CandidateRow = {
  id: string
  numero_nf: string
  chave_acesso: string | null
  status: NfStatus
  cedente_id: string
  cedente_fundo_id: string
  fundo_id: string
}

function criarClienteCapturado(input?: {
  rows?: CandidateRow[]
  candidateError?: { message: string } | null
  vinculo?: { id: string } | null
  vinculoError?: { message: string } | null
}) {
  const calls: QueryCall[] = []
  const rows = input?.rows ?? []

  const client = {
    from(table: string) {
      calls.push({ table, method: 'from' })
      const query = {
        select(value: string) {
          calls.push({ table, method: 'select', value })
          return query
        },
        eq(column: string, value: unknown) {
          calls.push({ table, method: 'eq', column, value })
          return query
        },
        neq(column: string, value: unknown) {
          calls.push({ table, method: 'neq', column, value })
          return query
        },
        order(column: string, value: unknown) {
          calls.push({ table, method: 'order', column, value })
          return query
        },
        maybeSingle() {
          calls.push({ table, method: 'maybeSingle' })
          return Promise.resolve({
            data: input?.vinculo === undefined ? { id: 'cf-1' } : input.vinculo,
            error: input?.vinculoError ?? null,
          })
        },
        limit(value: number) {
          calls.push({ table, method: 'limit', value })
          return Promise.resolve({
            data: rows,
            error: input?.candidateError ?? null,
          })
        },
      }
      return query
    },
  } as unknown as AppSupabaseClient

  return { client, calls }
}

const contexto = {
  notaFiscalId: 'nf-atual',
  cedenteId: 'cedente-1',
  cedenteFundoId: 'cf-1',
  fundoId: 'fundo-1',
}

const requisitoCte = {
  ativo: true,
  escopo: 'pos_cessao',
  tipo_documento_codigo: 'cte_xml',
  familia_documental: 'cte' as const,
}

describe('candidatas ao compartilhamento de CT-e', () => {
  it('usa somente o status canonico cancelada e nao aceita reprovada como nf_status', () => {
    expect(NF_STATUS_CANCELADA_CTE).toBe('cancelada')
    expect(isNfStatus('cancelada')).toBe(true)
    expect(isNfStatus('reprovada')).toBe(false)
    expect(isNfStatus('Reprovada')).toBe(false)
    expect(OPERACAO_STATUSES).toContain('reprovada')
  })

  it('reconhece CT-e antecipavel somente nos escopos logisticos ativos', () => {
    expect(possuiRequisitoCteAntecipavel([requisitoCte])).toBe(true)
    expect(possuiRequisitoCteAntecipavel([{ ...requisitoCte, ativo: false }])).toBe(false)
    expect(possuiRequisitoCteAntecipavel([{ ...requisitoCte, escopo: 'nf_pre_cessao' }])).toBe(false)
    expect(possuiRequisitoCteAntecipavel([{
      ...requisitoCte,
      tipo_documento_codigo: 'comprovante_entrega',
      familia_documental: 'comprovante_entrega',
    }])).toBe(false)
  })

  it('nao consulta o Supabase quando a politica nao possui CT-e antecipavel', async () => {
    const { client, calls } = criarClienteCapturado()

    const result = await carregarNfsCandidatasCteSeAplicavel({
      client,
      contexto,
      requisitos: [{
        ...requisitoCte,
        tipo_documento_codigo: 'comprovante_entrega',
        familia_documental: 'comprovante_entrega',
      }],
    })

    expect(result).toEqual({ aplicavel: false, candidatas: [], erro: null })
    expect(calls).toEqual([])
  })

  it('consulta contexto e NFs com filtros tipados sem enviar reprovada ao PostgREST', async () => {
    const { client, calls } = criarClienteCapturado({
      rows: [{
        id: 'nf-1',
        numero_nf: '13197',
        chave_acesso: null,
        status: 'rascunho',
        cedente_id: contexto.cedenteId,
        cedente_fundo_id: contexto.cedenteFundoId,
        fundo_id: contexto.fundoId,
      }],
    })

    const result = await carregarNfsCandidatasCteSeAplicavel({ client, contexto, requisitos: [requisitoCte] })

    expect(result.candidatas).toHaveLength(1)
    expect(calls.some((call) => call.table === 'cedente_fundos')).toBe(true)
    expect(calls.some((call) => call.table === 'notas_fiscais')).toBe(true)
    expect(calls).toContainEqual({ table: 'notas_fiscais', method: 'neq', column: 'status', value: 'cancelada' })
    expect(calls.some((call) => call.value === 'reprovada')).toBe(false)
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'notas_fiscais', method: 'eq', column: 'cedente_fundo_id', value: contexto.cedenteFundoId },
      { table: 'notas_fiscais', method: 'eq', column: 'cedente_id', value: contexto.cedenteId },
      { table: 'notas_fiscais', method: 'eq', column: 'fundo_id', value: contexto.fundoId },
    ]))
  })

  it('aceita toda a matriz real do enum sem propagar cancelada como candidata', async () => {
    const { client } = criarClienteCapturado({
      rows: NF_STATUSES.map((status, index) => ({
        id: `nf-${index}`,
        numero_nf: String(index + 1),
        chave_acesso: null,
        status,
        cedente_id: contexto.cedenteId,
        cedente_fundo_id: contexto.cedenteFundoId,
        fundo_id: contexto.fundoId,
      })),
    })

    const result = await carregarNfsCandidatasCteSeAplicavel({ client, contexto, requisitos: [requisitoCte] })

    expect(result.erro).toBeNull()
    expect(result.candidatas.map((item) => item.status)).toEqual(NF_STATUSES.filter(statusNfPermiteCandidaturaCte))
    expect(result.candidatas.some((item) => item.status === 'cancelada')).toBe(false)
  })

  it('preserva o checklist quando somente a consulta acessoria de candidatas falha', async () => {
    const { client } = criarClienteCapturado({ candidateError: { message: 'falha temporaria' } })

    const result = await carregarNfsCandidatasCteSeAplicavel({ client, contexto, requisitos: [requisitoCte] })

    expect(result.aplicavel).toBe(true)
    expect(result.candidatas).toEqual([])
    expect(result.erro).toMatch(/Nao foi possivel carregar outras NFs/)
  })

  it('mantem falha fechada quando o vinculo ativo nao existe', async () => {
    const { client } = criarClienteCapturado({ vinculo: null })

    await expect(carregarNfsCandidatasCteSeAplicavel({
      client,
      contexto,
      requisitos: [requisitoCte],
    })).rejects.toThrow(/vinculo entre cedente e fundo nao esta ativo/)
  })
})
