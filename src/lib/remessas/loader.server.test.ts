import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carregarLoteRemessaCanonico } from './loader.server'

const mocks = vi.hoisted(() => ({ from: vi.fn(), download: vi.fn(), resolver: vi.fn(), consultar: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: mocks.from, storage: { from: () => ({ download: mocks.download }) } }) }))
vi.mock('@/lib/integracoes/resolver.server', () => ({ integrationRuntimeEnvironment: () => 'homologacao', resolverIntegracaoPorCapability: mocks.resolver }))
vi.mock('@/lib/cadastro/cnpj.server', () => ({ consultarCnpj: mocks.consultar }))

beforeEach(() => {
  vi.clearAllMocks()
  const tabelas: Record<string, Record<string, unknown>[]> = {
    operacoes: [{ id: 'op', cedente_id: 'ced', cedente_fundo_id: 'vinculo', politica_operacional_versao_id: 'politica' }],
    cedente_fundos: [{ id: 'vinculo', cedente_id: 'ced', fundo_id: 'fundo', status: 'ativo' }],
    fundos: [{ id: 'fundo', nome: 'Teste', cnpj: '68522785000104', ativo: true }],
    cedentes: [{ id: 'ced', cnpj: '68522785000104', razao_social: 'Cedente', coobrigacao: true }],
    operacoes_nfs: [{ operacao_id: 'op', nota_fiscal_id: 'nf' }],
    notas_fiscais: [{ id: 'nf', cedente_id: 'ced', estabelecimento_id: 'est', numero_nf: '100', arquivo_url: 'nota.pdf', cnpj_destinatario: '68522785000104', razao_social_destinatario: 'Sacado', cnpj_emitente: '68522785000104', data_emissao: '2026-01-01', valor_bruto: 100 }],
    operacoes_nf_parcelas: [{ operacao_id: 'op', nota_fiscal_id: 'nf', parcela_id: 'parcela' }],
    nota_fiscal_parcelas: [{ id: 'parcela', nota_fiscal_id: 'nf', numero_parcela: 1, data_vencimento: '2026-12-01', valor_nominal: 100 }],
    operacao_calculo_nfs: [{ operacao_id: 'op', nota_fiscal_id: 'nf', parcela_id: 'parcela', valor_presente: 95, taxa_mensal: 2 }],
    cedente_estabelecimentos: [{ id: 'est', cedente_id: 'ced', cnpj: '68522785000104', razao_social: 'Emissor' }],
    cedente_estabelecimento_contas_bancarias: [],
  }
  mocks.from.mockImplementation((table: string) => ({ select: () => ({
    in: async () => ({ data: tabelas[table] ?? [], error: null }),
    eq: () => ({ maybeSingle: async () => ({ data: tabelas[table]?.[0], error: null }) }),
  }) }))
  mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { integrationVersionId: 'version', adapterKey: 'vortx_vrs', config: {} } })
  mocks.consultar.mockResolvedValue({ ok: true, dados: { cnpj: '68522785000104', cep: '01310100', logradouro: 'Rua consulta', numero: '10', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP' } })
})

describe('loader de remessa com fallback VRS', () => {
  it('integra a consulta de CNPJ quando NF possui apenas PDF, preservando selecao e memoria', async () => {
    const lote = await carregarLoteRemessaCanonico(['op'])
    expect(lote.operacoes[0].notas[0].devedor).toMatchObject({ endereco: 'Rua consulta', fonteEndereco: 'cnpj', nome: 'Sacado' })
    expect(lote.operacoes[0].notas[0].parcelasSelecionadas).toEqual([{ id: 'parcela', numero: 1, vencimento: '2026-12-01', valorNominal: 100, valorPresente: 95, taxaMensal: 2 }])
    expect(mocks.consultar).toHaveBeenCalledWith('68522785000104')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('nao introduz consulta de CNPJ na geracao de outro integrador', async () => {
    mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { integrationVersionId: 'version', adapterKey: 'sinqia_portal_fidc', config: {} } })
    const lote = await carregarLoteRemessaCanonico(['op'])
    expect(lote.operacoes[0].notas[0].devedor.endereco).toBeNull()
    expect(mocks.consultar).not.toHaveBeenCalled()
  })

  it('interrompe o carregamento se o endereco nao puder ser resolvido', async () => {
    mocks.consultar.mockResolvedValue({ ok: false, categoria: 'timeout', mensagem: '' })
    await expect(carregarLoteRemessaCanonico(['op'])).rejects.toThrow(/NF 100.*timeout/)
  })
})
