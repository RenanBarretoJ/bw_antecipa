import { beforeEach, describe, expect, it, vi } from 'vitest'

// Bug real (ticket P0_Claude_Fechar_Ajustes_Documentais_UX): o botao
// "Enviar nova versao" no header de RequisitoNfRemessa chamava exatamente a
// mesma action que "Enviar outra NF de Remessa" -- reenviar o MESMO XML
// (mesma chave_acesso) de uma remessa rejeitada sempre falhava com "Chave
// de acesso da remessa ja cadastrada", pois a RPC so sabia fazer INSERT.
//
// Ticket P0_Claude_Versionamento_NF_Remessa evoluiu a correcao: o design
// anterior fazia UPDATE destrutivo (sobrescrevia a linha e apagava o XML
// anterior do Storage) -- insuficiente para auditoria. Agora
// registrar_nota_fiscal_remessa versiona em nota_fiscal_remessa_versoes
// (append-only, nunca apagado) e a action em TypeScript NUNCA remove um
// arquivo do Storage apos um envio com sucesso.

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, { maybeSingle?: { data: unknown; error: unknown }; list?: { data: unknown[]; error: unknown } }>,
  rpcResponse: { data: null as unknown, error: null as unknown },
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  rpcCalls: [] as Array<{ name: string; params: unknown }>,
}))

function query(table: string) {
  const q = {
    select(...args: unknown[]) { mocks.calls.push({ table, method: 'select', args }); return q },
    eq(...args: unknown[]) { mocks.calls.push({ table, method: 'eq', args }); return q },
    in(...args: unknown[]) { mocks.calls.push({ table, method: 'in', args }); return q },
    neq(...args: unknown[]) { mocks.calls.push({ table, method: 'neq', args }); return q },
    order(...args: unknown[]) { mocks.calls.push({ table, method: 'order', args }); return q },
    maybeSingle() {
      mocks.calls.push({ table, method: 'maybeSingle', args: [] })
      return Promise.resolve(mocks.config[table]?.maybeSingle ?? { data: null, error: null })
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const resposta = mocks.config[table]?.list ?? { data: [], error: null }
      return Promise.resolve(resposta).then(resolve, reject)
    },
  }
  return q
}

function fakeSupabase() {
  return {
    from: (table: string) => { mocks.calls.push({ table, method: 'from', args: [] }); return query(table) },
    rpc: (name: string, params: unknown) => {
      mocks.rpcCalls.push({ name, params })
      return Promise.resolve(mocks.rpcResponse)
    },
  }
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({
  requireNotaFiscalAccess: vi.fn(async () => ({
    supabase: fakeSupabase(),
    user: { id: 'user-1' },
    profile: { role: 'cedente' },
    notaFiscal: { cedente_id: 'cedente-1' },
  })),
  requireAuthenticated: vi.fn(async () => ({ supabase: fakeSupabase(), user: { id: 'user-1' }, profile: { role: 'gestor' } })),
}))
vi.mock('@/lib/nf-parser', () => ({
  parseNFeXML: vi.fn(() => ({
    chave_acesso: '1'.repeat(44),
    numero_nf: '100',
    serie: '1',
    cnpj_emitente: '11111111111111',
    razao_social_emitente: 'EMITENTE',
    cnpj_destinatario: '22222222222222',
    razao_social_destinatario: 'DESTINATARIO',
    data_emissao: '2026-08-01',
    valor_bruto: 1000,
    quantidadeTotal: 10,
    nfRefChaves: [],
    itensEstruturados: [],
  })),
}))
vi.mock('@/lib/documentos-v2/storage', () => ({
  enviarObjetoDocumento: vi.fn(async () => undefined),
  gerarCaminhoNotaFiscalRemessa: vi.fn(() => 'remessas/novo.xml'),
  gerarUrlDocumento: vi.fn(async () => 'https://example.com/signed'),
  removerObjetoDocumento: vi.fn(async () => undefined),
}))
vi.mock('@/lib/eventos-dominio/registrar', () => ({
  carregarContextoEventoNota: vi.fn(async () => ({})),
  registrarEventoDominio: vi.fn(async () => undefined),
}))
vi.mock('./auditoria', () => ({ registrarLog: vi.fn(async () => undefined) }))

import { removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { enviarNotaFiscalRemessa } from './nota-fiscal-remessa'

function arquivoXmlFake() {
  return new File(['<xml/>'], 'remessa.xml', { type: 'application/xml' })
}

describe('enviarNotaFiscalRemessa -- versionamento append-only (fix do bug real, evoluido pelo ticket de versionamento)', () => {
  beforeEach(() => {
    mocks.config = {
      notas_fiscais: { maybeSingle: { data: { id: 'nf-1', chave_acesso: null, cnpj_destinatario: '22222222222222', valor_bruto: 1000, quantidade_total: null, itens_estruturados: null, status: 'aprovada' }, error: null } },
    }
    mocks.rpcResponse = { data: null, error: null }
    mocks.calls = []
    mocks.rpcCalls = []
    vi.clearAllMocks()
  })

  it('chave nova (nenhuma remessa existente): entidade + versao 1 -- acumulado nao exclui nada, nenhum arquivo removido do Storage', async () => {
    mocks.config.nota_fiscal_remessas = {
      maybeSingle: { data: null, error: null }, // nenhuma remessa com esta chave ainda
      list: { data: [], error: null }, // acumulado vazio
    }
    mocks.rpcResponse = {
      data: { id: 'remessa-nova-1', status_validacao: 'REVISAO_MANUAL', nota_fiscal_venda_id: 'nf-1', aprovacao_documental: null, atualizacao: false, numero_versao: 1 },
      error: null,
    }

    const formData = new FormData()
    formData.set('arquivo', arquivoXmlFake())
    const resultado = await enviarNotaFiscalRemessa('nf-1', formData)

    expect(resultado.success).toBe(true)
    expect(resultado.data?.id).toBe('remessa-nova-1')
    // acumulado nao pode ter sido filtrado por neq -- nao existe remessa a excluir.
    expect(mocks.calls.some((c) => c.table === 'nota_fiscal_remessas' && c.method === 'neq')).toBe(false)
    // Nunca remove nenhum arquivo do Storage apos um envio com sucesso --
    // o historico append-only preserva tudo.
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('mesma chave, mesma venda (remessa existente): nova versao -- acumulado exclui a propria linha, e o arquivo da versao anterior NUNCA e removido do Storage', async () => {
    mocks.config.nota_fiscal_remessas = {
      maybeSingle: { data: { id: 'remessa-existente-1', nota_fiscal_venda_id: 'nf-1' }, error: null },
      list: { data: [{ quantidade_total: 5 }], error: null },
    }
    mocks.rpcResponse = {
      data: { id: 'remessa-existente-1', status_validacao: 'VALIDADA', nota_fiscal_venda_id: 'nf-1', aprovacao_documental: null, atualizacao: true, numero_versao: 2 },
      error: null,
    }

    const formData = new FormData()
    formData.set('arquivo', arquivoXmlFake())
    const resultado = await enviarNotaFiscalRemessa('nf-1', formData)

    expect(resultado.success).toBe(true)
    expect(resultado.data?.id).toBe('remessa-existente-1')
    expect(resultado.message).toContain('Versão 2')
    // A query de acumulado precisa excluir a propria remessa sendo substituida
    // -- senao uma remessa ja VALIDADA sendo corrigida contaria a quantidade
    // em dobro contra o saldo da venda.
    expect(mocks.calls.some((c) => c.table === 'nota_fiscal_remessas' && c.method === 'neq' && c.args[0] === 'id' && c.args[1] === 'remessa-existente-1')).toBe(true)
    // A versao anterior fica preservada em nota_fiscal_remessa_versoes
    // (append-only) -- a action nunca chama removerObjetoDocumento apos um
    // envio com sucesso, nem para a versao antiga nem para a nova.
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('nao chama a RPC com parametros diferentes para insercao vs nova versao -- a decisao (insert/update + numero_versao) e inteiramente da RPC pela chave', async () => {
    mocks.config.nota_fiscal_remessas = {
      maybeSingle: { data: { id: 'remessa-existente-1', nota_fiscal_venda_id: 'nf-1' }, error: null },
      list: { data: [], error: null },
    }
    mocks.rpcResponse = {
      data: { id: 'remessa-existente-1', status_validacao: 'VALIDADA', nota_fiscal_venda_id: 'nf-1', aprovacao_documental: null, atualizacao: true, numero_versao: 2 },
      error: null,
    }

    const formData = new FormData()
    formData.set('arquivo', arquivoXmlFake())
    await enviarNotaFiscalRemessa('nf-1', formData)

    expect(mocks.rpcCalls).toHaveLength(1)
    expect(mocks.rpcCalls[0].name).toBe('registrar_nota_fiscal_remessa')
    expect(mocks.rpcCalls[0].params).not.toHaveProperty('p_atualizacao')
    expect(mocks.rpcCalls[0].params).not.toHaveProperty('p_numero_versao')
  })
})
