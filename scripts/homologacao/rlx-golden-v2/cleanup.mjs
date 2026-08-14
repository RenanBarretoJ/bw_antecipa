import { readFileSync } from 'node:fs'
import { createAdminClient, connectDb, initializeMutation, runtimeManifestPath } from './runtime.mjs'
import { DATASET_VERSION, PROVIDER, buildGoldenV2 } from './scenario-definitions.mjs'
import { deterministicUuid } from '../rlx-golden/helpers.mjs'

const { env, execute, confirmation } = initializeMutation('CLEANUP_V2')
const dataset = buildGoldenV2()
const exact = {
  operations: dataset.operations.map((item) => item.id),
  deliveries: dataset.operations.map((item) => item.note.id),
  documents: dataset.boletoDocuments.map((item) => item.id),
  versions: dataset.boletoDocuments.map((item) => item.versionId),
  analyses: dataset.boletoDocuments.map((item) => item.analysisId),
  links: dataset.boletoDocuments.map((item) => item.linkId),
  instances: dataset.boletoDocuments.map((item) => item.requirementInstanceId),
  assignments: dataset.cedents.map((item) => item.assignmentId),
  policies: dataset.funds.map((item) => item.policyId),
  policyVersions: dataset.funds.map((item) => item.policyVersionId),
  requirements: dataset.funds.flatMap((item) => Object.values(item.requirementIds)),
}
const logistics = dataset.operations
  .filter((operation) => operation.logistics !== 'INDETERMINADA')
  .map((operation) => {
    const family = operation.logistics === 'ENTREGUE' ? 'comprovante_entrega' : 'cte'
    return {
      family,
      documentId: deterministicUuid(`${DATASET_VERSION}:logistics-document:${family}:${operation.note.id}`),
      versionId: deterministicUuid(`${DATASET_VERSION}:logistics-version:${family}:${operation.note.id}:1`),
      analysisId: deterministicUuid(`${DATASET_VERSION}:logistics-analysis:${family}:${operation.note.id}:1`),
      entityId: deterministicUuid(`${DATASET_VERSION}:${family}:${operation.note.id}`),
    }
  })
let db

try {
  db = await connectDb(env, execute ? 'rlx_v2_cleanup' : 'rlx_v2_cleanup_preview')
  const counts = await db.query(`SELECT
    (SELECT count(*)::int FROM public.fundos WHERE id=ANY($1)) AS fundos,
    (SELECT count(*)::int FROM public.notas_fiscais WHERE id=ANY($2)) AS notas,
    (SELECT count(*)::int FROM public.operacoes WHERE id=ANY($4)) AS operacoes,
    (SELECT count(*)::int FROM public.documentos_repositorio WHERE id=ANY($5)) AS boletos,
    (SELECT count(*)::int FROM public.rlx_importacoes_financeiras WHERE fundo_id=ANY($1) AND provedor=$3) AS importacoes`,
    [dataset.funds.map((item) => item.id), dataset.notes.map((item) => item.id), PROVIDER, exact.operations, exact.documents])
  console.log(JSON.stringify({ dataset: DATASET_VERSION, mode: execute ? 'execute' : 'preview', counts: counts.rows[0] }, null, 2))
  if (!execute) {
    console.log(`Dry-run concluido. Para limpar apenas V2: --execute --expected-project-ref ${env.projectRef} --confirm ${confirmation}`)
  } else {
    const storage = await db.query(`SELECT storage_bucket,storage_path FROM public.rlx_importacao_arquivos WHERE fundo_id=ANY($1)`, [dataset.funds.map((item) => item.id)])
    await db.query('BEGIN')
    await db.query(`SET LOCAL session_replication_role='replica'`)
    const funds = dataset.funds.map((item) => item.id)
    const scopedDeletes = [
      `DELETE FROM public.rlx_posicao_logistica_resultados WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_posicao_logistica_execucoes WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_matching_candidatos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_conciliacao_resultados WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_matching_resultados WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_conciliacao_execucoes WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_matching_execucoes WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_titulo_nf_vinculo_chaves WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_titulo_nf_vinculos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_estoque_posicoes WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_aquisicao_movimentos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_liquidacao_movimentos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_carteira_snapshots WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_importacao_linhas WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_importacao_arquivos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_importacao_ciclos WHERE fundo_id=ANY($1)`,
      `DELETE FROM public.rlx_importacoes_financeiras WHERE fundo_id=ANY($1)`,
    ]
    for (const sql of scopedDeletes) await db.query(sql, [funds])
    const cteIds = logistics.filter((item) => item.family === 'cte').map((item) => item.entityId)
    const proofIds = logistics.filter((item) => item.family === 'comprovante_entrega').map((item) => item.entityId)
    if (cteIds.length) {
      await db.query(`DELETE FROM public.cte_notas_fiscais WHERE cte_id=ANY($1)`, [cteIds])
      await db.query(`DELETE FROM public.ctes WHERE id=ANY($1)`, [cteIds])
    }
    if (proofIds.length) await db.query(`DELETE FROM public.canhotos WHERE id=ANY($1)`, [proofIds])
    await db.query(`DELETE FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=ANY($1)`, [dataset.notes.map((item) => item.id)])
    await db.query(`DELETE FROM public.operacao_calculo_nfs WHERE operacao_id=ANY($1)`, [exact.operations])
    await db.query(`DELETE FROM public.operacoes_nfs WHERE operacao_id=ANY($1)`, [exact.operations])
    await db.query(`DELETE FROM public.operacoes WHERE id=ANY($1)`, [exact.operations])
    await db.query(`DELETE FROM public.documento_requisito_instancias WHERE id=ANY($1)`, [exact.instances])
    await db.query(`DELETE FROM public.documento_analises WHERE id=ANY($1)`, [[...exact.analyses, ...logistics.map((item) => item.analysisId)]])
    await db.query(`DELETE FROM public.documento_vinculos WHERE id=ANY($1)`, [exact.links])
    await db.query(`DELETE FROM public.documento_versoes WHERE id=ANY($1)`, [[...exact.versions, ...logistics.map((item) => item.versionId)]])
    await db.query(`DELETE FROM public.documentos_repositorio WHERE id=ANY($1)`, [[...exact.documents, ...logistics.map((item) => item.documentId)]])
    await db.query(`DELETE FROM public.notas_fiscais WHERE id=ANY($1)`, [dataset.notes.map((item) => item.id)])
    await db.query(`DELETE FROM public.cedente_fundo_politicas WHERE id=ANY($1)`, [exact.assignments])
    await db.query(`DELETE FROM public.politica_requisitos_documentais WHERE id=ANY($1)`, [exact.requirements])
    await db.query(`DELETE FROM public.politica_operacional_versoes WHERE id=ANY($1)`, [exact.policyVersions])
    await db.query(`DELETE FROM public.politicas_operacionais WHERE id=ANY($1)`, [exact.policies])
    await db.query(`DELETE FROM public.cedente_fundos WHERE fundo_id=ANY($1)`, [funds])
    await db.query(`DELETE FROM public.usuario_fundos WHERE fundo_id=ANY($1)`, [funds])
    await db.query(`DELETE FROM public.cedentes WHERE id=ANY($1)`, [dataset.cedents.map((item) => item.id)])
    await db.query(`DELETE FROM public.sacados WHERE id=ANY($1)`, [dataset.debtors.map((item) => item.id)])
    await db.query(`DELETE FROM public.fundos WHERE id=ANY($1)`, [funds])
    await db.query(`DELETE FROM public.profiles WHERE email LIKE '%@qa-rlx-v2.invalid'`)
    await db.query('COMMIT')
    const admin = createAdminClient(env)
    for (const item of storage.rows) await admin.storage.from(item.storage_bucket).remove([item.storage_path])
    try {
      const runtime = JSON.parse(readFileSync(runtimeManifestPath(), 'utf8'))
      for (const id of runtime.created_auth_user_ids || []) await admin.auth.admin.deleteUser(id)
    } catch { /* runtime opcional; usuarios preexistentes nunca sao removidos */ }
    console.log(`Cleanup ${DATASET_VERSION} concluido; V1 e dados externos preservados.`)
  }
} catch (error) {
  if (db) await db.query('ROLLBACK').catch(() => undefined)
  console.error(`Cleanup Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally { if (db) await db.end().catch(() => undefined) }
