#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  PERF9A_EMAIL_DOMAIN,
  PERF9A_PREFIX,
  assertExplicitConfirmation,
  assertHomologEnvironment,
  createAdminClient,
  deterministicUuidExpression,
  getPerf9aLocalDir,
  listAllAuthUsers,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
  runSqlFile,
  sqlText,
  writeRestrictedJson,
} from './common.mjs'
import {
  PERF9A_USERS,
  formatCnpj,
  generatePassword,
  generateTotp,
  generateValidCnpj,
} from './dataset.mjs'

const args = parseArgs()
const createdUserIds = []

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`\nCarga PERF9A falhou: ${safeError(error)}\n`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile(args['env-file'])
  const env = assertHomologEnvironment()
  assertExplicitConfirmation(args.confirm, env)
  const admin = createAdminClient(env)

  console.log('\nBW Antecipa - carga sintetica PERF9A')
  printEnvironmentSummary(env)
  console.log(`Prefixo: ${PERF9A_PREFIX}`)

  await assertDatasetAbsent(admin)
  const credentials = await createTestUsers(admin, env)

  try {
    const sql = buildSeedSql(credentials)
    await runSqlFile(env, sql, 'seed')
  } catch (error) {
    await compensateAuthUsers(admin)
    throw error
  }

  const credentialPath = resolve(
    getPerf9aLocalDir('credentials'),
    `users-${env.projectRef}.json`,
  )
  writeRestrictedJson(credentialPath, {
    projectRef: env.projectRef,
    appEnv: env.appEnv,
    createdAt: new Date().toISOString(),
    users: credentials,
  })

  console.log('\nCarga concluida com sucesso.')
  console.log(`Usuarios Auth: ${credentials.length}`)
  console.log('Credenciais gravadas fora do repositorio em arquivo local restrito.')
  console.log(`Arquivo local: ${credentialPath}`)
  console.log('Execute npm run perf9a:status para conferir os volumes.')
}

async function assertDatasetAbsent(admin) {
  const [{ count: fundCount, error: fundError }, authUsers] = await Promise.all([
    admin.from('fundos').select('id', { count: 'exact', head: true }).ilike('nome', `${PERF9A_PREFIX}%`),
    listAllAuthUsers(admin),
  ])

  if (fundError) throw new Error(`Falha ao verificar massa existente: ${fundError.message}`)
  const testAuthCount = authUsers.filter((user) => user.email?.endsWith(`@${PERF9A_EMAIL_DOMAIN}`)).length
  if ((fundCount || 0) > 0 || testAuthCount > 0) {
    throw new Error(
      `Massa PERF9A ja existe (fundos=${fundCount || 0}, usuarios_auth=${testAuthCount}). `
      + 'Use perf9a:status ou o cleanup explicito antes de nova carga.',
    )
  }
}

async function createTestUsers(admin, env) {
  const credentials = []

  for (const definition of PERF9A_USERS) {
    const email = `${definition.key}@${PERF9A_EMAIL_DOMAIN}`
    const password = generatePassword()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nome_completo: definition.name,
        role: definition.role,
        perf9a: true,
      },
    })
    if (error || !data.user) {
      await compensateAuthUsers(admin)
      throw new Error(`Falha ao criar usuario sintetico ${definition.key}: ${error?.message || 'retorno vazio'}`)
    }

    createdUserIds.push(data.user.id)
    const totpSecret = await enrollTotp(env, {
      email,
      password,
      friendlyName: `${PERF9A_PREFIX}${definition.key}`,
    })
    credentials.push({
      key: definition.key,
      id: data.user.id,
      email,
      password,
      totpSecret,
      role: definition.role,
      name: definition.name,
    })
    console.log(`- usuario ${definition.key}: criado com MFA TOTP`)
  }

  return credentials
}

async function enrollTotp(env, user) {
  const client = createClient(env.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (signInError) throw new Error(`Falha ao autenticar usuario de teste para MFA: ${signInError.message}`)

  const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: user.friendlyName,
  })
  if (enrollError || !enrollment?.id || !enrollment.totp?.secret) {
    throw new Error(`Falha ao cadastrar TOTP: ${enrollError?.message || 'retorno incompleto'}`)
  }

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollment.id,
  })
  if (challengeError || !challenge?.id) {
    throw new Error(`Falha ao criar desafio TOTP: ${challengeError?.message || 'retorno incompleto'}`)
  }

  let verifyError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await client.auth.mfa.verify({
      factorId: enrollment.id,
      challengeId: challenge.id,
      code: generateTotp(enrollment.totp.secret),
    })
    verifyError = error
    if (!error) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  }
  await client.auth.signOut()
  if (verifyError) throw new Error(`Falha ao confirmar TOTP: ${verifyError.message}`)
  return enrollment.totp.secret
}

async function compensateAuthUsers(admin) {
  for (const userId of createdUserIds.reverse()) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) console.error(`Compensacao Auth pendente para usuario sintetico: ${error.message}`)
  }
  createdUserIds.length = 0
}

export function buildSeedSql(credentials) {
  const users = new Map(credentials.map((user) => [user.key, user]))
  const userId = (key) => sqlText(requireUser(users, key).id)
  const id = (key) => deterministicUuidExpression(key)
  const fundA = id('FUNDO_A')
  const fundB = id('FUNDO_B')
  const policyA = id('POLITICA_A')
  const policyB = id('POLITICA_B')
  const versionA = id('POLITICA_VERSAO_A_1')
  const versionB = id('POLITICA_VERSAO_B_1')
  const cnpjRows = buildCnpjRows()
  const usersSql = credentials
    .map((user) => `(${sqlText(user.key)}, ${sqlText(user.id)}::uuid, ${sqlText(user.role)}, ${sqlText(user.name)})`)
    .join(',\n  ')

  return `BEGIN;

DO $$
BEGIN
  IF current_user IS NULL THEN
    RAISE EXCEPTION 'Conexao administrativa invalida.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fundos WHERE nome LIKE '${PERF9A_PREFIX}%')
     OR EXISTS (SELECT 1 FROM public.cedentes WHERE razao_social LIKE '${PERF9A_PREFIX}%') THEN
    RAISE EXCEPTION 'Massa PERF9A ja existe; carga cancelada.';
  END IF;
END;
$$;

CREATE TEMP TABLE perf9a_users (
  key text PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL,
  name text NOT NULL
) ON COMMIT DROP;
INSERT INTO perf9a_users (key, user_id, role, name) VALUES
  ${usersSql};

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM perf9a_users u
    LEFT JOIN public.profiles p ON p.id = u.user_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Trigger de perfil nao criou todos os profiles de teste.';
  END IF;
END;
$$;

CREATE TEMP TABLE perf9a_cnpjs (
  entity_key text PRIMARY KEY,
  cnpj text NOT NULL
) ON COMMIT DROP;
INSERT INTO perf9a_cnpjs (entity_key, cnpj) VALUES
  ${cnpjRows};

INSERT INTO public.fundos (
  id, nome, cnpj, administradora_nome, administradora_cnpj,
  gestora_nome, gestora_cnpj, custodiante_nome, custodiante_cnpj,
  contato_nome, contato_email, ativo
) VALUES
  (${fundA}, '${PERF9A_PREFIX}FUNDO A', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='FUNDO_A'),
   '${PERF9A_PREFIX}ADMINISTRADORA A', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='ADMIN_A'),
   '${PERF9A_PREFIX}GESTORA', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='GESTORA'),
   '${PERF9A_PREFIX}CUSTODIANTE', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='CUSTODIANTE'),
   '${PERF9A_PREFIX}CONTATO A', 'contato-a@${PERF9A_EMAIL_DOMAIN}', true),
  (${fundB}, '${PERF9A_PREFIX}FUNDO B', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='FUNDO_B'),
   '${PERF9A_PREFIX}ADMINISTRADORA B', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='ADMIN_B'),
   '${PERF9A_PREFIX}GESTORA', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='GESTORA'),
   '${PERF9A_PREFIX}CUSTODIANTE', (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='CUSTODIANTE'),
   '${PERF9A_PREFIX}CONTATO B', 'contato-b@${PERF9A_EMAIL_DOMAIN}', true);

INSERT INTO public.usuario_fundos (id, usuario_id, fundo_id, perfil_no_fundo, status, principal) VALUES
  (${id('UF_GESTOR_A_A')}, ${userId('gestor_a')}::uuid, ${fundA}, 'gestor', 'ativo', true),
  (${id('UF_GESTOR_B_B')}, ${userId('gestor_b')}::uuid, ${fundB}, 'gestor', 'ativo', true),
  (${id('UF_GESTOR_MULTI_A')}, ${userId('gestor_multi')}::uuid, ${fundA}, 'gestor', 'ativo', true),
  (${id('UF_GESTOR_MULTI_B')}, ${userId('gestor_multi')}::uuid, ${fundB}, 'gestor', 'ativo', false);

CREATE TEMP TABLE perf9a_cedentes (
  idx integer PRIMARY KEY,
  cedente_id uuid NOT NULL,
  group_key text NOT NULL,
  user_id uuid NOT NULL,
  cnpj text NOT NULL
) ON COMMIT DROP;

INSERT INTO perf9a_cedentes (idx, cedente_id, group_key, user_id, cnpj)
SELECT i,
       md5('BW_ANTECIPA:9A.1:CEDENTE_A_' || i)::uuid,
       'A',
       CASE i
         WHEN 1 THEN ${userId('cedente_a')}::uuid
         WHEN 2 THEN ${userId('cedente_multi')}::uuid
         WHEN 3 THEN ${userId('cedente_sem_escrow')}::uuid
         WHEN 4 THEN ${userId('cedente_com_escrow')}::uuid
         ELSE ${userId('bulk_cedente_a')}::uuid
       END,
       (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key = 'CEDENTE_A_' || i)
FROM generate_series(1, 60) i;

INSERT INTO perf9a_cedentes (idx, cedente_id, group_key, user_id, cnpj)
SELECT 60 + i,
       md5('BW_ANTECIPA:9A.1:CEDENTE_B_' || i)::uuid,
       'B',
       CASE i WHEN 1 THEN ${userId('cedente_b')}::uuid ELSE ${userId('bulk_cedente_b')}::uuid END,
       (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key = 'CEDENTE_B_' || i)
FROM generate_series(1, 59) i;

INSERT INTO perf9a_cedentes (idx, cedente_id, group_key, user_id, cnpj)
VALUES (
  120,
  ${id('CEDENTE_SUSPENSO')},
  'SUSPENSO',
  ${userId('bulk_cedente_a')}::uuid,
  (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='CEDENTE_SUSPENSO')
);

INSERT INTO public.cedentes (
  id, user_id, cnpj, razao_social, nome_fantasia, email_comercial,
  status, fundo_id, habilitar_escrow, coobrigacao
)
SELECT cedente_id, user_id, cnpj,
       '${PERF9A_PREFIX}CEDENTE ' || group_key || ' ' || idx,
       '${PERF9A_PREFIX}' || group_key || '-' || idx,
       'cedente-' || idx || '@${PERF9A_EMAIL_DOMAIN}',
       'ativo', NULL,
       idx <> 3, (idx % 2 = 0)
FROM perf9a_cedentes;

INSERT INTO public.cedentes (
  id, user_id, cnpj, razao_social, nome_fantasia, email_comercial,
  status, fundo_id, habilitar_escrow, coobrigacao
)
SELECT md5('BW_ANTECIPA:9A.1:ONBOARDING_' || i)::uuid,
       ${userId('bulk_onboarding')}::uuid,
       (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key = 'ONBOARDING_' || i),
       '${PERF9A_PREFIX}ONBOARDING ' || i,
       '${PERF9A_PREFIX}ONB-' || i,
       'onboarding-' || i || '@${PERF9A_EMAIL_DOMAIN}',
       CASE i % 4 WHEN 0 THEN 'em_analise'::public.cedente_status ELSE 'pendente'::public.cedente_status END,
       NULL, false, true
FROM generate_series(1, 60) i;

CREATE TEMP TABLE perf9a_links (
  link_idx integer PRIMARY KEY,
  cedente_fundo_id uuid NOT NULL,
  cedente_id uuid NOT NULL,
  fundo_id uuid NOT NULL,
  fund_key text NOT NULL,
  status text NOT NULL
) ON COMMIT DROP;

INSERT INTO perf9a_links
SELECT idx, md5('BW_ANTECIPA:9A.1:LINK_A_' || idx)::uuid, cedente_id, ${fundA}, 'A', 'ativo'
FROM perf9a_cedentes WHERE group_key='A';

INSERT INTO perf9a_links
SELECT 60 + i,
       md5('BW_ANTECIPA:9A.1:LINK_B_' || i)::uuid,
       CASE WHEN i=60 THEN (SELECT cedente_id FROM perf9a_cedentes WHERE group_key='A' AND idx=2)
            ELSE (SELECT cedente_id FROM perf9a_cedentes WHERE group_key='B' AND idx=60+i) END,
       ${fundB}, 'B', 'ativo'
FROM generate_series(1, 60) i;

INSERT INTO perf9a_links
VALUES (121, ${id('LINK_SUSPENSO')}, ${id('CEDENTE_SUSPENSO')}, ${fundA}, 'A', 'suspenso');

INSERT INTO public.cedente_fundos (
  id, cedente_id, fundo_id, codigo_externo, status, vigente_desde, observacoes
)
SELECT cedente_fundo_id, cedente_id, fundo_id,
       '${PERF9A_PREFIX}' || fund_key || '-' || lpad(link_idx::text, 3, '0'),
       status, now() - interval '180 days',
       '${PERF9A_PREFIX}vinculo sintetico'
FROM perf9a_links;

INSERT INTO public.sacados (id, user_id, cnpj, razao_social, email) VALUES
  (${id('SACADO_A')}, ${userId('sacado_a')}::uuid, (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='SACADO_A'), '${PERF9A_PREFIX}SACADO A', 'sacado-a@${PERF9A_EMAIL_DOMAIN}'),
  (${id('SACADO_B')}, ${userId('sacado_b')}::uuid, (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='SACADO_B'), '${PERF9A_PREFIX}SACADO B', 'sacado-b@${PERF9A_EMAIL_DOMAIN}'),
  (${id('SACADO_INATIVO')}, ${userId('sacado_inativo')}::uuid, (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='SACADO_INATIVO'), '${PERF9A_PREFIX}SACADO INATIVO', 'sacado-inativo@${PERF9A_EMAIL_DOMAIN}');

INSERT INTO public.consultor_cedente (id, consultor_id, cedente_id, comissao_percentual) VALUES
  (${id('CONSULTOR_A_CEDENTE_A')}, ${userId('consultor_a')}::uuid, ${id('CEDENTE_A_1')}, 0.75),
  (${id('CONSULTOR_A_CEDENTE_MULTI')}, ${userId('consultor_a')}::uuid, ${id('CEDENTE_A_2')}, 0.85),
  (${id('CONSULTOR_B_CEDENTE_B')}, ${userId('consultor_b')}::uuid, ${id('CEDENTE_B_1')}, 0.95);

INSERT INTO public.politicas_operacionais (
  id, fundo_id, codigo, nome, descricao, status, created_by, padrao
) VALUES
  (${policyA}, ${fundA}, '${PERF9A_PREFIX}POL_A', '${PERF9A_PREFIX}Politica Fundo A', 'Politica sintetica publicada A', 'ativa', ${userId('gestor_a')}::uuid, true),
  (${policyB}, ${fundB}, '${PERF9A_PREFIX}POL_B', '${PERF9A_PREFIX}Politica Fundo B', 'Politica sintetica publicada B', 'ativa', ${userId('gestor_b')}::uuid, true);

INSERT INTO public.politica_operacional_versoes (
  id, politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde,
  aceite_sacado_obrigatorio, cessao_no_desembolso, cria_acompanhamento_entrega,
  configuracao, regras, parametros, conteudo_hash, status
) VALUES
  (${versionA}, ${policyA}, NULL, ${fundA}, 1, now() - interval '90 days',
   false, true, true,
   '{"aceite":"dispensado","cessao":"desembolso","entrega":"obrigatoria"}',
   '{"origem":"PERF9A"}', '{"prazo_entrega_dias":10}',
   md5('PERF9A_POL_A') || md5('PERF9A_POL_A'), 'rascunho'),
  (${versionB}, ${policyB}, NULL, ${fundB}, 1, now() - interval '90 days',
   true, false, false,
   '{"aceite":"antes_desembolso","cessao":"assinatura","entrega":"nao_aplicavel"}',
   '{"origem":"PERF9A"}', '{"prazo_entrega_dias":0}',
   md5('PERF9A_POL_B') || md5('PERF9A_POL_B'), 'rascunho');

INSERT INTO public.politica_requisitos_documentais (
  id, politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id,
  fundo_id, codigo, escopo, tipo_documento_codigo, documento_tipo_id,
  obrigatorio, quantidade_minima, formatos_aceitos, nivel_validacao,
  prazo_dias_corridos, responsavel_upload, responsavel_aprovacao, ordem,
  ativo, momento_obrigatorio, categoria, bloqueia_fluxo, observacoes
)
SELECT md5('BW_ANTECIPA:9A.1:REQ_' || fund_key || '_' || req.idx)::uuid,
       CASE fund_key WHEN 'A' THEN ${versionA} ELSE ${versionB} END,
       CASE fund_key WHEN 'A' THEN ${policyA} ELSE ${policyB} END,
       NULL,
       CASE fund_key WHEN 'A' THEN ${fundA} ELSE ${fundB} END,
       '${PERF9A_PREFIX}' || fund_key || '_REQ_' || req.idx,
       req.escopo, req.tipo_codigo, dt.id,
       req.obrigatorio, 1, req.formatos, req.nivel,
       req.prazo, 'cedente', 'gestor', req.idx,
       true, req.escopo, req.escopo, req.obrigatorio,
       '${PERF9A_PREFIX}requisito sintetico'
FROM (VALUES ('A'), ('B')) funds(fund_key)
CROSS JOIN (
  VALUES
    (1, 'nf_pre_cessao', 'nf_xml', ARRAY['application/xml','text/xml']::text[], 'estrutural', NULL::integer, true),
    (2, 'nf_pre_cessao', 'nf_danfe_pdf', ARRAY['application/pdf']::text[], 'manual', NULL::integer, true),
    (3, 'nf_pre_cessao', 'nf_pedido_compra', ARRAY['application/pdf']::text[], 'manual', NULL::integer, false),
    (4, 'pos_cessao', 'comprovante_entrega', ARRAY['application/pdf','image/jpeg']::text[], 'manual', 10, true)
) req(idx, escopo, tipo_codigo, formatos, nivel, prazo, obrigatorio)
JOIN public.documento_tipos dt ON dt.codigo = req.tipo_codigo;

UPDATE public.politica_operacional_versoes
SET publicada_por = CASE fundo_id WHEN ${fundA} THEN ${userId('gestor_a')}::uuid ELSE ${userId('gestor_b')}::uuid END,
    publicada_em = now() - interval '89 days',
    status = 'publicada'
WHERE id IN (${versionA}, ${versionB});

CREATE TEMP TABLE perf9a_assignments (
  assignment_idx integer NOT NULL UNIQUE,
  assignment_id uuid PRIMARY KEY,
  cedente_fundo_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  fund_key text NOT NULL
) ON COMMIT DROP;

INSERT INTO perf9a_assignments
SELECT row_number() OVER (ORDER BY link_idx),
       md5('BW_ANTECIPA:9A.1:ASSIGN_' || link_idx)::uuid,
       cedente_fundo_id,
       CASE fund_key WHEN 'A' THEN ${policyA} ELSE ${policyB} END,
       CASE fund_key WHEN 'A' THEN ${versionA} ELSE ${versionB} END,
       fund_key
FROM perf9a_links
WHERE status='ativo' AND link_idx <> 119;

INSERT INTO public.cedente_fundo_politicas (
  id, cedente_fundo_id, politica_operacional_id, status, vigente_desde, atribuido_por, motivo
)
SELECT assignment_id, cedente_fundo_id, policy_id, 'ativa', now() - interval '80 days',
       CASE fund_key WHEN 'A' THEN ${userId('gestor_a')}::uuid ELSE ${userId('gestor_b')}::uuid END,
       '${PERF9A_PREFIX}atribuicao controlada'
FROM perf9a_assignments;

INSERT INTO public.taxas_cedente (id, cedente_id, prazo_min, prazo_max, taxa_percentual)
SELECT md5('BW_ANTECIPA:9A.1:TAXA_' || c.idx || '_' || faixa.idx)::uuid,
       c.cedente_id, faixa.minimo, faixa.maximo, faixa.taxa
FROM perf9a_cedentes c
CROSS JOIN (VALUES
  (1, 1, 30, 1.2375::numeric),
  (2, 31, 90, 2.8750::numeric),
  (3, 91, 180, 3.9900::numeric)
) faixa(idx, minimo, maximo, taxa)
WHERE c.group_key IN ('A','B');

CREATE TEMP TABLE perf9a_operacoes (
  op_idx integer PRIMARY KEY,
  operacao_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  cedente_fundo_id uuid NOT NULL,
  cedente_id uuid NOT NULL,
  fundo_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status public.operacao_status NOT NULL
) ON COMMIT DROP;

INSERT INTO perf9a_operacoes
SELECT i,
       md5('BW_ANTECIPA:9A.1:OPERACAO_' || i)::uuid,
       a.assignment_id,
       a.cedente_fundo_id,
       l.cedente_id,
       l.fundo_id,
       a.policy_id,
       a.version_id,
       (ARRAY['solicitada','em_analise','aprovada','em_andamento','liquidada','inadimplente','reprovada','cancelada']::public.operacao_status[])[1 + ((i - 1) % 8)]
FROM generate_series(1, 250) i
JOIN perf9a_assignments a ON a.assignment_idx = 1 + ((i - 1) % 119)
JOIN perf9a_links l ON l.cedente_fundo_id = a.cedente_fundo_id;

INSERT INTO public.operacoes (
  id, cedente_id, valor_bruto_total, taxa_desconto, prazo_dias,
  valor_liquido_desembolso, data_vencimento, status,
  aprovado_por, aprovado_em, liquidada_em,
  cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id,
  politica_versao, politica_snapshot, politica_snapshot_hash,
  contexto_configuracao_status, contexto_capturado_em,
  aceite_sacado_exigido, aceite_sacado_status, aceite_sacado_em,
  cessao_efetivada_em, solicitacao_idempotency_key, politica_atribuicao_id,
  created_at, updated_at
)
SELECT operacao_id, cedente_id,
       round((1000 + op_idx * 17.37)::numeric, 2),
       round((1.0000 + (op_idx % 7) * 0.2375)::numeric, 4),
       1 + (op_idx % 180),
       round((950 + op_idx * 16.91)::numeric, 2),
       current_date + (1 + (op_idx % 180)),
       status,
       CASE WHEN status IN ('aprovada','em_andamento','liquidada','inadimplente') THEN ${userId('gestor_multi')}::uuid END,
       CASE WHEN status IN ('aprovada','em_andamento','liquidada','inadimplente') THEN now() - interval '15 days' END,
       CASE WHEN status='liquidada' THEN now() - interval '2 days' END,
       cedente_fundo_id, policy_id, version_id, 1,
       jsonb_build_object('origem','PERF9A','versao',1,'fundo_id',fundo_id),
       md5('PERF9A_OP_' || op_idx) || md5('PERF9A_OP_' || op_idx),
       'completo', now() - interval '30 days',
       (fundo_id = ${fundB}),
       CASE WHEN fundo_id=${fundB} THEN 'pendente' ELSE 'dispensado' END,
       CASE WHEN fundo_id=${fundA} THEN now() - interval '30 days' END,
       CASE WHEN status IN ('em_andamento','liquidada','inadimplente') THEN now() - interval '14 days' END,
       '${PERF9A_PREFIX}OP_' || op_idx,
       assignment_id,
       timestamptz '2026-06-30 23:59:30+00' + (op_idx || ' minutes')::interval,
       timestamptz '2026-06-30 23:59:30+00' + (op_idx || ' minutes')::interval
FROM perf9a_operacoes;

CREATE TEMP TABLE perf9a_nfs (
  nf_idx integer PRIMARY KEY,
  nota_fiscal_id uuid NOT NULL,
  op_idx integer NOT NULL,
  operacao_id uuid NOT NULL,
  cedente_id uuid NOT NULL,
  cedente_fundo_id uuid NOT NULL,
  fundo_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO perf9a_nfs
SELECT n,
       md5('BW_ANTECIPA:9A.1:NF_' || n)::uuid,
       CASE
         WHEN n <= 50 THEN 1
         WHEN n <= 60 THEN 2
         WHEN n = 61 THEN 3
         WHEN n <= 853 THEN 4 + ((n - 62) / 4)
         ELSE 202 + ((n - 854) / 3)
       END,
       o.operacao_id, o.cedente_id, o.cedente_fundo_id, o.fundo_id, o.policy_id, o.version_id
FROM generate_series(1, 1000) n
JOIN perf9a_operacoes o ON o.op_idx = CASE
  WHEN n <= 50 THEN 1
  WHEN n <= 60 THEN 2
  WHEN n = 61 THEN 3
  WHEN n <= 853 THEN 4 + ((n - 62) / 4)
  ELSE 202 + ((n - 854) / 3)
END;

INSERT INTO public.notas_fiscais (
  id, cedente_id, cedente_fundo_id, fundo_id,
  numero_nf, serie, chave_acesso, data_emissao, data_vencimento,
  cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario,
  valor_bruto, valor_liquido, valor_icms, valor_pis, valor_cofins, valor_ipi,
  descricao_itens, condicao_pagamento, arquivo_url, status,
  taxa_desagio, valor_antecipado, submetida_em, submetida_por,
  aprovacao_sacado_em, aprovada_gestor_em, created_at, updated_at
)
SELECT n.nota_fiscal_id, n.cedente_id, n.cedente_fundo_id, n.fundo_id,
       '${PERF9A_PREFIX}' || lpad(n.nf_idx::text, 7, '0'), '1',
       lpad((90000000000000000000000000000000000000000000::numeric + n.nf_idx)::text, 44, '0'),
       date '2026-06-01' + (n.nf_idx % 30),
       date '2026-07-01' + (n.nf_idx % 180),
       c.cnpj, c.razao_social,
       CASE WHEN n.nf_idx % 10 = 0
         THEN (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='SACADO_B')
         ELSE (SELECT cnpj FROM perf9a_cnpjs WHERE entity_key='SACADO_A') END,
       CASE WHEN n.nf_idx % 10 = 0 THEN '${PERF9A_PREFIX}SACADO B' ELSE '${PERF9A_PREFIX}SACADO A' END,
       round((100 + n.nf_idx * 13.17)::numeric, 2),
       round((95 + n.nf_idx * 12.71)::numeric, 2),
       round((n.nf_idx * 0.37)::numeric, 2),
       round((n.nf_idx * 0.08)::numeric, 2),
       round((n.nf_idx * 0.12)::numeric, 2),
       round((n.nf_idx * 0.04)::numeric, 2),
       '${PERF9A_PREFIX}itens sinteticos', '30/60 dias',
       'perf9a/notas/' || n.nota_fiscal_id || '.xml',
       (ARRAY['rascunho','submetida','em_analise','aprovada','em_antecipacao','aceita','contestada','liquidada','cancelada','requer_ajuste']::public.nf_status[])[1 + ((n.nf_idx - 1) % 10)],
       round((1 + (n.nf_idx % 7) * 0.2375)::numeric, 4),
       round((95 + n.nf_idx * 12.71)::numeric, 2),
       timestamptz '2026-06-30 23:59:30+00' + (n.nf_idx || ' seconds')::interval,
       c.user_id,
       CASE WHEN n.nf_idx % 10 = 5 THEN now() - interval '10 days' END,
       CASE WHEN n.nf_idx % 10 IN (3,4,5,7) THEN now() - interval '12 days' END,
       timestamptz '2026-06-30 23:59:30+00' + (n.nf_idx || ' seconds')::interval,
       timestamptz '2026-06-30 23:59:30+00' + (n.nf_idx || ' seconds')::interval
FROM perf9a_nfs n
JOIN public.cedentes c ON c.id=n.cedente_id;

INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
SELECT operacao_id, nota_fiscal_id FROM perf9a_nfs;

INSERT INTO public.nota_fiscal_entregas (
  id, operacao_id, nota_fiscal_id, status_entrega, cessao_efetivada_em,
  data_limite_cte, data_limite_canhoto, data_entrega, entrega_confirmada_em,
  motivo_pendencia, created_at
)
SELECT md5('BW_ANTECIPA:9A.1:ENTREGA_' || nf_idx)::uuid,
       operacao_id, nota_fiscal_id,
       CASE nf_idx % 6
         WHEN 0 THEN 'nao_aplicavel'
         WHEN 1 THEN 'em_transito'
         WHEN 2 THEN 'aguardando_validacao'
         WHEN 3 THEN 'entregue'
         WHEN 4 THEN 'entrega_com_pendencia'
         ELSE 'devolvida'
       END,
       now() - interval '14 days',
       current_date + ((nf_idx % 20) - 5),
       current_date + ((nf_idx % 30) - 10),
       CASE WHEN nf_idx % 6=3 THEN current_date - 1 END,
       CASE WHEN nf_idx % 6=3 THEN now() - interval '1 day' END,
       CASE WHEN nf_idx % 6 IN (4,5) THEN '${PERF9A_PREFIX}pendencia controlada' END,
       timestamptz '2026-07-01 00:00:00+00' + (nf_idx || ' minutes')::interval
FROM perf9a_nfs WHERE nf_idx <= 200;

INSERT INTO public.eventos_entrega (
  id, nota_fiscal_entrega_id, tipo_evento, status_anterior, status_novo,
  ocorrido_em, registrado_por, ator_tipo, dados
)
SELECT md5('BW_ANTECIPA:9A.1:EVENTO_ENTREGA_' || nf_idx)::uuid,
       md5('BW_ANTECIPA:9A.1:ENTREGA_' || nf_idx)::uuid,
       'cessao_efetivada', NULL, 'em_transito',
       timestamptz '2026-07-01 00:00:00+00' + (nf_idx || ' minutes')::interval,
       ${userId('gestor_multi')}::uuid, 'usuario',
       jsonb_build_object('origem','PERF9A','indice',nf_idx)
FROM perf9a_nfs WHERE nf_idx <= 200;

INSERT INTO public.documentos_repositorio (
  id, documento_tipo_id, status, criado_por, created_at, updated_at
)
SELECT md5('BW_ANTECIPA:9A.1:DOC_' || nf_idx)::uuid,
       (SELECT id FROM public.documento_tipos WHERE codigo='nf_xml'),
       CASE nf_idx % 4 WHEN 0 THEN 'aprovado' WHEN 1 THEN 'enviado' WHEN 2 THEN 'em_analise' ELSE 'rejeitado' END,
       c.user_id,
       timestamptz '2026-07-02 00:00:00+00' + (nf_idx || ' seconds')::interval,
       timestamptz '2026-07-02 00:00:00+00' + (nf_idx || ' seconds')::interval
FROM perf9a_nfs n
JOIN public.cedentes c ON c.id=n.cedente_id
WHERE nf_idx <= 900;

INSERT INTO public.documento_versoes (
  id, documento_id, numero_versao, bucket, path, nome_original, mime_type,
  tamanho_bytes, sha256, status, enviado_por, enviado_em
)
SELECT md5('BW_ANTECIPA:9A.1:DOC_VERSION_' || nf_idx)::uuid,
       md5('BW_ANTECIPA:9A.1:DOC_' || nf_idx)::uuid,
       1, 'documentos-v2',
       'perf9a/documentos/' || nf_idx || '/nf.xml',
       '${PERF9A_PREFIX}NF_' || nf_idx || '.xml',
       'application/xml', 256 + nf_idx,
       md5('PERF9A_DOC_' || nf_idx) || md5('PERF9A_DOC_' || nf_idx),
       CASE nf_idx % 4 WHEN 0 THEN 'aprovado' WHEN 1 THEN 'enviado' WHEN 2 THEN 'em_analise' ELSE 'rejeitado' END,
       c.user_id,
       timestamptz '2026-07-02 00:00:00+00' + (nf_idx || ' seconds')::interval
FROM perf9a_nfs n
JOIN public.cedentes c ON c.id=n.cedente_id
WHERE nf_idx <= 900;

INSERT INTO public.documento_vinculos (
  id, documento_id, nota_fiscal_id, cedente_id, principal
)
SELECT md5('BW_ANTECIPA:9A.1:DOC_LINK_' || nf_idx)::uuid,
       md5('BW_ANTECIPA:9A.1:DOC_' || nf_idx)::uuid,
       nota_fiscal_id, cedente_id, true
FROM perf9a_nfs WHERE nf_idx <= 900;

-- Os triggers documentais reutilizam a mesma autorização de domínio das ações
-- autenticadas. A carga continua executada em uma única transação administrativa,
-- mas fornece o contexto JWT de um gestor sintético autorizado nos dois fundos.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', ${userId('gestor_multi')},
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('request.jwt.claim.sub', ${userId('gestor_multi')}, true);

INSERT INTO public.documento_requisito_instancias (
  id, politica_requisito_id, politica_operacional_id, politica_operacional_versao_id,
  politica_versao, documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot,
  nota_fiscal_id, cedente_id, status, obrigatorio, formatos_aceitos_snapshot,
  nivel_validacao_snapshot, quantidade_minima_snapshot,
  responsavel_upload_snapshot, responsavel_aprovacao_snapshot,
  documento_id, versao_aprovada_id, satisfeito_em, origem_snapshot
)
SELECT md5('BW_ANTECIPA:9A.1:DOC_INSTANCE_' || nf_idx)::uuid,
       md5('BW_ANTECIPA:9A.1:REQ_' || CASE fundo_id WHEN ${fundA} THEN 'A' ELSE 'B' END || '_1')::uuid,
       policy_id, version_id, 1,
       (SELECT id FROM public.documento_tipos WHERE codigo='nf_xml'),
       'nf_xml', 'nf_pre_cessao', nota_fiscal_id, cedente_id,
       CASE WHEN nf_idx <= 900 AND nf_idx % 4=0 THEN 'satisfeito' ELSE 'pendente' END,
       true, ARRAY['application/xml','text/xml'], 'estrutural', 1, 'cedente', 'gestor',
       CASE WHEN nf_idx <= 900 THEN md5('BW_ANTECIPA:9A.1:DOC_' || nf_idx)::uuid END,
       CASE WHEN nf_idx <= 900 AND nf_idx % 4=0 THEN md5('BW_ANTECIPA:9A.1:DOC_VERSION_' || nf_idx)::uuid END,
       CASE WHEN nf_idx <= 900 AND nf_idx % 4=0 THEN now() - interval '1 day' END,
       CASE WHEN nf_idx <= 900 THEN 'upload_requisito' ELSE 'reparo_administrativo' END
FROM perf9a_nfs;

INSERT INTO public.contas_escrow (
  id, cedente_id, identificador, saldo_disponivel, saldo_bloqueado, status
)
SELECT md5('BW_ANTECIPA:9A.1:ESCROW_' || row_number() OVER (ORDER BY cedente_id))::uuid,
       cedente_id,
       '${PERF9A_PREFIX}ESCROW_' || lpad(row_number() OVER (ORDER BY cedente_id)::text, 3, '0'),
       100000 + row_number() OVER (ORDER BY cedente_id) * 100,
       row_number() OVER (ORDER BY cedente_id) * 10,
       CASE row_number() OVER (ORDER BY cedente_id) % 10
         WHEN 0 THEN 'bloqueada'::public.conta_escrow_status
         WHEN 1 THEN 'encerrada'::public.conta_escrow_status
         ELSE 'ativa'::public.conta_escrow_status
       END
FROM (SELECT cedente_id FROM perf9a_cedentes WHERE group_key IN ('A','B') ORDER BY idx LIMIT 80) selected;

INSERT INTO public.movimentos_escrow (
  id, conta_escrow_id, tipo, descricao, valor, saldo_apos, operacao_id, created_at
)
SELECT md5('BW_ANTECIPA:9A.1:MOV_' || i)::uuid,
       ${id('ESCROW_1')},
       CASE i % 2 WHEN 0 THEN 'credito'::public.movimento_tipo ELSE 'debito'::public.movimento_tipo END,
       '${PERF9A_PREFIX}movimento ' || i,
       round((10 + (i % 97) * 1.11)::numeric, 2),
       round((100000 + i * 0.37)::numeric, 2),
       CASE WHEN i <= 250 THEN md5('BW_ANTECIPA:9A.1:OPERACAO_' || i)::uuid END,
       CASE WHEN i BETWEEN 1 AND 30
         THEN timestamptz '2026-07-15 12:00:00+00'
         ELSE timestamptz '2026-07-01 00:00:00+00' + (i || ' seconds')::interval END
FROM generate_series(1, 5000) i;

INSERT INTO public.notificacoes (
  id, usuario_id, titulo, mensagem, tipo, lida, created_at, dedupe_key
)
SELECT md5('BW_ANTECIPA:9A.1:NOTIF_' || u.key || '_' || i)::uuid,
       u.user_id,
       '${PERF9A_PREFIX}Notificacao ' || i,
       '${PERF9A_PREFIX}mensagem sintetica ' || i,
       (ARRAY['info','sucesso','alerta','erro'])[1 + ((i - 1) % 4)],
       (i % 3 = 0),
       CASE WHEN i <= 30
         THEN timestamptz '2026-07-20 12:00:00+00'
         ELSE timestamptz '2026-07-01 00:00:00+00' + (i || ' minutes')::interval END,
       '${PERF9A_PREFIX}' || u.key || '_' || i
FROM perf9a_users u
CROSS JOIN generate_series(1, 500) i
WHERE u.key IN ('gestor_a','gestor_b','gestor_multi','cedente_a','cedente_b','consultor_a','consultor_b','sacado_a','sacado_b');

INSERT INTO public.logs_auditoria (
  id, usuario_id, tipo_evento, entidade_tipo, entidade_id,
  dados_antes, dados_depois, ator_tipo, origem, ator_identificador, created_at
)
SELECT md5('BW_ANTECIPA:9A.1:AUDIT_' || i)::uuid,
       ${userId('gestor_multi')}::uuid,
       '${PERF9A_PREFIX}EVENTO_' || (i % 12),
       CASE i % 4 WHEN 0 THEN 'operacoes' WHEN 1 THEN 'notas_fiscais' WHEN 2 THEN 'cedentes' ELSE 'fundos' END,
       CASE i % 4
         WHEN 0 THEN md5('BW_ANTECIPA:9A.1:OPERACAO_' || (1 + (i % 250)))::uuid
         WHEN 1 THEN md5('BW_ANTECIPA:9A.1:NF_' || (1 + (i % 1000)))::uuid
         WHEN 2 THEN md5('BW_ANTECIPA:9A.1:CEDENTE_A_' || (1 + (i % 60)))::uuid
         ELSE ${fundA} END,
       jsonb_build_object('origem','PERF9A','valor',i-1),
       jsonb_build_object('origem','PERF9A','valor',i),
       'usuario', 'perf9a_seed', '${PERF9A_PREFIX}gestor_multi',
       CASE WHEN i <= 30
         THEN timestamptz '2026-07-20 12:00:00+00'
         ELSE timestamptz '2026-07-01 00:00:00+00' + (i || ' minutes')::interval END
FROM generate_series(1, 1000) i;

INSERT INTO public.eventos_dominio (
  id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id, operacao_id,
  tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot, ator_perfil_snapshot,
  origem, descricao, metadata, visibilidade, correlation_id, origem_evento,
  origem_registro_id, created_at
)
SELECT md5('BW_ANTECIPA:9A.1:DOMAIN_' || i)::uuid,
       n.fundo_id, n.cedente_id, n.cedente_fundo_id,
       CASE WHEN i > 100 THEN n.nota_fiscal_id END,
       CASE WHEN i <= 100 THEN n.operacao_id END,
       '${PERF9A_PREFIX}DOMINIO_' || i,
       CASE i % 5 WHEN 0 THEN 'documento' WHEN 1 THEN 'analise' WHEN 2 THEN 'operacao' WHEN 3 THEN 'logistica' ELSE 'sistema' END,
       ${userId('gestor_multi')}::uuid, '${PERF9A_PREFIX}Gestor Multi', 'gestor',
       'perf9a_seed', '${PERF9A_PREFIX}evento de dominio ' || i,
       jsonb_build_object('origem','PERF9A','indice',i),
       CASE i % 3 WHEN 0 THEN 'interno' WHEN 1 THEN 'cedente' ELSE 'ambos' END,
       '${PERF9A_PREFIX}CORR_' || i, 'seed', i::text,
       CASE WHEN i <= 30
         THEN timestamptz '2026-07-20 12:00:00+00'
         ELSE timestamptz '2026-07-01 00:00:00+00' + (i || ' minutes')::interval END
FROM generate_series(1, 200) i
CROSS JOIN LATERAL (
  SELECT * FROM perf9a_nfs WHERE nf_idx = CASE WHEN i <= 100 THEN 1 ELSE 2 END
) n;

UPDATE public.profiles
SET status='inativo'
WHERE id IN (${userId('usuario_inativo')}::uuid, ${userId('sacado_inativo')}::uuid);

UPDATE public.profiles
SET mfa_ativado_em=now(), ultima_autenticacao_forte_em=now()
WHERE id IN (SELECT user_id FROM perf9a_users)
  AND id <> ${userId('sem_perfil')}::uuid;

DELETE FROM public.profiles WHERE id=${userId('sem_perfil')}::uuid;

DO $$
DECLARE
  v_total integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.notas_fiscais WHERE numero_nf LIKE '${PERF9A_PREFIX}%';
  IF v_total <> 1000 THEN RAISE EXCEPTION 'Volume de NFs divergente: %', v_total; END IF;
  SELECT count(*) INTO v_total FROM public.operacoes WHERE solicitacao_idempotency_key LIKE '${PERF9A_PREFIX}%';
  IF v_total <> 250 THEN RAISE EXCEPTION 'Volume de operacoes divergente: %', v_total; END IF;
  SELECT count(*) INTO v_total FROM public.operacoes_nfs onf JOIN public.notas_fiscais nf ON nf.id=onf.nota_fiscal_id WHERE nf.numero_nf LIKE '${PERF9A_PREFIX}%';
  IF v_total <> 1000 THEN RAISE EXCEPTION 'Volume de operacoes_nfs divergente: %', v_total; END IF;
  IF EXISTS (SELECT 1 FROM public.cedentes WHERE razao_social LIKE '${PERF9A_PREFIX}%' AND fundo_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Fallback legado cedentes.fundo_id foi preenchido indevidamente.';
  END IF;
END;
$$;

COMMIT;
`
}

function buildCnpjRows() {
  const rows = []
  let sequence = 1
  const add = (key) => {
    rows.push(`(${sqlText(key)}, ${sqlText(formatCnpj(generateValidCnpj(sequence)))})`)
    sequence += 1
  }

  for (const key of ['FUNDO_A', 'FUNDO_B', 'ADMIN_A', 'ADMIN_B', 'GESTORA', 'CUSTODIANTE', 'SACADO_A', 'SACADO_B', 'SACADO_INATIVO']) add(key)
  for (let index = 1; index <= 60; index += 1) add(`CEDENTE_A_${index}`)
  for (let index = 1; index <= 59; index += 1) add(`CEDENTE_B_${index}`)
  add('CEDENTE_SUSPENSO')
  for (let index = 1; index <= 60; index += 1) add(`ONBOARDING_${index}`)
  return rows.join(',\n  ')
}

function requireUser(users, key) {
  const user = users.get(key)
  if (!user) throw new Error(`Usuario PERF9A ausente: ${key}`)
  return user
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error)
  return error.message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
