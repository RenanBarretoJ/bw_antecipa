import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { base, branch, connect, details, ref, saveCredentials } from './nfse-submit-runtime.mjs'

const mode = process.argv[2]
assert(['--seed', '--bind-env'].includes(mode) && process.argv.length === 3)
const d = details()
if (mode === '--bind-env') {
  for (const key of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) assert.equal(JSON.parse(Buffer.from(d[key].split('.')[1], 'base64url').toString()).ref, ref)
  const entries = { NEXT_PUBLIC_SUPABASE_URL: d.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: d.SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: d.SUPABASE_SERVICE_ROLE_KEY, APP_BASE_URL: base }
  for (const [key, value] of Object.entries(entries)) {
    const r = spawnSync(process.execPath, [resolve(process.env.APPDATA, 'npm/node_modules/vercel/dist/vc.js'), 'env', 'add', key, 'preview', '--git-branch', branch, '--project', 'prj_nKt7FiU3FWHrmRyf0mbDudM0AVIF', '--scope', 'renanbarretoj', '--yes', '--force', ...(key === 'SUPABASE_SERVICE_ROLE_KEY' ? ['--sensitive'] : ['--no-sensitive'])], { input: value, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    if (r.status !== 0) {
      let message = `${r.stderr || ''}${r.stdout || ''}`
      for (const value of Object.values(entries)) message = message.replaceAll(value, '[REDACTED]')
      console.error(message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]').slice(-900))
    }
    assert.equal(r.status, 0, `PREVIEW_ENV_BIND_FAILED:${key}`)
    console.log(JSON.stringify({ key, target: 'preview', branch, success: true }))
  }
} else {
  const db = await connect(d)
  const admin = createClient(d.SUPABASE_URL, d.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const state = { ref, actors: {}, ids: {}, seeded: false }
  try {
    assert.equal((await db.query('select (select count(*) from auth.users)+(select count(*) from public.notas_fiscais) n')).rows[0].n, '0', 'EMPTY_QA_REQUIRED')
    for (const [name, role, suffix] of [['consultor', 'consultor', 1], ['leitor', 'consultor', 2], ['cedente', 'cedente', 3], ['gestor', 'gestor', 4]]) {
      const email = `qa-nfse-submit-${name}@example.invalid`, password = `Nfse!A1${randomBytes(24).toString('base64url')}`
      const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome_completo: `QA NFSE ${name}` } })
      assert(!r.error && r.data.user, 'QA_CREATE_FAILED')
      state.actors[name] = { id: r.data.user.id, email, password, role }
      state.ids[`21000000-0000-4000-8000-00000000000${suffix}`] = r.data.user.id
      saveCredentials(state)
    }
    let fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8').replace(/  INSERT INTO auth.users[\s\S]*?(?=  INSERT INTO public.profiles)/, '')
    fixture += '\n' + readFileSync('supabase/tests/nfse_submit_frozen.assert.sql', 'utf8').split('CREATE TEMP TABLE nfse_submit_before')[0]
    for (const uuid of new Set(fixture.match(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g))) state.ids[uuid] ||= randomUUID()
    for (const [from, to] of Object.entries(state.ids)) fixture = fixture.replaceAll(from, to)
    fixture = fixture.replaceAll('Fundo QA C2.1', 'FUNDO QA NFSE SUBMIT')
    saveCredentials(state)
    await db.query('BEGIN')
    await db.query(fixture)
    for (const [name, a] of Object.entries(state.actors)) await db.query('update public.profiles set nome_completo=$1,email=$2 where id=$3', [`QA NFSE ${name}`, a.email, a.id])
    // Existing NFE fixture becomes an unsubmitted legacy sample for the UI regression.
    await db.query("update public.notas_fiscais set status='rascunho' where id=$1", [state.ids['2a000000-0000-4000-8000-000000000004']])
    await db.query('COMMIT')
    state.seeded = true; saveCredentials(state)
    writeFileSync('rehearsal/reports/NFSE_SUBMIT_QA_IDS.json', JSON.stringify({ ref, ids: state.ids }, null, 2))
    console.log(JSON.stringify({ success: true, ref, qaActors: 4, productionChanged: false }))
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ success: false, code: e.code || 'ASSERTION', message: String(e.message).split('\n')[0].slice(0, 160) })); process.exitCode = 1
  } finally { await db.end() }
}
