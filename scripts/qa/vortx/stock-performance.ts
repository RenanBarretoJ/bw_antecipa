import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { prepararSnapshotEstoqueVortx } from '../../../src/lib/integracoes/vortx/estoque-snapshot'
import { CONTEXTO_CSV_QA, csvVortxQa } from '../../../src/lib/integracoes/vortx/__fixtures__/relatorios-csv'
import { blocosEstoqueVortx, MAX_STOCK_CHUNK_BYTES } from '../../../src/lib/integracoes/vortx/estoque-blocos'

const total = 20000
const rows = Array.from({ length: total }, (_, index) => ({ chave_ativo: `QA-${index}`, chave_parcela: `PARCELA-${index}`, customizado_1: 'x'.repeat(400) }))
const ativo = csvVortxQa('PosicaoAtivo', rows), parcela = csvVortxQa('PosicaoParcela', rows)
assert(ativo.byteLength <= 20 * 1024 * 1024 && parcela.byteLength <= 20 * 1024 * 1024)
const start = performance.now()
const result = prepararSnapshotEstoqueVortx({ contexto: CONTEXTO_CSV_QA, integracaoFundoVersaoId: CONTEXTO_CSV_QA.fundoId,
  ativo: { nome: 'ativo-sintetico.csv', conteudo: ativo }, parcela: { nome: 'parcela-sintetica.csv', conteudo: parcela } })
assert.equal(result.composicao.reconciliado, true)
assert.equal(result.payload.ativos.length, total); assert.equal(result.payload.parcelas.length, total)
assert.equal(new Set(result.payload.parcelas.map(row => row.dados_normalizados.external_title_key)).size, total)
let chunkCount = 0, normalizedRowJsonBytes = 0, maxChunkBytes = 0
for (const tipo of ['ativos', 'parcelas'] as const) for (const chunk of blocosEstoqueVortx(result.payload[tipo])) {
  assert(chunk.bytes <= MAX_STOCK_CHUNK_BYTES)
  chunkCount++; normalizedRowJsonBytes += chunk.bytes; maxChunkBytes = Math.max(maxChunkBytes, chunk.bytes)
}
const durationMs = Math.round(performance.now() - start)
const report = { scope: 'LOCAL_SYNTHETIC_CSV_PREPARATION_ONLY', rowsPerFile: total,
  ativoBytes: ativo.byteLength, parcelaBytes: parcela.byteLength, durationMs,
  normalizedRowJsonBytes, chunkCount, maxChunkBytes, maxRssBytes: process.resourceUsage().maxRSS * 1024,
  reconciliado: true, hostedThroughputCertified: false }
const output = resolve(process.env.LOCALAPPDATA!, 'bw-antecipa-evidence/vortx-stock-processing-20261020', `performance-${Date.now()}.json`)
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, evidence: output }))
