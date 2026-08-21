import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const processor = readFileSync(join(root, 'src/lib/financeiro/risco/processor.server.ts'), 'utf8')
const types = readFileSync(join(root, 'src/lib/financeiro/risco/types.ts'), 'utf8')

// P0 (correcao real): a assinatura de idempotencia do gate de risco
// (assinatura_inputs, unique por fundo+operacao+regra_versao) so incluia
// exposure/candidate/classification -- todos os TRES ficavam nulos/fixos
// sempre que QUALQUER estagio lancava um erro tecnico (matching, P2.4,
// exposicao OU a simulacao do candidato, via um unico Promise.all que
// descartava o resultado real do lado que NAO falhou). Confirmado ao vivo
// em homologacao: dois erros tecnicos DIFERENTES (causados por Carteira/PL,
// ESTOQUE ou estado bootstrap diferentes) colidiam na MESMA assinatura e
// reutilizavam uma risco_execucao antiga e desatualizada -- exatamente o
// "technical_error stale" relatado no ticket. Corrigido incluindo o estado
// bootstrap e um fingerprint independente das bases financeiras (sempre
// resolvidos ANTES do try/catch de decisao) na assinatura, e decompondo o
// Promise.all em Promise.allSettled para que uma falha isolada no
// candidato nao descarte o resultado real do pipeline financeiro (e
// vice-versa).
describe('P0 (correcao real): idempotencia do gate de risco nao pode mascarar mudanca de inputs materiais', () => {
  it('bootstrapState e financialFingerprint sao resolvidos ANTES do try/catch de decisao, dentro do bloco policy.active', () => {
    const inicioPolicy = processor.indexOf('if (policy.active) {')
    expect(inicioPolicy).toBeGreaterThan(-1)
    const inicioTry = processor.indexOf('try {', inicioPolicy)
    const inicioAllSettled = processor.indexOf('Promise.allSettled', inicioTry)
    const corpoAntesDoAllSettled = processor.slice(inicioTry, inicioAllSettled)
    expect(corpoAntesDoAllSettled).toContain('bootstrapState = await resolverBootstrapFinanceiro(client, input.fundoId)')
    expect(corpoAntesDoAllSettled).toContain('financialFingerprint = await resolverFingerprintFinanceiro(client')
  })

  it('Promise.allSettled decompoe o pipeline financeiro do candidato -- uma falha isolada em um lado preserva o resultado real do outro', () => {
    expect(processor).toContain('await withRiskGateTimeout(Promise.allSettled([')
    expect(processor).not.toContain('await withRiskGateTimeout(Promise.all([')
    expect(processor).toContain("if (candidateResult.status === 'fulfilled') candidate = candidateResult.value")
    expect(processor).toContain("if (refreshedResult.status === 'fulfilled') {")
  })

  it('a assinatura de risco (criarAssinaturaRisco) inclui bootstrap e financialFingerprint, alem dos campos pre-existentes', () => {
    const indice = processor.indexOf('const signature = criarAssinaturaRisco({')
    const corpo = processor.slice(indice, processor.indexOf('})', indice))
    expect(corpo).toContain('bootstrap: bootstrapState')
    expect(corpo).toContain('financialFingerprint,')
    expect(corpo).toContain('exposure: exposure?.id')
    expect(corpo).toContain('candidate,')
  })

  it('resolverFingerprintFinanceiro observa ESTOQUE/AQUISICOES/LIQUIDACOES/Carteira D-2 diretamente, independente de o pipeline ter sucesso', () => {
    const indice = processor.indexOf('async function resolverFingerprintFinanceiro')
    const corpo = processor.slice(indice, processor.indexOf('\n}', indice))
    expect(corpo).toContain("base('ESTOQUE', input.dates.ESTOQUE)")
    expect(corpo).toContain("base('AQUISICOES', input.dates.ESTOQUE)")
    expect(corpo).toContain("base('LIQUIDACOES', input.dates.ESTOQUE)")
    expect(corpo).toContain("base('CARTEIRA', input.dates.CARTEIRA)")
  })

  it('detalhes persistidos agora expoem bootstrap e financial_fingerprint para auditoria (aditivo, nao altera a decisao)', () => {
    expect(processor).toContain('bootstrap: bootstrapState, financial_fingerprint: financialFingerprint')
  })

  it('RiskCandidateProjection carrega os itens (parcela-aware) usados na simulacao, para que mudanca de parcelas selecionadas altere a assinatura', () => {
    expect(types).toContain('items: Array<{ notaFiscalId: string | null; parcelaId: string | null; valorAquisicao: string | null }>')
    expect(processor).toContain('parcelaId: text(item.parcela_id)')
  })
})
