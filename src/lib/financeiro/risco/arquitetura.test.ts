import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260814230000_p2_6_gate_risco_decisao_operacional.sql'), 'utf8').toLowerCase()
const processor = readFileSync(join(process.cwd(), 'src/lib/financeiro/risco/processor.server.ts'), 'utf8')
const types = readFileSync(join(process.cwd(), 'src/lib/financeiro/risco/types.ts'), 'utf8')
const approval = readFileSync(join(process.cwd(), 'src/lib/actions/operacao.ts'), 'utf8')
const policy = readFileSync(join(process.cwd(), 'src/lib/actions/politica.ts'), 'utf8')
const loader = readFileSync(join(process.cwd(), 'src/lib/financeiro/conciliacao/loaders.server.ts'), 'utf8')
const central = readFileSync(join(process.cwd(), 'src/app/gestor/conciliacao/conciliacao-financeira-client.tsx'), 'utf8')
const candidateSimulationMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20260820170000_simular_memoria_financeira_operacao_parcelas.sql'), 'utf8')
const exposicaoProcessor = readFileSync(join(process.cwd(), 'src/lib/financeiro/exposicao/processor.server.ts'), 'utf8')

describe('arquitetura P2.6', () => {
  it('mantem o dominio generico e versiona a regra', () => {
    expect(migration).toContain("regra_versao text not null default 'gate_risco_v1'")
    expect(migration).not.toContain('rlx_risco')
    expect(types).toContain("RISK_GATE_RULE_VERSION = 'GATE_RISCO_V1'")
    expect(processor).toContain('RISK_GATE_RULE_VERSION')
  })

  it('restringe persistencia ao service role e leitura ao fundo autorizado', () => {
    expect(migration).toContain("if not private.financeiro_chamada_service_role()")
    expect(migration).toContain('grant execute on function public.persistir_risco_execucao(jsonb) to service_role')
    expect(migration).toContain('private.financeiro_gestor_tem_acesso_fundo(fundo_id)')
    expect(migration).not.toContain('for insert to authenticated')
  })

  it('preserva snapshots e bloqueia mutacoes historicas', () => {
    expect(migration).toContain('risco_execucoes_imutaveis')
    expect(migration).toContain('risco_motivos_imutaveis')
    expect(migration).toContain('operacao_updated_at_snapshot')
    expect(migration).toContain('assinatura_inputs')
  })

  it('nao permite bypass da aprovacao e protege contra TOCTOU', () => {
    expect(approval).toContain("executarGateRisco({")
    expect(approval).toContain("rpc('aprovar_operacao_com_risco_atomica'")
    expect(approval).not.toContain("rpc('aprovar_operacao_atomica'")
    expect(migration).toContain("pg_advisory_xact_lock(pg_catalog.hashtextextended('aprovar-risco:'")
    expect(migration).toContain('for update of o')
    expect(migration).toContain('a avaliacao de risco expirou porque a operacao foi alterada')
  })

  it('exige revisao fundamentada, TOTP fresco e proibe override de bloqueio', () => {
    expect(migration).toContain("p_decisao not in ('liberada','recusada')")
    expect(migration).toContain("private.financeiro_autorizacao_consumida('revisar_risco_operacao')")
    expect(migration).toContain('super admin puro nao pode decidir risco operacional')
    expect(migration).toContain("if v_risco.aplicavel and v_risco.decisao='bloqueado'")
    expect(migration).not.toContain("v_risco.decisao='bloqueado' and v_revisao.status='liberada'")
  })

  it('congela configuracao do gate na politica versionada', () => {
    expect(policy).toContain('gate_risco_ativo')
    expect(policy).toContain("tratamento_indeterminada: 'REVISAO_MANUAL'")
    expect(migration).toContain('new.gate_risco_ativo is distinct from old.gate_risco_ativo')
  })

  it('falha fechada por timeout e mede a cadeia canonica inteira', () => {
    expect(processor).toContain('RISK_GATE_TIMEOUT_MS')
    expect(processor).toContain('withRiskGateTimeout')
    expect(processor).toContain('matchingMs')
    expect(processor).toContain('reconciliationMs')
    expect(processor).toContain('logisticsMs')
    expect(processor).toContain('exposureMs')
    expect(processor).toContain('candidateSimulationMs')
  })

  it('oferece filtros operacionais e detalhe do snapshot na Central de Risco', () => {
    expect(loader).toContain('riskReason')
    expect(loader).toContain('riskOperation')
    expect(loader).toContain('riskPolicy')
    expect(loader).toContain('riskCreatedFrom')
    expect(loader).toContain('riskCreatedTo')
    expect(central).toContain('Aplicar filtros de risco')
    expect(central).toContain('Snapshot historico da avaliacao')
    expect(central).toContain('Operacoes bloqueadas')
  })

  it('nao esconde revisao historica ao filtrar a Central por operacao', () => {
    expect(loader).toContain("filters.riskOperation ? '' : dates[0]")
    expect(loader).toContain("^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
    expect(loader).not.toContain("[1-5][0-9a-f]{3}-[89ab]")
  })
})

// P0 (auditoria obrigatoria de regressao causada por parcelas): P2.6
// (20260814230000) e ANTERIOR as migrations de parcelas de NF (Fase 1/2,
// 20260819210000..20260820120000) e nunca foi revisitado -- o candidato de
// risco (simular_memoria_financeira_operacao, usado por candidateProjection
// ANTES da aprovacao) ainda assumia "1 NF = 1 item", usando o valor_bruto/
// vencimento AGREGADO da NF inteira mesmo quando so parte das parcelas foi
// cedida a operacao. Confirmado ao vivo (nao e a causa do bloqueio
// AVALIACAO_RISCO_INDISPONIVEL desta operacao especifica -- essa causa e
// ausencia de base financeira publicada, P23_MATCHING_ERROR/dado ausente),
// mas e uma incompatibilidade real, exigida pelo escopo do ticket.
describe('P0 (correção real): candidato de risco (P2.6) e exposição (P2.5) com parcelas', () => {
  it('simular_memoria_financeira_operacao usa o valor_nominal/data_vencimento de cada parcela cedida, não o agregado da NF, quando a NF tem parcelas nesta operação', () => {
    expect(candidateSimulationMigration).toContain('FROM public.operacoes_nf_parcelas onp')
    expect(candidateSimulationMigration).toContain('JOIN public.nota_fiscal_parcelas p ON p.id=onp.parcela_id')
    const indiceLoopParcela = candidateSimulationMigration.indexOf('FOR v_parcela IN')
    const indiceCalculoParcela = candidateSimulationMigration.indexOf("private.calcular_memoria_financeira_nf(v_nf.id,v_parcela.valor_nominal,p_taxa_desconto,v_data_base,v_parcela.data_vencimento,v_metodo)")
    expect(indiceLoopParcela).toBeGreaterThan(-1)
    expect(indiceCalculoParcela).toBeGreaterThan(indiceLoopParcela)
  })

  it('simular_memoria_financeira_operacao preserva o comportamento legado (valor/vencimento agregado) para NF sem parcelas cedidas', () => {
    expect(candidateSimulationMigration).toContain("private.calcular_memoria_financeira_nf(v_nf.id,v_nf.valor_bruto,p_taxa_desconto,v_data_base,v_nf.data_vencimento,v_metodo)")
    expect(candidateSimulationMigration).toContain('v_tem_parcelas')
  })

  it('exposição (resolveOverlay/simularExposicaoOperacao) SOMA valor_presente por NF quando há múltiplas linhas em operacao_calculo_nfs (uma por parcela), não descarta todas menos a última', () => {
    const indiceOverlay = exposicaoProcessor.indexOf('async function resolveOverlay')
    const indiceFimOverlay = exposicaoProcessor.indexOf('return (linksResult.data', indiceOverlay)
    const corpoOverlay = exposicaoProcessor.slice(indiceOverlay, indiceFimOverlay)
    expect(corpoOverlay).not.toContain("new Map((calculationResult.data || []).map((row) => [`${row.operacao_id}:${row.nota_fiscal_id}`, row.valor_presente]))")
    expect(corpoOverlay).toContain('soma')

    const indiceSimulacao = exposicaoProcessor.indexOf('export async function simularExposicaoOperacao')
    const indiceFimSimulacao = exposicaoProcessor.indexOf('let additionalTransit', indiceSimulacao)
    const corpoSimulacao = exposicaoProcessor.slice(indiceSimulacao, indiceFimSimulacao)
    expect(corpoSimulacao).not.toContain('new Map((calculations.data || []).map((row) => [row.nota_fiscal_id, row.valor_presente]))')
    expect(corpoSimulacao).toContain('soma')
  })
})
