import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FUND_NAME,
  SEED_VERSION,
  assertHomologEnvironment,
  brl,
  buildDataset,
  connectDb,
  environmentSummary,
  loadHomologEnv,
  localManifestPath,
  parseArgs,
  writeRestrictedJson,
} from './helpers.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const dataset = buildDataset()
const client = await connectDb(env, 'verify')
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function number(value) {
  return Number(value || 0)
}

try {
  console.log('\nBW Antecipa - verificacao da massa Central Logistica')
  console.log(environmentSummary(env))
  await client.query('BEGIN READ ONLY')

  const result = await client.query(`
    WITH qa_nfs AS (
      SELECT nf.* FROM public.notas_fiscais nf WHERE nf.fundo_id = $1
    ), latest_analysis AS (
      SELECT DISTINCT ON (da.documento_versao_id)
        da.documento_versao_id, da.resultado, da.analisado_em
      FROM public.documento_analises da
      JOIN public.documento_versoes dv ON dv.id = da.documento_versao_id
      JOIN public.documentos_repositorio dr ON dr.id = dv.documento_id
      WHERE dr.id IN (SELECT documento_id FROM public.evidencias_logisticas_antecipadas WHERE fundo_id = $1)
      ORDER BY da.documento_versao_id, da.analisado_em DESC, da.id DESC
    ), approved AS (
      SELECT DISTINCT ela.nota_fiscal_id, ela.familia_documental
      FROM public.evidencias_logisticas_antecipadas ela
      JOIN public.evidencia_logistica_versoes elv ON elv.evidencia_logistica_id = ela.id
      JOIN public.documento_versoes dv ON dv.id = elv.documento_versao_id
      LEFT JOIN latest_analysis la ON la.documento_versao_id = dv.id
      WHERE ela.fundo_id = $1 AND (dv.status = 'aprovado' OR la.resultado = 'aprovado')
    ), current_docs AS (
      SELECT ela.nota_fiscal_id, ela.familia_documental, ela.primeiro_upload_em,
        dv.id AS versao_id, dv.status AS versao_status,
        CASE
          WHEN dv.status = 'aprovado' OR la.resultado = 'aprovado' THEN 'APROVADO'
          WHEN dv.status = 'rejeitado' OR la.resultado IN ('rejeitado','requer_ajuste') THEN 'REJEITADO'
          ELSE 'AGUARDANDO_ANALISE'
        END AS status_documento
      FROM public.evidencias_logisticas_antecipadas ela
      JOIN public.documento_versoes dv ON dv.id = ela.documento_versao_atual_id
      LEFT JOIN latest_analysis la ON la.documento_versao_id = dv.id
      WHERE ela.fundo_id = $1
    ), latest_op AS (
      SELECT DISTINCT ON (onf.nota_fiscal_id)
        onf.nota_fiscal_id, o.id AS operacao_id, o.status::text AS operacao_status,
        COALESCE(nfe.cessao_efetivada_em, o.cessao_efetivada_em,
          CASE WHEN (o.politica_snapshot->>'cessao_no_desembolso')::boolean = false THEN o.aprovado_em END) AS cessao_em
      FROM public.operacoes_nfs onf
      JOIN public.operacoes o ON o.id = onf.operacao_id
      LEFT JOIN public.nota_fiscal_entregas nfe ON nfe.operacao_id = o.id AND nfe.nota_fiscal_id = onf.nota_fiscal_id
      WHERE onf.nota_fiscal_id IN (SELECT id FROM qa_nfs)
      ORDER BY onf.nota_fiscal_id, o.created_at DESC, o.id DESC
    ), classified AS (
      SELECT nf.id, nf.valor_bruto,
        CASE
          WHEN EXISTS (SELECT 1 FROM approved a WHERE a.nota_fiscal_id = nf.id AND a.familia_documental = 'comprovante_entrega') THEN 'ENTREGUE'
          WHEN EXISTS (SELECT 1 FROM approved a WHERE a.nota_fiscal_id = nf.id AND a.familia_documental = 'cte') THEN 'EM_TRANSITO'
          ELSE 'INDETERMINADA'
        END AS status_logistico
      FROM qa_nfs nf
    ), pending_notes AS (
      SELECT DISTINCT nfe.nota_fiscal_id
      FROM public.documento_requisito_instancias dri
      JOIN public.nota_fiscal_entregas nfe ON nfe.id = dri.nota_fiscal_entrega_id
      WHERE nfe.nota_fiscal_id IN (SELECT id FROM qa_nfs)
        AND dri.obrigatorio = true AND dri.status <> 'satisfeito'
        AND dri.prazo_limite < (timezone('America/Sao_Paulo', now()))::date
    )
    SELECT
      (SELECT count(*) FROM qa_nfs) AS nfs,
      (SELECT count(*) FROM public.cedentes WHERE id = ANY($2)) AS cedentes,
      (SELECT count(*) FROM public.sacados WHERE id = ANY($3)) AS sacados,
      (SELECT count(*) FROM public.operacoes WHERE id = ANY($4)) AS operacoes,
      (SELECT count(*) FROM public.ctes WHERE fundo_id = $1) AS ctes,
      (SELECT count(*) FROM public.canhotos c JOIN public.nota_fiscal_entregas nfe ON nfe.id = c.nota_fiscal_entrega_id WHERE nfe.nota_fiscal_id IN (SELECT id FROM qa_nfs)) AS canhotos,
      (SELECT count(*) FROM public.nota_fiscal_entrega_postergacoes_canhoto WHERE fundo_id = $1) AS postergacoes,
      (SELECT count(*) FROM classified WHERE status_logistico = 'ENTREGUE') AS entregues,
      (SELECT count(*) FROM classified WHERE status_logistico = 'EM_TRANSITO') AS em_transito,
      (SELECT count(*) FROM classified WHERE status_logistico = 'INDETERMINADA') AS indeterminadas,
      (SELECT coalesce(sum(valor_bruto),0) FROM classified) AS valor_total,
      (SELECT coalesce(sum(valor_bruto),0) FROM classified WHERE status_logistico = 'ENTREGUE') AS valor_entregue,
      (SELECT coalesce(sum(valor_bruto),0) FROM classified WHERE status_logistico = 'EM_TRANSITO') AS valor_em_transito,
      (SELECT coalesce(sum(valor_bruto),0) FROM classified WHERE status_logistico = 'INDETERMINADA') AS valor_indeterminado,
      (SELECT count(*) FROM pending_notes) AS pendencias_vencidas,
      (SELECT count(*) FROM current_docs WHERE status_documento = 'AGUARDANDO_ANALISE') AS aguardando_analise,
      (SELECT count(*) FROM current_docs WHERE status_documento = 'REJEITADO') AS rejeitados,
      (SELECT count(DISTINCT cd.nota_fiscal_id) FROM current_docs cd JOIN latest_op lo USING (nota_fiscal_id) WHERE cd.primeiro_upload_em < lo.cessao_em) AS envios_antecipados,
      (SELECT count(*) FROM current_docs cd JOIN latest_op lo USING (nota_fiscal_id) WHERE cd.familia_documental='cte' AND cd.primeiro_upload_em < lo.cessao_em) AS cte_antecipado,
      (SELECT count(*) FROM current_docs cd JOIN latest_op lo USING (nota_fiscal_id) WHERE cd.familia_documental='cte' AND cd.primeiro_upload_em >= lo.cessao_em) AS cte_pos,
      (SELECT count(*) FROM current_docs cd JOIN latest_op lo USING (nota_fiscal_id) WHERE cd.familia_documental='comprovante_entrega' AND cd.primeiro_upload_em < lo.cessao_em) AS comprovante_antecipado,
      (SELECT count(*) FROM current_docs cd JOIN latest_op lo USING (nota_fiscal_id) WHERE cd.familia_documental='comprovante_entrega' AND cd.primeiro_upload_em >= lo.cessao_em) AS comprovante_pos,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias WHERE fundo_id=$1 AND etapa='criacao' AND status_logistico='ENTREGUE') AS memoria_criacao_entregue,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias WHERE fundo_id=$1 AND etapa='criacao' AND status_logistico='EM_TRANSITO') AS memoria_criacao_transito,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias WHERE fundo_id=$1 AND etapa='criacao' AND status_logistico='INDETERMINADA') AS memoria_criacao_indeterminada,
      (SELECT count(*) FROM (
        SELECT cnf.cte_id FROM public.cte_notas_fiscais cnf JOIN public.ctes c ON c.id=cnf.cte_id
        WHERE c.fundo_id=$1 GROUP BY cnf.cte_id HAVING count(*) > 1
      ) shared) AS ctes_compartilhados,
      (SELECT count(*) FROM classified c WHERE c.status_logistico='INDETERMINADA') AS view_indeterminadas,
      (SELECT count(DISTINCT cd.nota_fiscal_id) FROM current_docs cd WHERE cd.status_documento='AGUARDANDO_ANALISE') AS view_aguardando_gestor,
      (SELECT count(DISTINCT cd.nota_fiscal_id) FROM current_docs cd JOIN latest_op lo USING(nota_fiscal_id) WHERE cd.primeiro_upload_em < lo.cessao_em) AS view_antecipados,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias WHERE fundo_id=$1 AND etapa='criacao' AND status_logistico='ENTREGUE') AS view_entregues_criacao,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias WHERE fundo_id=$1 AND etapa='criacao' AND status_logistico='EM_TRANSITO') AS view_transito_criacao,
      (SELECT count(DISTINCT nfe.nota_fiscal_id) FROM public.documento_requisito_instancias dri JOIN public.nota_fiscal_entregas nfe ON nfe.id=dri.nota_fiscal_entrega_id
        LEFT JOIN current_docs cd ON cd.nota_fiscal_id=nfe.nota_fiscal_id AND cd.familia_documental = CASE WHEN dri.tipo_documento_codigo_snapshot='cte' THEN 'cte' ELSE 'comprovante_entrega' END
        WHERE nfe.nota_fiscal_id IN (SELECT id FROM qa_nfs) AND dri.obrigatorio=true AND dri.status<>'satisfeito'
          AND (dri.prazo_limite <= (timezone('America/Sao_Paulo',now()))::date + 3 OR cd.status_documento='REJEITADO')) AS view_atencao
  `, [dataset.fund.id, dataset.cedents.map((item) => item.id), dataset.debtors.map((item) => item.id), dataset.operations.map((item) => item.id)])
  const metrics = result.rows[0]

  const integrity = (await client.query(`
    WITH qa_nfs AS (SELECT * FROM public.notas_fiscais WHERE fundo_id=$1)
    SELECT
      (SELECT count(*) FROM qa_nfs nf JOIN public.cedente_fundos cf ON cf.id=nf.cedente_fundo_id
        WHERE cf.fundo_id<>nf.fundo_id OR cf.cedente_id<>nf.cedente_id) AS cross_fund_nfs,
      (SELECT count(*) FROM public.cte_notas_fiscais cnf JOIN public.ctes c ON c.id=cnf.cte_id JOIN qa_nfs nf ON nf.id=cnf.nota_fiscal_id
        WHERE c.fundo_id<>nf.fundo_id OR c.cedente_id<>nf.cedente_id OR c.cedente_fundo_id<>nf.cedente_fundo_id) AS cross_fund_cte,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias m JOIN public.operacoes o ON o.id=m.operacao_id JOIN qa_nfs nf ON nf.id=m.nota_fiscal_id
        WHERE m.fundo_id<>nf.fundo_id OR o.cedente_id<>nf.cedente_id OR m.politica_operacional_versao_id<>o.politica_operacional_versao_id) AS incoherent_memories,
      (SELECT count(*) FROM public.operacao_nf_logistica_memorias m JOIN public.operacoes o ON o.id=m.operacao_id
        WHERE m.fundo_id=$1 AND m.etapa='aprovacao' AND m.gate_exigido=true AND m.status_logistico='INDETERMINADA'
          AND o.status::text NOT IN ('solicitada','em_analise')) AS gate_violations,
      (SELECT count(*) FROM (
        SELECT ela.nota_fiscal_id, ela.politica_operacional_versao_id, ela.familia_documental, count(*)
        FROM public.evidencias_logisticas_antecipadas ela WHERE ela.fundo_id=$1
        GROUP BY 1,2,3 HAVING count(*)>1
      ) d) AS duplicate_evidences,
      (SELECT count(*) FROM (
        SELECT dri.politica_requisito_id,dri.nota_fiscal_entrega_id,count(*)
        FROM public.documento_requisito_instancias dri JOIN public.nota_fiscal_entregas nfe ON nfe.id=dri.nota_fiscal_entrega_id
        WHERE nfe.nota_fiscal_id IN (SELECT id FROM qa_nfs) GROUP BY 1,2 HAVING count(*)>1
      ) d) AS duplicate_requirements,
      (SELECT count(*) FROM (
        SELECT m.operacao_id,m.nota_fiscal_id,m.etapa,count(*) FROM public.operacao_nf_logistica_memorias m
        WHERE m.fundo_id=$1 GROUP BY 1,2,3 HAVING count(*)>1
      ) d) AS duplicate_memories,
      (SELECT count(*) FROM public.documento_requisito_instancias dri JOIN public.nota_fiscal_entregas nfe ON nfe.id=dri.nota_fiscal_entrega_id
        JOIN public.evidencias_logisticas_antecipadas ela ON ela.nota_fiscal_id=nfe.nota_fiscal_id
          AND ela.familia_documental=CASE WHEN dri.tipo_documento_codigo_snapshot='cte' THEN 'cte' ELSE 'comprovante_entrega' END
        WHERE nfe.nota_fiscal_id IN (SELECT id FROM qa_nfs) AND dri.documento_id IS NOT NULL AND dri.documento_id<>ela.documento_id) AS reconciliation_copies,
      (SELECT count(DISTINCT status::text) FROM public.operacoes WHERE id=ANY($2)) AS operation_status_diversity,
      (SELECT count(DISTINCT cedente_id) FROM qa_nfs) AS cedent_diversity,
      (SELECT count(DISTINCT cnpj_destinatario) FROM qa_nfs) AS debtor_diversity
  `, [dataset.fund.id, dataset.operations.map((item) => item.id)])).rows[0]

  const fund = (await client.query('SELECT nome FROM public.fundos WHERE id=$1', [dataset.fund.id])).rows[0]
  check(fund?.nome === FUND_NAME, 'Fundo sintetico ausente ou divergente.')
  check(number(metrics.nfs) >= 50, 'Menos de 50 NFs logisticas.')
  check(number(metrics.cedentes) === 3, 'Quantidade de cedentes diferente de 3.')
  check(number(metrics.sacados) === 6, 'Quantidade de sacados diferente de 6.')
  check(number(metrics.operacoes) >= 18 && number(metrics.operacoes) <= 24, 'Operacoes fora da faixa 18-24.')
  check(number(metrics.entregues) > 0 && number(metrics.em_transito) > 0 && number(metrics.indeterminadas) > 0, 'Distribuicao logistica incompleta.')
  check(number(metrics.ctes) >= 12, 'Menos de 12 CT-es.')
  check(number(metrics.ctes_compartilhados) >= 4, 'Menos de 4 CT-es compartilhados.')
  check(number(metrics.canhotos) >= 20, 'Menos de 20 comprovantes/canhotos materializados.')
  check(number(metrics.postergacoes) >= 6, 'Menos de 6 postergacoes.')
  for (const key of ['cte_antecipado','cte_pos','comprovante_antecipado','comprovante_pos','aguardando_analise','rejeitados','pendencias_vencidas','memoria_criacao_entregue','memoria_criacao_transito']) {
    check(number(metrics[key]) > 0, `Cenario obrigatorio sem registros: ${key}.`)
  }
  for (const key of ['view_atencao','view_aguardando_gestor','view_antecipados','view_entregues_criacao','view_transito_criacao','view_indeterminadas']) {
    check(number(metrics[key]) > 0, `View rapida sem resultados: ${key}.`)
  }
  for (const [key, value] of Object.entries(integrity)) {
    if (key.endsWith('_diversity')) check(number(value) >= (key === 'operation_status_diversity' ? 4 : 3), `Diversidade insuficiente: ${key}.`)
    else check(number(value) === 0, `Falha de integridade ${key}: ${value}.`)
  }

  const routePath = resolve(process.cwd(), 'src/app/gestor/logistica/exportar/route.ts')
  check(existsSync(routePath), 'Exportador CSV da Central nao encontrado.')
  if (existsSync(routePath)) {
    const source = readFileSync(routePath, 'utf8')
    check(!/['"](?:nota_fiscal_id|documento_id|operacao_id|cte_id)['"]/i.test(source), 'Exportador CSV aparenta expor UUID interno no cabecalho.')
    check(source.includes('carregarCentralLogistica') && source.includes('semPaginacao'), 'Exportador nao reutiliza a Central sem paginacao.')
  }

  const total = number(metrics.nfs)
  const anticipated = number(metrics.envios_antecipados)
  console.log('\n=== CENTRAL LOGISTICA QA ===')
  console.log(`NFs acompanhadas: ${total} | ${brl(metrics.valor_total)}`)
  console.log(`Entregues: ${metrics.entregues} | ${brl(metrics.valor_entregue)}`)
  console.log(`Em transito: ${metrics.em_transito} | ${brl(metrics.valor_em_transito)}`)
  console.log(`Indeterminadas: ${metrics.indeterminadas} | ${brl(metrics.valor_indeterminado)}`)
  console.log(`Pendencias vencidas: ${metrics.pendencias_vencidas}`)
  console.log(`Aguardando analise: ${metrics.aguardando_analise}`)
  console.log(`Rejeitados: ${metrics.rejeitados}`)
  console.log(`CT-es: ${metrics.ctes} | compartilhados: ${metrics.ctes_compartilhados}`)
  console.log(`Comprovantes/canhotos materializados: ${metrics.canhotos}`)
  console.log(`Postergacoes: ${metrics.postergacoes}`)
  console.log(`Envios antecipados: ${anticipated}/${total} (${total ? Math.round(anticipated / total * 1000) / 10 : 0}%)`)

  const verifyReport = { seedVersion: SEED_VERSION, verifiedAt: new Date().toISOString(), projectRef: env.projectRef, metrics, integrity, failures }
  writeRestrictedJson(localManifestPath().replace('manifest.json', 'verify.json'), verifyReport)
  await client.query('ROLLBACK')
  if (failures.length) throw new Error(`Verify reprovado:\n- ${failures.join('\n- ')}`)
  console.log('\nVERIFY APROVADO: thresholds, invariantes, views rapidas e contrato estatico do CSV validados.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`\nFalha no verify: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
