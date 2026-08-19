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
if (!`${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`.includes(EXPECTED_PROJECT_REF)) {
  throw new Error('Destino PostgreSQL nao corresponde a homologacao autorizada.')
}
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  await db.query('BEGIN')

  const actorCedenteA = randomUUID()
  const actorCedenteB = randomUUID()
  const actorGestor = randomUUID()
  const actorSuperAdmin = randomUUID()
  const fundoA = randomUUID()
  const fundoB = randomUUID()
  const cnpjMatrizA = makeCnpj('910000010001')
  const cnpjFilialA = makeCnpj('910000010002')
  const cnpjFilialPendente = makeCnpj('910000010003')
  const cnpjMatrizB = makeCnpj('910000020001')

  await createAuthUser(actorCedenteA, 'cedente')
  await createAuthUser(actorCedenteB, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorSuperAdmin, 'cedente')
  await db.query(`update public.profiles set role = 'super_admin' where id = $1`, [actorSuperAdmin])

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Multi-CNPJ A',$2,'QA Admin A',$3,'QA Gestora A',$4,true,$5),
           ($6,'QA Multi-CNPJ B',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundoA, makeCnpj('920000010001'), makeCnpj('920000010002'), makeCnpj('920000010003'), actorGestor,
    fundoB, makeCnpj('920000020001'), makeCnpj('920000020002'), makeCnpj('920000020003'),
  ])

  const cedenteA = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente A','ativo') returning id`, [actorCedenteA, cnpjMatrizA])).rows[0].id
  const cedenteB = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente B','ativo') returning id`, [actorCedenteB, cnpjMatrizB])).rows[0].id
  const vinculoA = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedenteA, fundoA])).rows[0].id
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [cedenteB, fundoB])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundoA])

  const matrizA = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedenteA])).rows[0].id
  const matrizB = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedenteB])).rows[0].id
  ok('backfill/trigger cria exatamente uma Matriz por Cedente', Boolean(matrizA && matrizB))

  await asActor(actorCedenteA)
  const filialA = (await db.query(`select id,status from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilialA, 'QA Filial A', 'QA Filial A'])).rows[0]
  ok('Cedente cadastra Filial em estado pendente', filialA.status === 'pendente')

  await expectError('CNPJ e globalmente unico entre Cedentes', async () => {
    await asActor(actorCedenteB)
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilialA, 'Duplicada', null])
  }, /duplicate key|ja cadastrado/i)

  await asActor(actorCedenteA)
  const propriaAntes = await db.query(`select id from public.cedente_estabelecimentos order by tipo,id`)
  ok('Cedente enxerga somente seus estabelecimentos via RLS', propriaAntes.rowCount === 2)

  await asActor(actorCedenteB)
  const outraEmpresa = await db.query(`select id from public.cedente_estabelecimentos order by tipo,id`)
  ok('Outro Cedente nao enxerga Matriz/Filial alheia', outraEmpresa.rowCount === 1 && outraEmpresa.rows[0].id === matrizB)

  await asActor(actorCedenteA)
  // Evolucao de Estabelecimentos (P0 posterior): decidir_estabelecimento_gestor
  // passou a exigir conta bancaria principal antes de aprovar uma Filial.
  // A conta precisa existir antes da aprovacao nesta regressao.
  const contaFilial = await db.query(`select id from public.salvar_conta_estabelecimento_cedente($1,'001','1234','56789-0','corrente',true)`, [filialA.id])
  const contaVinculada = await db.query(`select estabelecimento_id,principal from public.cedente_estabelecimento_contas_bancarias where id=$1`, [contaFilial.rows[0].id])
  ok('Filial possui conta bancaria propria e principal', contaVinculada.rows[0].estabelecimento_id === filialA.id && contaVinculada.rows[0].principal)

  await asActor(actorGestor)
  const gestorVisiveis = await db.query(`select id from public.cedente_estabelecimentos order by tipo,id`)
  ok('Gestor enxerga somente estabelecimentos dos fundos autorizados', gestorVisiveis.rowCount === 2)
  await db.query(`select * from public.decidir_estabelecimento_gestor($1,'aprovar',null)`, [filialA.id])

  await asActor(actorCedenteA)
  const gateAprovado = await db.query(`select public.estabelecimento_pode_originar($1,$2,$3) permitido`, [filialA.id, cedenteA, fundoA])
  ok('Filial aprovada herda o vinculo Cedente-Fundo', gateAprovado.rows[0].permitido === true)

  await asActor(actorGestor)
  const documentoTipo = (await db.query(`select id from public.documento_tipos where ativo order by codigo limit 1`)).rows[0]
  if (!documentoTipo) throw new Error('Catalogo documental de homologacao esta vazio')
  const requisitoResultado = (await db.query(`select public.configurar_requisito_estabelecimento_gestor($1,$2,true,true,'QA Multi-CNPJ') resultado`, [filialA.id, documentoTipo.id])).rows[0].resultado
  const requisito = requisitoResultado.requisito
  ok('Gestor configura checklist proprio da Filial', Boolean(requisito.id))

  await asActor(actorCedenteA)
  const documento = await db.query(`select public.registrar_documento_estabelecimento_upload(
    $1,$2,$3,'qa.pdf','application/pdf',10,$4,'documentos-v2',$5,null
  ) resultado`, [filialA.id, requisito.id, documentoTipo.id, 'a'.repeat(64), `qa/multi-cnpj/${randomUUID()}.pdf`])
  ok('Cedente registra documento no checklist do estabelecimento', Boolean(documento.rows[0].resultado?.versao_id))

  const nfFilial = await insertNf({ cedenteId: cedenteA, vinculoId: vinculoA, fundoId: fundoA, cnpjEmitente: cnpjFilialA, numero: 'QA-MC-1' })
  ok('NF da Filial aprovada deriva estabelecimento_id no servidor', nfFilial.estabelecimento_id === filialA.id)

  await expectError('CNPJ nao cadastrado e bloqueado antes da origem', () => insertNf({
    cedenteId: cedenteA, vinculoId: vinculoA, fundoId: fundoA, cnpjEmitente: makeCnpj('910000990001'), numero: 'QA-MC-2',
  }), /CNPJ emitente nao esta cadastrado|Estabelecimento emissor nao cadastrado/i)

  const filialPendente = (await db.query(`select id,status from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilialPendente, 'QA Filial Pendente', null])).rows[0]
  await expectError('Filial pendente nao pode originar NF', () => insertNf({
    cedenteId: cedenteA, vinculoId: vinculoA, fundoId: fundoA, cnpjEmitente: cnpjFilialPendente, numero: 'QA-MC-3',
  }), /nao esta aprovado|nao esta autorizado|nao pode originar/i)

  await asActor(actorGestor)
  await db.query(`select * from public.decidir_estabelecimento_gestor($1,'suspender','QA de bloqueio da Matriz')`, [matrizA])
  await asActor(actorCedenteA)
  const gateMatrizSuspensa = await db.query(`select public.estabelecimento_pode_originar($1,$2,$3) permitido`, [filialA.id, cedenteA, fundoA])
  ok('Matriz suspensa bloqueia novas origens de todas as Filiais', gateMatrizSuspensa.rows[0].permitido === false)
  await expectError('Trigger de NF aplica o bloqueio da Matriz suspensa', () => insertNf({
    cedenteId: cedenteA, vinculoId: vinculoA, fundoId: fundoA, cnpjEmitente: cnpjFilialA, numero: 'QA-MC-4',
  }), /Matriz|nao esta aprovado|nao esta autorizado|nao pode originar/i)

  await asActor(actorSuperAdmin)
  const superAdminVisiveis = await db.query(`select id from public.cedente_estabelecimentos`)
  ok('Super Admin puro nao recebe acesso operacional implícito', superAdminVisiveis.rowCount === 0)

  await expectError('Anon nao possui leitura dos estabelecimentos', async () => {
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role: 'anon' })])
    await db.query('SET LOCAL ROLE anon')
    await db.query(`select id from public.cedente_estabelecimentos`)
  }, /permission denied/i)

  await db.query('RESET ROLE')
  const audit = await db.query(`select count(*)::int quantidade from public.logs_auditoria where entidade_tipo in ('cedente_estabelecimentos','cedente_estabelecimento_contas_bancarias') and entidade_id in ($1,$2,$3)`, [filialA.id, filialPendente.id, contaFilial.rows[0].id])
  ok('Mutacoes controladas geram trilha de auditoria', audit.rows[0].quantidade >= 4)

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
    id, `qa-multi-cnpj-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

async function insertNf({ cedenteId, vinculoId, fundoId, cnpjEmitente, numero }) {
  const result = await db.query(`insert into public.notas_fiscais (
    cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,
    cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status
  ) values ($1,$2,$3,$4,'1',current_date,current_date+30,$5,'QA Emitente',$6,'QA Destinatario',100,'rascunho')
  returning id,estabelecimento_id`, [cedenteId, vinculoId, fundoId, numero, cnpjEmitente, makeCnpj('930000010001')])
  return result.rows[0]
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
