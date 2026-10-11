import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { canonicalSchema } from '../canonical/schema'
import { extractNationalXml } from './adapter'
import { loadStructuralCorpus, valueAt } from './corpus'

const corpus = loadStructuralCorpus()
const outputs = corpus.map(({ entry, xml, expected }) => {
  const result = extractNationalXml(xml)
  if (result.resultado !== 'RECONHECIDO') throw new Error('CERTIFICATION_CORPUS_NOT_RECOGNIZED')
  return { id: entry.id, versao: entry.versao, origem: entry.origem,
    documento: result.documento, problemas: result.problemas, expected }
})

describe('certificação estrutural Nacional, sem prova de emissão fiscal', () => {
  it('mantém o JSON Schema 1.1 publicado idêntico à definição tipada', () => {
    const published: unknown = JSON.parse(readFileSync('docs/analises/nfse-canonical-1.1.0.schema.json', 'utf8'))
    expect(published).toEqual({
      ...z.toJSONSchema(canonicalSchema, { target: 'draft-2020-12', reused: 'ref' }),
      $id: 'urn:bw-antecipa:nfse-canonical:1.1.0',
      title: 'NFS-e canônica: extração documental sem elegibilidade',
    })
  })

  it.each(outputs)('preserva o contrato e as expectativas após serialização: $id', row => {
    const serialized: unknown = JSON.parse(JSON.stringify(row.documento))
    expect(canonicalSchema.safeParse(serialized).success).toBe(true)
    for (const [field, expected] of Object.entries(row.expected.campos)) {
      expect(valueAt(serialized, field), field).toMatchObject(expected)
    }
    expect(row.documento.verificacao.elegibilidade).toBe('NAO_AVALIADA')
    expect(row.documento.identificacao.situacao.valor).toBe('DESCONHECIDA')
  })

  it('exporta somente os dados fictícios para validação JSON Schema independente', () => {
    if (process.env.BW_NFSE_WRITE_CERTIFICATION === 'true') {
      writeFileSync('docs/analises/nfse-e1-e2-certificacao-2026-10-09.outputs.json',
        JSON.stringify({ node: process.version, origem: 'SINTETICO_ESTRUTURAL', resultados: outputs }, null, 2)+'\n', 'utf8')
    }
    expect(outputs).toHaveLength(15)
  })
})
