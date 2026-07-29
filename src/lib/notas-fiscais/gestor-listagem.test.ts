import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calcularMetricasPaginaNotasGestor,
  parseFiltrosNotasFiscaisGestor,
  type NotaFiscalGestorListagemItem,
} from './gestor-listagem'

function nota(
  overrides: Partial<NotaFiscalGestorListagemItem> = {},
): NotaFiscalGestorListagemItem {
  return {
    id: 'nf-1',
    numero: '13197',
    serie: '1',
    chaveAcesso: '4'.repeat(44),
    status: 'submetida',
    cedente: { id: 'cedente-1', nome: 'Cedente', cnpj: '00262371000575' },
    sacado: { nome: 'Sacado', cnpj: '41985505000130' },
    valorBruto: 1000,
    emissaoEm: '2026-07-01',
    vencimentoEm: '2026-08-01',
    operacao: null,
    resumoDocumental: {
      totalObrigatorios: 2,
      totalSatisfeitos: 1,
      totalPendentes: 1,
      possuiRejeicao: false,
      elegivel: false,
    },
    criadoEm: '2026-07-01T12:00:00Z',
    atualizadoEm: '2026-07-01T12:00:00Z',
    ...overrides,
  }
}

describe('listagem de NFs do gestor', () => {
  it('normaliza pagina, page size, filtros e ordenacao da URL', () => {
    expect(parseFiltrosNotasFiscaisGestor({
      page: '2',
      pageSize: '20',
      q: '  NF 13197  ',
      status: 'submetida',
      cedente: 'cedente-1',
      vencimentoDe: '2026-07-01',
      vencimentoAte: '2026-08-01',
      sort: 'data_vencimento',
      direction: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 20,
      q: 'NF 13197',
      status: 'submetida',
      cedenteId: 'cedente-1',
      vencimentoDe: '2026-07-01',
      vencimentoAte: '2026-08-01',
      sort: 'data_vencimento',
      direction: 'asc',
    })
  })

  it('rejeita parametros arbitrarios e usa defaults seguros', () => {
    expect(parseFiltrosNotasFiscaisGestor({
      page: '-1',
      pageSize: '500',
      status: 'status_injetado',
      sort: 'sql_injetado',
      direction: 'sideways',
      vencimentoDe: '01/07/2026',
    })).toMatchObject({
      page: 1,
      pageSize: 10,
      status: null,
      sort: 'created_at',
      direction: 'desc',
      vencimentoDe: '',
    })
  })

  it('calcula cards exclusivamente com os itens da pagina', () => {
    const metricas = calcularMetricasPaginaNotasGestor([
      nota(),
      nota({ id: 'nf-2', status: 'aprovada', valorBruto: 2500 }),
      nota({ id: 'nf-3', status: 'cancelada', valorBruto: 900 }),
    ])

    expect(metricas).toEqual({ pendentes: 1, aprovadas: 1, valor: 3500 })
  })

  it('mantem o contrato compacto sem arquivo, URL ou historico', () => {
    expect(Object.keys(nota())).toEqual([
      'id',
      'numero',
      'serie',
      'chaveAcesso',
      'status',
      'cedente',
      'sacado',
      'valorBruto',
      'emissaoEm',
      'vencimentoEm',
      'operacao',
      'resumoDocumental',
      'criadoEm',
      'atualizadoEm',
    ])
  })

  it('pagina no banco e hidrata somente os IDs da pagina', () => {
    const serverSource = readFileSync(
      join(process.cwd(), 'src/lib/notas-fiscais/gestor-listagem.server.ts'),
      'utf8',
    )
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/gestor/notas-fiscais/page.tsx'),
      'utf8',
    )
    const clientSource = readFileSync(
      join(process.cwd(), 'src/components/notas-fiscais/NotasFiscaisGestorListagem.tsx'),
      'utf8',
    )

    expect(serverSource).toContain('.range(range.from, range.to)')
    expect(serverSource).toContain('carregarResumoDocumentalDasNotas(auth.supabase, ids)')
    expect(serverSource).not.toContain("select('*'")
    expect(pageSource).not.toContain("'use client'")
    expect(clientSource).not.toContain('createClient')
    expect(clientSource).not.toContain('listarChecklistDaNota')
  })

  it('elimina action e checklist por NF na aprovacao em lote', () => {
    const actionSource = readFileSync(
      join(process.cwd(), 'src/lib/actions/nota-fiscal.ts'),
      'utf8',
    )
    const inicio = actionSource.indexOf('export async function aprovarNFsLote')
    const fim = actionSource.indexOf('export async function reprovarNFsLote')
    const loteSource = actionSource.slice(inicio, fim)

    expect(loteSource).toContain('Array.from(new Set(')
    expect(loteSource).toContain('carregarResumoDocumentalDasNotas(supabase, idsUnicos)')
    expect(loteSource).not.toContain('listarChecklistDaNota')
    expect(loteSource).not.toContain('aprovarNF(')
    expect(loteSource).not.toMatch(/\.map\(\s*async/)
    expect(loteSource).toContain('A aprovacao em lote e atomica')
  })
})
