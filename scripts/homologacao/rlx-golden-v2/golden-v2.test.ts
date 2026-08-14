import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFixtureFiles } from './fixtures.mjs'
import { BUSINESS_DATES, DATASET_VERSION, buildGoldenV2 } from './scenario-definitions.mjs'

describe('RLX Golden Dataset V2', () => {
  it('mantem os 37 artefatos V1 congelados', () => {
    const root = resolve(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures')
    const files: string[] = []
    const walk = (directory: string) => {
      for (const name of readdirSync(directory).sort()) {
        const path = resolve(directory, name)
        if (statSync(path).isDirectory()) walk(path)
        else files.push(path)
      }
    }
    walk(root)
    const digest = createHash('sha256')
    for (const file of files) {
      digest.update(relative(root, file).replaceAll('\\', '/'))
      digest.update('\0')
      digest.update(readFileSync(file))
      digest.update('\0')
    }
    expect(files).toHaveLength(37)
    expect(digest.digest('hex')).toBe('7b1535954ac84fdce92b521b282717133031ca9ae1fdf708617d44cfd64050d5')
  })

  it('congela o calendario ANBIMA correto', () => expect(BUSINESS_DATES).toEqual({ 'D-1': '2026-08-07', 'D-2': '2026-08-06', 'D-3': '2026-08-05', 'D-4': '2026-08-04' }))

  it('possui 110 notas em dois fundos exclusivos', () => {
    const data = buildGoldenV2()
    expect(data.notes).toHaveLength(110)
    expect(new Set(data.notes.map((item: { id: string }) => item.id)).size).toBe(110)
    expect(data.funds).toHaveLength(2)
    const v1Root = resolve(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures')
    const v1Text = readdirSync(v1Root, { recursive: true })
      .map(String)
      .filter((name) => statSync(resolve(v1Root, name)).isFile())
      .map((name) => readFileSync(resolve(v1Root, name), 'utf8'))
      .join('\n')
    expect(data.funds.every((fund: { id: string }) => !v1Text.includes(fund.id))).toBe(true)
  })

  it('nao permite D-1 em fim de semana', () => {
    const d1 = new Date(`${BUSINESS_DATES['D-1']}T12:00:00Z`).getUTCDay()
    expect([0, 6]).not.toContain(d1)
  })

  it('inclui o seed operacional exigido sem tornar logistica autoritativa no P2.3.1', () => {
    const data = buildGoldenV2()
    expect(data.operations).toHaveLength(10)
    expect(data.boletoDocuments).toHaveLength(110)
    expect(new Set(data.operations.map((item: { logistics: string }) => item.logistics))).toEqual(new Set(['ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA']))
    const logistics = JSON.parse(buildFixtureFiles().get('expected/expected-logistics.json')!)
    expect(logistics.authoritative_in_p2_3_1).toBe(false)
    expect(logistics.cases).toHaveLength(10)
  })

  it('gera arquivos deterministas', () => {
    const hash = (files: Map<string, string>) => createHash('sha256').update(JSON.stringify([...files])).digest('hex')
    expect(hash(buildFixtureFiles())).toBe(hash(buildFixtureFiles()))
  })

  it('separa oraculos por responsabilidade sem importar o motor real', () => {
    const files = buildFixtureFiles()
    expect(JSON.parse(files.get('expected/expected-matching.json')!).dataset_version).toBe(DATASET_VERSION)
    expect(JSON.parse(files.get('expected/expected-reconciliation.json')!).dataset_version).toBe(DATASET_VERSION)
    expect(JSON.parse(files.get('expected/expected-import-lifecycle.json')!).schema).toBe('rlx_expected_import_lifecycle_v2')
    expect(readFileSync(new URL('./fixtures.mjs', import.meta.url), 'utf8')).not.toContain("from '../../../src/lib/rlx/conciliacao")
  })

  it('mantem retificacao e hash fora dos status esperados por titulo', () => {
    const files = buildFixtureFiles()
    const recon = JSON.parse(files.get('expected/expected-reconciliation.json')!)
    const lifecycle = JSON.parse(files.get('expected/expected-import-lifecycle.json')!)
    expect(recon.cases.every((item: { expected_status: string }) => !/RETIFICACAO|HASH|COMPLETO_VAZIO/.test(item.expected_status))).toBe(true)
    expect(lifecycle.duplicate.reuses_import).toBe(true)
    expect(lifecycle.rectifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ESTOQUE', revisions: [1, 2] }),
      expect.objectContaining({ type: 'AQUISICOES', revisions: [1, 2] }),
    ]))
    expect(lifecycle.complete_empty.length).toBeGreaterThan(0)
  })

  it('cobre os estados temporais canonicos de reconciliacao', () => {
    const recon = JSON.parse(buildFixtureFiles().get('expected/expected-reconciliation.json')!)
    const statuses = new Set(recon.cases.map((item: { expected_status: string }) => item.expected_status))
    for (const status of [
      'MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'ENTRADA_NAO_INCORPORADA',
      'ENTRADA_SEM_AQUISICAO', 'SAIDA_REFLETIDA', 'SAIDA_SEM_LIQUIDACAO',
      'LIQUIDADO_AINDA_NO_ESTOQUE', 'LIQUIDACAO_PARCIAL_SALDO',
      'LIQUIDACAO_REPETIDA_MESMO_DIA', 'DIVERGENCIA_VALOR',
    ]) expect(statuses.has(status)).toBe(true)
  })

  it('materializa todos os cenarios de matching nas fixtures executaveis', () => {
    const data = buildGoldenV2()
    const expected = JSON.parse(buildFixtureFiles(data).get('expected/expected-matching.json')!)
    const byScenario = new Map(data.matching.map((item: { scenarioId: string }) => [item.scenarioId, item]))
    const expectedByScenario = new Map(expected.cases.map((item: { scenario_id: string }) => [item.scenario_id, item]))

    expect(byScenario.get('MATCH_CHAVE')).toMatchObject({ expectedMethod: 'CHAVE_NFE' })
    expect(byScenario.get('MATCH_SEU_NUMERO')).toMatchObject({ chaveNfe: null, expectedMethod: 'SEU_NUMERO' })
    expect(byScenario.get('MATCH_PROPAGACAO')).toMatchObject({ bigInteger: '900719925474099312345' })
    expect(byScenario.get('MATCH_COMPOSTO')).toMatchObject({ chaveNfe: null, seuNumero: '', expectedMethod: 'COMPOSTO' })
    expect(byScenario.get('MATCH_AMBIGUO')).toMatchObject({ expectedStatus: 'AMBIGUO', expectedCandidateCount: 2 })
    expect(byScenario.get('MATCH_NAO_CONCILIADO')).toMatchObject({ fund: data.mainFund, note: null, expectedCandidateCount: 0 })
    expect(expectedByScenario.get('MATCH_NAO_CONCILIADO')).toMatchObject({ expected_status: 'NAO_CONCILIADO', expected_nf_id: null })
    expect(expected.stock_d1_aggregates.nao_conciliado_count).toBe(1)
  })

  it('mantem identidades iguais isoladas por fundo', () => {
    const data = buildGoldenV2()
    const main = data.matching.find((item: { scenarioId: string }) => item.scenarioId === 'MATCH_CROSS_FUND_MAIN')!
    const adversarial = data.matching.find((item: { scenarioId: string }) => item.scenarioId === 'MATCH_CROSS_FUND_ADV')!

    expect(main.identity).toBe(adversarial.identity)
    expect(main.seuNumero).toBe(adversarial.seuNumero)
    expect(main.fund.id).not.toBe(adversarial.fund.id)
  })
})
