import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
}))

function chain(rows: unknown[]) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    not: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve({ data: (rows[0] as unknown) ?? null, error: null }),
    then: (resolve: (result: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  }
  return query
}

function fakeSupabase() {
  return {
    from: (table: string) => chain(mocks.tables[table] || []),
  }
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({
  requireNotaFiscalAccess: vi.fn(async () => ({
    supabase: fakeSupabase(),
    user: { id: 'user-1' },
    profile: { role: 'cedente' },
  })),
  requireGestor: vi.fn(async () => ({ supabase: fakeSupabase(), user: { id: 'gestor-1' } })),
}))
vi.mock('@/lib/auth/mfa', () => ({ exigirSessaoElevada: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./notificacao', () => ({ notificarCedente: vi.fn() }))
vi.mock('./auditoria', () => ({ registrarLog: vi.fn(async () => undefined) }))

import { identificarBeneficiarioBoleto, listarParcelasBoletosDaNota } from './parcelas-nf'

describe('listarParcelasBoletosDaNota', () => {
  beforeEach(() => {
    mocks.tables = {}
  })

  it('NF com parcelas mas politica SEM boleto retorna lista vazia (nao inventa itens pendentes)', async () => {
    mocks.tables.nota_fiscal_parcelas = [
      { id: 'p1', nota_fiscal_id: 'nf-1', numero_parcela: 1, valor_nominal: 100, data_vencimento: '2026-10-01' },
      { id: 'p2', nota_fiscal_id: 'nf-1', numero_parcela: 2, valor_nominal: 100, data_vencimento: '2026-11-01' },
      { id: 'p3', nota_fiscal_id: 'nf-1', numero_parcela: 3, valor_nominal: 100, data_vencimento: '2026-12-01' },
    ]
    mocks.tables.documento_requisito_instancias = []

    const result = await listarParcelasBoletosDaNota('nf-1')

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('NF com parcelas e politica COM boleto retorna exatamente 1 item por parcela com requisito real', async () => {
    mocks.tables.nota_fiscal_parcelas = [
      { id: 'p1', nota_fiscal_id: 'nf-1', numero_parcela: 1, valor_nominal: 100, data_vencimento: '2026-10-01' },
      { id: 'p2', nota_fiscal_id: 'nf-1', numero_parcela: 2, valor_nominal: 100, data_vencimento: '2026-11-01' },
    ]
    mocks.tables.documento_requisito_instancias = [
      { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: null, tipo_documento_codigo_snapshot: 'boleto' },
      { id: 'req-2', parcela_id: 'p2', obrigatorio: true, status: 'satisfeito', documento_id: 'doc-2', tipo_documento_codigo_snapshot: 'boleto' },
    ]
    mocks.tables.documento_versoes = [
      { id: 'v2', documento_id: 'doc-2', numero_versao: 1, nome_original: 'boleto-002.pdf', beneficiario_estabelecimento_id: 'est-1' },
    ]
    mocks.tables.documento_analises = []

    const result = await listarParcelasBoletosDaNota('nf-1')

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.data?.map((item) => item.parcela.numero_parcela)).toEqual([1, 2])
    expect(result.data?.every((item) => item.obrigatorio)).toBe(true)
    expect(result.data?.[1].status).toBe('satisfeito')
    expect(result.data?.[1].documentoVersaoId).toBe('v2')
  })

  it('NF sem nenhuma parcela retorna lista vazia sem consultar requisitos', async () => {
    mocks.tables.nota_fiscal_parcelas = []

    const result = await listarParcelasBoletosDaNota('nf-2')

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  describe('status exibido reflete a versao/analise real, nao o status estatico da instancia', () => {
    // registrar_documento_upload sempre grava documento_requisito_instancias.status
    // = 'pendente' apos qualquer envio (novo ou reenvio) -- o requisito.status
    // por si so nao distingue "nunca enviado" de "enviado, aguardando analise"
    // de "rejeitado, precisa reenviar". listarParcelasBoletosDaNota precisa
    // derivar o status real a partir de documento_versoes/documento_analises.
    beforeEach(() => {
      mocks.tables.nota_fiscal_parcelas = [
        { id: 'p1', nota_fiscal_id: 'nf-1', numero_parcela: 1, valor_nominal: 100, data_vencimento: '2026-10-01' },
      ]
    })

    it('sem nenhum documento_id -> Aguardando envio (pendente)', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: null, tipo_documento_codigo_snapshot: 'boleto' },
      ]
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('pendente')
    })

    it('upload feito, versao em_analise, instancia ainda "pendente" -> exibe em_analise (nao "Aguardando envio")', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: 'doc-1', tipo_documento_codigo_snapshot: 'boleto' },
      ]
      mocks.tables.documento_versoes = [
        { id: 'v1', documento_id: 'doc-1', numero_versao: 1, status: 'em_analise', nome_original: 'boleto.pdf', beneficiario_estabelecimento_id: null },
      ]
      mocks.tables.documento_analises = []
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('em_analise')
    })

    it('analise com resultado rejeitado -> exibe rejeitado', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: 'doc-1', tipo_documento_codigo_snapshot: 'boleto' },
      ]
      mocks.tables.documento_versoes = [
        { id: 'v1', documento_id: 'doc-1', numero_versao: 1, status: 'rejeitado', nome_original: 'boleto.pdf', beneficiario_estabelecimento_id: null },
      ]
      mocks.tables.documento_analises = [
        { documento_versao_id: 'v1', resultado: 'rejeitado', observacoes: 'Documento ilegivel', analisado_em: '2026-08-01' },
      ]
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('rejeitado')
      expect(result.data?.[0].motivo).toBe('Documento ilegivel')
    })

    it('analise com resultado requer_ajuste -> exibe requer_ajuste', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: 'doc-1', tipo_documento_codigo_snapshot: 'boleto' },
      ]
      mocks.tables.documento_versoes = [
        { id: 'v1', documento_id: 'doc-1', numero_versao: 1, status: 'em_analise', nome_original: 'boleto.pdf', beneficiario_estabelecimento_id: null },
      ]
      mocks.tables.documento_analises = [
        { documento_versao_id: 'v1', resultado: 'requer_ajuste', observacoes: 'Falta assinatura', analisado_em: '2026-08-01' },
      ]
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('requer_ajuste')
    })

    it('instancia satisfeito apos aprovacao continua exibindo satisfeito', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'satisfeito', documento_id: 'doc-1', tipo_documento_codigo_snapshot: 'boleto' },
      ]
      mocks.tables.documento_versoes = [
        { id: 'v1', documento_id: 'doc-1', numero_versao: 1, status: 'aprovado', nome_original: 'boleto.pdf', beneficiario_estabelecimento_id: null },
      ]
      mocks.tables.documento_analises = [
        { documento_versao_id: 'v1', resultado: 'aprovado', observacoes: null, analisado_em: '2026-08-01' },
      ]
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('satisfeito')
    })

    it('reenvio apos rejeicao cria nova versao mais recente e o status reflete a nova versao', async () => {
      mocks.tables.documento_requisito_instancias = [
        { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: 'doc-1', tipo_documento_codigo_snapshot: 'boleto' },
      ]
      mocks.tables.documento_versoes = [
        { id: 'v2', documento_id: 'doc-1', numero_versao: 2, status: 'em_analise', nome_original: 'boleto-v2.pdf', beneficiario_estabelecimento_id: null },
        { id: 'v1', documento_id: 'doc-1', numero_versao: 1, status: 'rejeitado', nome_original: 'boleto-v1.pdf', beneficiario_estabelecimento_id: null },
      ]
      mocks.tables.documento_analises = [
        { documento_versao_id: 'v1', resultado: 'rejeitado', observacoes: 'Motivo antigo', analisado_em: '2026-08-01' },
      ]
      const result = await listarParcelasBoletosDaNota('nf-1')
      expect(result.data?.[0].status).toBe('em_analise')
      expect(result.data?.[0].numeroVersao).toBe(2)
    })
  })
})

// extrairCandidatosCnpj e encontrarBeneficiarioUnico (regras puras usadas
// por identificarBeneficiarioBoleto) tem testes dedicados em
// src/lib/documentos-v2/boleto-beneficiario.test.ts -- vivem la porque um
// modulo 'use server' so pode exportar funcoes assincronas (Server Actions).
describe('identificarBeneficiarioBoleto (identificacao automatica de beneficiario a partir do PDF)', () => {
  beforeEach(() => {
    mocks.tables = {}
  })

  it('sem arquivo no FormData -> retorna estabelecimentoId null sem lancar erro', async () => {
    const formData = new FormData()
    const result = await identificarBeneficiarioBoleto('nf-1', formData)
    expect(result.success).toBe(true)
    expect(result.data?.estabelecimentoId).toBeNull()
  })

  it('arquivo que nao e PDF (mime/extensao) -> retorna estabelecimentoId null sem consultar beneficiarios', async () => {
    const formData = new FormData()
    formData.set('arquivo', new File(['conteudo'], 'boleto.txt', { type: 'text/plain' }))
    const result = await identificarBeneficiarioBoleto('nf-1', formData)
    expect(result.success).toBe(true)
    expect(result.data?.estabelecimentoId).toBeNull()
  })

  it('arquivo PDF invalido/nao parseavel -> falha graciosamente, nunca lanca erro', async () => {
    mocks.tables.notas_fiscais = [{ cedente_id: 'cedente-1' }]
    mocks.tables.cedente_estabelecimentos = [{ id: 'b1', razao_social: 'ACME LTDA', cnpj: '12345678000190', tipo: 'matriz' }]

    const formData = new FormData()
    formData.set('arquivo', new File(['nao e um pdf real'], 'boleto.pdf', { type: 'application/pdf' }))
    const result = await identificarBeneficiarioBoleto('nf-1', formData)

    expect(result.success).toBe(true)
    expect(result.data?.estabelecimentoId).toBeNull()
  })
})
