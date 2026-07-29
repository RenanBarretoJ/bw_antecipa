import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calcularIndicadoresPaginaPagamentos,
  parseFiltrosAprovacoesSacado,
  parseFiltrosNfsSacado,
  parseFiltrosPagamentosSacado,
  type NotaFiscalSacadoListagemItem,
  type PagamentoSacadoItem,
} from './portal-listagens'
import { buildOffsetRange, buildPaginatedResult } from '@/lib/pagination'

const ROOT = process.cwd()

function ler(caminho: string) {
  return readFileSync(join(ROOT, caminho), 'utf8')
}

describe('filtros do portal do sacado', () => {
  it('usa os defaults compartilhados nas NFs', () => {
    expect(parseFiltrosNfsSacado({})).toEqual({
      page: 1,
      pageSize: 10,
      q: '',
      status: null,
      sort: 'created_at',
      direction: 'desc',
    })
  })

  it.each(['10', '20', '40'])('aceita pageSize %s nas NFs', (pageSize) => {
    expect(parseFiltrosNfsSacado({ pageSize }).pageSize).toBe(Number(pageSize))
  })

  it('normaliza busca, status e ordenação de NFs', () => {
    expect(parseFiltrosNfsSacado({
      page: '2',
      pageSize: '20',
      q: '  Cedente   A  ',
      status: 'liquidada',
      sort: 'data_vencimento',
      direction: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 20,
      q: 'Cedente A',
      status: 'liquidada',
      sort: 'data_vencimento',
      direction: 'asc',
    })
  })

  it('rejeita status e sort arbitrários', () => {
    expect(parseFiltrosNfsSacado({
      status: 'outro_sacado',
      sort: 'tenant_id',
      direction: 'random',
    })).toMatchObject({
      status: null,
      sort: 'created_at',
      direction: 'desc',
    })
  })

  it('normaliza os filtros de aprovação', () => {
    expect(parseFiltrosAprovacoesSacado({
      cedente: 'cedente-1',
      vencimentoDe: '2026-07-01',
      vencimentoAte: '2026-07-31',
      valorMinimo: '10,50',
      valorMaximo: '1000',
      sort: 'valor_bruto',
      direction: 'asc',
    })).toMatchObject({
      cedenteId: 'cedente-1',
      vencimentoDe: '2026-07-01',
      vencimentoAte: '2026-07-31',
      valorMinimo: 10.5,
      valorMaximo: 1000,
      sort: 'valor_bruto',
      direction: 'asc',
    })
  })

  it('descarta datas e valores inválidos da aprovação', () => {
    expect(parseFiltrosAprovacoesSacado({
      vencimentoDe: '01/07/2026',
      vencimentoAte: 'invalida',
      valorMinimo: '-1',
      valorMaximo: 'abc',
    })).toMatchObject({
      vencimentoDe: '',
      vencimentoAte: '',
      valorMinimo: null,
      valorMaximo: null,
    })
  })

  it('usa offset e allowlist no histórico de pagamentos', () => {
    expect(parseFiltrosPagamentosSacado({
      page: '3',
      pageSize: '40',
      status: 'em_andamento',
      sort: 'data_vencimento',
      direction: 'asc',
    })).toEqual({
      page: 3,
      pageSize: 40,
      q: '',
      status: 'em_andamento',
      sort: 'data_vencimento',
      direction: 'asc',
    })
  })

  it('rejeita status de operação fora do histórico de pagamentos', () => {
    expect(parseFiltrosPagamentosSacado({
      status: 'solicitada',
      sort: 'created_at',
    })).toMatchObject({
      status: null,
      sort: 'liquidada_em',
      direction: 'desc',
    })
  })
})

describe('paginação e contratos compactos', () => {
  it('divide 25 NFs em páginas estáveis de dez itens', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `nf-${index + 1}`)
    const primeira = buildOffsetRange({ page: 1, pageSize: 10 })
    const segunda = buildOffsetRange({ page: 2, pageSize: 10 })
    const terceira = buildOffsetRange({ page: 3, pageSize: 10 })

    expect(ids.slice(primeira.from, primeira.to + 1)).toHaveLength(10)
    expect(ids.slice(segunda.from, segunda.to + 1)).toHaveLength(10)
    expect(ids.slice(terceira.from, terceira.to + 1)).toHaveLength(5)
    expect(buildPaginatedResult(ids.slice(segunda.from, segunda.to + 1), {
      page: 2,
      pageSize: 10,
      total: 25,
    }).pagination).toMatchObject({
      page: 2,
      total: 25,
      totalPages: 3,
      hasPrevious: true,
      hasNext: true,
    })
  })

  it('mantém NF sem operação no contrato da listagem', () => {
    const item: NotaFiscalSacadoListagemItem = {
      id: 'nf-1',
      numero: '1',
      serie: null,
      chaveAcesso: null,
      cedente: { id: 'ced-1', nome: 'Cedente', cnpj: '00000000000000' },
      valor: 100,
      emissaoEm: null,
      vencimentoEm: null,
      status: 'submetida',
      situacaoAprovacao: 'nao_solicitada',
      operacao: null,
      criadoEm: '2026-07-29T00:00:00Z',
      possuiArquivo: false,
    }

    expect(item.operacao).toBeNull()
    expect(item).not.toHaveProperty('arquivo_url')
    expect(item).not.toHaveProperty('documentos')
    expect(item).not.toHaveProperty('eventos')
  })

  it('calcula e identifica os indicadores dos pagamentos como página atual', () => {
    const base: PagamentoSacadoItem = {
      id: 'op-1',
      codigo: 'op-1',
      cedente: { id: 'ced-1', nome: 'Cedente', cnpj: '00000000000000' },
      valorOriginal: 100,
      valorLiquido: 90,
      vencimentoEm: '2026-07-29',
      pagoEm: null,
      status: 'em_andamento',
      contaEscrow: null,
    }
    expect(calcularIndicadoresPaginaPagamentos([
      base,
      { ...base, id: 'op-2', status: 'liquidada', valorOriginal: 200 },
      { ...base, id: 'op-3', status: 'inadimplente', valorOriginal: 300 },
    ])).toEqual({
      totalAPagar: 100,
      totalPago: 200,
      totalOperacoes: 3,
    })
  })
})

describe('arquitetura do Escopo 4', () => {
  const paginas = [
    'src/app/sacado/dashboard/page.tsx',
    'src/app/sacado/notas-fiscais/page.tsx',
    'src/app/sacado/aprovacao/page.tsx',
    'src/app/sacado/pagamentos/page.tsx',
  ]

  it.each(paginas)('%s é server-side e não usa o carregador legado', (pagina) => {
    const source = ler(pagina)
    expect(source).not.toContain("'use client'")
    expect(source).not.toContain('carregarPortalSacado')
    expect(source).not.toContain('useEffect')
  })

  it('usa loaders específicos nas quatro rotas', () => {
    expect(ler(paginas[0])).toContain('carregarDashboardSacado')
    expect(ler(paginas[1])).toContain('carregarNotasFiscaisSacado')
    expect(ler(paginas[2])).toContain('carregarAprovacoesSacado')
    expect(ler(paginas[3])).toContain('carregarPagamentosSacado')
  })

  it('pagina no banco, carrega relações da página em lote e não usa select estrela', () => {
    const source = ler('src/lib/sacado/portal-loaders.server.ts')
    expect(source).toContain('.range(range.from, range.to)')
    expect(source).toContain(".in('nota_fiscal_id', notaIds)")
    expect(source).toContain(".in('id', operacaoIds)")
    expect(source).not.toMatch(/select\(\s*['"`]\*['"`]\s*\)/)
    expect(source).not.toMatch(/Promise\.all\(\s*notaIds\.map/)
  })

  it('centraliza a identidade pela sessão e valida perfil ativo e CNPJ', () => {
    const source = ler('src/lib/sacado/contexto.server.ts')
    expect(source).toContain("requireRole('sacado')")
    expect(source).toContain("auth.profile.status !== 'ativo'")
    expect(source).toContain(".eq('user_id', auth.user.id)")
    expect(source).toContain('cnpj.length !== 14')
    expect(source).not.toMatch(/resolverContextoSacado\s*\([^)]*(cnpj|sacadoId|fundoId)/)
  })

  it('gera URL assinada somente sob demanda e revalida o destinatário', () => {
    const action = ler('src/lib/actions/sacado-portal.ts')
    const loader = ler('src/lib/sacado/portal-loaders.server.ts')
    expect(action).toContain('obterUrlArquivoNotaSacado')
    expect(action).toContain('createSignedUrl')
    expect(action).toContain('cnpj_destinatario')
    expect(loader).not.toContain('createSignedUrl')
  })

  it('revalida somente as rotas do sacado afetadas', () => {
    const source = ler('src/lib/actions/sacado.ts')
    expect(source).toContain("revalidatePath('/sacado/dashboard')")
    expect(source).toContain("revalidatePath('/sacado/notas-fiscais')")
    expect(source).toContain("revalidatePath('/sacado/aprovacao')")
    expect(source).toContain("revalidatePath('/sacado/pagamentos')")
    expect(source).not.toContain("revalidatePath('/gestor")
    expect(source).not.toContain("revalidatePath('/cedente")
  })

  it('preserva o RPC transacional de aceite e valida lotes em consultas batched', () => {
    const source = ler('src/lib/actions/sacado.ts')
    expect(source).toContain("rpc('processar_aceite_sacado'")
    expect(source).toContain('const ids = [...new Set(nfIds)]')
    expect(source).toContain(".in('id', ids)")
    expect(source).toContain(".in('nota_fiscal_id', ids)")
    expect(source).not.toMatch(
      /for\s*\([^)]*nfIds[^)]*\)\s*\{[\s\S]*?aprovarCessao/,
    )
  })

  it('mantém a agregação do dashboard como SECURITY INVOKER e sem índice especulativo', () => {
    const migration = ler(
      'supabase/migrations/20260729203749_performance_portal_sacado_dashboard.sql',
    )
    expect(migration).toContain('SECURITY INVOKER')
    expect(migration).toContain('auth.uid()')
    expect(migration).toContain('LIMIT 8')
    expect(migration).toContain('carregar_indicadores_nfs_sacado')
    expect(migration).not.toContain('CREATE INDEX')
  })
})
