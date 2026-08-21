import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseNFeXML, type NfParsedItem } from '../nf-parser'
import { parseCteXml } from './cte-parser'
import {
  avaliarMatchingRemessaVenda,
  classificarTomadorCte,
  resolverVinculoCtePorNf,
  type ItemComparavel,
  type RemessaValidadaParaVinculoCte,
} from './nf-remessa-matching'
import { validarCteContraNfes, type NfeParaValidacaoCte } from './validacao-cte-nfe'

// Ticket P0_Claude_Ajustes_Finais_NF_Remessa, item 1: validar a cadeia com os
// XMLs reais do ticket (nao sinteticos). Os arquivos originais contem dados
// de cedentes/sacados reais e certificados X.509 -- por isso ficam SOMENTE
// locais (__fixtures__/reais/ esta no .gitignore, nunca commitado). Quando
// ausentes (outra maquina, CI), esta suite e pulada em vez de falhar; a
// cadeia real ja foi verificada ao vivo nesta sessao e o resultado esta
// documentado em docs/operacional/nf-remessa-lastro-logistico.md.
const FIXTURES = join(__dirname, '__fixtures__', 'reais')
const FIXTURES_DISPONIVEIS = existsSync(join(FIXTURES, '5576-venda.xml'))

function ler(nome: string): string {
  return readFileSync(join(FIXTURES, nome), 'utf8')
}

function itemComparavel(item: NfParsedItem): ItemComparavel {
  return { descricao: item.descricao, codigo: item.codigo || undefined, ncm: item.ncm || undefined, unidade: item.unidade || undefined, quantidade: item.quantidade }
}

describe.skipIf(!FIXTURES_DISPONIVEIS)('Cadeia real: NF Venda 5576 -> NF Remessa 35006 -> CT-e 489878 (XMLs reais do ticket)', () => {
  let venda: ReturnType<typeof parseNFeXML>
  let remessa: ReturnType<typeof parseNFeXML>

  beforeAll(() => {
    venda = parseNFeXML(ler('5576-venda.xml'))
    remessa = parseNFeXML(ler('5576-remessa.xml'))
  })

  it('venda real: chave, CNPJs, cProd/NCM/unidade/quantidade batem com o ticket', () => {
    expect(venda.chave_acesso).toBe('13260707312248000307550040000055761611390985')
    expect(venda.cnpj_emitente).toBe('07312248000307')
    expect(venda.cnpj_destinatario).toBe('23704498000179')
    expect(venda.itensEstruturados).toEqual([
      expect.objectContaining({ codigo: '003002', ncm: '38276100', unidade: 'KG', quantidade: 76.3 }),
    ])
  })

  it('remessa real: NFref aponta para a venda, emitente ZF LOG, mesmo cProd/NCM/unidade/quantidade da venda', () => {
    expect(remessa.chave_acesso).toBe('42260715644666000230550020000350061027265253')
    expect(remessa.numero_nf).toBe('35006')
    expect(remessa.serie).toBe('2')
    expect(remessa.cnpj_emitente).toBe('15644666000230')
    expect(remessa.razao_social_emitente).toMatch(/ZF LOG/i)
    expect(remessa.cnpj_destinatario).toBe('23704498000179')
    expect(remessa.nfRefChaves).toEqual([venda.chave_acesso])
    expect(remessa.itensEstruturados).toEqual([
      expect.objectContaining({ codigo: '003002', ncm: '38276100', unidade: 'KG', quantidade: 76.3 }),
    ])
  })

  it('matching venda<->remessa real -> VALIDADA, com produtos DETERMINISTICO (cProd casa) e quantidade verificavel', () => {
    const resultado = avaliarMatchingRemessaVenda({
      venda: {
        chave_acesso: venda.chave_acesso,
        cnpj_destinatario: venda.cnpj_destinatario,
        valor_bruto: venda.valor_bruto,
        quantidade_total: venda.quantidadeTotal,
        itens: venda.itensEstruturados.map(itemComparavel),
      },
      remessa: {
        nf_ref_chaves: remessa.nfRefChaves,
        destinatario_cnpj: remessa.cnpj_destinatario,
        valor_total: remessa.valor_bruto,
        quantidade_total: remessa.quantidadeTotal,
        itens: remessa.itensEstruturados.map(itemComparavel),
      },
      acumuladoAnterior: 0,
    })
    expect(resultado.status).toBe('VALIDADA')
    expect(resultado.referenciaNfVendaConfirmada).toBe(true)
    expect(resultado.produtosCompativeis).toBe('DETERMINISTICO')
    expect(resultado.motivos).toEqual([])
  })

  it('CT-e real: tomador RLX (via toma4), remetente ZF LOG, destinatario MJR, referencia a chave da REMESSA (nao a da venda)', async () => {
    const cte = await parseCteXml(ler('5576-cte.xml'))
    expect(cte.valido).toBe(true)
    expect(cte.chave_cte).toBe('42260772090442000934570010004898781010855801')
    expect(cte.numero).toBe('489878')
    expect(cte.cnpj_remetente).toBe('15644666000230')
    expect(cte.cnpj_destinatario).toBe('23704498000179')
    expect(cte.toma_codigo).toBe('4')
    expect(cte.cnpj_tomador).toBe('07312248000307')
    expect(cte.chaves_nfe_referenciadas).toEqual([remessa.chave_acesso])
    expect(cte.chaves_nfe_referenciadas).not.toContain(venda.chave_acesso)
  })

  it('cadeia completa: vinculo = VIA_REMESSA, tomador = ALLOW, validarCteContraNfes = aprovado', async () => {
    const cte = await parseCteXml(ler('5576-cte.xml'))
    const remessaValidada: RemessaValidadaParaVinculoCte = {
      id: 'remessa-real-35006',
      chave_acesso: remessa.chave_acesso,
      emitente_cnpj: remessa.cnpj_emitente,
      emitente_razao_social: remessa.razao_social_emitente,
      valor_total: remessa.valor_bruto,
      quantidade_total: remessa.quantidadeTotal,
      itens: remessa.itensEstruturados.map(itemComparavel),
    }

    const vinculo = resolverVinculoCtePorNf({
      vendaChaveAcesso: venda.chave_acesso,
      chavesReferenciadasNoCte: cte.chaves_nfe_referenciadas,
      remessasValidadasDaVenda: [remessaValidada],
    })
    expect(vinculo.tipoVinculo).toBe('VIA_REMESSA')
    if (vinculo.tipoVinculo !== 'VIA_REMESSA') throw new Error('esperado VIA_REMESSA')
    expect(vinculo.notaFiscalRemessaId).toBe('remessa-real-35006')

    const tomador = classificarTomadorCte({
      tomadorCnpj: cte.cnpj_tomador,
      emitenteVendaCnpj: venda.cnpj_emitente,
      cedenteId: 'cedente-rlx',
      estabelecimentosAprovadosDoCedente: [],
    })
    expect(tomador.classificacao).toBe('ALLOW')

    const nfEntry: NfeParaValidacaoCte = {
      id: 'nf-venda-5576',
      chave_acesso: vinculo.remessa.chave_acesso,
      data_emissao: venda.data_emissao,
      cnpj_emitente: vinculo.remessa.emitente_cnpj,
      razao_social_emitente: vinculo.remessa.emitente_razao_social,
      cnpj_destinatario: venda.cnpj_destinatario,
      razao_social_destinatario: venda.razao_social_destinatario,
      valor_bruto: vinculo.remessa.valor_total,
      quantidade_total: vinculo.remessa.quantidade_total,
      descricao_itens: vinculo.remessa.itens.map((item) => item.descricao).join('; '),
    }
    const resultadoCte = validarCteContraNfes({ cte, nfs: [nfEntry] })
    expect(resultadoCte.status).toBe('aprovado')
    expect(resultadoCte.bloqueios).toEqual([])
  })
})

describe.skipIf(!FIXTURES_DISPONIVEIS)('Regressao real (sem remessa): NF 149 -> CT-e direto (fluxo legado intacto)', () => {
  let venda: ReturnType<typeof parseNFeXML>

  beforeAll(() => {
    venda = parseNFeXML(ler('149-venda-direta.xml'))
  })

  it('venda real 149 nao tem NFref (nao e uma remessa)', () => {
    expect(venda.nfRefChaves).toEqual([])
  })

  it('CT-e real referencia a chave da PROPRIA venda -> DIRETO_VENDA', async () => {
    const cte = await parseCteXml(ler('149-cte-direto.xml'))
    expect(cte.valido).toBe(true)
    expect(cte.chaves_nfe_referenciadas).toEqual([venda.chave_acesso])

    const vinculo = resolverVinculoCtePorNf({
      vendaChaveAcesso: venda.chave_acesso,
      chavesReferenciadasNoCte: cte.chaves_nfe_referenciadas,
      remessasValidadasDaVenda: [],
    })
    expect(vinculo.tipoVinculo).toBe('DIRETO_VENDA')
  })

  it('toma3 codigo 0 (remetente) resolve o tomador sem remessa envolvida', async () => {
    const cte = await parseCteXml(ler('149-cte-direto.xml'))
    expect(cte.toma_codigo).toBe('0')
    expect(cte.cnpj_tomador).toBe(cte.cnpj_remetente)
  })
})
