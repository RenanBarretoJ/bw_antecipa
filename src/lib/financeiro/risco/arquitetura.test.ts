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
