import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { agruparRemessa } from '../../../src/lib/remessas/domain'
import { classificarStatusLogisticoPreCessao } from '../../../src/lib/logistica/evidencias-logisticas'
import { operacao, config } from '../../../src/lib/remessas/vrs/__fixtures__/operacao'
import { mapearGrupoParaVrs } from '../../../src/lib/remessas/vrs/mapper'
import { serializarVrsInclusaoCsv } from '../../../src/lib/remessas/vrs/csv'
import { gerarVrsInclusaoXlsx, VRS_LAYOUT_VERSION } from '../../../src/lib/remessas/vrs/xlsx'

// Synthetic examples only. No network, database or production document. Run with tsx.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
async function main() {
const output = resolve(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'bw-antecipa-evidence', `vrs-duplicatas-example-${Date.now()}`)
const op = operacao()
op.notas[0].numero = '3518'
op.notas[0].parcelasSelecionadas = op.notas[0].parcelasSelecionadas.slice(0, 2).map((p, i) => ({ ...p, numero: i + 4 }))
op.notas[0].classificacaoLogistica = classificarStatusLogisticoPreCessao([
  { familia: 'comprovante_entrega', documentoId: 'qa-proof', versaoId: 'qa-proof-v1', versaoStatus: 'aprovado' },
])
const other = structuredClone(op.notas[0])
other.id = '22222222-2222-3333-4444-555555555555'
other.numero = '3519'
other.chaveAcesso = '35260812345678000195550010000001011000000010'
other.parcelasSelecionadas = [{ ...other.parcelasSelecionadas[0], id: 'parcela-1-qa-3519', numero: 1 }]
other.classificacaoLogistica = classificarStatusLogisticoPreCessao([
  { familia: 'cte', documentoId: 'qa-cte', versaoId: 'qa-cte-v1', versaoStatus: 'aprovado' },
])
op.notas.push(other)
const group = agruparRemessa([op], 'POR_CEDENTE')[0]
const mapped = mapearGrupoParaVrs(group, config)
const csv = serializarVrsInclusaoCsv(mapped)
const xlsx = await gerarVrsInclusaoXlsx(mapped)
mkdirSync(output, { recursive: true })
const files = { 'EXEMPLO_SINTETICO_VRS_V4.csv': csv.conteudo, 'EXEMPLO_SINTETICO_VRS_V4.xlsx': xlsx }
for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(output, name), bytes)
const report = {
  synthetic: true, operationalUse: false, layout: VRS_LAYOUT_VERSION,
  files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }])),
  duplicatas: mapped.ativos.map((asset, i) => ({ ativo: asset.chaveUnicaAtivo, fluxo: mapped.fluxos[i].chaveUnicaParcela, numeroEmissao: asset.campos[27], ativoCustom1: asset.campos[36], ativoCustom2: asset.campos[37], fluxoCustom1: mapped.fluxos[i].campos[10], fluxoCustom2: mapped.fluxos[i].campos[11] })),
}
assert.deepEqual(report.duplicatas.map(d => d.ativo), ['3518/4', '3518/5', '3519/1'])
assert.deepEqual(report.duplicatas.map(d => d.ativoCustom2), ['entregue', 'entregue', 'em transito'])
assert(report.duplicatas.every(d => /^\d{44}$/.test(d.ativoCustom1) && d.ativoCustom1 === d.fluxoCustom1))
writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, layout: report.layout, count: report.duplicatas.length }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
