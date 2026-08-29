import crypto from 'node:crypto'
import path from 'node:path'
import { REPORT_DIR, ensureRuntimeDirectories, formatError, localPgConfig, stableJson, withPgClient, writeJson } from './lib.mjs'

const FIXTURE = Object.freeze({
  cedenteUser: '85a53e73-354d-41af-8813-dbba9f5dc215',
  cedente: '0073f2a1-d0e0-44a0-989f-ee2d107aa8ac',
  fundo: '7a114257-7816-468e-adf4-d796b93364df',
  sacadoUser: '15becd99-ae1b-4a91-a5de-0ece124b6d49',
  gestorUser: '10690e0c-c1a9-4282-892a-f2ce803f95d7',
  policy: 'd1311000-0000-4000-8000-000000000001',
  policyVersion: 'd1311000-0000-4000-8000-000000000002',
})

function nfeDigit(base43) {
  let weight = 2
  let sum = 0
  for (let index = base43.length - 1; index >= 0; index -= 1) {
    sum += Number(base43[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

function key(sequence) {
  const base = `3526083262203700014855001${sequence.padStart(9, '0')}1${sequence.padStart(8, '0')}`
  return `${base}${nfeDigit(base)}`
}

async function setIdentity(client, userId) {
  await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claims',$2,true)", [
    userId, JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2' }),
  ])
}

async function createOperation(client, suffix, action, context) {
  const nfId = `d1314000-0000-4000-8000-0000000000${suffix}`
  await client.query(`
    insert into public.notas_fiscais (
      id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,numero_nf,serie,chave_acesso,
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,
      razao_social_destinatario,valor_bruto,valor_liquido,status,aprovada_gestor_em,created_at,updated_at
    ) values ($1,$2,$3,$4,$5,$6,'1',$7,current_date,current_date+90,'32622037000148',
      'CORAMED COMERCIO DE ARTIGOS MEDICOS LTDA','11344038002141','SOCIEDADE BENEFICENTE ISRAELITA BRASILEIRA HOSPITAL ALBERT EINSTEIN',
      1000,1000,'aprovada',now(),now(),now())
  `, [nfId, FIXTURE.cedente, context.cedente_fundo_id, FIXTURE.fundo, context.estabelecimento_id, `P31-${suffix}`, key(suffix)])
  await setIdentity(client, FIXTURE.cedenteUser)
  const assignment = await client.query(`select id from public.cedente_fundo_politicas where cedente_fundo_id=$1 and politica_operacional_id=$2 and status='ativa'`, [context.cedente_fundo_id, FIXTURE.policy])
  const snapshot = {
    schema: 'bw-antecipa.politica-operacional.v1', cedente_fundo_id: context.cedente_fundo_id, fundo_id: FIXTURE.fundo,
    politica_operacional_id: FIXTURE.policy, politica_operacional_versao_id: FIXTURE.policyVersion, politica_versao: 1,
    politica_atribuicao_id: assignment.rows[0].id, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true,
    cria_acompanhamento_entrega: false, exigir_status_logistico_pre_cessao: false,
    permite_postergacao_upload_canhoto: false, limite_postergacao_upload_canhoto_dias: null,
    controle_exposicao_logistica_ativo: false, limite_exposicao_em_transito_pct: null, gate_risco_ativo: false,
    limite_inclusivo: true, tipo_ativo_financeiro: 'NOTA_FISCAL',
    calculo_financeiro: {
      metodo: 'DIAS_CORRIDOS_365', descricao: '365 - Dias corridos', base: 365, periodo_taxa: 'mensal',
      divisor_mensal: null, unidade_contagem: 'dias_corridos', calendario: null, convencao: null,
      versao_motor: 1, arredondamento: 'ROUND_HALF_UP_2_CASAS',
    },
    configuracao: { cutover: 'DLZ_HEALTH', risco_financeiro: 'NAO_APLICAVEL' }, requisitos: [],
  }
  const snapshotHash = crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex')
  const requested = await client.query(`
    select public.solicitar_operacao_antecipacao_atomica(
      $1,$2,$3,$4,1,$5::jsonb,$6,true,'pendente',array[$7]::uuid[],1000,1,90,970,current_date+90,$8,null
    ) as value
  `, [FIXTURE.cedente, context.cedente_fundo_id, FIXTURE.policy, FIXTURE.policyVersion, JSON.stringify(snapshot), snapshotHash, nfId, `p3.1-dlz-${action}-${suffix}`])
  const operationId = requested.rows[0].value.operacao_id
  const pending = await client.query('select aceite_sacado_exigido,aceite_sacado_status,status::text from public.operacoes where id=$1', [operationId])
  if (!pending.rows[0]?.aceite_sacado_exigido || pending.rows[0]?.aceite_sacado_status !== 'pendente') throw new Error('Nova operacao DLZ nao iniciou no gate do sacado.')

  await setIdentity(client, FIXTURE.sacadoUser)
  await client.query('select public.processar_aceite_sacado(array[$1]::uuid[],$2,$3)', [nfId, action, action === 'contestar' ? 'Contestacao controlada P3.1' : null])
  const afterSacado = await client.query('select aceite_sacado_status,status::text from public.operacoes where id=$1', [operationId])
  if (action === 'aceitar') {
    if (afterSacado.rows[0]?.aceite_sacado_status !== 'aceito') throw new Error('Aceite do sacado nao consolidou a operacao.')
    await setIdentity(client, FIXTURE.gestorUser)
    await client.query('select public.aprovar_operacao_atomica_financeiro_v1($1,5)', [operationId])
  } else if (afterSacado.rows[0]?.aceite_sacado_status !== 'contestado') {
    throw new Error('Contestacao do sacado nao consolidou a operacao.')
  }
  const final = await client.query('select aceite_sacado_status,status::text from public.operacoes where id=$1', [operationId])
  return { action, gate_initial: 'pendente', gate_final: final.rows[0].aceite_sacado_status, operation_status: final.rows[0].status }
}

async function main() {
  ensureRuntimeDirectories()
  const result = await withPgClient(localPgConfig(), async (client) => {
    await client.query('begin')
    try {
      const contextResult = await client.query(`
        select cf.id as cedente_fundo_id, ce.id as estabelecimento_id
          from public.cedente_fundos cf
          join public.cedente_estabelecimentos ce on ce.cedente_id=cf.cedente_id and ce.ativo is true
         where cf.cedente_id=$1 and cf.fundo_id=$2 and cf.status='ativo'
         order by ce.id limit 1
      `, [FIXTURE.cedente, FIXTURE.fundo])
      if (!contextResult.rows[0]) throw new Error('Contexto DLZ da fixture E2E nao encontrado.')
      const accepted = await createOperation(client, '01', 'aceitar', contextResult.rows[0])
      const contested = await createOperation(client, '02', 'contestar', contextResult.rows[0])
      const noFinancialDependencies = await client.query(`
        select not exists(select 1 from public.risco_execucoes where operacao_id in (
          select id from public.operacoes where solicitacao_idempotency_key like 'p3.1-dlz-%'
        )) as ok
      `)
      await client.query('rollback')
      return { accepted, contested, no_financial_dependencies: noFinancialDependencies.rows[0].ok, synthetic_cleanup: 'ROLLBACK' }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
  const passed = result.accepted.gate_final === 'aceito' && result.accepted.operation_status === 'aprovada'
    && result.contested.gate_final === 'contestado' && result.no_financial_dependencies === true
  writeJson(path.join(REPORT_DIR, 'P3_1_DLZ_SACADO_E2E.json'), {
    generated_at: new Date().toISOString(), environment: 'rehearsal/local', authenticated_context: 'database/JWT claims against canonical RPCs',
    production_access: 'none', stopped_before_external_send: true, ...result, passed,
  })
  console.log(`E2E DLZ com gate do sacado: ${passed ? 'PASS' : 'FAIL'}`)
  if (!passed) process.exitCode = 2
}

main().catch((error) => {
  console.error(`E2E P3.1 falhou: ${formatError(error)}`)
  process.exitCode = 1
})
