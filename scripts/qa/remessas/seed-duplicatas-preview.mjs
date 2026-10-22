import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { connectDuplicatasPreview } from './preview-db.mjs'
import { nfeFixtureKey } from '../../email-intake/nfe-fixture-key.mjs'

// Explicit synthetic administrative fixture. No financial approval, session creation,
// provider calls, policy changes or changes to preexisting business records.
assert.deepEqual(process.argv.slice(2), ['--apply'])
const tag = 'QA_VRS_DUPLICATAS_20261022'
const fund = '0df93349-4244-4398-b9a8-db1c036dae7a'
const actor = '174a4e39-b985-40c8-a146-423d5d891bb7'
function syntheticCnpj(prefix) {
  let value = prefix
  for (const weights of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const rest = [...value].reduce((sum, digit, i) => sum + Number(digit) * weights[i], 0) % 11
    value += rest < 2 ? '0' : String(11 - rest)
  }
  return value
}
const issuer = syntheticCnpj('989910220001'), debtor = '98765432000198'
const ids = { cedente: randomUUID(), link: randomUUID(), establishment: randomUUID(), operation: randomUUID() }
const output = resolve(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'bw-antecipa-evidence', `vrs-qa-${Date.now()}`)
mkdirSync(output, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const stableValue = v => Array.isArray(v) ? v.map(stableValue) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, stableValue(value)])) : v
function proofPdf(text) {
  const stream = `BT /F1 10 Tf 40 780 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
const report = { tag, project: 'phdckowbexkkvuwnzeaf', fund, ...ids, result: 'PENDING', providerRequests: 0, approvalPerformed: false, notes: [] }
const uploaded = []
let db, storage, committed = false
const insert = async (table, row) => {
  report.stage = `INSERT_${table}`
  assert(/^[a-z_]+$/.test(table))
  const columns = Object.keys(row)
  assert(columns.every(c => /^[a-z_][a-z_0-9]*$/.test(c)))
  await db.query(`insert into public.${table}(${columns.join(',')}) values(${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(c => row[c]))
}
async function upload(bucket, path, bytes, contentType) {
  const { error } = await storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
  assert(!error, 'QA_STORAGE_UPLOAD_FAILED')
  uploaded.push({ bucket, path })
  return path
}
try {
  const connection = await connectDuplicatasPreview(); db = connection.db
  storage = createClient(connection.details.SUPABASE_URL, connection.details.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage
  assert.equal((await db.query('select count(*)::int n from public.cedentes where razao_social=$1', [tag])).rows[0].n, 0, 'QA_ALREADY_EXISTS_USE_EXISTING_REPORT')
  const existingOperations = (await db.query('select id,md5(to_jsonb(o)::text) hash from public.operacoes o order by id')).rows
  const policy = (await db.query("select * from public.politica_operacional_versoes where fundo_id=$1 and status='publicada' and vigente_ate is null order by versao desc limit 1", [fund])).rows[0]
  assert(policy, 'PUBLISHED_FUND_POLICY_REQUIRED')
  const requirements = (await db.query('select * from public.politica_requisitos_documentais where politica_operacional_versao_id=$1 and ativo order by ordem,id', [policy.id])).rows
  let bank = (await db.query("select * from public.bancos where codigo='001' and ativo")).rows[0]
  const bankCount = (await db.query('select count(*)::int n from public.bancos')).rows[0].n
  assert(bank || bankCount === 0, 'EXISTING_BANK_CATALOG_REQUIRES_OPERATOR_REVIEW')
  assert.equal((await db.query('select private.cnpj_valido($1) valid', [issuer])).rows[0].valid, true)
  const date = (await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text d")).rows[0].d
  assert.equal(date, '2026-10-22', 'FIXTURE_REFERENCE_DATE_CHANGED_REVIEW_REQUIRED')
  await db.query('set default_transaction_read_only=off')
  await db.query('begin read write')
  await db.query('select pg_advisory_xact_lock(20261022,220010)')
  if (!bank) {
    // Same bank reference used by the repository's structured-account fixtures.
    bank = { id: randomUUID(), codigo: '001', ispb: '00000000', nome: 'Banco do Brasil', nome_completo: 'Banco do Brasil S.A.', fonte: 'seed', ativo: true }
    await insert('bancos', bank); report.createdBankReference = bank.id
  }
  await insert('cedentes', { id: ids.cedente, cnpj: issuer, razao_social: tag, status: 'ativo', fundo_id: fund, coobrigacao: true })
  const establishments = (await db.query('select * from public.cedente_estabelecimentos where cedente_id=$1', [ids.cedente])).rows
  assert.equal(establishments.length, 1, 'CANONICAL_ESTABLISHMENT_COUNT')
  const establishment = establishments[0]
  assert(establishment.cnpj === issuer && establishment.tipo === 'matriz' && establishment.status === 'aprovado' && establishment.ativo === true, 'UNEXPECTED_CANONICAL_ESTABLISHMENT')
  ids.establishment = establishment.id
  report.establishment = establishment.id
  await insert('cedente_fundos', { id: ids.link, cedente_id: ids.cedente, fundo_id: fund, status: 'ativo', base_valor_antecipacao: 'BRUTO', observacoes: tag })
  const assignment = randomUUID()
  await insert('cedente_fundo_politicas', { id: assignment, cedente_fundo_id: ids.link, politica_operacional_id: policy.politica_operacional_id, status: 'ativa', atribuido_por: actor, motivo: tag })
  await insert('cedente_estabelecimento_contas_bancarias', { estabelecimento_id: ids.establishment, titular_estabelecimento_id: ids.establishment, banco: `${bank.codigo} - ${bank.nome}`, banco_codigo: bank.codigo, banco_ispb: bank.ispb, banco_nome: bank.nome, agencia: '1234', conta: '100-7', principal: true, ativo: true, criado_por: actor })
  // All rules come from the published fund version; the fixture does not relax it.
  const snapshot = { schema: 'bw-antecipa.politica-operacional.v1', base_valor_antecipacao: 'BRUTO', cedente_fundo_id: ids.link, fundo_id: fund, politica_operacional_id: policy.politica_operacional_id, politica_operacional_versao_id: policy.id, politica_versao: policy.versao, politica_atribuicao_id: assignment,
    ...Object.fromEntries(['aceite_sacado_obrigatorio', 'cessao_no_desembolso', 'cria_acompanhamento_entrega', 'exigir_status_logistico_pre_cessao', 'permite_postergacao_upload_canhoto', 'limite_postergacao_upload_canhoto_dias', 'controle_exposicao_logistica_ativo', 'limite_exposicao_em_transito_pct', 'gate_risco_ativo', 'limite_inclusivo', 'tipo_ativo_financeiro'].map(k => [k, policy[k]])),
    calculo_financeiro: { metodo: policy.metodo_calculo_financeiro, versao_motor: policy.metodo_calculo_financeiro === 'TRINTA_360' ? 2 : 1 }, configuracao: policy.configuracao,
    requisitos: requirements.map(r => Object.fromEntries(['id', 'documento_tipo_id', 'codigo', 'escopo', 'tipo_documento_codigo', 'obrigatorio', 'quantidade_minima', 'formatos_aceitos', 'nivel_validacao', 'prazo_dias_corridos', 'responsavel_upload', 'responsavel_aprovacao', 'ordem', 'ativo', 'familia_documental'].map(k => [k, r[k]]))),
  }
  const selected = []
  for (let i = 1; i <= 10; i++) {
    const nf = { id: randomUUID(), number: String(991022000 + i), scenario: i <= 4 ? 'TODAS_3_PARCELAS' : i <= 8 ? 'PARCELAS_1_E_3_DE_4' : 'PARCELA_UNICA', totalParcels: i <= 4 ? 3 : i <= 8 ? 4 : 1, delivered: i % 2 === 0, parcels: [] }
    nf.key = nfeFixtureKey({ issuer, number: nf.number, issued: date })
    for (let p = 1; p <= nf.totalParcels; p++) {
      const due = new Date(`${date}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + p * 30)
      nf.parcels.push({ id: randomUUID(), number: p, due: due.toISOString().slice(0, 10), nominal: 1000 + i * 100, selected: i <= 4 || i >= 9 || p === 1 || p === 3 })
    }
    const amount = nf.parcels.reduce((a, p) => a + p.nominal, 0)
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe${nf.key}" versao="4.00"><ide><nNF>${nf.number}</nNF><serie>1</serie><dhEmi>${date}T09:00:00-03:00</dhEmi></ide><emit><CNPJ>${issuer}</CNPJ><xNome>${tag}</xNome></emit><dest><CNPJ>${debtor}</CNPJ><xNome>SACADO QA SINTETICO</xNome><enderDest><xLgr>Rua QA</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF><CEP>01310100</CEP></enderDest></dest><total><ICMSTot><vNF>${amount.toFixed(2)}</vNF></ICMSTot></total><cobr>${nf.parcels.map(p => `<dup><nDup>${p.number}</nDup><dVenc>${p.due}</dVenc><vDup>${p.nominal.toFixed(2)}</vDup></dup>`).join('')}</cobr><infAdic><infCpl>${tag} - SEM VALOR FISCAL</infCpl></infAdic></infNFe></NFe></nfeProc>`)
    const path = await upload('notas-fiscais', `qa-vrs/${ids.operation}/${nf.number}.xml`, xml, 'application/xml')
    await insert('notas_fiscais', { id: nf.id, cedente_id: ids.cedente, fundo_id: fund, cedente_fundo_id: ids.link, estabelecimento_id: ids.establishment, numero_nf: nf.number, serie: '1', chave_acesso: nf.key, data_emissao: date, data_vencimento: nf.parcels.at(-1).due, cnpj_emitente: issuer, razao_social_emitente: tag, cnpj_destinatario: debtor, razao_social_destinatario: 'SACADO QA SINTETICO', valor_bruto: amount, valor_liquido: amount, valor_liquido_origem: 'DOCUMENTO_EXPLICITO', arquivo_url: path, status: 'aceita', tipo_documento_fiscal: 'NFE', descricao_itens: `${tag} - SEM VALOR FISCAL`, source_channel: 'MANUAL_UPLOAD' })
    for (const p of nf.parcels) {
      await insert('nota_fiscal_parcelas', { id: p.id, nota_fiscal_id: nf.id, numero_parcela: p.number, valor_nominal: p.nominal, data_vencimento: p.due, origem: 'xml_nfe', status: p.selected ? 'em_operacao' : 'disponivel' })
      if (p.selected) {
        const memory = (await db.query('select private.calcular_memoria_financeira_nf($1,$2,2.5,$3,$4,$5) m', [nf.id, p.nominal, date, p.due, policy.metodo_calculo_financeiro])).rows[0].m
        selected.push({ ...memory, parcela_id: p.id })
      }
    }
    report.notes.push(nf)
  }
  const base = (await db.query('select private.capturar_base_antecipacao($1,$2,$3,$4) b', [ids.link, policy.id, report.notes.map(n => n.id), selected.map(m => m.parcela_id)])).rows[0].b
  const nominal = selected.reduce((a, m) => a + Number(m.valor_nominal), 0), present = Math.round(selected.reduce((a, m) => a + Number(m.valor_presente), 0) * 100) / 100
  await insert('operacoes', { id: ids.operation, cedente_id: ids.cedente, cedente_fundo_id: ids.link, status: 'em_analise', politica_operacional_id: policy.politica_operacional_id, politica_operacional_versao_id: policy.id, politica_versao: policy.versao, politica_atribuicao_id: assignment, politica_snapshot: snapshot, politica_snapshot_hash: sha(JSON.stringify(stableValue(snapshot))), contexto_configuracao_status: 'completo', contexto_capturado_em: new Date(), aceite_sacado_exigido: policy.aceite_sacado_obrigatorio, aceite_sacado_status: 'aceito', valor_bruto_total: nominal, valor_liquido_desembolso: present, taxa_desconto: 2.5, prazo_dias: Math.round(selected.reduce((a, m) => a + Number(m.valor_nominal) * Number(m.dias), 0) / nominal), data_vencimento: report.notes.flatMap(n => n.parcels.filter(p => p.selected).map(p => p.due)).sort().at(-1), base_antecipacao_snapshot: base, calculo_memoria: { tipo: tag, itens: selected, data_base: date, metodo: policy.metodo_calculo_financeiro, taxa_mensal: 2.5, valor_bruto_total: nominal, valor_liquido_total: present }, solicitacao_idempotency_key: tag })
  for (const nf of report.notes) {
    const createDocument = async (code, mime) => {
      let type = (await db.query('select id from public.documento_tipos where codigo=$1', [code])).rows[0]
      if (!type) { type = { id: randomUUID() }; await insert('documento_tipos', { id: type.id, codigo: code, nome: `${code} QA`, dominio: 'entrega', mime_types_aceitos: [mime], extensoes_aceitas: [mime === 'application/xml' ? 'xml' : 'pdf'] }) }
      const document = randomUUID(), version = randomUUID(), bytes = mime === 'application/xml' ? Buffer.from(`<?xml version="1.0"?><CTeQA><aviso>${tag} SEM VALOR FISCAL</aviso><NF>${nf.number}</NF></CTeQA>`) : proofPdf(`${tag} NF ${nf.number} SEM VALOR FISCAL`)
      const path = await upload('documentos-v2', `qa-vrs/${ids.operation}/${document}.${mime === 'application/xml' ? 'xml' : 'pdf'}`, bytes, mime)
      await insert('documentos_repositorio', { id: document, documento_tipo_id: type.id, status: 'aprovado', criado_por: actor })
      await insert('documento_versoes', { id: version, documento_id: document, numero_versao: 1, bucket: 'documentos-v2', path, nome_original: `${tag}_${code}_${nf.number}`, mime_type: mime, tamanho_bytes: bytes.length, sha256: sha(bytes), status: 'aprovado', enviado_por: actor })
      await insert('documento_analises', { documento_versao_id: version, resultado: 'aprovado', analisado_por: actor, observacoes: `${tag} - analise sintetica de fixture; nao e documento real` })
      const family = code === 'cte_xml' ? 'cte' : 'comprovante_entrega'
      const requirement = requirements.find(r => r.familia_documental === family || r.tipo_documento_codigo === family)
      assert(requirement, 'PUBLISHED_LOGISTICS_REQUIREMENT_REQUIRED')
      const evidence = randomUUID()
      await insert('evidencias_logisticas_antecipadas', { id: evidence, nota_fiscal_id: nf.id, fundo_id: fund, cedente_id: ids.cedente, cedente_fundo_id: ids.link, politica_operacional_versao_id: policy.id, politica_requisito_id: requirement.id, familia_documental: family, documento_id: document, documento_versao_atual_id: version, criado_por: actor })
      await insert('evidencia_logistica_versoes', { evidencia_logistica_id: evidence, documento_id: document, documento_versao_id: version })
      return { document, version }
    }
    const cte = await createDocument('cte_xml', 'application/xml'), cteId = randomUUID()
    await insert('ctes', { id: cteId, cedente_id: ids.cedente, fundo_id: fund, cedente_fundo_id: ids.link, numero: `${tag}-${nf.number}`, formato_origem: 'xml', nivel_validacao: 'manual', status: 'aprovado', documento_id: cte.document, documento_versao_atual_id: cte.version, documento_versao_aprovada_id: cte.version, analisado_por: actor, analisado_em: new Date(), dados_extraidos: { synthetic: true, qa_dataset: tag } })
    await insert('cte_notas_fiscais', { cte_id: cteId, nota_fiscal_id: nf.id, chave_nfe_referenciada: nf.key, status_validacao: 'aprovado' })
    await insert('documento_vinculos', { documento_id: cte.document, cte_id: cteId, cedente_id: ids.cedente, principal: true })
    // Canonical logistics trigger now sees the approved CT-e. The delivery FK
    // requires this operation/NF relationship before a proof can be registered.
    await insert('operacoes_nfs', { operacao_id: ids.operation, nota_fiscal_id: nf.id })
    if (nf.delivered) {
      const proof = await createDocument('comprovante_entrega', 'application/pdf'), delivery = randomUUID()
      await insert('nota_fiscal_entregas', { id: delivery, operacao_id: ids.operation, nota_fiscal_id: nf.id, status_entrega: 'aguardando_validacao', data_entrega: date })
      await insert('canhotos', { nota_fiscal_entrega_id: delivery, status: 'aprovado', documento_id: proof.document, documento_versao_atual_id: proof.version, documento_versao_aprovada_id: proof.version, analisado_por: actor, analisado_em: new Date(), nome_recebedor: 'RECEBEDOR SINTETICO QA' })
      await insert('documento_vinculos', { documento_id: proof.document, nota_fiscal_entrega_id: delivery, cedente_id: ids.cedente, principal: true })
    }
  }
  // Financial links retain only the explicitly selected synthetic installments.
  for (const nf of report.notes) {
    for (const m of selected.filter(m => m.nota_fiscal_id === nf.id)) {
      await insert('operacoes_nf_parcelas', { operacao_id: ids.operation, nota_fiscal_id: nf.id, parcela_id: m.parcela_id })
      await insert('operacao_calculo_nfs', { operacao_id: ids.operation, nota_fiscal_id: nf.id, parcela_id: m.parcela_id, fundo_id: fund, cedente_id: ids.cedente, metodo_calculo_financeiro: m.metodo, valor_nominal: m.valor_nominal, taxa_mensal: m.taxa_mensal, data_base: m.data_base, vencimento_contratual: m.vencimento_contratual, vencimento_calculo: m.vencimento_calculo, base_calculo: m.base, dias_corridos_reais: m.dias_corridos_reais, dias_uteis: m.dias_uteis, dias_financeiros: m.dias_financeiros, dias_aplicados: m.dias, expoente: m.expoente, fator: m.fator, valor_presente: m.valor_presente, desconto: m.desconto, versao_motor: m.versao_motor })
    }
  }
  assert.equal(report.notes.length, 10); assert.equal(selected.length, 22)
  assert.deepEqual((await db.query('select id,md5(to_jsonb(o)::text) hash from public.operacoes o where id<>$1 order by id', [ids.operation])).rows, existingOperations)
  await insert('logs_auditoria', { usuario_id: actor, tipo_evento: 'QA_VRS_DUPLICATAS_CRIADA', entidade_tipo: 'operacao', entidade_id: ids.operation, origem: 'script_qa_preview', dados_depois: { qa_dataset: tag, synthetic: true, nfs: 10, parcelas_total: 30, parcelas_selecionadas: 22, approval_performed: false } })
  await db.query('commit'); committed = true
  report.result = 'PASS'; report.selected = selected.length; report.nominal = nominal; report.present = present; report.status = 'em_analise'
} catch (error) {
  await db?.query('rollback').catch(() => {})
  report.result = 'FAIL'; report.error = { code: error.code ?? null, constraint: error.constraint ?? null, table: error.table ?? null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'QA_SEED_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (!committed && storage) for (const { bucket, path } of uploaded) { const { error } = await storage.from(bucket).remove([path]); assert(!error, 'QA_NEW_UPLOAD_COMPENSATION_FAILED') }
  await db?.end().catch(() => {})
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, result: report.result, operation: report.operation, nfs: report.notes.length, selected: report.selected, status: report.status, error: report.error ?? null }))
}
