import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcularCandidatoParcelAware, type ParcelaCandidataProforma } from './proforma-selecao'

const service = readFileSync('src/lib/financeiro/risco/proforma-selecao.server.ts', 'utf8')
const domain = readFileSync('src/lib/financeiro/risco/proforma-selecao.ts', 'utf8')
const action = readFileSync('src/lib/actions/exposicao.ts', 'utf8')
const client = readFileSync('src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx', 'utf8')
const loader = readFileSync('src/lib/operacoes/nova-solicitacao.server.ts', 'utf8')

describe('proforma read-only da exposicao na nova solicitacao', () => {
  it('resolve a politica aplicavel do vinculo e nunca usa snapshot inexistente', () => {
    expect(loader).toContain('obterPoliticaAplicavelAoCedenteFundo')
    expect(loader).toContain('politica.versao.id')
    expect(loader).not.toContain('resolverVersaoPolitica')
    expect(action).toContain('resolverCedenteFundoAtivo')
    expect(action).toContain('obterPoliticaAplicavelAoCedenteFundo')
  })

  it('calcula o candidato somente com as parcelas selecionadas e o motor financeiro canonico', () => {
    expect(service).toContain("from('nota_fiscal_parcelas')")
    expect(service).toContain(".in('id', parcelaIds)")
    expect(service).toContain('calcularCandidatoParcelAware')
    expect(domain).toContain('calcularAntecipacaoEmLote')
    expect(service).toContain('valorNominal: Number(parcela.valor_nominal)')
    expect(service).not.toContain('valor_bruto:')
    expect(service).not.toContain('valorBruto: Number(nota')
  })

  const parcela = (id: string, notaFiscalId: string, valorNominal: number): ParcelaCandidataProforma => ({
    id,
    notaFiscalId,
    valorNominal,
    dataVencimento: '2026-12-31',
  })
  const calcular = (parcelasSelecionadas: ParcelaCandidataProforma[]) => calcularCandidatoParcelAware({
    parcelasSelecionadas,
    taxas: [{ prazo_min: 0, prazo_max: 999, taxa_percentual: 0 }],
    dataBase: '2026-08-25',
    metodo: 'DIAS_CORRIDOS_365',
  })

  it('calcula uma parcela, multiplas parcelas da mesma NF e multiplas NFs', () => {
    const p1 = parcela('p1', 'nf1', 100)
    const p2 = parcela('p2', 'nf1', 200)
    const p3 = parcela('p3', 'nf2', 300)
    expect(calcular([p1])).toMatchObject({ valorCandidato: 100, quantidadeNfs: 1, quantidadeParcelas: 1 })
    expect(calcular([p1, p2])).toMatchObject({ valorCandidato: 300, quantidadeNfs: 1, quantidadeParcelas: 2 })
    expect(calcular([p1, p2, p3])).toMatchObject({ valorCandidato: 600, quantidadeNfs: 2, quantidadeParcelas: 3 })
  })

  it('remove imediatamente do candidato a parcela desmarcada', () => {
    const p1 = parcela('p1', 'nf1', 100)
    const p2 = parcela('p2', 'nf1', 200)
    const p3 = parcela('p3', 'nf2', 300)
    expect(calcular([p1, p2, p3]).valorCandidato).toBe(600)
    expect(calcular([p1, p3]).valorCandidato).toBe(400)
  })

  it('valida o mesmo cedente, vinculo e fundo antes de simular', () => {
    expect(service).toContain(".eq('cedente_id', input.cedenteId)")
    expect(service).toContain(".eq('cedente_fundo_id', input.cedenteFundoId)")
    expect(service).toContain(".eq('fundo_id', input.fundoId)")
    expect(service).toContain(".eq('status', 'aprovada')")
    expect(service).toContain(".eq('status', 'disponivel')")
  })

  it('nao cria execucao, auditoria ou qualquer mutacao ao simular', () => {
    for (const source of [service, action]) {
      expect(source).not.toContain('.insert(')
      expect(source).not.toContain('.update(')
      expect(source).not.toContain('.delete(')
      expect(source).not.toContain('.upsert(')
      expect(source).not.toContain('executarGateRisco')
      expect(source).not.toContain('risco_execucoes')
      expect(source).not.toContain('exposicao_execucoes')
      expect(source).not.toContain('logs_auditoria')
    }
  })

  it('atualiza com debounce e ignora respostas obsoletas ao marcar ou desmarcar', () => {
    expect(client).toContain('simularExposicaoSelecao(selecaoProforma)')
    expect(client).toContain('}, 350)')
    expect(client).toContain('simulacaoAtual.current !== requisicao')
    expect(client).toContain('Atualizando impacto...')
  })

  it('nao renderiza a proforma quando a politica nao exige controle', () => {
    expect(client).toContain('{proformaExposicao && (')
    expect(service).toContain('if (!controleAtivo) return null')
  })
})
