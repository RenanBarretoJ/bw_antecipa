import { describe, expect, it } from 'vitest'
import { prepararSnapshotEstoqueVortx } from './estoque-snapshot'
import { CONTEXTO_CSV_QA, csvVortxQa } from './__fixtures__/relatorios-csv'

const input = () => ({ contexto: CONTEXTO_CSV_QA, integracaoFundoVersaoId: '893aa90d-459f-40bf-bc96-71fa550e03ad',
  ativo: { nome: 'Ativo.csv', conteudo: csvVortxQa('PosicaoAtivo') },
  parcela: { nome: 'Parcela.csv', conteudo: csvVortxQa('PosicaoParcela') } })

describe('snapshot nativo Vortx', () => {
  it('preserva dois arquivos/linhas e identidades sem transformar parcela em estoque legado', () => {
    const result = prepararSnapshotEstoqueVortx(input())
    expect(result.arquivos.map(f => f.ordem)).toEqual([1, 2])
    expect(result.payload.ativos).toHaveLength(1)
    expect(result.payload.parcelas).toHaveLength(1)
    expect(result.payload.parcelas[0].dados_normalizados).toHaveProperty('external_title_key')
    expect(result.payload.parcelas[0].dados_brutos).toHaveProperty('Chave Única da Parcela')
    expect(result.arquivos.every(f => f.storage_path.startsWith(`${CONTEXTO_CSV_QA.fundoId}/vortx/`))).toBe(true)
    expect(result.payload).not.toHaveProperty('estoque_posicoes')
  })
  it('hash idempotente inclui escopo, data e os dois arquivos, nao UUID temporario', () => {
    const first = prepararSnapshotEstoqueVortx(input()), again = prepararSnapshotEstoqueVortx(input())
    expect(first.payload.id).not.toBe(again.payload.id)
    expect(first.payload.hash_conteudo).toBe(again.payload.hash_conteudo)
    const other = input(); other.contexto = { ...other.contexto, ambiente: 'producao' }
    expect(prepararSnapshotEstoqueVortx(other).payload.hash_conteudo).not.toBe(first.payload.hash_conteudo)
    other.contexto = { ...other.contexto, dataReferencia: '2026-10-15' }
    expect(prepararSnapshotEstoqueVortx(other).payload.hash_conteudo).not.toBe(first.payload.hash_conteudo)
  })
  it('preserva divergencia para revisao, sem autorizar publicacao financeira', () => {
    const value = input(); value.parcela.conteudo = csvVortxQa('PosicaoParcela', [{ valor_pdd: '0.00' }])
    const result = prepararSnapshotEstoqueVortx(value)
    expect(result.composicao.publicacaoHabilitada).toBe(false)
    expect(result.payload.parcelas[0].dados_normalizados.valor_pdd).toBe('0.0000')
  })
})
