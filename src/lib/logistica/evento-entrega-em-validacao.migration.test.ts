import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DELIVERY_EVENT_TYPES, DELIVERY_STATUSES } from '@/lib/types/domain'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260807132532_corrigir_evento_entrega_em_validacao.sql'),
  'utf8',
).toLowerCase()

const functionMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql'),
  'utf8',
).toLowerCase()

const previousEvents = [
  'cessao_efetivada',
  'cte_pendente',
  'cte_enviado',
  'cte_aprovado',
  'cte_rejeitado',
  'cte_atrasado',
  'canhoto_pendente',
  'canhoto_enviado',
  'canhoto_aprovado',
  'canhoto_rejeitado',
  'canhoto_atrasado',
  'canhoto_postergacao_comunicada',
  'documento_entrega_enviado',
  'entrega_confirmada',
  'entrega_com_pendencia',
  'devolucao_registrada',
] as const

describe('contrato do evento de entrega em validacao', () => {
  it('aceita no CHECK o evento que avaliar_conclusao_entrega emite', () => {
    expect(functionMigration).toContain("'entrega_em_validacao'")
    expect(migration).toContain("'entrega_em_validacao'")
    expect(DELIVERY_EVENT_TYPES).toContain('entrega_em_validacao')
  })

  it('preserva todos os eventos anteriormente aceitos', () => {
    for (const event of previousEvents) {
      expect(migration).toContain(`'${event}'`)
      expect(DELIVERY_EVENT_TYPES).toContain(event)
    }
  })

  it('e incremental e reaplicavel sem alterar dados ou funcoes', () => {
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
    expect(migration).toContain('drop constraint if exists eventos_entrega_tipo_check')
    expect(migration).toContain('add constraint eventos_entrega_tipo_check')
    expect(migration).not.toMatch(/\b(?:insert|update|delete|truncate)\b/)
    expect(migration).not.toContain('create or replace function')
  })

  it('nao amplia nem altera o catalogo de estados fisicos da entrega', () => {
    expect(DELIVERY_STATUSES).toEqual([
      'nao_aplicavel',
      'em_transito',
      'aguardando_validacao',
      'entregue',
      'entrega_com_pendencia',
      'devolvida',
      'cancelada',
    ])
    expect(migration).not.toContain('status_entrega')
  })
})
