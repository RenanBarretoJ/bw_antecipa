import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { canonicalSchema } from '../../../../src/lib/nfse/canonical/schema'
import { canonicalFields, loadStructuralCorpus } from '../../../../src/lib/nfse/xml-nacional/corpus'

vi.mock('../../../../src/lib/nfse/xml-nacional/xml-tree', async importOriginal => {
  const original = /** @type {typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree')} */ (await importOriginal())
  if (process.env.BW_NFSE_E25_PARSER !== 'sax') return original
  const { parseWithSax } = await import('./sax-tree.mjs')
  /** @type {typeof original.parseXmlSafely} */
  const parseXmlSafely = xml => parseWithSax(xml, {
    limits: original.XML_LIMITS, ErrorClass: original.NationalXmlError,
  })
  return { ...original, parseXmlSafely }
})
import { extractNationalXml } from '../../../../src/lib/nfse/xml-nacional/adapter'
import { XML_LIMITS } from '../../../../src/lib/nfse/xml-nacional/xml-tree'

const parserName = process.env.BW_NFSE_E25_PARSER === 'sax' ? 'sax' : 'saxes'
const directory = process.env.BW_NFSE_E25_PRIVATE_DIR
const corpus = loadStructuralCorpus()
const sample = corpus[0].xml
const candidates = [
  { id: 'namespace-prefixado', xml: sample.replace(/<(\/?)(?!ds:)([A-Za-z][\w]*)(?=[\s/>])/g, '<$1n:$2')
    .replace('xmlns="http://www.sped.fazenda.gov.br/nfse"', 'xmlns:n="http://www.sped.fazenda.gov.br/nfse"'), accepted: true },
  { id: 'versao-desconhecida', xml: sample.replace('versao="1.00"', 'versao="9.99"'), accepted: false },
  { id: 'dtd-xxe-arquivo', xml: '<!DOCTYPE NFSe [<!ENTITY x SYSTEM "file:///not-authorized">]>'+sample, accepted: false, expectedCode: 'XML_DTD_FORBIDDEN' },
  { id: 'dtd-xxe-rede', xml: '<!DOCTYPE NFSe SYSTEM "https://invalid.example/xxe">'+sample, accepted: false, expectedCode: 'XML_DTD_FORBIDDEN' },
  { id: 'entidade-expansao', xml: '<!DOCTYPE NFSe [<!ENTITY a "x"><!ENTITY b "&a;&a;&a;">]>'+sample, accepted: false, expectedCode: 'XML_DTD_FORBIDDEN' },
  { id: 'entidade-desconhecida', xml: sample.replace('SAO PAULO', '&unknown;'), accepted: false },
  { id: 'entidade-html-sem-declaracao', xml: sample.replace('SAO PAULO', '&copy;'), accepted: false },
  { id: 'tag-nao-fechada', xml: sample.replace('</NFSe>', ''), accepted: false },
  { id: 'atributo-duplicado', xml: sample.replace('versao="1.00"', 'versao="1.00" versao="1.00"'), accepted: false },
  { id: 'tag-campo-duplicado', xml: sample.replace('<nNFSe>900001</nNFSe>', '<nNFSe>900001</nNFSe><nNFSe>2</nNFSe>'), accepted: false },
  { id: 'namespace-injetado', xml: sample.replace('<nNFSe>', '<nNFSe xmlns="urn:evil">'), accepted: false },
  { id: 'identidade-ambigua', xml: sample.replace('<CNPJ>12345678000195</CNPJ>', '<CNPJ>12345678000195</CNPJ><CPF>12345678909</CPF>'), accepted: false },
  { id: 'encoding-nao-utf8', xml: sample.replace("encoding='utf-8'", "encoding='ISO-8859-1'"), accepted: false },
  { id: 'xml-versao-1-1', xml: sample.replace("version='1.0'", "version='1.1'"), accepted: false },
  { id: 'texto-fora-da-raiz', xml: 'unexpected'+sample, accepted: false },
  { id: 'profundidade-excedida', xml: '<a>'.repeat(XML_LIMITS.depth+1)+'</a>'.repeat(XML_LIMITS.depth+1), accepted: false, expectedCode: 'XML_LIMIT' },
  { id: 'nos-excedidos', xml: '<a>'+'<b/>'.repeat(XML_LIMITS.nodes)+'</a>', accepted: false, expectedCode: 'XML_LIMIT' },
  { id: 'atributos-excedidos', xml: '<a '+Array.from({length: XML_LIMITS.attributes+1}, (_, i) => `x${i}="1"`).join(' ')+'/>', accepted: false, expectedCode: 'XML_LIMIT' },
  { id: 'bytes-excedidos', xml: sample+' '.repeat(XML_LIMITS.bytes), accepted: false, expectedCode: 'XML_SIZE' },
  { id: 'nome-invalido', xml: sample.replace('<nNFSe>', '<1nNFSe>').replace('</nNFSe>', '</1nNFSe>'), accepted: false },
  { id: 'controle-xml-invalido', xml: sample.replace('SAO PAULO', 'SAO\u0001PAULO'), accepted: false },
  { id: 'declaracao-duplicada', xml: "<?xml version='1.0' encoding='utf-8'?>"+sample, accepted: false },
]

/** @param {string} xml */
function observation(xml) {
  const start = performance.now()
  const cpu = process.cpuUsage()
  const result = extractNationalXml(xml)
  const usage = process.cpuUsage(cpu)
  return { result, wall_ms: performance.now()-start, cpu_us: usage.user+usage.system }
}

describe(`PoC isolada E2.5: ${parserName}`, () => {
  it('compara fatos documentais e registra contrato, rejeições e evidências', () => {
    const structural = corpus.map(({ entry, xml, expected }) => {
      const measured = observation(xml)
      expect(measured.result.resultado).toBe('RECONHECIDO')
      if (measured.result.resultado !== 'RECONHECIDO') throw new Error('CORPUS_NOT_RECOGNIZED')
      expect(canonicalSchema.safeParse(measured.result.documento).success).toBe(true)
      return { id: entry.id, classification: entry.origem, expected, ...measured }
    })
    const security = candidates.map(({ id, xml, accepted, expectedCode }) => {
      const measured = observation(xml)
      // Record failures honestly; a maintained parser is not assumed to satisfy this gate.
      return { id, expected_accepted: accepted, expected_code: expectedCode ?? null,
        passed: (measured.result.resultado === 'RECONHECIDO') === accepted
          && (expectedCode === undefined || measured.result.resultado !== 'RECONHECIDO' && measured.result.codigo === expectedCode), ...measured }
    })
    const publicSchema = z.array(z.object({ id: z.string(), sha256: z.string(),
      local_private_path: z.string(), classification: z.string(), version: z.string().nullable() }))
    const publicRows = directory ? publicSchema.parse(JSON.parse(readFileSync(join(directory, 'public-samples.json'), 'utf8'))).map(entry => {
      const bytes = readFileSync(entry.local_private_path)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      const measured = observation(bytes.toString('utf8'))
      return { id: entry.id, classification: entry.classification, version: entry.version, ...measured }
    }) : []
    if (directory) writeFileSync(join(directory, `adapter-${parserName}.json`), JSON.stringify({
      node: process.version, parser: parserName, operational_integration: false,
      structural, security, public_samples: publicRows,
      memory: { rss: process.memoryUsage().rss, heap_used: process.memoryUsage().heapUsed,
        max_rss_kib: process.resourceUsage().maxRSS },
      traced_field_count: structural.reduce((n, row) => n + (row.result.resultado === 'RECONHECIDO' ? canonicalFields(row.result.documento).length : 0), 0),
    }, null, 2)+'\n', 'utf8')
    expect(structural).toHaveLength(15)
  })
})
