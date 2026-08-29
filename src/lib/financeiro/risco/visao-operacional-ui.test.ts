import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const card = readFileSync('src/components/operacoes/ExposicaoLogisticaCard.tsx', 'utf8')
const operationServer = readFileSync('src/components/operacoes/ExposicaoLogisticaOperacaoServer.tsx', 'utf8')
const operationLoader = readFileSync('src/lib/financeiro/risco/visao-operacional.server.ts', 'utf8')
const gestorPage = readFileSync('src/app/gestor/operacoes/[id]/page.tsx', 'utf8')
const cedenteOperationPage = readFileSync('src/app/cedente/operacoes/[id]/page.tsx', 'utf8')
const cedenteDashboard = readFileSync('src/app/cedente/dashboard/page.tsx', 'utf8')
const dashboardLoader = readFileSync('src/lib/analytics/loaders.server.ts', 'utf8')
const operationsList = readFileSync('src/components/operacoes/OperacoesPaginadas.tsx', 'utf8')
const operationsLoader = readFileSync('src/lib/operacoes/listagem.server.ts', 'utf8')
const newRequest = readFileSync('src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx', 'utf8')
const proformaService = readFileSync('src/lib/financeiro/risco/proforma-selecao.server.ts', 'utf8')

describe('integração da visão operacional de exposição', () => {
  it('usa o mesmo componente e a mesma avaliação canônica na operação do gestor e do cedente', () => {
    expect(gestorPage).toContain('ExposicaoLogisticaOperacaoServer')
    expect(cedenteOperationPage).toContain('ExposicaoLogisticaOperacaoServer')
    expect(operationServer).toContain('carregarVisaoExposicaoOperacaoCanonica')
    expect(operationServer).not.toContain('politica_operacional_versoes')
    expect(operationLoader).not.toContain("from('politica_operacional_versoes')")
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
    expect(operationLoader).toContain('resolverPlReferencia(admin, { fundoId: input.fundoId, dataOperacional })')
    expect(operationLoader).toContain(".eq('data_operacional', dataOperacional)")
    expect(operationLoader).toContain(".eq('carteira_snapshot_id', plReferencia.snapshotId)")
    expect(operationLoader).not.toContain(".lte('data_operacional', dataOperacional)")
  })

  it('expõe somente textos operacionais e não códigos técnicos', () => {
    expect(card).toContain('Margem disponível')
    expect(card).toContain('Impacto na exposição logística')
    expect(card).toContain('PL de referência')
    expect(card).toContain('Defasagem')
    expect(card).toContain('Origem')
    expect(card).toContain('Operação candidata')
    expect(card).not.toContain('AVALIACAO_RISCO_INDISPONIVEL')
  })

  it('usa preview canônico parcel-aware sem executar o gate persistente ao abrir a tela', () => {
    expect(operationLoader).toContain('projetarCandidatoOperacaoCanonica')
    expect(operationLoader).toContain('classificarGateRisco')
    expect(operationLoader).not.toContain('executarGateRisco')
    expect(operationLoader).not.toContain('.insert(')
  })

  it('inclui o mesmo card nas listagens do gestor e cedente sem reservar espaco quando nao aplicavel', () => {
    expect(operationsList).toContain('resultado.exposicaoLogistica &&')
    expect(operationsList).toContain("'gestor-listagem'")
    expect(operationsList).toContain("'cedente-listagem'")
    expect(operationsLoader).toContain('carregarVisaoExposicaoFundoPadraoCanonica')
    expect(operationsLoader).toContain('carregarVisaoExposicaoFundoCanonica')
  })

  it('usa o mesmo resolvedor temporal de PL no gestor, cedente e nova solicitacao', () => {
    expect(operationLoader).toContain('resolverPlReferencia(admin, { fundoId: input.fundoId, dataOperacional })')
    expect(operationsLoader).toContain('carregarVisaoExposicaoFundoPadraoCanonica')
    expect(operationsLoader).toContain('carregarVisaoExposicaoFundoCanonica')
    expect(proformaService).toContain('carregarVisaoExposicaoFundoCanonica')
  })

  it('mostra a proforma com os dados operacionais exigidos e alerta acima do limite', () => {
    expect(newRequest).toContain('variante="proforma-solicitacao"')
    expect(card).toContain('Impacto estimado na exposição')
    expect(card).toContain('label="Seleção"')
    expect(card).toContain('Operação candidata')
    expect(card).toContain('Esta solicitação poderá ser bloqueada na análise.')
  })

  it('mantém a proforma legível em uma sidebar larga e responsiva', () => {
    expect(newRequest).toContain('max-w-[1440px]')
    expect(newRequest).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(400px,440px)]')
    expect(newRequest).toContain('xl:sticky xl:top-6')
    expect(newRequest).toContain('atualizando={atualizandoImpacto}')
    expect(card).toContain('grid grid-cols-1 gap-2 sm:grid-cols-2')
    expect(card).toContain('break-words text-base font-semibold')
    expect(card).toContain('aria-live="polite"')
    expect(card).toContain('title={truncate ? value : undefined}')
  })
})
