import { describe, expect, it } from 'vitest'
import { parseCteXml } from './cte-parser'
import { chaveNfeFixture, cteXmlValido } from './cte-parser.test'
import { validarCteContraNfes, type NfeParaValidacaoCte } from './validacao-cte-nfe'

const nfBase: NfeParaValidacaoCte = {
  id: 'nf-1',
  chave_acesso: chaveNfeFixture,
  data_emissao: '2026-05-18',
  cnpj_emitente: '00.262.371/0005-75',
  razao_social_emitente: 'FORMAPLAN FORMAS PLANEJADAS',
  cnpj_destinatario: '40.439.661/0001-32',
  razao_social_destinatario: 'SPE PAUPINA EMPREENDIMENTOS',
  valor_bruto: 5974,
  descricao_itens: 'FORMAS METALICAS (Qtd: 1000.0000, R$ 5974.00)',
  ambiente: '2',
  municipio_emitente_codigo: '4106902',
  uf_emitente: 'PR',
  municipio_destinatario_codigo: '3550308',
  uf_destinatario: 'SP',
  quantidade_total: 1000,
}

async function validar(xml: string, nf: NfeParaValidacaoCte | NfeParaValidacaoCte[] = nfBase) {
  const cte = await parseCteXml(xml)
  return validarCteContraNfes({ cte, nfs: Array.isArray(nf) ? nf : [nf] })
}

describe('validarCteContraNfes', () => {
  it('aprova CT-e correto contra NF-e vinculada', async () => {
    const result = await validar(cteXmlValido)

    expect(result.status).toBe('aprovado')
    expect(result.bloqueios).toHaveLength(0)
    expect(result.checks.chave_nfe).toBe('ok')
    expect(result.checks.valor_carga).toBe('ok')
  })

  it('bloqueia CT-e que nao referencia a chave da NF-e selecionada', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, chave_acesso: '41260500262371000575550010000131911937900008' })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'nfe_nao_referenciada')).toBe(true)
  })

  it('bloqueia remetente diferente do emitente da NF-e', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, cnpj_emitente: '11111111000191' })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'remetente_divergente')).toBe(true)
  })

  it('bloqueia destinatario divergente', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, cnpj_destinatario: '22222222000192' })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'destinatario_divergente')).toBe(true)
  })

  it('bloqueia valor da carga acima da tolerancia', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, valor_bruto: 5000 })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'valor_carga_divergente')).toBe(true)
  })

  it('bloqueia quantidade divergente quando ambos os documentos possuem quantidade comparavel', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, quantidade_total: 999 })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'quantidade_divergente')).toBe(true)
  })

  it('bloqueia CT-e nao autorizado', async () => {
    const result = await validar(cteXmlValido.replace('<cStat>100</cStat>', '<cStat>110</cStat>'))

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'cte_nao_autorizado')).toBe(true)
  })

  it('bloqueia ambiente fiscal divergente', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, ambiente: '1' })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'ambiente_divergente')).toBe(true)
  })

  it('bloqueia origem e destino divergentes quando existem dados estruturados', async () => {
    const result = await validar(cteXmlValido, { ...nfBase, uf_emitente: 'SC', uf_destinatario: 'RJ' })

    expect(result.status).toBe('rejeitado')
    expect(result.bloqueios.some((b) => b.codigo === 'origem_uf_divergente')).toBe(true)
    expect(result.bloqueios.some((b) => b.codigo === 'destino_uf_divergente')).toBe(true)
  })

  it('classifica como parcial quando o CT-e referencia NFs ainda nao cadastradas', async () => {
    const outraChave = '41260500262371000575550010000131921937900004'
    const xml = cteXmlValido.replace('</infDoc>', `<infNFe><chave>${outraChave}</chave></infNFe></infDoc>`)
    const result = await validar(xml)

    expect(result.status).toBe('validacao_parcial')
    expect(result.chavesNfeNaoCadastradas).toEqual([outraChave])
  })
})
