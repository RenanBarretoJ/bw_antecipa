import crypto from 'node:crypto'
import path from 'node:path'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { localSupabaseStatus } from './runtime-lib.mjs'

function nfeCheckDigit(base43) {
  let weight = 2
  let sum = 0
  for (let index = base43.length - 1; index >= 0; index -= 1) {
    sum += Number(base43[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder
}

function syntheticNfeKey(cnpj) {
  const digits = String(cnpj).replace(/\D/gu, '').padStart(14, '0')
  const base = `35${String(new Date().getFullYear()).slice(-2)}${String(new Date().getMonth() + 1).padStart(2, '0')}${digits}55${'000'}${'199999999'}1${crypto.randomInt(0, 100_000_000).toString().padStart(8, '0')}`
  return `${base}${nfeCheckDigit(base)}`
}

async function main() {
  ensureRuntimeDirectories()
  localSupabaseStatus()
  const configured = await withPgClient(localPgConfig(), async (client) => {
    await client.query('begin')
    try {
      const fixture = await client.query(`
        select ca.user_id, ca.cedente_id, cf.id as cedente_fundo_id, cf.fundo_id,
               ce.id as estabelecimento_id, ce.cnpj as cnpj_emitente,
               c.razao_social as razao_social_emitente,
               nf.cnpj_destinatario, nf.razao_social_destinatario
          from public.cedente_acessos ca
          join public.cedente_fundos cf on cf.cedente_id = ca.cedente_id and cf.status = 'ativo'
          join public.cedentes c on c.id = ca.cedente_id
          join public.cedente_estabelecimentos ce on ce.cedente_id = ca.cedente_id and ce.ativo is true
          join lateral (
            select historica.cnpj_destinatario, historica.razao_social_destinatario
              from public.notas_fiscais historica where historica.cedente_id = ca.cedente_id
             order by historica.created_at desc limit 1
          ) nf on true
         where ca.perfil = 'ADMIN' and ca.status = 'ATIVO' and ca.ativo is true
           and exists (select 1 from public.taxas_cedente tc where tc.cedente_id = ca.cedente_id)
         order by ca.cedente_id, ca.user_id limit 1
      `)
      if (!fixture.rows[0]) throw new Error('Nenhum Cedente historico possui NF aprovada livre para o fluxo controlado.')
      const row = fixture.rows[0]
      const policyId = crypto.randomUUID()
      const versionId = crypto.randomUUID()
      const code = `REHEARSAL-${policyId.slice(0, 8)}`
      const contentHash = crypto.createHash('sha256').update(`rehearsal:${versionId}`).digest('hex')
      const notaFiscalId = crypto.randomUUID()
      const chaveAcesso = syntheticNfeKey(row.cnpj_emitente)
      await client.query(`
        insert into public.politicas_operacionais (id, fundo_id, codigo, nome, descricao, status, created_by, padrao)
        values ($1, $2, $3, 'Politica local de rehearsal', 'Configuracao sintetica sem efeito externo', 'ativa', $4, false)
      `, [policyId, row.fundo_id, code, row.user_id])
      await client.query(`
        insert into public.politica_operacional_versoes (
          id, politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde,
          aceite_sacado_obrigatorio, cessao_no_desembolso, cria_acompanhamento_entrega,
          configuracao, conteudo_hash, publicada_por, publicada_em, status, regras, parametros,
          metodo_calculo_financeiro, exigir_status_logistico_pre_cessao
        ) values (
          $1, $2, $3, $4, 1, now(), false, true, false,
          '{"rehearsal":true}'::jsonb, $5, $6, now(), 'publicada', '{}'::jsonb, '{}'::jsonb,
          'DIAS_CORRIDOS_365', false
        )
      `, [versionId, policyId, row.cedente_fundo_id, row.fundo_id, contentHash, row.user_id])
      await client.query(`
        insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por, motivo)
        values ($1, $2, 'ativa', $3, 'Configuracao sintetica local do P2')
      `, [row.cedente_fundo_id, policyId, row.user_id])
      await client.query(`
        insert into public.notas_fiscais (
          id, cedente_id, cedente_fundo_id, fundo_id, estabelecimento_id,
          numero_nf, serie, chave_acesso, data_emissao, data_vencimento,
          cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario,
          valor_bruto, valor_liquido, status, aprovada_gestor_em
        ) values (
          $1, $2, $3, $4, $5,
          'P2-REHEARSAL', '1', $6, current_date, current_date + 90,
          $7, $8, $9, $10,
          1000, 1000, 'aprovada', now()
        )
      `, [notaFiscalId, row.cedente_id, row.cedente_fundo_id, row.fundo_id, row.estabelecimento_id, chaveAcesso, row.cnpj_emitente, row.razao_social_emitente, row.cnpj_destinatario, row.razao_social_destinatario])
      await client.query('commit')
      return { user_id: row.user_id, cedente_id: row.cedente_id, fundo_id: row.fundo_id, policy_id: policyId, version_id: versionId, nota_fiscal_id: notaFiscalId }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
  writeJson(path.join(REPORT_DIR, 'RUNTIME_CONTROLLED_CONFIG.json'), {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    external_credentials: false,
    external_endpoints: false,
    ...configured,
  })
  console.log('Politica publicada sintetica criada somente no clone local para o fluxo controlado.')
}

main().catch((error) => {
  console.error(`Configuracao controlada falhou: ${formatError(error)}`)
  process.exitCode = 1
})
