import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260922214000_c2_consultor_criacao_operacao_cedente.sql',
  'utf8',
)
const action = readFileSync('src/lib/actions/operacao.ts', 'utf8')
const exposureAction = readFileSync('src/lib/actions/exposicao.ts', 'utf8')
const loader = readFileSync('src/lib/operacoes/nova-solicitacao.server.ts', 'utf8')
const requester = readFileSync('src/lib/operacoes/solicitante.server.ts', 'utf8')
const selector = readFileSync('src/components/operacoes/ConsultorCedenteSelector.tsx', 'utf8')
const consultantPage = readFileSync('src/app/consultor/operacoes/nova/page.tsx', 'utf8')
const cedentePage = readFileSync('src/app/cedente/operacoes/nova/page.tsx', 'utf8')

describe('C2 - Consultor cria operacao por Cedente', () => {
  it('mantem um unico loader e um unico editor para Cedente e Consultor', () => {
    expect(consultantPage).toContain("from '@/app/cedente/operacoes/nova/nova-solicitacao-client'")
    expect(consultantPage).toContain('carregarNovaSolicitacaoOperacao')
    expect(consultantPage).toContain('key={resultado.cedente.id}')
    expect(cedentePage).toContain('carregarNovaSolicitacaoOperacao')
    expect(loader).toContain('resolverCedenteSolicitanteOperacao')
  })

  it('revalida o vinculo ativo no loader, na simulacao e na criacao', () => {
    expect(requester).toContain(".eq('consultor_id', auth.user.id)")
    expect(requester).toContain(".eq('cedente_id', cedenteIdInformado)")
    expect(requester).toContain(".eq('status', 'ativo')")
    expect(requester).toContain("cedente.status !== 'ativo'")
    expect(action).toContain('resolverCedenteSolicitanteOperacao(auth, cedenteId)')
    expect(exposureAction).toContain('resolverCedenteSolicitanteOperacao(auth, parsed.data.cedenteId)')
  })

  it('faz busca remota com debounce, limite e contrato acessivel', () => {
    expect(selector).toContain('}, 300)')
    expect(selector).toContain('role="combobox"')
    expect(selector).toContain('role="listbox"')
    expect(selector).toContain('label htmlFor={triggerId}')
    expect(selector).toContain('Cedente <span aria-hidden="true">*</span>')
    expect(selector).toContain('aria-activedescendant')
    expect(migration).toContain('least(coalesce(p_limite, 10), 10)')
    expect(migration).toContain('extensions.unaccent')
    expect(migration).toContain("pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g')")
  })

  it('bloqueia manipulacao cross-tenant e mantem o ator real na RPC atomica', () => {
    expect(migration).toContain("actor_role NOT IN ('cedente', 'consultor')")
    expect(migration).toContain('cc.consultor_id = actor_id')
    expect(migration).toContain('cc.cedente_id = p_cedente_id')
    expect(migration).toContain("cc.status = 'ativo'")
    expect(migration).toContain('taxas_cedente_consultor_select')
    expect(migration).toContain('nf.cedente_id = p_cedente_id')
    expect(migration).toContain('nf.cedente_fundo_id = p_cedente_fundo_id')
    expect(migration).toContain("nf.status = 'aprovada'")
    expect(migration).toContain("VALUES (actor_id, 'OPERACAO_SOLICITADA'")
    expect(migration).toContain("'solicitado_por_role', actor_role")
    expect(migration).not.toContain('service_role')
  })

  it('roda depois do P14 e preserva o reuso de NF de operacao reprovada', () => {
    expect(Number('20260922214000')).toBeGreaterThan(Number('20260922182301'))
    expect(migration).toContain('JOIN public.operacoes op ON op.id = onf.operacao_id')
    expect(migration).toContain('private.operacao_status_reserva_nf(op.status)')
    expect(migration).toContain("ERRCODE = 'P1401'")
    expect(migration).toContain("MESSAGE = 'NF_ALREADY_LINKED_TO_ACTIVE_OPERATION'")
    expect(migration).not.toContain('Uma ou mais NFs ja estao vinculadas a uma operacao')
  })

  it('nao amplia EXECUTE para anon e preserva a revogacao explicita', () => {
    expect(migration).toContain('FROM PUBLIC, anon')
    expect(migration).toContain('TO authenticated')
    const grants = migration.match(/GRANT EXECUTE[\s\S]*?;/giu) || []
    expect(grants.every((grant) => !/\bTO\s+anon\b/iu.test(grant))).toBe(true)
  })
})
