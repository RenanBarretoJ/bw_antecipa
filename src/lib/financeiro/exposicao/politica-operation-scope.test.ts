import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const exposicaoProcessor = readFileSync(join(root, 'src/lib/financeiro/exposicao/processor.server.ts'), 'utf8')
const riscoProcessor = readFileSync(join(root, 'src/lib/financeiro/risco/processor.server.ts'), 'utf8')
const conciliacaoAction = readFileSync(join(root, 'src/lib/actions/conciliacao.ts'), 'utf8')

// P0 (correcao real): para avaliacao operation-scoped, executarGateRisco ja
// usava o snapshot de politica CONGELADO na propria operacao
// (operacoes.politica_operacional_versao_id) -- mas executarExposicaoFinanceira
// resolvia sua PROPRIA politica exigindo politicas_operacionais.padrao=true,
// ignorando por completo o snapshot da operacao. Confirmado ao vivo na
// operacao real d6afe2f3-dd0a-447a-b393-83f155c3f76b: a politica que
// realmente governa essa operacao (congelada nela mesma, com
// gate_risco_ativo=true) tem padrao=false -- exposicao caia em
// NAO_APLICAVEL indevidamente, mascarando a classificacao real (P2.6 usava
// a politica certa, P2.5 usava outra). Corrigido para exposicao aceitar um
// politicaOperacionalVersaoId explicito e, quando presente, buscar
// exatamente essa versao por id -- nunca a resolucao padrao=true. Escopo
// fundo/Central de Risco (sem operacaoId) permanece inalterado: nenhum id
// e passado, a resolucao padrao=true de sempre continua rodando.
describe('P0 (correcao real): P2.5 e P2.6 usam a MESMA politica em escopo operacao', () => {
  it('resolvePolicy (exposicao) aceita politicaOperacionalVersaoId e busca exatamente essa versao por id, sem exigir padrao=true nem filtrar por vigencia', () => {
    const inicio = exposicaoProcessor.indexOf('async function resolvePolicy(')
    const corpo = exposicaoProcessor.slice(inicio, exposicaoProcessor.indexOf('\n}', inicio))
    expect(corpo).toContain('if (politicaOperacionalVersaoId) {')
    expect(corpo).toContain(".eq('id', politicaOperacionalVersaoId).eq('fundo_id', fundoId).maybeSingle()")
    // A busca por id explicito nao deve reaparecer condicionada a padrao/vigencia.
    const trechoOperacao = corpo.slice(corpo.indexOf('if (politicaOperacionalVersaoId)'), corpo.indexOf("// Escopo fundo"))
    expect(trechoOperacao).not.toContain("eq('padrao', true)")
    expect(trechoOperacao).not.toContain(".lte('vigente_desde'")
  })

  it('escopo fundo/Central de Risco permanece inalterado: resolucao padrao=true de sempre, sem id explicito', () => {
    const inicio = exposicaoProcessor.indexOf('// Escopo fundo / Central de Risco')
    const corpo = exposicaoProcessor.slice(inicio, exposicaoProcessor.indexOf('\n}', inicio))
    expect(corpo).toContain("eq('padrao', true).eq('status', 'ativa')")
  })

  it('executarGateRisco so passa politicaOperacionalVersaoId para exposicao quando ha operacaoId -- fundo-level nunca troca a resolucao independente de exposicao', () => {
    const indice = riscoProcessor.indexOf('politicaOperacionalVersaoId: operationId ? resolved.version?.id || null : null')
    expect(indice).toBeGreaterThan(-1)
  })

  it('executarExposicaoAction (Central de Conciliacao, sempre fundo-level) nao passa politicaOperacionalVersaoId -- comportamento fundo-level intocado', () => {
    const indice = conciliacaoAction.indexOf('export async function executarExposicaoAction')
    const corpo = conciliacaoAction.slice(indice, conciliacaoAction.indexOf('\n}', indice + 200))
    expect(corpo).not.toContain('politicaOperacionalVersaoId')
  })
})
