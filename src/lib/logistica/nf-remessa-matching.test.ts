import { describe, expect, it } from 'vitest'
import {
  avaliarCompatibilidadeProdutos,
  avaliarMatchingRemessaVenda,
  classificarTomadorCte,
  resolverTipoVinculoCte,
  resolverVinculoCtePorNf,
  type RemessaParaMatching,
  type RemessaValidadaParaVinculoCte,
  type VendaParaMatchingRemessa,
} from './nf-remessa-matching'

// Cenario real do ticket P0/P1 NF de Remessa (dados dos XMLs reais em
// __fixtures__/reais/): venda RLX->MJR (NF 5576, cProd=003002,
// NCM=38276100, KG, 76.3), remessa ZF LOG->MJR (NF 35006, mesmo
// cProd/NCM/unidade/quantidade) referenciando a venda, CT-e 489878 com
// tomador RLX (07.312.248/0003-07).
const CHAVE_VENDA = '13260707312248000307550040000055761611390985'
const CNPJ_MJR = '23704498000179'
const CNPJ_RLX = '07312248000307'
const CNPJ_ZF_LOG = '15644666000230'
const CNPJ_TERCEIRO_ESTRANHO = '99999999000199'
const CPROD_REAL = '003002'
const NCM_REAL = '38276100'

function venda(overrides: Partial<VendaParaMatchingRemessa> = {}): VendaParaMatchingRemessa {
  return {
    chave_acesso: CHAVE_VENDA,
    cnpj_destinatario: CNPJ_MJR,
    valor_bruto: 3433.5,
    quantidade_total: 76.3,
    itens: [{ descricao: 'DAC R404 GB RLX 10,9KG ONU 3337 - CLASSE 2.2', codigo: CPROD_REAL, ncm: NCM_REAL, unidade: 'KG', quantidade: 76.3 }],
    ...overrides,
  }
}

function remessa(overrides: Partial<RemessaParaMatching> = {}): RemessaParaMatching {
  return {
    nf_ref_chaves: [CHAVE_VENDA],
    destinatario_cnpj: CNPJ_MJR,
    valor_total: 3433.5,
    quantidade_total: 76.3,
    itens: [{ descricao: 'DAC R404 GB RLX 10,9KG ONU 3337', codigo: CPROD_REAL, ncm: NCM_REAL, unidade: 'KG', quantidade: 76.3 }],
    ...overrides,
  }
}

describe('avaliarMatchingRemessaVenda', () => {
  it('teste 1/2: venda 5576 + remessa 35006 com NFref, destinatario e saldo corretos -> VALIDADA', () => {
    const resultado = avaliarMatchingRemessaVenda({ venda: venda(), remessa: remessa(), acumuladoAnterior: 0 })
    expect(resultado.status).toBe('VALIDADA')
    expect(resultado.referenciaNfVendaConfirmada).toBe(true)
  })

  it('teste 4: destinatario da remessa diverge do sacado da venda -> REJEITADA (DENY), mesmo com NFref correto', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda(),
      remessa: remessa({ destinatario_cnpj: CNPJ_TERCEIRO_ESTRANHO }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REJEITADA')
    expect(resultado.motivos.join(' ')).toMatch(/destinatario/i)
  })

  it('teste 5: remessa sem NFref/refNFe estruturado -> nao auto-ALLOW (REVISAO_MANUAL)', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda(),
      remessa: remessa({ nf_ref_chaves: [] }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REVISAO_MANUAL')
    expect(resultado.referenciaNfVendaConfirmada).toBe(false)
  })

  it('remessa com NFref apontando para outra NF (nao a venda em questao) -> REVISAO_MANUAL', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda(),
      remessa: remessa({ nf_ref_chaves: ['00000000000000000000000000000000000000000000'] }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REVISAO_MANUAL')
  })

  it('teste 6: remessa parcial dentro do saldo -> VALIDADA (ALLOW)', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda({ quantidade_total: 100, valor_bruto: 4500 }),
      remessa: remessa({ quantidade_total: 40, valor_total: 1800 }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('VALIDADA')
  })

  it('teste 7: duas remessas parciais acumuladas <= venda -> ambas VALIDADA', () => {
    const vendaCem = venda({ quantidade_total: 100, valor_bruto: 4500 })
    const primeira = avaliarMatchingRemessaVenda({
      venda: vendaCem,
      remessa: remessa({ quantidade_total: 40, valor_total: 1800 }),
      acumuladoAnterior: 0,
    })
    expect(primeira.status).toBe('VALIDADA')

    const segunda = avaliarMatchingRemessaVenda({
      venda: vendaCem,
      remessa: remessa({ quantidade_total: 60, valor_total: 2700 }),
      acumuladoAnterior: 40, // acumulado da primeira remessa, ja VALIDADA
    })
    expect(segunda.status).toBe('VALIDADA')
  })

  it('teste 8: acumulado > quantidade da venda -> REJEITADA (DENY)', () => {
    const vendaCem = venda({ quantidade_total: 100, valor_bruto: 4500 })
    const resultado = avaliarMatchingRemessaVenda({
      venda: vendaCem,
      remessa: remessa({ quantidade_total: 61, valor_total: 2700 }),
      acumuladoAnterior: 40, // 40 + 61 = 101 > 100
    })
    expect(resultado.status).toBe('REJEITADA')
    expect(resultado.motivos.join(' ')).toMatch(/quantidade/i)
  })

  it('teste 14 (garantia de dominio): o resultado de matching nunca produz um campo de titulo/parcela/operacao -- e apenas status+motivos', () => {
    const resultado = avaliarMatchingRemessaVenda({ venda: venda(), remessa: remessa(), acumuladoAnterior: 0 })
    expect(Object.keys(resultado).sort()).toEqual(['motivos', 'produtosCompativeis', 'referenciaNfVendaConfirmada', 'status'])
  })

  it('ajuste final regra 3: venda sem quantidade estruturada (cadastro manual/PDF) -> REVISAO_MANUAL, NUNCA VALIDADA so porque o valor financeiro coincide', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda({ quantidade_total: null, itens: [] }),
      remessa: remessa({ quantidade_total: 30 }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REVISAO_MANUAL')
    expect(resultado.motivos.join(' ')).toMatch(/quantidade.*nao verificavel/i)
  })

  it('ajuste final regra 3: remessa sem quantidade estruturada -> REVISAO_MANUAL mesmo com a venda tendo quantidade', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda(),
      remessa: remessa({ quantidade_total: null, itens: [] }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REVISAO_MANUAL')
  })

  it('produtos incompativeis por cProd/NCM (deterministico) com NFref e destinatario corretos -> REVISAO_MANUAL, nunca REJEITADA', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda({ itens: [{ descricao: 'PARAFUSO SEXTAVADO INOX', codigo: '999', ncm: '73181500', unidade: 'UN', quantidade: 76.3 }] }),
      remessa: remessa({ itens: [{ descricao: 'CABO DE ACO GALVANIZADO', codigo: '888', ncm: '73121000', unidade: 'UN', quantidade: 76.3 }] }),
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('REVISAO_MANUAL')
    expect(resultado.produtosCompativeis).toBe('INCOMPATIVEL')
  })

  it('produtos comparaveis apenas por heuristica de descricao (sem cProd/NCM/unidade em comum) -> nunca VALIDADA, mesmo com NFref/destinatario/quantidade corretos', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: venda({ itens: [{ descricao: 'DAC R404 GB RLX 10,9KG', quantidade: 76.3 }] }),
      remessa: remessa({ itens: [{ descricao: 'DAC R404 GB - REMESSA PARCIAL', quantidade: 76.3 }] }),
      acumuladoAnterior: 0,
    })
    expect(resultado.produtosCompativeis).toBe('HEURISTICO')
    expect(resultado.status).toBe('REVISAO_MANUAL')
  })
})

describe('avaliarCompatibilidadeProdutos (regra 4 dos ajustes finais: deterministico > heuristico)', () => {
  it('cProd igual -> DETERMINISTICO, mesmo com descricoes diferentes e NCM ausente', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'Produto A', codigo: CPROD_REAL, quantidade: 1 }],
      [{ descricao: 'Nome completamente diferente', codigo: CPROD_REAL, quantidade: 1 }],
    )).toBe('DETERMINISTICO')
  })

  it('cProd presente mas divergente -> INCOMPATIVEL (nao cai para NCM/heuristica quando cProd esta disponivel nos dois lados)', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'Produto A', codigo: '111', ncm: NCM_REAL, quantidade: 1 }],
      [{ descricao: 'Produto A', codigo: '222', ncm: NCM_REAL, quantidade: 1 }],
    )).toBe('INCOMPATIVEL')
  })

  it('sem cProd disponivel, NCM igual -> DETERMINISTICO', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'Produto A', ncm: NCM_REAL, quantidade: 1 }],
      [{ descricao: 'Produto B', ncm: NCM_REAL, quantidade: 1 }],
    )).toBe('DETERMINISTICO')
  })

  it('sem cProd/NCM, unidade+quantidade iguais -> DETERMINISTICO', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'Produto A', unidade: 'KG', quantidade: 76.3 }],
      [{ descricao: 'Produto B totalmente diferente', unidade: 'kg', quantidade: 76.3 }],
    )).toBe('DETERMINISTICO')
  })

  it('sem cProd/NCM, unidade igual mas quantidade diferente -> INCOMPATIVEL', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'Produto A', unidade: 'KG', quantidade: 76.3 }],
      [{ descricao: 'Produto A', unidade: 'KG', quantidade: 10 }],
    )).toBe('INCOMPATIVEL')
  })

  it('sem nenhum campo estruturado, so descricao -> HEURISTICO (nunca DETERMINISTICO)', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'DAC R404 GB RLX 10,9KG', quantidade: 1 }],
      [{ descricao: 'DAC R404 GB - REMESSA PARCIAL', quantidade: 1 }],
    )).toBe('HEURISTICO')
  })

  it('sem nenhum campo estruturado e sem overlap de descricao -> INCOMPATIVEL', () => {
    expect(avaliarCompatibilidadeProdutos(
      [{ descricao: 'PARAFUSO SEXTAVADO INOX', quantidade: 1 }],
      [{ descricao: 'CABO DE ACO GALVANIZADO', quantidade: 1 }],
    )).toBe('INCOMPATIVEL')
  })

  it('retorna NAO_VERIFICAVEL quando um dos lados nao tem itens', () => {
    expect(avaliarCompatibilidadeProdutos([], [{ descricao: 'X', quantidade: 1 }])).toBe('NAO_VERIFICAVEL')
  })

  it('caso real do ticket: cProd=003002 identico entre venda e remessa -> DETERMINISTICO', () => {
    expect(avaliarCompatibilidadeProdutos(venda().itens, remessa().itens)).toBe('DETERMINISTICO')
  })
})

describe('classificarTomadorCte (regra 6)', () => {
  const base = { emitenteVendaCnpj: CNPJ_RLX, cedenteId: 'cedente-1', estabelecimentosAprovadosDoCedente: [] as Array<{ cnpj: string; cedente_id: string }> }

  it('teste 9: tomador exato (emitente da venda) -> ALLOW', () => {
    const resultado = classificarTomadorCte({ ...base, tomadorCnpj: CNPJ_RLX })
    expect(resultado.classificacao).toBe('ALLOW')
  })

  it('teste 10: outro estabelecimento aprovado do mesmo Cedente -> REVISAO_MANUAL', () => {
    const cnpjFilial = '07312248000191'
    const resultado = classificarTomadorCte({
      ...base,
      tomadorCnpj: cnpjFilial,
      estabelecimentosAprovadosDoCedente: [{ cnpj: cnpjFilial, cedente_id: 'cedente-1' }],
    })
    expect(resultado.classificacao).toBe('REVISAO_MANUAL')
  })

  it('teste 11: terceiro estranho -> DENY', () => {
    const resultado = classificarTomadorCte({ ...base, tomadorCnpj: CNPJ_TERCEIRO_ESTRANHO })
    expect(resultado.classificacao).toBe('DENY')
  })

  it('teste 15 (cross-fund/cross-cedente): estabelecimento aprovado de OUTRO cedente nao vale como REVISAO_MANUAL -> DENY', () => {
    const cnpjFilialDeOutroCedente = '07312248000191'
    const resultado = classificarTomadorCte({
      ...base,
      tomadorCnpj: cnpjFilialDeOutroCedente,
      estabelecimentosAprovadosDoCedente: [{ cnpj: cnpjFilialDeOutroCedente, cedente_id: 'cedente-DIFERENTE' }],
    })
    expect(resultado.classificacao).toBe('DENY')
  })

  it('tomador nao identificavel no XML (toma3 codigo 1/2) -> DENY (fail-closed, nunca ALLOW por omissao)', () => {
    const resultado = classificarTomadorCte({ ...base, tomadorCnpj: null })
    expect(resultado.classificacao).toBe('DENY')
  })
})

describe('resolverTipoVinculoCte (regra 5)', () => {
  it('teste 3: sem remessa, CT-e referencia a venda diretamente -> DIRETO_VENDA (fluxo atual preservado)', () => {
    expect(resolverTipoVinculoCte({ chaveReferenciadaEhDaVenda: true, chaveReferenciadaEhDeRemessaValidada: false })).toBe('DIRETO_VENDA')
  })

  it('teste 2: com remessa validada, CT-e referencia a remessa -> VIA_REMESSA', () => {
    expect(resolverTipoVinculoCte({ chaveReferenciadaEhDaVenda: false, chaveReferenciadaEhDeRemessaValidada: true })).toBe('VIA_REMESSA')
  })

  it('teste 13: CT-e nao referencia nem a venda nem uma remessa validada -> null (nao satisfaz vinculo)', () => {
    expect(resolverTipoVinculoCte({ chaveReferenciadaEhDaVenda: false, chaveReferenciadaEhDeRemessaValidada: false })).toBeNull()
  })
})

const CHAVE_REMESSA = '42260715644666000230550020000350061027265253'

function remessaValidadaFixture(overrides: Partial<RemessaValidadaParaVinculoCte> = {}): RemessaValidadaParaVinculoCte {
  return {
    id: 'remessa-1',
    chave_acesso: CHAVE_REMESSA,
    emitente_cnpj: CNPJ_ZF_LOG,
    emitente_razao_social: 'ZF LOG',
    valor_total: 3433.5,
    quantidade_total: 76.3,
    itens: [{ descricao: 'DAC R404 GB RLX', quantidade: 76.3 }],
    ...overrides,
  }
}

describe('resolverVinculoCtePorNf', () => {
  it('teste 3: sem remessa, CT-e referencia a chave da venda -> DIRETO_VENDA', () => {
    const resultado = resolverVinculoCtePorNf({
      vendaChaveAcesso: CHAVE_VENDA,
      chavesReferenciadasNoCte: [CHAVE_VENDA],
      remessasValidadasDaVenda: [],
    })
    expect(resultado.tipoVinculo).toBe('DIRETO_VENDA')
  })

  it('teste 2: CT-e referencia a chave de uma remessa VALIDADA da venda -> VIA_REMESSA com a remessa resolvida', () => {
    const resultado = resolverVinculoCtePorNf({
      vendaChaveAcesso: CHAVE_VENDA,
      chavesReferenciadasNoCte: [CHAVE_REMESSA],
      remessasValidadasDaVenda: [remessaValidadaFixture()],
    })
    expect(resultado.tipoVinculo).toBe('VIA_REMESSA')
    if (resultado.tipoVinculo === 'VIA_REMESSA') {
      expect(resultado.notaFiscalRemessaId).toBe('remessa-1')
      expect(resultado.remessa.emitente_cnpj).toBe(CNPJ_ZF_LOG)
    }
  })

  it('CT-e referencia uma chave que nao e nem a venda nem uma remessa validada -> tipoVinculo null (bloqueio existente de nfe_nao_referenciada se aplica)', () => {
    const resultado = resolverVinculoCtePorNf({
      vendaChaveAcesso: CHAVE_VENDA,
      chavesReferenciadasNoCte: ['00000000000000000000000000000000000000000000'],
      remessasValidadasDaVenda: [remessaValidadaFixture()],
    })
    expect(resultado.tipoVinculo).toBeNull()
  })

  it('DIRETO_VENDA tem precedencia quando o CT-e referencia a propria chave da venda mesmo havendo remessas validadas', () => {
    const resultado = resolverVinculoCtePorNf({
      vendaChaveAcesso: CHAVE_VENDA,
      chavesReferenciadasNoCte: [CHAVE_VENDA, CHAVE_REMESSA],
      remessasValidadasDaVenda: [remessaValidadaFixture()],
    })
    expect(resultado.tipoVinculo).toBe('DIRETO_VENDA')
  })
})
