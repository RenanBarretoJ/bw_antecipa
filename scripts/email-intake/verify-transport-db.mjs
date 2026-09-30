import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

// This is an isolated transport-contract test, not a full application clean-room.
// Fixed local Docker container + a fresh task-owned database; never a remote URL.
const exec = promisify(execFile)
const container = 'supabase_db_fhgkmggthxikfpogrvaa'
const database = `email_intake_qa_${process.pid}`
const ids = {
  fund: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  integration: '33333333-3333-4333-8333-333333333333',
}

async function sql(query, db = database) {
  // stdin avoids command-line secrets and shell interpolation.
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, '-At'],
      { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.replace(/CONTEXT:[\s\S]*/, '').slice(0, 1500)))
        else resolve(stdout.trim())
      })
    child.stdin.end(query)
  })
}

let created = false
try {
  const { stdout } = await exec('docker', ['inspect', '--format', '{{.Name}}', container])
  assert.equal(stdout.trim(), `/${container}`)
  assert.equal(await sql(`SELECT count(*) FROM pg_database WHERE datname = '${database}'`, 'postgres'), '0')
  await sql(`CREATE DATABASE ${database}`, 'postgres')
  created = true
  await sql(`CREATE SCHEMA private;
    CREATE TABLE public.fundos(id uuid PRIMARY KEY, ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.cedentes(id uuid PRIMARY KEY);
    CREATE TABLE public.notas_fiscais(id uuid PRIMARY KEY);
    INSERT INTO public.fundos VALUES ('${ids.fund}', true);
    INSERT INTO public.profiles VALUES ('${ids.actor}');`)
  await sql(await readFile(new URL('../../supabase/migrations/20260929204430_email_intake_durable_transport.sql', import.meta.url), 'utf8'))
  await sql(`INSERT INTO private.email_integrations(id, fundo_id, name, provider, mailbox_address, created_by, start_at,
      enabled, scope_verified_at, scope_evidence_hash, credential_env_ref)
    VALUES ('${ids.integration}', '${ids.fund}', 'Synthetic QA', 'OUTLOOK_GRAPH', 'qa@example.test', '${ids.actor}', now(),
      true, now(), repeat('a',64), 'EMAIL_INTAKE_QA_SYNTHETIC');`)
  const claimQuery = `SELECT token::text || '|' || revision FROM public.email_intake_claim_discovery('${ids.integration}', 'DELTA')`
  const [left, right] = await Promise.all([sql(claimQuery), sql(claimQuery)])
  assert.equal([left, right].filter(Boolean).length, 1, 'only one concurrent discovery winner')
  const [token, revision] = (left || right).split('|')
  const attachment = { externalId: 'attachment', name: 'synthetic.pdf', contentType: 'application/pdf', size: 8, inline: false, kind: 'FILE' }
  const messages = [{ externalId: 'message', receivedAt: '2026-09-29T00:00:00Z', attachments: [attachment] }]
  const commit = (rev, rows) => `SELECT public.email_intake_commit_page('${ids.integration}', 'DELTA', '${token}', ${rev},
    '${JSON.stringify(rows)}'::jsonb, 'v1:encrypted-test-cursor', 'v1', false)`
  await assert.rejects(sql(commit(revision, [...messages, { ...messages[0], externalId: 'bad', attachments: null }])), /EMAIL_INVALID_ATTACHMENTS/)
  assert.equal(await sql('SELECT count(*) FROM private.email_intake_messages'), '0', 'whole-page rollback')
  assert.equal(await sql('SELECT revision FROM private.email_sync_state'), '0', 'cursor unchanged after rollback')
  assert.equal(await sql(commit(0, messages)), '1')
  await assert.rejects(sql(commit(0, messages)), /EMAIL_LEASE_LOST/, 'revision fence')
  assert.equal(await sql(commit(1, messages)), '2')
  assert.equal(await sql('SELECT count(*) FROM private.email_intake_attachments'), '1', 'discovery replay deduplicated')
  const claimAttachment = `SELECT id::text || '|' || token::text FROM public.email_intake_claim_attachment('TEXT')`
  const [a, b] = await Promise.all([sql(claimAttachment), sql(claimAttachment)])
  assert.equal([a, b].filter(Boolean).length, 1, 'only one concurrent attachment winner')
  await sql(`UPDATE private.email_intake_attachments SET lease_expires_at = now() - interval '1 minute'`)
  const recovered = await sql(claimAttachment)
  assert.ok(recovered && recovered !== (a || b), 'expired lease receives new fencing token')
  assert.equal(await sql('SELECT attempts FROM private.email_intake_attachments'), '2')
  await sql(`UPDATE private.email_intake_attachments SET attempts = max_attempts, lease_expires_at = now() - interval '1 minute'`)
  assert.equal(await sql(claimAttachment), '')
  assert.equal(await sql('SELECT status FROM private.email_intake_attachments'), 'FAILED')
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await sql(`SELECT has_function_privilege('${role}', 'public.email_intake_claim_discovery(uuid,text)', 'EXECUTE')`), 'f')
    assert.equal(await sql(`SELECT has_table_privilege('${role}', 'private.email_integrations', 'SELECT')`), 'f')
  }
  assert.equal(await sql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relname LIKE 'email_%' AND c.relkind = 'r' AND c.relrowsecurity`), '6')
  console.log('PASS: isolated migration, atomic page rollback, checkpoint fence, replay, concurrent claims, lease recovery, retry exhaustion, grants and RLS.')
} finally {
  if (created) {
    await sql(`DROP DATABASE ${database}`, 'postgres')
    console.log('PASS: synthetic task database removed.')
  }
}
