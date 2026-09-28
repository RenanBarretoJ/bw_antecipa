import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/20260928120000_c2_1_r2_taxa_consultor_validacao_gestor.sql'), 'utf8')
const freeRateMigration = readFileSync(join(root, 'supabase/migrations/20260928183000_c2_1_r2_taxa_consultor_livre.sql'), 'utf8')
const keepFreeRateMigration = readFileSync(join(root, 'supabase/migrations/20260928193000_c2_1_r2_gestor_mantem_taxa_livre.sql'), 'utf8')
const action = readFileSync(join(root, 'src/lib/actions/operacao.ts'), 'utf8')
const consultorUi = readFileSync(join(root, 'src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx'), 'utf8')
const gestorUi = readFileSync(join(root, 'src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx'), 'utf8')

describe('C2.1-R2 - arquitetura da taxa proposta e final', () => {
  it('preserva proposta, ator, organizacao, instante e snapshot em campos imutaveis', () => {
    expect(migration).toContain('taxa_proposta_consultor numeric')
    expect(migration).toContain('taxa_proposta_por uuid')
    expect(migration).toContain('taxa_proposta_consultor_id uuid')
    expect(migration).toContain('taxa_proposta_em timestamptz')
    expect(migration).toContain('calculo_proposta_memoria jsonb')
    expect(migration).toContain('operacoes_proteger_proposta_taxa_consultor')
    expect(migration).toContain("TG_OP = 'INSERT'")
    expect(migration).toContain("CURRENT_USER = 'postgres'")
  })

  it('separa os contratos do Cedente e do Consultor e fecha o executor legado', () => {
    expect(migration).toContain('solicitar_operacao_antecipacao_cedente_atomica')
    expect(migration).toContain('solicitar_operacao_antecipacao_consultor_atomica')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.solicitar_operacao_antecipacao_atomica\([\s\S]+?FROM PUBLIC, anon, authenticated;/)
    expect(action).toContain("solicitante.perfil === 'consultor'")
    expect(action).toContain("supabase.rpc('solicitar_operacao_antecipacao_consultor_atomica'")
    expect(action).toContain("supabase.rpc('solicitar_operacao_antecipacao_cedente_atomica'")
  })

  it('recalcula proposta e decisao final com o motor canonico no backend', () => {
    expect(migration).toContain('private.calcular_memoria_financeira_nf')
    expect(migration).toContain('public.aprovar_operacao_atomica_financeiro_v1')
    expect(migration).toContain("'ROUND_HALF_UP_2_CASAS'")
  })

  it('mantem simulacao imediata nas duas telas sem formula paralela', () => {
    expect(consultorUi).toContain('calcularAntecipacaoEmLote')
    expect(consultorUi).toContain('Taxa proposta (% a.m.) *')
    expect(gestorUi).toContain('calcularAntecipacaoEmLote')
    expect(gestorUi).toContain('Taxa proposta pelo Consultor')
    expect(gestorUi).toContain('Taxa da operacao (% a.m.)')
  })

  it('permite proposta livre do Consultor sem exigir taxa pre-cadastrada', () => {
    expect(freeRateMigration).toContain('Taxa proposta invalida')
    expect(freeRateMigration).not.toContain('A taxa proposta nao esta configurada para o prazo da operacao')
    expect(action).not.toContain('A taxa proposta nao esta configurada para o prazo da operacao')
    expect(consultorUi).toContain('A proposta pode ser diferente.')
    expect(gestorUi).toContain('taxaMantemPropostaConsultor')
    expect(action).toContain('mantendoPropostaConsultor')
    expect(keepFreeRateMigration).toContain('op.taxa_proposta_consultor IS DISTINCT FROM p_taxa_desconto')
    expect(keepFreeRateMigration).toContain('A taxa selecionada nao esta configurada para o prazo da operacao')
  })

  it('audita proposta, manutencao e alteracao dentro das RPCs atomicas', () => {
    expect(migration).toContain("'TAXA_PROPOSTA_CONSULTOR'")
    expect(migration).toContain("'TAXA_MANTIDA_GESTOR'")
    expect(migration).toContain("'TAXA_ALTERADA_GESTOR'")
    expect(migration).toContain("'actor_user_id', v_actor_id")
    expect(migration).toContain("'consultor_id', v_consultor_id")
  })

  it('nao cria fluxo, status ou aceite de taxa pelo Cedente', () => {
    expect(migration).not.toMatch(/aguardando[_ ]aceite[_ ]taxa/i)
    expect(migration).not.toMatch(/contraproposta/i)
    expect(migration).not.toMatch(/notifica.{0,8}aceite.{0,8}taxa/i)
  })
})
