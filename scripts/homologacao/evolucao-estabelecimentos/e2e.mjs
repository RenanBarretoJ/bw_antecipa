#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const checks = []

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  await db.query('BEGIN')

  const actorCedente = randomUUID()
  const actorCedenteOutro = randomUUID()
  const actorGestor = randomUUID()
  const actorGestorOutroFundo = randomUUID()
  const actorSuperAdmin = randomUUID()
  const fundo = randomUUID()
  const fundoOutro = randomUUID()
  const cnpjMatriz = makeCnpj('940000010001')
  const cnpjFilial = makeCnpj('940000010002')
  const cnpjMatrizOutro = makeCnpj('940000020001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorCedenteOutro, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorGestorOutroFundo, 'gestor')
  await createAuthUser(actorSuperAdmin, 'cedente')
  await db.query(`update public.profiles set role = 'super_admin' where id = $1`, [actorSuperAdmin])

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Evolucao A',$2,'QA Admin',$3,'QA Gestora',$4,true,$5),
           ($6,'QA Evolucao B',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundo, makeCnpj('950000010001'), makeCnpj('950000010002'), makeCnpj('950000010003'), actorGestor,
    fundoOutro, makeCnpj('950000020001'), makeCnpj('950000020002'), makeCnpj('950000020003'),
  ])

  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Evolucao','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteOutro = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Outro','ativo') returning id`, [actorCedenteOutro, cnpjMatrizOutro])).rows[0].id
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [cedente, fundo])
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [cedenteOutro, fundoOutro])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorOutroFundo, fundoOutro])

  const matriz = (await db.query(`select id,status from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0]
  ok('Matriz e criada aprovada automaticamente (Cedente ativo)', matriz.status === 'aprovado')

  const tipos = (await db.query(`select id, codigo from public.documento_tipos
    where codigo in ('estabelecimento_cartao_cnpj','estabelecimento_comprovante_faturamento','estabelecimento_contrato_social')`)).rows
  const tipoCartao = tipos.find((t) => t.codigo === 'estabelecimento_cartao_cnpj')
  const tipoFaturamento = tipos.find((t) => t.codigo === 'estabelecimento_comprovante_faturamento')
  const tipoContratoSocial = tipos.find((t) => t.codigo === 'estabelecimento_contrato_social')
  if (!tipoCartao || !tipoFaturamento || !tipoContratoSocial) throw new Error('Catalogo cadastro de estabelecimento incompleto em homologacao')

  // Passo 1: documento legado ja aprovado no onboarding do Cedente (cartao_cnpj).
  await db.query(`insert into public.documentos (cedente_id,tipo,versao,status,url_arquivo,nome_arquivo,analisado_por,analisado_em)
    values ($1,'cartao_cnpj',1,'aprovado','https://example.invalid/qa.pdf','qa.pdf',$2,now())`, [cedente, actorGestor])

  // Passo 2: Gestor configura o checklist cadastral da Matriz -- 1 tipo com
  // equivalente legado aprovado, 1 sem equivalente aprovado.
  await asActor(actorGestor)
  const reqCartao = (await db.query(`select public.configurar_requisito_estabelecimento_gestor($1,$2,true,true,'QA reuso') resultado`, [matriz.id, tipoCartao.id])).rows[0].resultado
  ok('Configurar requisito com equivalente legado nao gera pendencia pos-aprovacao (ja satisfeito)', reqCartao.pendencia_pos_aprovacao === false)

  const reqFaturamento = (await db.query(`select public.configurar_requisito_estabelecimento_gestor($1,$2,true,true,'QA sem reuso') resultado`, [matriz.id, tipoFaturamento.id])).rows[0].resultado
  ok('Configurar requisito sem equivalente legado aprovado gera pendencia pos-aprovacao', reqFaturamento.pendencia_pos_aprovacao === true)

  // Passo 3: checklist da Matriz reflete reuso sem duplicar Storage.
  const checklistMatriz = (await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [matriz.id])).rows
  const statusCartao = checklistMatriz.find((r) => r.documento_tipo_codigo === 'estabelecimento_cartao_cnpj')
  const statusFaturamento = checklistMatriz.find((r) => r.documento_tipo_codigo === 'estabelecimento_comprovante_faturamento')
  ok('Cartao CNPJ da Matriz aparece aprovado com origem cadastro_inicial', statusCartao?.status === 'aprovado' && statusCartao?.origem === 'cadastro_inicial' && statusCartao?.documento_versao_id === null)
  ok('Comprovante de Faturamento da Matriz sem equivalente legado fica pendente', statusFaturamento?.status === 'pendente' && statusFaturamento?.origem === null)

  // Passo 4: Cedente cadastra Filial; Filial NAO herda documentos da Matriz.
  await asActor(actorCedente)
  const filial = (await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilial, 'QA Filial Evolucao', null])).rows[0]
  ok('Filial e cadastrada em estado pendente', filial.status === 'pendente')

  await asActor(actorGestor)
  const reqFilial = (await db.query(`select public.configurar_requisito_estabelecimento_gestor($1,$2,true,true,'QA Filial') resultado`, [filial.id, tipoContratoSocial.id])).rows[0].resultado
  const checklistFilialInicial = (await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])).rows
  ok('Filial nao herda documento da Matriz para requisito equivalente', checklistFilialInicial.find((r) => r.documento_tipo_codigo === 'estabelecimento_contrato_social')?.status === 'pendente')
  ok('Requisito recem-criado da Filial nao esta aprovada ainda (sem pendencia pos-aprovacao, pois Filial nao esta aprovada)', reqFilial.pendencia_pos_aprovacao === false)

  // Passo 5: gate bloqueia aprovacao da Filial sem documentos obrigatorios.
  await expectError('Gate bloqueia aprovacao da Filial com documento obrigatorio pendente', async () => {
    await db.query(`select * from public.decidir_estabelecimento_gestor($1,'aprovar',null)`, [filial.id])
  }, /DOCUMENTOS_OBRIGATORIOS_PENDENTES/)

  // Passo 6: Cedente envia o documento; Gestor reprova; Cedente reenvia; Gestor aprova.
  await asActor(actorCedente)
  const requisitoFilialId = reqFilial.requisito.id
  const uploadInicial = (await db.query(`select public.registrar_documento_estabelecimento_upload(
    $1,$2,$3,'contrato.pdf','application/pdf',10,$4,'documentos-v2',$5,null) resultado`,
    [filial.id, requisitoFilialId, tipoContratoSocial.id, 'b'.repeat(64), `qa/evolucao/${randomUUID()}.pdf`])).rows[0].resultado

  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_estabelecimento_gestor($1,'rejeitado','Documento ilegivel')`, [uploadInicial.versao_id])
  const checklistAposReprova = (await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])).rows
  const statusReprovado = checklistAposReprova.find((r) => r.documento_tipo_codigo === 'estabelecimento_contrato_social')
  ok('Documento reprovado mostra status e motivo', statusReprovado?.status === 'rejeitado' && statusReprovado?.motivo === 'Documento ilegivel')

  await asActor(actorCedente)
  const uploadCorrigido = (await db.query(`select public.registrar_documento_estabelecimento_upload(
    $1,$2,$3,'contrato-v2.pdf','application/pdf',10,$4,'documentos-v2',$5,$6) resultado`,
    [filial.id, requisitoFilialId, tipoContratoSocial.id, 'c'.repeat(64), `qa/evolucao/${randomUUID()}.pdf`, uploadInicial.versao_id])).rows[0].resultado
  ok('Reenvio cria nova versao do mesmo documento (nao duplica registro)', uploadCorrigido.documento_id === uploadInicial.documento_id && uploadCorrigido.numero_versao === 2)

  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_estabelecimento_gestor($1,'aprovado',null)`, [uploadCorrigido.versao_id])

  // Passo 7: sem conta bancaria principal, gate ainda bloqueia.
  await expectError('Gate bloqueia aprovacao da Filial sem conta bancaria principal', async () => {
    await db.query(`select * from public.decidir_estabelecimento_gestor($1,'aprovar',null)`, [filial.id])
  }, /CONTA_BANCARIA_PENDENTE/)

  await asActor(actorCedente)
  await db.query(`select * from public.salvar_conta_estabelecimento_cedente($1,'237','0001','98765-4','corrente',true)`, [filial.id])

  await asActor(actorGestor)
  const filialAprovada = (await db.query(`select * from public.decidir_estabelecimento_gestor($1,'aprovar',null)`, [filial.id])).rows[0]
  ok('Gate permite aprovacao da Filial com checklist e conta completos', filialAprovada.status === 'aprovado')

  // Passo 8: pendencia documental pos-aprovacao nao rebaixa status nem originacao.
  const pendenciaPosAprovacao = (await db.query(`select public.configurar_requisito_estabelecimento_gestor($1,$2,true,true,'QA pos-aprovacao') resultado`, [filial.id, tipoFaturamento.id])).rows[0].resultado
  ok('Novo requisito obrigatorio pos-aprovacao gera pendencia_pos_aprovacao=true', pendenciaPosAprovacao.pendencia_pos_aprovacao === true)
  const filialAposNovoRequisito = (await db.query(`select status,ativo from public.cedente_estabelecimentos where id=$1`, [filial.id])).rows[0]
  ok('Estabelecimento aprovado permanece aprovado apos novo requisito', filialAposNovoRequisito.status === 'aprovado' && filialAposNovoRequisito.ativo === true)

  await asActor(actorCedente)
  const podeOriginarAposPendencia = (await db.query(`select public.estabelecimento_pode_originar($1,$2,$3) permitido`, [filial.id, cedente, fundo])).rows[0].permitido
  ok('Originacao continua permitida apos pendencia documental pos-aprovacao', podeOriginarAposPendencia === true)

  // Passo 9: seguranca -- cross-fundo, cross-cedente, Super Admin puro, anon.
  await expectError('Gestor de outro fundo nao acessa checklist da Filial (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])
  }, /nao encontrado/i)

  await expectError('Gestor de outro fundo nao analisa documento (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select public.analisar_documento_estabelecimento_gestor($1,'aprovado',null)`, [uploadCorrigido.versao_id])
  }, /Acesso negado|nao encontrado/i)

  await expectError('Gestor de outro fundo nao decide aprovacao (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select * from public.decidir_estabelecimento_gestor($1,'suspender','tentativa indevida')`, [filial.id])
  }, /nao encontrado/i)

  await expectError('Cedente diferente nao acessa checklist da Filial alheia (cross-cedente)', async () => {
    await asActor(actorCedenteOutro)
    await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])
  }, /nao encontrado/i)

  await expectError('Super Admin puro nao recebe acesso operacional implicito', async () => {
    await asActor(actorSuperAdmin)
    await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])
  }, /nao encontrado/i)

  await expectError('Anon nao acessa checklist de estabelecimento', async () => {
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role: 'anon' })])
    await db.query('SET LOCAL ROLE anon')
    await db.query(`select * from public.listar_requisitos_estabelecimento($1)`, [filial.id])
  }, /permission denied/i)

  await db.query('RESET ROLE')
  const auditoria = await db.query(`select count(*)::int quantidade from public.logs_auditoria
    where entidade_tipo in ('documento_versoes','cedente_estabelecimentos') and origem = 'gestor_estabelecimentos'`)
  ok('Analises e decisoes geram trilha de auditoria', auditoria.rows[0].quantidade >= 4)

  await db.query('ROLLBACK')
  console.log(JSON.stringify({
    project_ref: apiRef,
    transaction: 'ROLLED_BACK',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(JSON.stringify({ project_ref: apiRef, transaction: 'ROLLED_BACK', error: error instanceof Error ? error.message : String(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  await db.end()
}

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-evolucao-estabelecimentos-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
  ])
}

async function asActor(userId) {
  await db.query('RESET ROLE')
  const claims = { sub: userId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

async function expectError(name, callback, pattern) {
  const savepoint = `sp_${checks.length}`
  await db.query(`SAVEPOINT ${savepoint}`)
  try {
    await callback()
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, false, 'A operacao deveria ter sido bloqueada')
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, pattern.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error))
  }
}

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha E2E: ${name}${evidence ? ` (${evidence})` : ''}`)
}

function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, index) => sum + value * weights[index], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${d2}`
}

function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}

function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
