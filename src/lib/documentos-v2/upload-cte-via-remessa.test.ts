import { describe, expect, it } from 'vitest'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { validarCteXmlContraNotaSeNecessario } from './upload'

const CHAVE_ORIGINAL_NO_FIXTURE = '41260500262371000575550010000131911937900007'
const CHAVE_CTE_FIXTURE = '41260532595140000227570010000005451000005452'

const cteXmlValido = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc versao="4.00">
  <CTe>
    <infCte Id="CTe${CHAVE_CTE_FIXTURE}" versao="4.00">
      <ide>
        <cUF>41</cUF>
        <CFOP>5353</CFOP>
        <natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>545</nCT>
        <dhEmi>2026-05-20T10:00:00-03:00</dhEmi>
        <tpAmb>2</tpAmb>
        <tpCTe>0</tpCTe>
        <tpServ>0</tpServ>
        <cMunIni>4106902</cMunIni>
        <xMunIni>CURITIBA</xMunIni>
        <UFIni>PR</UFIni>
        <cMunFim>3550308</cMunFim>
        <xMunFim>SAO PAULO</xMunFim>
        <UFFim>SP</UFFim>
        <modal>01</modal>
      </ide>
      <emit>
        <CNPJ>32595140000227</CNPJ>
        <IE>123456789</IE>
        <xNome>TRANSPORTADORA TESTE LTDA</xNome>
        <enderEmit><cMun>4106902</cMun><xMun>CURITIBA</xMun><UF>PR</UF></enderEmit>
      </emit>
      <rem>
        <CNPJ>00262371000575</CNPJ>
        <xNome>FORMAPLAN FORMAS PLANEJADAS</xNome>
        <enderReme><cMun>4106902</cMun><xMun>CURITIBA</xMun><UF>PR</UF></enderReme>
      </rem>
      <dest>
        <CNPJ>40439661000132</CNPJ>
        <xNome>SPE PAUPINA EMPREENDIMENTOS</xNome>
        <enderDest><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF></enderDest>
      </dest>
      <vPrest>
        <vTPrest>150.75</vTPrest>
        <vRec>150.75</vRec>
        <Comp><xNome>FRETE</xNome><vComp>150.75</vComp></Comp>
      </vPrest>
      <infCTeNorm>
        <infCarga>
          <vCarga>5974.00</vCarga>
          <proPred>formas metalicas</proPred>
          <infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1000.0000</qCarga></infQ>
        </infCarga>
        <infDoc><infNFe><chave>${CHAVE_ORIGINAL_NO_FIXTURE}</chave></infNFe></infDoc>
      </infCTeNorm>
    </infCte>
  </CTe>
  <protCTe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <chCTe>${CHAVE_CTE_FIXTURE}</chCTe>
      <dhRecbto>2026-05-20T10:05:00-03:00</dhRecbto>
      <nProt>141260000000000</nProt>
      <digVal>abc</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso do CT-e</xMotivo>
    </infProt>
  </protCTe>
</cteProc>`

// Bug real (ticket P0_Claude_CTe_Via_Remessa_Usando_Venda): o caminho
// efetivamente usado pela UI para enviar CT-e (`enviarDocumentoDaNota` ->
// `uploadDocumentoDaEntrega`/`uploadDocumentoDaNota` -> este modulo) nunca
// resolvia o vinculo VIA_REMESSA -- sempre comparava a chave/remetente do
// CT-e contra a NF DE VENDA, mesmo quando havia uma NF de remessa VALIDADA
// referenciada. `src/lib/actions/logistica.ts::enviarCte` ja fazia essa
// resolucao corretamente, mas nao e chamado por nenhuma UI (codigo morto) --
// por isso o bug persistia na pratica.

const CHAVE_VENDA = '1'.repeat(44)
const CHAVE_REMESSA_A = '2'.repeat(44)
const CHAVE_REMESSA_B = '3'.repeat(44)
const CNPJ_EMITENTE_VENDA = '11111111111111'
const CNPJ_EMITENTE_REMESSA = '22222222222222'
const CNPJ_SACADO = '33333333333333'
const CNPJ_TERCEIRO = '44444444444444'

type QueryResponse = { data: unknown; error: { message: string } | null }

function criarClienteFake(responses: Record<string, QueryResponse>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const client = {
    from(table: string) {
      calls.push({ table, method: 'from', args: [] })
      const resposta = responses[table] ?? { data: null, error: null }
      const query: Record<string, unknown> = {
        select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return query },
        eq(...args: unknown[]) { calls.push({ table, method: 'eq', args }); return query },
        in(...args: unknown[]) { calls.push({ table, method: 'in', args }); return query },
        maybeSingle() { calls.push({ table, method: 'maybeSingle', args: [] }); return Promise.resolve(resposta) },
        then(resolve: (value: QueryResponse) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(resposta).then(resolve, reject)
        },
      }
      return query
    },
  } as unknown as AppSupabaseClient
  return { client, calls }
}

function montarCteXml(input: { chaveReferenciada: string; cnpjRemetente: string; cnpjDestinatario: string; tomaCnpj?: string }) {
  let xml = cteXmlValido
    .replace(`<infDoc><infNFe><chave>${CHAVE_ORIGINAL_NO_FIXTURE}</chave></infNFe></infDoc>`, `<infDoc><infNFe><chave>${input.chaveReferenciada}</chave></infNFe></infDoc>`)
    .replace('<CNPJ>00262371000575</CNPJ>', `<CNPJ>${input.cnpjRemetente}</CNPJ>`)
    .replace('<CNPJ>40439661000132</CNPJ>', `<CNPJ>${input.cnpjDestinatario}</CNPJ>`)
  if (input.tomaCnpj) {
    xml = xml.replace('<ide>', `<ide><toma4><toma>4</toma><CNPJ>${input.tomaCnpj}</CNPJ><xNome>TOMADOR</xNome></toma4>`)
  }
  return new File([xml], 'cte.xml', { type: 'text/xml' })
}

const nfBase = {
  id: 'nf-1',
  cedente_id: 'cedente-1',
  cedente_fundo_id: 'cf-1',
  fundo_id: 'fundo-1',
  chave_acesso: CHAVE_VENDA,
  data_emissao: '2026-05-15',
  cnpj_emitente: CNPJ_EMITENTE_VENDA,
  razao_social_emitente: 'VENDA EMITENTE LTDA',
  cnpj_destinatario: CNPJ_SACADO,
  razao_social_destinatario: 'SACADO LTDA',
  valor_bruto: 5974,
  descricao_itens: null,
}

describe('validarCteXmlContraNotaSeNecessario -- vinculo VIA_REMESSA (fix do bug real)', () => {
  it('com remessa VALIDADA referenciada, compara a chave/remetente do CT-e contra a REMESSA, nunca contra a venda', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_A,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: CNPJ_SACADO,
      tomaCnpj: CNPJ_EMITENTE_VENDA,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      nota_fiscal_remessas: {
        data: [{
          id: 'remessa-1',
          chave_acesso: CHAVE_REMESSA_A,
          emitente_cnpj: CNPJ_EMITENTE_REMESSA,
          emitente_razao_social: 'REMESSA LOG LTDA',
          valor_total: 5974,
          quantidade_total: 1000,
          itens: [],
        }],
        error: null,
      },
      cedente_estabelecimentos: { data: [], error: null },
    })

    const resultado = await validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })

    expect(resultado).not.toBeNull()
    expect(resultado?.resultadoValidacaoCte.status).toBe('aprovado')
    expect(resultado?.resultadoValidacaoCte.validacoesPorNf[0]?.chaveNfe).toBe(CHAVE_REMESSA_A)
    expect(resultado?.resultadoValidacaoCte.checks.chave_nfe).toBe('ok')
    expect(resultado?.resultadoValidacaoCte.checks.remetente).toBe('ok')
    expect(resultado?.vinculoRemessa).toEqual({ nota_fiscal_id: 'nf-1', nota_fiscal_remessa_id: 'remessa-1' })
    expect(resultado?.tomadorClassificacao).toBe('ALLOW')
  })

  it('reproduz o bug se a resolucao de vinculo nao for aplicada: comparar contra a venda gera os bloqueios reais observados na UI', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_A,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: CNPJ_SACADO,
    })
    // Sem consultar a remessa (sem VIA_REMESSA), o comparador recebe a NF de
    // venda: nem a chave nem o remetente do CT-e batem contra ela -- exatamente
    // a mensagem do bug relatado ("O CT-e nao referencia a chave da NF-e
    // selecionada. O remetente do CT-e nao corresponde ao emitente da NF-e.").
    const { validarCteContraNfes, mensagemValidacaoCte } = await import('@/lib/logistica/validacao-cte-nfe')
    const { parseCteXml } = await import('@/lib/logistica/cte-parser')
    const parsed = await parseCteXml(arquivo)
    const resultado = validarCteContraNfes({ cte: parsed, nfs: [nfBase] })
    expect(resultado.status).toBe('rejeitado')
    expect(mensagemValidacaoCte(resultado)).toMatch(/nao referencia a chave/i)
    expect(mensagemValidacaoCte(resultado)).toMatch(/remetente do CT-e nao corresponde/i)
  })

  it('sem remessa (DIRETO_VENDA), continua comparando contra a NF de venda -- comportamento legado preservado', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_VENDA,
      cnpjRemetente: CNPJ_EMITENTE_VENDA,
      cnpjDestinatario: CNPJ_SACADO,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      nota_fiscal_remessas: { data: [], error: null },
    })

    const resultado = await validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })

    expect(resultado?.resultadoValidacaoCte.validacoesPorNf[0]?.chaveNfe).toBe(CHAVE_VENDA)
    expect(resultado?.vinculoRemessa).toBeNull()
    expect(resultado?.tomadorClassificacao).toBeNull()
  })

  it('remessa REVISAO_MANUAL/REJEITADA nunca aparece na fonte VALIDADA -- CT-e que a referencia cai sem vinculo (DENY por chave nao referenciada)', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_A,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: CNPJ_SACADO,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      // A query real filtra .eq('status_validacao','VALIDADA') -- uma
      // remessa REVISAO_MANUAL/REJEITADA simplesmente nao volta aqui.
      nota_fiscal_remessas: { data: [], error: null },
    })

    await expect(validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })).rejects.toThrow(/incompativel/i)
  })

  it('multiplas remessas VALIDADAs: seleciona a remessa cuja chave aparece no CT-e', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_B,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: CNPJ_SACADO,
      tomaCnpj: CNPJ_EMITENTE_VENDA,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      nota_fiscal_remessas: {
        data: [
          { id: 'remessa-1', chave_acesso: CHAVE_REMESSA_A, emitente_cnpj: CNPJ_EMITENTE_REMESSA, emitente_razao_social: 'A', valor_total: 100, quantidade_total: 10, itens: [] },
          { id: 'remessa-2', chave_acesso: CHAVE_REMESSA_B, emitente_cnpj: CNPJ_EMITENTE_REMESSA, emitente_razao_social: 'B', valor_total: 5974, quantidade_total: 1000, itens: [] },
        ],
        error: null,
      },
      cedente_estabelecimentos: { data: [], error: null },
    })

    const resultado = await validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })

    expect(resultado?.vinculoRemessa).toEqual({ nota_fiscal_id: 'nf-1', nota_fiscal_remessa_id: 'remessa-2' })
  })

  it('tomador terceiro nao autorizado (via remessa) bloqueia o envio -- fail-closed', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_A,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: CNPJ_SACADO,
      tomaCnpj: CNPJ_TERCEIRO,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      nota_fiscal_remessas: {
        data: [{ id: 'remessa-1', chave_acesso: CHAVE_REMESSA_A, emitente_cnpj: CNPJ_EMITENTE_REMESSA, emitente_razao_social: 'REMESSA', valor_total: 5974, quantidade_total: 1000, itens: [] }],
        error: null,
      },
      cedente_estabelecimentos: { data: [], error: null },
    })

    await expect(validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })).rejects.toThrow(/tomador nao foi autorizado/i)
  })

  it('destinatario divergente continua bloqueando mesmo via remessa (sacado precisa ser o mesmo)', async () => {
    const arquivo = montarCteXml({
      chaveReferenciada: CHAVE_REMESSA_A,
      cnpjRemetente: CNPJ_EMITENTE_REMESSA,
      cnpjDestinatario: '55555555555555',
      tomaCnpj: CNPJ_EMITENTE_VENDA,
    })
    const { client } = criarClienteFake({
      notas_fiscais: { data: nfBase, error: null },
      nota_fiscal_remessas: {
        data: [{ id: 'remessa-1', chave_acesso: CHAVE_REMESSA_A, emitente_cnpj: CNPJ_EMITENTE_REMESSA, emitente_razao_social: 'REMESSA', valor_total: 5974, quantidade_total: 1000, itens: [] }],
        error: null,
      },
      cedente_estabelecimentos: { data: [], error: null },
    })

    await expect(validarCteXmlContraNotaSeNecessario({
      notaFiscalId: 'nf-1',
      arquivo,
      codigoSnapshot: 'cte',
      tipoCodigo: 'cte_xml',
      client,
      actorRole: 'cedente',
    })).rejects.toThrow(/incompativel/i)
  })
})
