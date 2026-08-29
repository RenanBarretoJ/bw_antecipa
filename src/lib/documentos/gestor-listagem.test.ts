import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calcularMetricasPaginaDocumentosGestor,
  parseFiltrosDocumentosGestor,
  type DocumentoGestorListagemItem,
} from './gestor-listagem'

function documento(
  overrides: Partial<DocumentoGestorListagemItem> = {},
): DocumentoGestorListagemItem {
  return {
    id: 'doc-1',
    tipo: 'contrato_social',
    nome: 'Contrato Social',
    status: 'em_analise',
    escopo: { tipo: 'empresa' },
    cedente: { id: 'cedente-1', nome: 'Cedente', cnpj: '00262371000575' },
    versaoAtual: { numero: 2, criadoEm: '2026-07-01T12:00:00Z' },
    ultimaAnalise: null,
    possuiArquivo: true,
    criadoEm: '2026-07-01T12:00:00Z',
    atualizadoEm: '2026-07-02T12:00:00Z',
    ...overrides,
  }
}

describe('listagem de documentos do gestor', () => {
  it('normaliza pagina, busca, status e ordenacao', () => {
    expect(parseFiltrosDocumentosGestor({
      page: '2',
      pageSize: '40',
      q: '  Contrato  ',
      status: 'em_analise',
      sort: 'tipo',
      direction: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 40,
      q: 'Contrato',
      status: 'em_analise',
      sort: 'tipo',
      direction: 'asc',
    })
  })

  it('rejeita status, sort e paginacao arbitrarios', () => {
    expect(parseFiltrosDocumentosGestor({
      page: 'abc',
      pageSize: '1000',
      status: 'qualquer',
      sort: 'arquivo_url',
      direction: 'random',
    })).toMatchObject({
      page: 1,
      pageSize: 10,
      status: null,
      sort: 'created_at',
      direction: 'desc',
    })
  })

  it('calcula cards com a pagina atual', () => {
    expect(calcularMetricasPaginaDocumentosGestor([
      documento(),
      documento({ id: 'doc-2', status: 'enviado' }),
      documento({ id: 'doc-3', status: 'aprovado' }),
      documento({ id: 'doc-4', status: 'reprovado' }),
    ])).toEqual({ pendentes: 2, aprovados: 1, reprovados: 1 })
  })

  it('nao expoe path, URL, conteudo ou historico no contrato', () => {
    expect(Object.keys(documento())).toEqual([
      'id',
      'tipo',
      'nome',
      'status',
      'escopo',
      'cedente',
      'versaoAtual',
      'ultimaAnalise',
      'possuiArquivo',
      'criadoEm',
      'atualizadoEm',
    ])
  })

  it('pagina no banco e gera a URL somente sob demanda', () => {
    const serverSource = readFileSync(
      join(process.cwd(), 'src/lib/documentos/gestor-listagem.server.ts'),
      'utf8',
    )
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/gestor/documentos/page.tsx'),
      'utf8',
    )
    const clientSource = readFileSync(
      join(process.cwd(), 'src/components/documentos/DocumentosGestorListagem.tsx'),
      'utf8',
    )

    expect(serverSource).toContain('.range(range.from, range.to)')
    expect(serverSource).not.toContain('createSignedUrl')
    expect(serverSource).not.toContain("select('*'")
    expect(pageSource).not.toContain("'use client'")
    expect(clientSource).toContain('gerarUrlDocumentoGestor(doc.id)')
    expect(clientSource).not.toContain('createClient')
  })
})
