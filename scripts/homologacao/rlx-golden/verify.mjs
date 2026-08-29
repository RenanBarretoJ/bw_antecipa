import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BOLETO_DOCUMENT_CODE,
  DATASET_VERSION,
  assertHomologEnvironment,
  buildDataset,
  connectDb,
  loadHomologEnv,
  parseArgs,
  validateNfeKey,
} from './helpers.mjs'
import { FIXTURES_ROOT, writeFixtures } from './manifest.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const dataset = buildDataset()
const client = await connectDb(env, 'verify')
const failures = []

function check(condition, message, details = null) {
  if (!condition) failures.push({ message, details })
}

async function count(table, condition, values) {
  const { rows } = await client.query(`SELECT count(*)::integer total FROM public.${table} WHERE ${condition}`, values)
  return Number(rows[0]?.total || 0)
}

try {
  console.log('\nBW Antecipa - verificacao read-only P2.1 RLX')
  console.log(`Projeto: ${env.projectRef}; dataset: ${DATASET_VERSION}`)
  await client.query('BEGIN READ ONLY')

  const fixtureCheck = writeFixtures({ check: true })
  check(fixtureCheck.differences.length === 0, 'Fixtures versionadas divergem da geracao deterministica.', fixtureCheck.differences)
  const manifest = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'manifest.json'), 'utf8'))
  check(manifest.datasetVersion === DATASET_VERSION, 'Manifesto possui versao inesperada.')
  check(manifest.baseDate === dataset.baseDate && manifest.timezone === dataset.timezone, 'Base temporal ou timezone divergente.')

  check(dataset.notes.every((note) => validateNfeKey(note.key)), 'Ha chave NF-e sintetica sem 44 digitos/DV valido.')
  check(dataset.notes.every((note) => note.key.slice(6, 20) === note.cedent.cnpj), 'CNPJ emitente nao esta preservado na chave NF-e.')
  check(dataset.notes.filter((note) => note.fund === dataset.mainFund).length === 108, 'Quantidade principal de NFs divergente.')
  check(dataset.notes.filter((note) => note.fund === dataset.adversarialFund).length === 15, 'Quantidade adversarial de NFs divergente.')
  check(dataset.stockD1.length === 90, 'Estoque D-1 precisa conter 90 posicoes.')
  check(dataset.acquisitions.length === 30, 'Fixture deve conter 30 aquisicoes.')
  check(dataset.liquidations.length >= 20 && dataset.liquidations.length <= 30, 'Fixture deve conter 20-30 liquidacoes.')
  check(dataset.operations.length >= 8 && dataset.operations.length <= 12, 'D0 deve conter 8-12 operacoes.')
  check(dataset.operations.every((operation) => !dataset.stockD1.some((note) => note.id === operation.note.id)), 'Operacao D0 apareceu indevidamente no Estoque D-1.')

  check(await count('fundos', 'id=ANY($1)', [dataset.funds.map((item) => item.id)]) === 2, 'Fundos dedicados nao foram encontrados.')
  check(await count('cedentes', 'id=ANY($1)', [dataset.cedents.map((item) => item.id)]) === dataset.cedents.length, 'Cedentes sinteticos incompletos.')
  check(await count('sacados', 'id=ANY($1)', [dataset.debtors.map((item) => item.id)]) === dataset.debtors.length, 'Sacados sinteticos incompletos.')
  check(await count('notas_fiscais', 'id=ANY($1)', [dataset.notes.map((item) => item.id)]) === dataset.notes.length, 'Notas fiscais sinteticas incompletas.')
  check(await count('operacoes', 'id=ANY($1) AND status=$2', [dataset.operations.map((item) => item.id), 'aprovada']) === dataset.operations.length, 'Operacoes D0 nao estao todas aprovadas.')
  check(await count('operacao_calculo_nfs', 'operacao_id=ANY($1)', [dataset.operations.map((item) => item.id)]) === dataset.operations.length, 'Memorias financeiras por NF incompletas.')
  check(await count('documentos_repositorio', 'id=ANY($1)', [dataset.documents.map((item) => item.id)]) === dataset.documents.length, 'Repositorio documental sintetico incompleto.')

  const policy = await client.query(`
    SELECT pov.id,pov.status,pov.tipo_ativo_financeiro,pov.exigir_status_logistico_pre_cessao,
      count(pr.id) FILTER (WHERE pr.tipo_documento_codigo='boleto' AND pr.obrigatorio) AS boletos
    FROM public.politica_operacional_versoes pov
    LEFT JOIN public.politica_requisitos_documentais pr ON pr.politica_operacional_versao_id=pov.id
    WHERE pov.id=ANY($1)
    GROUP BY pov.id
  `, [dataset.funds.map((item) => item.policyVersionId)])
  check(policy.rows.length === 2, 'Versoes de politica ausentes.')
  check(policy.rows.every((row) => row.status === 'publicada' && row.tipo_ativo_financeiro === 'NOTA_FISCAL'), 'Politica RLX nao permaneceu publicada e baseada em NF.', policy.rows)
  check(policy.rows.every((row) => row.exigir_status_logistico_pre_cessao && Number(row.boletos) === 1), 'Gate logistico ou Boleto obrigatorio nao configurado.', policy.rows)

  const boletoType = await client.query(`SELECT id,nome,ativo FROM public.documento_tipos WHERE codigo=$1`, [BOLETO_DOCUMENT_CODE])
  check(boletoType.rows.length === 1 && boletoType.rows[0].ativo && boletoType.rows[0].nome === 'Boleto / Duplicata Digital', 'Catalogo de Boleto / Duplicata Digital incorreto.')
  check(await count('duplicatas', 'nota_fiscal_id=ANY($1)', [dataset.notes.map((item) => item.id)]) === 0, 'P2.1 contaminou as tabelas de Duplicata do P2.0.')

  const calculations = await client.query(`
    SELECT ocn.*, (private.calcular_memoria_financeira_nf(
      ocn.nota_fiscal_id,ocn.valor_nominal,ocn.taxa_mensal,ocn.data_base,
      ocn.vencimento_contratual,ocn.metodo_calculo_financeiro
    )->>'valor_presente')::numeric AS esperado
    FROM public.operacao_calculo_nfs ocn WHERE ocn.operacao_id=ANY($1)
  `, [dataset.operations.map((item) => item.id)])
  check(calculations.rows.every((row) => row.metodo_calculo_financeiro === 'DIAS_UTEIS_252'), 'Metodo financeiro inesperado nas memorias.')
  check(calculations.rows.every((row) => Number(row.valor_presente) === Number(row.esperado)), 'Preco de aquisicao diverge do motor financeiro canonico.')

  const documentRows = await client.query(`
    SELECT dr.id,dr.status FROM public.documentos_repositorio dr WHERE dr.id=ANY($1)
  `, [dataset.documents.map((item) => item.id)])
  const statusByDocument = new Map(documentRows.rows.map((row) => [row.id, row.status]))
  const derived = dataset.notes.map((note) => {
    const proof = dataset.documentByNoteFamily.get(`${note.id}:comprovante_entrega`)
    const cte = dataset.documentByNoteFamily.get(`${note.id}:cte_xml`)
    const actual = proof && statusByDocument.get(proof.id) === 'aprovado'
      ? 'ENTREGUE'
      : cte && statusByDocument.get(cte.id) === 'aprovado' ? 'EM_TRANSITO' : 'INDETERMINADA'
    return { noteId: note.id, expected: note.logistics, actual }
  })
  check(derived.every((item) => item.expected === item.actual), 'Derivacao logistica nao corresponde as evidencias.', derived.filter((item) => item.expected !== item.actual))

  const matching = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'expected/expected-matching.json'), 'utf8'))
  check(matching.crossFundCollision.seuNumero === 'QA-000001', 'Colisao cross-fund de SEU_NUMERO ausente.')
  check(matching.crossFundCollision.idRecebivel === '900719925474099312345', 'Colisao cross-fund de ID_RECEBIVEL ausente.')
  check(typeof matching.crossFundCollision.idRecebivel === 'string' && BigInt(matching.crossFundCollision.idRecebivel) > BigInt(Number.MAX_SAFE_INTEGER), 'ID externo grande nao foi preservado como string.')
  const duplicateReference = JSON.parse(readFileSync(resolve(FIXTURES_ROOT, 'edge-cases/duplicate-file-reference.json'), 'utf8'))
  check(manifest.hashes[duplicateReference.first] === manifest.hashes[duplicateReference.duplicate], 'Arquivo duplicado nao possui hash identico.')

  const managerEmail = String(args['gestor-email'] || process.env.RLX_GOLDEN_GESTOR_EMAIL || '').trim().toLowerCase()
  if (managerEmail) {
    const managerAccess = await client.query(`
      SELECT uf.fundo_id FROM public.usuario_fundos uf JOIN public.profiles p ON p.id=uf.usuario_id
      WHERE lower(p.email)=$1 AND uf.fundo_id=ANY($2) AND uf.status='ativo'
    `, [managerEmail, dataset.funds.map((item) => item.id)])
    check(managerAccess.rows.some((row) => row.fundo_id === dataset.mainFund.id), 'Gestor opcional nao tem acesso ao fundo principal.')
    check(!managerAccess.rows.some((row) => row.fundo_id === dataset.adversarialFund.id), 'Gestor opcional ganhou acesso indevido ao fundo adversarial.')
  }

  await client.query('ROLLBACK')
  if (failures.length) {
    console.error(`\nVerificacao falhou em ${failures.length} item(ns):`)
    for (const failure of failures) console.error(`- ${failure.message}${failure.details ? ` ${JSON.stringify(failure.details)}` : ''}`)
    process.exitCode = 1
  } else {
    console.log('\nVerificacao concluida: dataset deterministico, isolado, reconciliavel e coerente com o dominio BW atual.')
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`\nFalha tecnica na verificacao: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
