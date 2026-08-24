import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const card = readFileSync('src/components/operacoes/ExposicaoLogisticaCard.tsx', 'utf8')
const operationServer = readFileSync('src/components/operacoes/ExposicaoLogisticaOperacaoServer.tsx', 'utf8')
const gestorPage = readFileSync('src/app/gestor/operacoes/[id]/page.tsx', 'utf8')
const cedenteOperationPage = readFileSync('src/app/cedente/operacoes/[id]/page.tsx', 'utf8')
const cedenteDashboard = readFileSync('src/app/cedente/dashboard/page.tsx', 'utf8')
const dashboardLoader = readFileSync('src/lib/analytics/loaders.server.ts', 'utf8')

describe('integração da visão operacional de exposição', () => {
  it('usa o mesmo componente e a mesma avaliação canônica na operação do gestor e do cedente', () => {
    expect(gestorPage).toContain('ExposicaoLogisticaOperacaoServer')
    expect(cedenteOperationPage).toContain('ExposicaoLogisticaOperacaoServer')
    expect(operationServer).toContain('carregarVisaoExposicaoOperacaoCanonica')
    expect(operationServer).toContain('return visao ? <ExposicaoLogisticaCard')
  })

  it('não reserva espaço quando o snapshot não habilita o controle', () => {
    expect(operationServer).toContain('return visao ? <ExposicaoLogisticaCard')
    expect(card).not.toContain('Não aplicável')
  })

  it('resolve dashboard pelo vínculo e fundo ativos sem agregar fundos', () => {
    expect(dashboardLoader).toContain('resolverCedenteFundoAtivo')
    expect(dashboardLoader).toContain('fundoId: contexto.fundo.id')
    expect(dashboardLoader).toContain('politicaVersao: politica.versao')
    expect(cedenteDashboard).toContain('stats.exposicaoLogistica &&')
  })

  it('expõe somente textos operacionais e não códigos técnicos', () => {
    expect(card).toContain('Margem disponível')
    expect(card).toContain('Impacto desta operação na exposição')
    expect(card).not.toContain('AVALIACAO_RISCO_INDISPONIVEL')
  })
})
