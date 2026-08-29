#!/usr/bin/env node
// Apaga por completo, em homologacao, um cedente identificado pelo auth.user.id,
// para permitir cadastrar/recadastrar o mesmo CNPJ em ciclos de teste.
//
// Segue o mesmo padrao de seguranca de scripts/homologacao/reset-geral-homolog.mjs:
// preview por padrao, --execute + frase de confirmacao para a operacao destrutiva,
// e trava explicita de projeto/ambiente.
//
// Cobre: cadastro (cedentes, representantes, documentos legado), documental v2
// (documento_vinculos/requisito_instancias/documentos_repositorio/documento_versoes/
// documento_analises), estabelecimentos (matriz/filial, contas, requisitos), vinculo
// de fundo (cedente_fundos, cedente_fundo_politicas), escrow, taxas, acessos,
// solicitacoes de alteracao cadastral, eventos_dominio, logs_auditoria do proprio
// usuario, e o restante do fluxo operacional (notas fiscais, operacoes, duplicatas,
// CT-e, evidencias logisticas, canhotos, memorias) quando existir.
//
// NAO cobre (por design, artefatos com trilha juridica imutavel no banco):
// - documentos_gerados (contratos gerados): tem trigger que bloqueia DELETE
//   incondicionalmente ("Documento gerado compoe trilha juridica").
// - operacoes ja incluidas em remessas_cnab_operacoes/remessas_cnab geradas.
// Se o cedente tiver esses artefatos, o script recusa a execucao com uma
// mensagem explicita — nao ha bypass, pois seria contornar uma protecao
// deliberada do schema.

import { Client } from 'pg'
import {
  assertHomologEnvironment,
  createAdminClient,
  loadEnvFile,
  maskDbUrl,
  parseArgs,
} from '../perf9a/common.mjs'

const args = parseArgs()

async function main() {
  if (args.help === true) {
    printHelp()
    return
  }

  loadEnvFile(args['env-file'] || '.env.homolog')
  const env = assertHomologEnvironment()
  assertProductionNotTargeted(env)
  assertExpectedProjectRef(args['expected-project-ref'], env.projectRef)
  assertDatabaseConfigured(env)

  const authUserId = String(args['auth-user-id'] || '').trim()
  if (!isUuid(authUserId)) throw new Error('Informe --auth-user-id <uuid> valido.')

  const execute = args.execute === true
  const confirmation = buildConfirmation(env.projectRef)
  const admin = createAdminClient(env)
  const db = createDatabaseClient(env.dbUrl)

  console.log(`\nBW Antecipa - APAGAR CEDENTE (${execute ? 'EXECUCAO DESTRUTIVA' : 'PREVIEW'})`)
  console.log(`Ambiente: ${env.appEnv}`)
  console.log(`Projeto Supabase: ${env.projectRef}`)
  console.log(`DB: ${maskDbUrl(env.dbUrl)}`)
  console.log(`auth.user.id: ${authUserId}`)

  try {
    await db.connect()

    const cedente = await findCedenteByUserId(db, authUserId)
    if (!cedente) {
      console.log('\nNenhum cedente encontrado para este auth.user.id.')
      const hasAuthUser = await authUserExists(admin, authUserId)
      if (!hasAuthUser) {
        console.log('Tambem nao existe usuario Auth com este id. Nada a fazer.')
        return
      }
      console.log('Existe um usuario Auth (sem cadastro de cedente vinculado).')
      if (!execute) {
        console.log('\nPREVIEW concluido. Para remover apenas o usuario Auth:')
        console.log(buildExecuteCommand(env.projectRef, authUserId, confirmation))
        return
      }
      assertDestructiveConfirmation(args.confirm, confirmation)
      await deleteAuthUser(admin, authUserId)
      console.log('\nUsuario Auth removido. Nada mais a fazer.')
      return
    }

    console.log(`Cedente encontrado: ${cedente.id} (${cedente.razao_social}, CNPJ ${cedente.cnpj})`)

    const estabelecimentos = await listEstabelecimentos(db, cedente.id)
    const bloqueios = await checkImmutableArtifacts(db, cedente.id)
    if (bloqueios.length > 0) {
      console.log('\nBLOQUEADO: este cedente possui artefatos protegidos por trilha imutavel e nao pode ser apagado por completo:')
      for (const bloqueio of bloqueios) console.log(`  - ${bloqueio}`)
      console.log('\nEsses artefatos existem por design (nao ha bypass). Este script nao serve para cedentes nesse estagio.')
      process.exitCode = 1
      return
    }

    const snapshot = await collectSnapshot(db, cedente.id, estabelecimentos)
    printSnapshot('Dados relacionados a este cedente', snapshot)

    if (!execute) {
      console.log('\nPREVIEW concluido. Nenhum dado foi alterado.')
      console.log('Para executar a exclusao irreversivel:')
      console.log(buildExecuteCommand(env.projectRef, authUserId, confirmation))
      return
    }

    assertDestructiveConfirmation(args.confirm, confirmation)

    console.log('\n[1/3] Removendo dados relacionados no banco (transacao unica)...')
    await deleteCedenteData(db, cedente.id)

    console.log('[2/3] Removendo usuario Auth (cascateia profiles)...')
    await deleteAuthUser(admin, authUserId)

    console.log('[3/3] Limpando objetos no Storage...')
    await cleanupStorage(admin, cedente, estabelecimentos)

    console.log('\nCedente removido por completo. O mesmo CNPJ e e-mail podem ser recadastrados.')
  } finally {
    await db.end().catch(() => undefined)
  }
}

function createDatabaseClient(dbUrl) {
  return new Client({
    connectionString: dbUrl,
    application_name: 'bw_antecipa_apagar_cedente_homolog',
    statement_timeout: 120_000,
    query_timeout: 120_000,
    ssl: { rejectUnauthorized: false },
  })
}

async function findCedenteByUserId(db, userId) {
  const result = await db.query('SELECT id, cnpj, razao_social FROM public.cedentes WHERE user_id = $1', [userId])
  return result.rows[0] || null
}

async function authUserExists(admin, userId) {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error) return false
  return Boolean(data?.user)
}

async function listEstabelecimentos(db, cedenteId) {
  const result = await db.query(
    'SELECT id, cnpj, tipo FROM public.cedente_estabelecimentos WHERE cedente_id = $1',
    [cedenteId],
  )
  return result.rows
}

async function checkImmutableArtifacts(db, cedenteId) {
  const bloqueios = []

  const gerados = await db.query(
    'SELECT count(*)::int AS total FROM public.documentos_gerados WHERE cedente_id = $1',
    [cedenteId],
  )
  if (gerados.rows[0].total > 0) {
    bloqueios.push(`${gerados.rows[0].total} documento(s) gerado(s) (contrato) protegido(s) por trilha juridica (documentos_gerados)`)
  }

  const remessas = await db.query(
    `SELECT count(*)::int AS total
       FROM public.remessas_cnab_operacoes rco
       JOIN public.operacoes o ON o.id = rco.operacao_id
      WHERE o.cedente_id = $1`,
    [cedenteId],
  )
  if (remessas.rows[0].total > 0) {
    bloqueios.push(`${remessas.rows[0].total} operacao(oes) ja incluida(s) em remessa CNAB gerada (remessas_cnab_operacoes)`)
  }

  return bloqueios
}

const SNAPSHOT_STEPS = [
  { label: 'documentos (cadastral legado)', sql: 'SELECT count(*)::int AS total FROM public.documentos WHERE cedente_id = $1' },
  { label: 'representantes', sql: 'SELECT count(*)::int AS total FROM public.representantes WHERE cedente_id = $1' },
  { label: 'documento_vinculos', sql: 'SELECT count(*)::int AS total FROM public.documento_vinculos WHERE cedente_id = $1' },
  { label: 'documento_requisito_instancias', sql: 'SELECT count(*)::int AS total FROM public.documento_requisito_instancias WHERE cedente_id = $1' },
  { label: 'cedente_estabelecimentos', sql: 'SELECT count(*)::int AS total FROM public.cedente_estabelecimentos WHERE cedente_id = $1' },
  { label: 'cedente_estabelecimento_requisitos', sql: `SELECT count(*)::int AS total FROM public.cedente_estabelecimento_requisitos
     WHERE estabelecimento_id IN (SELECT id FROM public.cedente_estabelecimentos WHERE cedente_id = $1)` },
  { label: 'cedente_estabelecimento_contas_bancarias', sql: `SELECT count(*)::int AS total FROM public.cedente_estabelecimento_contas_bancarias
     WHERE estabelecimento_id IN (SELECT id FROM public.cedente_estabelecimentos WHERE cedente_id = $1)` },
  { label: 'cedente_fundos', sql: 'SELECT count(*)::int AS total FROM public.cedente_fundos WHERE cedente_id = $1' },
  { label: 'contas_escrow', sql: 'SELECT count(*)::int AS total FROM public.contas_escrow WHERE cedente_id = $1' },
  { label: 'taxas_cedente', sql: 'SELECT count(*)::int AS total FROM public.taxas_cedente WHERE cedente_id = $1' },
  { label: 'consultor_cedente', sql: 'SELECT count(*)::int AS total FROM public.consultor_cedente WHERE cedente_id = $1' },
  { label: 'cedente_acessos', sql: 'SELECT count(*)::int AS total FROM public.cedente_acessos WHERE cedente_id = $1' },
  { label: 'solicitacoes_alteracao_cedente', sql: 'SELECT count(*)::int AS total FROM public.solicitacoes_alteracao_cedente WHERE cedente_id = $1' },
  { label: 'notas_fiscais', sql: 'SELECT count(*)::int AS total FROM public.notas_fiscais WHERE cedente_id = $1' },
  { label: 'operacoes', sql: 'SELECT count(*)::int AS total FROM public.operacoes WHERE cedente_id = $1' },
  { label: 'duplicatas', sql: 'SELECT count(*)::int AS total FROM public.duplicatas WHERE cedente_id = $1' },
  { label: 'ctes', sql: 'SELECT count(*)::int AS total FROM public.ctes WHERE cedente_id = $1' },
  { label: 'evidencias_logisticas_antecipadas', sql: 'SELECT count(*)::int AS total FROM public.evidencias_logisticas_antecipadas WHERE cedente_id = $1' },
  { label: 'nota_fiscal_entrega_postergacoes_canhoto', sql: 'SELECT count(*)::int AS total FROM public.nota_fiscal_entrega_postergacoes_canhoto WHERE cedente_id = $1' },
  { label: 'operacao_calculo_nfs', sql: 'SELECT count(*)::int AS total FROM public.operacao_calculo_nfs WHERE cedente_id = $1' },
  { label: 'eventos_dominio (cedente/nf/operacao)', sql: `SELECT count(*)::int AS total FROM public.eventos_dominio
     WHERE cedente_id = $1
        OR cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE cedente_id = $1)
        OR nota_fiscal_id IN (SELECT id FROM public.notas_fiscais WHERE cedente_id = $1)
        OR operacao_id IN (SELECT id FROM public.operacoes WHERE cedente_id = $1)` },
]

async function collectSnapshot(db, cedenteId, estabelecimentos) {
  const counts = []
  for (const step of SNAPSHOT_STEPS) {
    const result = await db.query(step.sql, [cedenteId])
    counts.push({ label: step.label, count: result.rows[0].total })
  }
  return { counts, estabelecimentos: estabelecimentos.length }
}

function printSnapshot(label, snapshot) {
  console.log(`\n${label}:`)
  for (const item of snapshot.counts) {
    if (item.count > 0) console.log(`  - ${item.label}: ${item.count}`)
  }
  console.log(`  - cedente_estabelecimentos (matriz/filiais): ${snapshot.estabelecimentos}`)
}

async function deleteCedenteData(db, cedenteId) {
  await db.query('BEGIN')
  try {
    // 1) eventos_dominio primeiro: CHECK exige nota_fiscal_id OU operacao_id
    //    nao-nulo, e a FK e SET NULL — apagar NF/operacao antes travaria essa CHECK.
    await db.query(
      `DELETE FROM public.eventos_dominio
        WHERE cedente_id = $1
           OR cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE cedente_id = $1)
           OR nota_fiscal_id IN (SELECT id FROM public.notas_fiscais WHERE cedente_id = $1)
           OR operacao_id IN (SELECT id FROM public.operacoes WHERE cedente_id = $1)`,
      [cedenteId],
    )

    // 2) Cadeia logistica/documental por nota fiscal.
    await db.query(
      `DELETE FROM public.cte_notas_fiscais
        WHERE nota_fiscal_id IN (SELECT id FROM public.notas_fiscais WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await runAppendOnlySafe(db, 'eventos_entrega', 'eventos_entrega_append_only', async () => {
      await db.query(
        `DELETE FROM public.eventos_entrega
          WHERE nota_fiscal_entrega_id IN (
            SELECT id FROM public.nota_fiscal_entregas
             WHERE nota_fiscal_id IN (SELECT id FROM public.notas_fiscais WHERE cedente_id = $1)
          )`,
        [cedenteId],
      )
    })
    await runAppendOnlySafe(db, 'nota_fiscal_entrega_postergacoes_canhoto', 'postergacao_upload_canhoto_append_only', async () => {
      await db.query('DELETE FROM public.nota_fiscal_entrega_postergacoes_canhoto WHERE cedente_id = $1', [cedenteId])
    })
    await db.query(
      `DELETE FROM public.nota_fiscal_entregas
        WHERE nota_fiscal_id IN (SELECT id FROM public.notas_fiscais WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query('DELETE FROM public.ctes WHERE cedente_id = $1', [cedenteId])

    // 3) Repositorio documental novo (documento_vinculos aponta para o cedente
    //    diretamente; documentos_repositorio/versoes/analises sao alcancados via join).
    await runAppendOnlySafe(db, 'documento_analises', 'documento_analise_append_only', async () => {
      await db.query(
        `DELETE FROM public.documento_analises
          WHERE documento_versao_id IN (
            SELECT dv.id FROM public.documento_versoes dv
            JOIN public.documento_vinculos dvi ON dvi.documento_id = dv.documento_id
            WHERE dvi.cedente_id = $1
          )`,
        [cedenteId],
      )
    })
    await db.query(
      `DELETE FROM public.documento_versoes
        WHERE documento_id IN (SELECT documento_id FROM public.documento_vinculos WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query(
      `DELETE FROM public.documentos_repositorio
        WHERE id IN (SELECT documento_id FROM public.documento_vinculos WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query('DELETE FROM public.documento_requisito_instancias WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.documento_vinculos WHERE cedente_id = $1', [cedenteId])

    // 4) Evidencias logisticas antecipadas e memorias de calculo por operacao.
    await db.query(
      `DELETE FROM public.evidencia_logistica_versoes
        WHERE evidencia_logistica_id IN (SELECT id FROM public.evidencias_logisticas_antecipadas WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query('DELETE FROM public.evidencias_logisticas_antecipadas WHERE cedente_id = $1', [cedenteId])
    await runAppendOnlySafe(db, 'operacao_nf_logistica_memorias', 'operacao_nf_logistica_memoria_append_only', async () => {
      await db.query(
        `DELETE FROM public.operacao_nf_logistica_memorias
          WHERE operacao_id IN (SELECT id FROM public.operacoes WHERE cedente_id = $1)`,
        [cedenteId],
      )
    })
    await db.query('DELETE FROM public.operacao_calculo_nfs WHERE cedente_id = $1', [cedenteId])

    // 5) Duplicatas (ativo financeiro) — historico append-only.
    await runAppendOnlySafe(db, 'duplicata_correcoes', 'duplicata_correcoes_append_only', async () => {
      await db.query(
        `DELETE FROM public.duplicata_correcoes
          WHERE duplicata_id IN (SELECT id FROM public.duplicatas WHERE cedente_id = $1)`,
        [cedenteId],
      )
    })
    await runAppendOnlySafe(db, 'duplicata_validacoes', 'duplicata_validacoes_append_only', async () => {
      await db.query(
        `DELETE FROM public.duplicata_validacoes
          WHERE duplicata_id IN (SELECT id FROM public.duplicatas WHERE cedente_id = $1)`,
        [cedenteId],
      )
    })
    await db.query(
      `UPDATE public.duplicatas SET versao_atual_id = NULL WHERE cedente_id = $1 AND versao_atual_id IS NOT NULL`,
      [cedenteId],
    )
    await runAppendOnlySafe(db, 'duplicata_versoes', 'duplicata_versoes_append_only', async () => {
      await db.query(
        `DELETE FROM public.duplicata_versoes
          WHERE duplicata_id IN (SELECT id FROM public.duplicatas WHERE cedente_id = $1)`,
        [cedenteId],
      )
    })
    await db.query('DELETE FROM public.duplicatas WHERE cedente_id = $1', [cedenteId])

    // 6) Escrow, operacoes e notas fiscais (movimentos_escrow cai em cascade).
    await db.query('DELETE FROM public.operacoes WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.notas_fiscais WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.contas_escrow WHERE cedente_id = $1', [cedenteId])

    // 7) Estabelecimentos (filiais antes da matriz, por causa do auto-vinculo).
    await db.query(
      `DELETE FROM public.cedente_estabelecimento_requisitos
        WHERE estabelecimento_id IN (SELECT id FROM public.cedente_estabelecimentos WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query(
      `DELETE FROM public.cedente_estabelecimento_contas_bancarias
        WHERE estabelecimento_id IN (SELECT id FROM public.cedente_estabelecimentos WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query(
      `DELETE FROM public.cedente_estabelecimentos WHERE cedente_id = $1 AND tipo = 'filial'`,
      [cedenteId],
    )
    await db.query(
      `DELETE FROM public.cedente_estabelecimentos WHERE cedente_id = $1 AND tipo = 'matriz'`,
      [cedenteId],
    )

    // 8) Vinculo de fundo e demais tabelas cadastrais (a maioria e CASCADE a
    //    partir de cedentes, mas apagamos explicitamente para relatorio claro).
    await db.query(
      `DELETE FROM public.cedente_fundo_politicas
        WHERE cedente_fundo_id IN (SELECT id FROM public.cedente_fundos WHERE cedente_id = $1)`,
      [cedenteId],
    )
    await db.query('DELETE FROM public.cedente_fundos WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.solicitacoes_alteracao_cedente WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.cedente_acessos WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.consultor_cedente WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.taxas_cedente WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.documentos WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.representantes WHERE cedente_id = $1', [cedenteId])
    await db.query('DELETE FROM public.devedores_solidarios WHERE cedente_id = $1', [cedenteId])

    // 9) Auditoria do proprio ator (logs_auditoria.usuario_id -> profiles sem
    //    ON DELETE; bloquearia o CASCADE de auth.users -> profiles no passo seguinte).
    await db.query(
      `DELETE FROM public.logs_auditoria
        WHERE usuario_id = (SELECT user_id FROM public.cedentes WHERE id = $1)`,
      [cedenteId],
    )

    // 10) Por fim, o cadastro do cedente.
    await db.query('DELETE FROM public.cedentes WHERE id = $1', [cedenteId])

    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function runAppendOnlySafe(db, table, trigger, action) {
  await db.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`)
  try {
    await action()
  } finally {
    await db.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`)
  }
}

async function deleteAuthUser(admin, userId) {
  const { error } = await admin.auth.admin.deleteUser(userId, false)
  if (error) throw new Error(`Falha ao remover usuario Auth: ${error.message}`)
}

async function cleanupStorage(admin, cedente, estabelecimentos) {
  const cnpjs = [cedente.cnpj, ...estabelecimentos.map((item) => item.cnpj)]
  for (const cnpj of cnpjs) {
    await removePrefixRecursive(admin, 'documentos-cedentes', cnpj)
    await removePrefixRecursive(admin, 'notas-fiscais', cnpj)
  }
  await removePrefixRecursive(admin, 'documentos-v2', cedente.id)
  await removePrefixRecursive(admin, 'contratos', `cedentes/${cedente.id}`)
}

async function removePrefixRecursive(admin, bucket, prefix) {
  const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !entries) return

  const files = entries.filter((entry) => entry.id).map((entry) => `${prefix}/${entry.name}`)
  if (files.length > 0) {
    const { error: removeError } = await admin.storage.from(bucket).remove(files)
    if (removeError) console.log(`  aviso: falha ao remover ${files.length} objeto(s) de ${bucket}/${prefix}: ${removeError.message}`)
    else console.log(`  - ${bucket}/${prefix}: ${files.length} objeto(s) removido(s)`)
  }

  const folders = entries.filter((entry) => !entry.id)
  for (const folder of folders) {
    await removePrefixRecursive(admin, bucket, `${prefix}/${folder.name}`)
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function assertDatabaseConfigured(env) {
  if (!env.dbUrl) throw new Error('SUPABASE_DB_URL e obrigatoria.')
}

function assertProductionNotTargeted(env) {
  const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF
  if (productionRef && env.projectRef === productionRef) {
    throw new Error('Projeto de producao bloqueado.')
  }
}

function assertExpectedProjectRef(expected, actual) {
  if (!expected || expected !== actual) {
    throw new Error(`Projeto nao confirmado. Informe exatamente --expected-project-ref ${actual}.`)
  }
}

function assertDestructiveConfirmation(value, expected) {
  if (value !== expected) {
    throw new Error(`Confirmacao destrutiva invalida. Informe exatamente --confirm ${expected}.`)
  }
}

function buildConfirmation(projectRef) {
  return `APAGAR_CEDENTE_HOMOLOG_${projectRef}`
}

function buildExecuteCommand(projectRef, authUserId, confirmation) {
  return `npm run homolog:apagar-cedente -- --auth-user-id ${authUserId} --execute --expected-project-ref ${projectRef} --confirm ${confirmation}`
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function printHelp() {
  console.log(`
Apaga por completo um cedente de homologacao (cadastro, documentos, estabelecimentos,
vinculo de fundo, escrow, operacional e o usuario Auth), para permitir recadastro.

Preview (padrao):
  npm run homolog:apagar-cedente -- --auth-user-id <uuid> --expected-project-ref <project-ref>

Execucao:
  npm run homolog:apagar-cedente -- --auth-user-id <uuid> --execute --expected-project-ref <project-ref> --confirm APAGAR_CEDENTE_HOMOLOG_<project-ref>

Opcoes:
  --auth-user-id <uuid>          Obrigatorio. id do usuario em auth.users
  --env-file <arquivo>           Arquivo de ambiente; padrao: .env.homolog
  --expected-project-ref <ref>   Confirma explicitamente o projeto Supabase
  --execute                      Habilita a operacao destrutiva
  --confirm <frase>              Frase de confirmacao vinculada ao project ref
  --help                         Exibe esta ajuda

Recusa a execucao se o cedente tiver documentos_gerados (contrato) ou operacoes
ja incluidas em remessa CNAB — esses artefatos sao imutaveis por design.
`)
}

try {
  await main()
} catch (error) {
  console.error(`\nExclusao de cedente em homologacao falhou: ${safeErrorMessage(error)}\n`)
  process.exitCode = 1
}
