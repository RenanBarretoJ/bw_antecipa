import { describe, expect, it } from 'vitest'
import { parseFiscalFile } from '@/lib/fiscal-intake/parse.server'
import { canonicalSchema } from '../canonical/schema'
import { extractNationalXml } from './adapter'
import { canonicalFields, loadStructuralCorpus, valueAt } from './corpus'
import { NATIONAL_NS, XML_LIMITS } from './xml-tree'

const corpus = loadStructuralCorpus()
const sample = corpus[0].xml
function recognized(xml: string) {
  const result = extractNationalXml(xml)
  if (result.resultado !== 'RECONHECIDO') throw new Error(`Fixture não reconhecida: ${result.codigo}`)
  return result
}

describe('adaptador isolado XML Nacional', () => {
  it.each(corpus)('extrai expectativas independentes: $entry.id', ({ xml, expected, entry }) => {
    const result = recognized(xml)
    expect(result.documento.natureza_documento).toBe(expected.natureza_documento)
    expect(canonicalSchema.safeParse(result.documento).success).toBe(true)
    for (const [key, value] of Object.entries(expected.campos)) expect(valueAt(result.documento, key), key).toMatchObject(value)
    for (const alert of expected.alertas) expect(result.documento.alertas_documento).toContain(alert)
    if (entry.id !== 'campo-invalido') expect(result.problemas).toEqual([])
    for (const field of canonicalFields(result.documento)) {
      const source = valueAt(result.documento, field.caminho)
      if (field.estado === 'PRESENTE') expect(source).toMatchObject({ confianca: null, evidencias: [{ documento_sha256: entry.sha256 }] })
    }
    expect(result.documento.verificacao.elegibilidade).toBe('NAO_AVALIADA')
  })
  it('resolve namespaces prefixados sem depender do prefixo literal', () => {
    const prefixed = sample.replace(/<(\/?)(?!ds:)([A-Za-z][\w]*)(?=[\s/>])/g, '<$1n:$2')
      .replace(`xmlns="${NATIONAL_NS}"`, `xmlns:n="${NATIONAL_NS}"`)
    expect(canonicalFields(recognized(prefixed).documento)).toEqual(canonicalFields(recognized(sample).documento))
  })
  it('não trata cStat=100 como autorização nem atividade atual', () => {
    const doc = recognized(sample).documento
    expect(doc.identificacao.codigo_status_geracao.valor).toBe('100')
    expect(doc.identificacao.situacao.valor).toBe('DESCONHECIDA')
    expect(doc.verificacao.assinatura).toBe('NAO_EXECUTADA')
  })
  it('preserva data/hora de processamento separada da emissão da DPS e não inventa vencimento', () => {
    const doc = recognized(sample).documento
    expect(doc.identificacao.emissao.estado).toBe('AUSENTE')
    expect(doc.identificacao.processamento.valor).not.toBe(doc.identificacao.dps.emissao.valor)
    expect(doc.vencimento.estado).toBe('AUSENTE')
  })
  it('mantém líquido documental divergente sem sobrescrever com cálculo', () => {
    const doc = recognized(corpus.find(c => c.entry.id === 'divergencia-liquido')!.xml).documento
    expect(doc.totais.liquido_documental.valor).toBe('999.00')
    expect(doc.totais.liquido_derivado.valor).toBe('1000.00')
  })
  it('trata chave da NFS-e com 50 dígitos separadamente da NF-e', () => {
    expect(recognized(sample).documento.identificacao.chave_acesso.valor).toHaveLength(50)
  })
  it.each([
    ['DOCTYPE', '<!DOCTYPE NFSe [<!ENTITY x SYSTEM "file:///private">]>'+sample, 'XML_DTD_FORBIDDEN'],
    ['ENTITY', '<!ENTITY x "boom">'+sample, 'XML_DTD_FORBIDDEN'],
    ['entidade desconhecida', sample.replace('SAO PAULO', '&secret;'), 'XML_MALFORMED'],
    ['tag aberta', sample.replace('</NFSe>', ''), 'XML_MALFORMED'],
    ['identificador duplicado', sample.replace('<nNFSe>900001</nNFSe>', '<nNFSe>900001</nNFSe><nNFSe>2</nNFSe>'), 'XML_AMBIGUOUS_FIELD'],
    ['namespace injetado', sample.replace('<nNFSe>', '<nNFSe xmlns="urn:evil">'), 'XML_NAMESPACE_CONFLICT'],
    ['identidades conflitantes', sample.replace('<CNPJ>12345678000195</CNPJ>', '<CNPJ>12345678000195</CNPJ><CPF>12345678909</CPF>'), 'XML_PERSON_ID_CHOICE'],
    ['encoding não UTF8', sample.replace("encoding='utf-8'", "encoding='ISO-8859-1'"), 'XML_ENCODING_VERSION_UNSUPPORTED'],
    ['XML 1.1', sample.replace("version='1.0'", "version='1.1'"), 'XML_ENCODING_VERSION_UNSUPPORTED'],
  ])('falha de forma fechada: %s', (_label, xml, code) => {
    expect(extractNationalXml(xml)).toEqual({ resultado: 'INVALIDO', codigo: code })
  })
  it('rejeita excesso de profundidade antes de construir toda a árvore', () => {
    expect(extractNationalXml('<a>'.repeat(XML_LIMITS.depth+1)+'</a>'.repeat(XML_LIMITS.depth+1))).toMatchObject({ codigo: 'XML_LIMIT' })
  })
  it('rejeita arquivo acima do limite existente de upload', () => {
    expect(extractNationalXml(' '.repeat(XML_LIMITS.bytes+1))).toMatchObject({ codigo: 'XML_SIZE' })
  })
  it('limita quantidade de nós e atributos sem resolver recursos externos', () => {
    expect(extractNationalXml('<a>'+'<b/>'.repeat(XML_LIMITS.nodes)+'</a>')).toMatchObject({ codigo: 'XML_LIMIT' })
    expect(extractNationalXml('<a '+Array.from({length: XML_LIMITS.attributes+1}, (_,i) => `x${i}="1"`).join(' ')+'/>')).toMatchObject({ codigo: 'XML_LIMIT' })
  })
  it('aceita bytes UTF8 e preserva seu hash, inclusive o BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(sample)])
    const result = extractNationalXml(bytes)
    expect(result.resultado).toBe('RECONHECIDO')
    if (result.resultado === 'RECONHECIDO') expect(result.documento.originais[0].sha256).not.toBe(recognized(sample).documento.originais[0].sha256)
    expect(extractNationalXml(Buffer.from([0xc3, 0x28]))).toMatchObject({ codigo: 'XML_UTF8_INVALID' })
  })
  it('sinaliza inconsistência de chave e identidade sem alterar fatos documentais', () => {
    const result = recognized(sample.replace('<nNFSe>900001</nNFSe>', '<nNFSe>900002</nNFSe>'))
    expect(result.documento.identificacao.numero_nfse.valor).toBe('900002')
    expect(result.problemas).toContain('CHAVE_NFSE_DIVERGE_DO_NUMERO')
  })
  it('valida cStat conforme a versão, sem atribuir efeito fiscal', () => {
    expect(recognized(sample.replace('<cStat>100</cStat>', '<cStat>101</cStat>')).documento.identificacao.codigo_status_geracao.estado).toBe('PRESENTE')
    const version101 = corpus.find(c => c.entry.id === 'nfse-1-01')!.xml
    expect(recognized(version101.replace('<cStat>100</cStat>', '<cStat>101</cStat>')).documento.identificacao.codigo_status_geracao.estado).toBe('INVALIDO')
  })
  it('informa folhas não mapeadas e não usa ausência como zero', () => {
    const doc = recognized(sample).documento
    expect(doc.campos_nao_mapeados.some(field => field.caminho.includes('indTotTrib'))).toBe(true)
    expect(doc.totais.valor_pis.estado).toBe('AUSENTE')
  })
  it('informa campos obrigatórios ausentes sem inventar seus valores', () => {
    const result = recognized(sample.replace('<nNFSe>900001</nNFSe>', ''))
    expect(result.documento.identificacao.numero_nfse.estado).toBe('AUSENTE')
    expect(result.problemas).toContain('CAMPO_OBRIGATORIO_AUSENTE:nNFSe')
  })
  it('preserva isolamento: eventos e DPS continuam bloqueados no dispatcher operacional', async () => {
    for (const row of corpus.filter(c => c.expected.natureza_documento !== 'NFSE')) {
      await expect(parseFiscalFile(new File([row.xml], row.entry.arquivo))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
    }
  })
  it('não confunde namespace municipal nem XML em versão desconhecida', () => {
    expect(extractNationalXml(sample.replaceAll(NATIONAL_NS, 'urn:municipal'))).toMatchObject({ resultado: 'INCOMPATIVEL' })
    expect(extractNationalXml(sample.replace('versao="1.00"', 'versao="9.99"'))).toMatchObject({ codigo: 'VERSAO_NAO_SUPORTADA' })
  })
  it('rejeita CPF inválido e data inexistente sem perder o original', () => {
    const xml = sample.replace('2026-10-09</dCompet>', '2026-02-30</dCompet>').replace('<CNPJ>12345678000195</CNPJ>', '<CPF>11111111111</CPF>')
    const doc = recognized(xml).documento
    expect(doc.identificacao.competencia).toMatchObject({ estado: 'INVALIDO', original: '2026-02-30', valor: null })
    expect(doc.prestador.cpf).toMatchObject({ estado: 'INVALIDO', original: '11111111111', valor: null })
  })
  it('mantém a NF-e no dispatcher existente e sua chave estritamente de 44 dígitos', async () => {
    const cnpj = '12345678000195'
    const key = '352610'+cnpj+'550010000001231123456789'
    expect(key).toHaveLength(44)
    const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><serie>1</serie><nNF>123</nNF><dhEmi>2026-10-09T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ><xNome>QA</xNome></emit><dest><CNPJ>${cnpj}</CNPJ><xNome>QA</xNome></dest><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`
    expect(extractNationalXml(xml)).toMatchObject({ resultado: 'INCOMPATIVEL' })
    await expect(parseFiscalFile(new File([xml], 'nfe.xml'))).resolves.toMatchObject({ documentType: 'NFE', key })
    await expect(parseFiscalFile(new File([xml.replace(key, key+'000000')], 'nfe.xml'))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
    await expect(parseFiscalFile(new File([sample], 'nacional.xml'))).rejects.toMatchObject({ code: 'MISSING_IDENTITY' })
  })
})
