#!/usr/bin/env node
// Golden P8.0: A cancelada preserva operacoes_nfs; B solicitada reutiliza as
// mesmas NFs. Executa a RPC real como sacado autenticado e reverte tudo.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_REF = 'fhgkmggthxikfpogrvaa'
const checks = []
for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}
const apiRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const dbUrl = new URL(process.env.SUPABASE_DB_URL)
const dbRef = dbUrl.username.match(/^postgres\.([a-z0-9]+)$/i)?.[1] ?? dbUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1]
if (apiRef !== EXPECTED_REF || dbRef !== EXPECTED_REF || process.env.SUPABASE_PRODUCTION_PROJECT_REF === EXPECTED_REF || process.env.NEXT_PUBLIC_APP_ENV !== 'homolog') {
  throw new Error('Destino bloqueado: este golden so roda no projeto de homologacao esperado.')
}
dbUrl.password = process.env.SUPABASE_PASSWORD
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false } })
const runId = randomUUID()
const sacadoUserId = randomUUID()
const opA = randomUUID()
const opB = randomUUID()
const nfIds = [randomUUID(), randomUUID()]
let transactionOpen = false

function check(name, condition, detail) {
  checks.push({ name, result: condition ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) })
  if (!condition) throw new Error(`Golden P8.0 falhou: ${name}`)
}

async function expectRejected(name, fn, pattern) {
  await db.query('SAVEPOINT negative_case')
  let errorMessage = ''
  try { await fn() } catch (error) { errorMessage = error.message }
  await db.query('ROLLBACK TO SAVEPOINT negative_case')
  check(name, pattern.test(errorMessage), errorMessage || 'Aceite indevidamente permitido')
}

async function asSacado() {
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: sacadoUserId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() })])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sacadoUserId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

await db.connect()
try {
  await db.query('BEGIN')
  transactionOpen = true
  await db.query("SET LOCAL statement_timeout = '20s'")
  const context = (await db.query(`
    select c.id cedente_id, c.cnpj cnpj_emitente, cf.id cedente_fundo_id, cf.fundo_id
      from public.cedentes c
      join public.cedente_fundos cf on cf.cedente_id = c.id and cf.status = 'ativo'
      join public.fundos f on f.id = cf.fundo_id and f.ativo
      join public.cedente_estabelecimentos e on e.cedente_id = c.id and e.cnpj = c.cnpj and e.status = 'aprovado'
     where f.nome = 'QA RLX GOLDEN V2 FIDC' and c.status = 'ativo'
     order by c.id limit 1
  `)).rows[0]
  check('Contexto isolado de cedente/fundo QA disponivel', Boolean(context))

  const sacadoCnpj = '84830000999906'
  await db.query(`insert into auth.users
    (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    sacadoUserId, `qa-p8-0-${runId}@example.invalid`, JSON.stringify({ role: 'sacado', nome_completo: 'QA Golden Sacado P8.0' }),
  ])
  await db.query(`update public.profiles set role = 'sacado', status = 'ativo' where id = $1`, [sacadoUserId])
  await db.query(`insert into public.sacados (user_id,cnpj,razao_social) values ($1,$2,'QA Golden Sacado P8.0')`, [sacadoUserId, sacadoCnpj])

  for (let index = 0; index < nfIds.length; index++) {
    await db.query(`insert into public.notas_fiscais
      (id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,
       cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,status)
      values ($1,$2,$3,$4,$5,'1',current_date,current_date + 60,$6,'QA Cedente',
              $7,'QA Golden Sacado P8.0',$8,'em_antecipacao')`, [
      nfIds[index], context.cedente_id, context.cedente_fundo_id, context.fundo_id,
      `P8-0-${runId.slice(0, 8)}-${index + 1}`, context.cnpj_emitente, sacadoCnpj, 1000 + index,
    ])
  }

  async function createOperation(id) {
    await db.query(`insert into public.operacoes
      (id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status,
       aceite_sacado_exigido,aceite_sacado_status)
      values ($1,$2,$3,2001,60,current_date + 60,'solicitada',true,'pendente')`, [
      id, context.cedente_id, context.cedente_fundo_id,
    ])
    for (const nfId of nfIds) {
      await db.query(`insert into public.operacoes_nfs (operacao_id,nota_fiscal_id) values ($1,$2)`, [id, nfId])
    }
  }

  await createOperation(opA)
  await db.query(`update public.operacoes set status='cancelada' where id=$1`, [opA])
  const oldOnly = (await db.query(`select count(*)::int as historicos,
    count(*) filter (where op.status::text not in ('cancelada','reprovada'))::int as ativos
    from public.operacoes_nfs onf join public.operacoes op on op.id=onf.operacao_id
    where onf.nota_fiscal_id = any($1::uuid[])`, [nfIds])).rows[0]
  check('Cancelamento mantem historico e zera vinculos ativos', oldOnly.historicos === 2 && oldOnly.ativos === 0)
  await asSacado()
  await expectRejected('Operacao somente cancelada nao pode ser aceita', () => db.query(`select public.processar_aceite_sacado($1::uuid[],'aceitar',null)`, [nfIds]), /opera..o ativa/i)
  await db.query('RESET ROLE')

  await createOperation(opB)

  const before = (await db.query(`select onf.nota_fiscal_id,
    count(*) as historicos,
    count(*) filter (where op.status::text not in ('cancelada','reprovada')) as ativos
    from public.operacoes_nfs onf join public.operacoes op on op.id = onf.operacao_id
    where onf.nota_fiscal_id = any($1::uuid[]) group by onf.nota_fiscal_id`, [nfIds])).rows
  check('Cada NF mantem dois vinculos historicos e somente um ativo', before.length === 2 && before.every(row => Number(row.historicos) === 2 && Number(row.ativos) === 1), JSON.stringify(before))

  await db.query('SAVEPOINT ambiguous_link')
  const opC = randomUUID()
  await db.query(`insert into public.operacoes
    (id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status,
     aceite_sacado_exigido,aceite_sacado_status)
    values ($1,$2,$3,1000,60,current_date + 60,'solicitada',true,'pendente')`, [opC, context.cedente_id, context.cedente_fundo_id])
  await db.query(`insert into public.operacoes_nfs (operacao_id,nota_fiscal_id) values ($1,$2)`, [opC, nfIds[0]])
  await asSacado()
  await expectRejected('Duas operacoes ativas na mesma NF sao bloqueadas', () => db.query(`select public.processar_aceite_sacado($1::uuid[],'aceitar',null)`, [nfIds]), /amb.guo/i)
  await db.query('RESET ROLE')
  await db.query('ROLLBACK TO SAVEPOINT ambiguous_link')

  await asSacado()
  const response = (await db.query(`select public.processar_aceite_sacado($1::uuid[],'aceitar',null) as result`, [nfIds])).rows[0].result
  check('RPC aceita duas NFs na operacao B', response.acao === 'aceitar' && response.nota_fiscal_ids.length === 2 && response.operacao_ids.length === 1 && response.operacao_ids[0] === opB)

  await db.query('RESET ROLE')
  const after = (await db.query(`select id,status,aceite_sacado_status from public.operacoes where id = any($1::uuid[])`, [[opA, opB]])).rows
  check('B fica aceita sem reabrir A cancelada', after.find(row => row.id === opB)?.aceite_sacado_status === 'aceito' && after.find(row => row.id === opA)?.status === 'cancelada' && after.find(row => row.id === opA)?.aceite_sacado_status === 'pendente', JSON.stringify(after))
  const accepted = (await db.query(`select id,status from public.notas_fiscais where id = any($1::uuid[])`, [nfIds])).rows
  check('Ambas as NFs ficam aceitas', accepted.length === 2 && accepted.every(row => row.status === 'aceita'))
  const links = (await db.query(`select count(*)::int as total from public.operacoes_nfs where nota_fiscal_id = any($1::uuid[])`, [nfIds])).rows[0].total
  check('Os quatro vinculos historicos permanecem', links === 4)
  const audit = (await db.query(`select count(*)::int as total from public.logs_auditoria where usuario_id=$1 and tipo_evento='CESSAO_ACEITA' and entidade_id = any($2::uuid[])`, [sacadoUserId, nfIds])).rows[0].total
  check('Dois eventos de auditoria foram gerados', audit === 2)

  await db.query('SET LOCAL ROLE authenticated')
  await expectRejected('Repetir aceite nao altera operacao/NFs ja aceitas', () => db.query(`select public.processar_aceite_sacado($1::uuid[],'aceitar',null)`, [nfIds]), /n.o est. aberta para aceite|n.o pode ser alterada/i)
  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  transactionOpen = false
  const residue = (await db.query(`select
    (select count(*) from public.operacoes where id=any($1::uuid[])) as operacoes,
    (select count(*) from public.notas_fiscais where id=any($2::uuid[])) as notas,
    (select count(*) from public.operacoes_nfs where nota_fiscal_id=any($2::uuid[])) as vinculos,
    (select count(*) from auth.users where id=$3) as usuarios`, [[opA, opB], nfIds, sacadoUserId])).rows[0]
  check('Rollback nao deixa fixtures no homolog', Object.values(residue).every(value => Number(value) === 0), JSON.stringify(residue))
  console.log(JSON.stringify({ golden: 'P8.0 ACEITE SACADO', project_ref: EXPECTED_REF, transaction: 'ROLLED_BACK', passed: checks.length, checks }, null, 2))
} catch (error) {
  if (transactionOpen) await db.query('ROLLBACK').catch(() => undefined)
  console.error(JSON.stringify({ golden: 'P8.0 ACEITE SACADO', project_ref: EXPECTED_REF, transaction: 'ROLLED_BACK', error: error.message, checks }, null, 2))
  process.exitCode = 1
} finally {
  await db.end()
}
