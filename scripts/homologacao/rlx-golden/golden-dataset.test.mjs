import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATASET_VERSION,
  buildDataset,
  deterministicUuid,
  validateNfeKey,
} from './helpers.mjs'
import { buildFixtureFiles, buildManifest, writeFixtures } from './manifest.mjs'

describe('P2.1 - RLX Golden Dataset', () => {
  it('e deterministico, versionado e possui IDs reproduziveis', () => {
    const first = buildDataset()
    const second = buildDataset()
    expect(first.version).toBe('RLX_GOLDEN_V1')
    expect(first).toEqual(second)
    expect(deterministicUuid('fund-main')).toBe(deterministicUuid('fund-main'))
  })

  it('respeita volumes, politica NF e operacoes intraday fora do estoque D-1', () => {
    const dataset = buildDataset()
    expect(dataset.mainNotes).toHaveLength(108)
    expect(dataset.notes).toHaveLength(123)
    expect(dataset.stockD1).toHaveLength(90)
    expect(dataset.acquisitions).toHaveLength(30)
    expect(dataset.liquidations.length).toBeGreaterThanOrEqual(20)
    expect(dataset.operations).toHaveLength(10)
    expect(dataset.operations.every((operation) => !dataset.stockD1.some((note) => note.id === operation.note.id))).toBe(true)
  })

  it('gera chaves NF-e sinteticas com 44 digitos, DV valido e CNPJ emitente', () => {
    const dataset = buildDataset()
    expect(dataset.notes.every((note) => validateNfeKey(note.key))).toBe(true)
    expect(dataset.notes.every((note) => note.key.slice(6, 20) === note.cedent.cnpj)).toBe(true)
  })

  it('preserva colisoes cross-fund e identificadores grandes como string', () => {
    const matching = JSON.parse(buildFixtureFiles().get('expected/expected-matching.json'))
    expect(matching.crossFundCollision.seuNumero).toBe('QA-000001')
    expect(matching.crossFundCollision.idRecebivel).toBe('900719925474099312345')
    expect(typeof matching.crossFundCollision.idRecebivel).toBe('string')
    expect(BigInt(matching.crossFundCollision.idRecebivel)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
    expect(matching.crossFundCollision.mainNoteId).not.toBe(matching.crossFundCollision.adversarialNoteId)
  })

  it('explicita dias sem movimento e preserva retificacoes', () => {
    const files = buildFixtureFiles()
    expect(files.get('D-2/liquidacoes.csv')).toContain('SEM_MOVIMENTO')
    expect(files.get('D-1/aquisicoes.csv')).toContain('SEM_MOVIMENTO')
    expect(files.has('retificacoes/estoque-D-1-v2.csv')).toBe(true)
    expect(files.has('retificacoes/aquisicoes-D-2-v2.csv')).toBe(true)
  })

  it('mantem fixtures e expected results sincronizados com o manifest', () => {
    const { differences } = writeFixtures({ check: true })
    const manifest = buildManifest()
    expect(differences).toEqual([])
    expect(manifest.datasetVersion).toBe(DATASET_VERSION)
    expect(manifest.expected).toEqual({
      matching: 'expected/expected-matching.json',
      reconciliation: 'expected/expected-reconciliation.json',
      logistics: 'expected/expected-logistics.json',
      exposure: 'expected/expected-exposure.json',
    })
    expect(manifest.timeline['D-2'].liquidacoes).toBe('SEM_MOVIMENTO')
    expect(manifest.timeline['D-1'].aquisicoes).toBe('SEM_MOVIMENTO')
  })

  it('nao usa Duplicata Mercantil nem cria tabelas financeiras futuras', () => {
    const seed = readFileSync(resolve(process.cwd(), 'scripts/homologacao/rlx-golden/seed.mjs'), 'utf8')
    expect(seed).toContain("tipo_ativo_financeiro")
    expect(seed).toContain("'NOTA_FISCAL'")
    expect(seed).toContain("'Boleto / Duplicata Digital','nf'")
    expect(seed).not.toContain("'DUPLICATA_MERCANTIL'")
    expect(seed).not.toMatch(/CREATE\s+TABLE/i)
  })

  it('restringe cleanup aos IDs determinísticos e não usa matching amplo', () => {
    const cleanup = readFileSync(resolve(process.cwd(), 'scripts/homologacao/rlx-golden/cleanup.mjs'), 'utf8')
    expect(cleanup).toContain('id=ANY($1)')
    expect(cleanup).not.toMatch(/DELETE[^\n]+LIKE/i)
    expect(cleanup).not.toContain("--force-production")
  })
})
