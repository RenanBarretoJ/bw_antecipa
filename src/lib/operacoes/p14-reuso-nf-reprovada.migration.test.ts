import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260922182301_p14_liberar_nf_de_operacao_reprovada.sql',
), 'utf8')

const helper = migration.match(
  /CREATE OR REPLACE FUNCTION private\.operacao_status_reserva_nf[\s\S]*?COMMENT ON FUNCTION private\.operacao_status_reserva_nf/,
)?.[0] || ''

const overloads = migration
  .split('CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica')
  .slice(1)

describe('P14 - reuso de NF apos operacao reprovada', () => {
  it('centraliza exatamente os status reservantes e preserva cancelada', () => {
    for (const status of [
      'solicitada',
      'em_analise',
      'aprovada',
      'em_andamento',
      'liquidada',
      'inadimplente',
      'cancelada',
    ]) {
      expect(helper).toContain(`'${status}'::public.operacao_status`)
    }
    expect(helper).not.toContain("'reprovada'::public.operacao_status")
    expect(helper).toContain('IMMUTABLE')
    expect(helper).not.toContain('SECURITY DEFINER')
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.operacao_status_reserva_nf(public.operacao_status)',
    )
  })

  it('atualiza as duas sobrecargas com o mesmo predicate e erro de dominio', () => {
    expect(overloads).toHaveLength(2)

    for (const overload of overloads) {
      expect(overload).toContain('JOIN public.operacoes op ON op.id = onf.operacao_id')
      expect(overload).toContain('private.operacao_status_reserva_nf(op.status)')
      expect(overload).toContain("ERRCODE = 'P1401'")
      expect(overload).toContain("MESSAGE = 'NF_ALREADY_LINKED_TO_ACTIVE_OPERATION'")
      expect(overload.indexOf('FOR UPDATE')).toBeGreaterThanOrEqual(0)
      expect(overload.indexOf('FOR UPDATE')).toBeLessThan(
        overload.indexOf('private.operacao_status_reserva_nf(op.status)'),
      )
    }
  })

  it('preserva historico, transacao e grants sem reintroduzir o bloqueio antigo', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
    expect(migration).not.toContain('DELETE FROM public.operacoes_nfs')
    expect(migration).not.toContain('Uma ou mais NFs ja estao vinculadas a uma operacao')
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2)
    expect(migration.match(/SET search_path = public/g)).toHaveLength(2)
    expect(migration.match(/TO authenticated;/g)).toHaveLength(2)
  })
})
