import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const criticalNames = ['handle_new_user', 'registrar_sessao_mfa_atual', 'fiscal_intake_commit',
  'fiscal_intake_stage', 'fiscal_intake_reserve', 'fiscal_validate_stored_actor', 'fiscal_instanciar_requisitos_nota']
export const securityCatalog = `SELECT md5(jsonb_build_object(
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','private','auth','storage')),
  'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p'))
  )::text);`
export const sha256 = value => createHash('sha256').update(value).digest('hex')

export function decodeSnapshot(text, expectedHash) {
  assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/, 'SNAPSHOT_HASH_REQUIRED')
  assert.equal(sha256(text.replaceAll('\r\n', '\n')), expectedHash, 'VERSIONED_NATIVE_SNAPSHOT_HASH_DRIFT')
  const envelope = JSON.parse(text)
  assert.equal(envelope.format, 'BW_NATIVE_QA_SCHEMA_ONLY_V1')
  const bytes = gunzipSync(Buffer.from(envelope.gzipBase64, 'base64'), { maxOutputLength: 12 * 1024 * 1024 })
  assert.equal(sha256(bytes), envelope.payloadSha256, 'NATIVE_SNAPSHOT_PAYLOAD_DRIFT')
  const payload = JSON.parse(bytes.toString('utf8'))
  assert.equal(payload.sourceKind, 'LOCAL_SCHEMA_ONLY_NO_APPLICATION_DATA')
  assert.match(payload.image, /^public\.ecr\.aws\/supabase\/postgres:[\d.]+$/)
  assert.equal(sha256(payload.schema), payload.schemaSha256)
  assert.equal(sha256(payload.platformHistory), payload.platformHistorySha256)
  assert(payload.schema.length > 100000 && !/^COPY |^INSERT INTO /m.test(payload.schema), 'SCHEMA_ONLY_REQUIRED')
  assert(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.|sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(payload.schema + payload.platformHistory), 'SECRET_IN_SNAPSHOT_REFUSED')
  const inserts = payload.platformHistory.split('\n').filter(line => /^INSERT INTO /i.test(line))
  assert(!/^COPY /im.test(payload.platformHistory), 'UNEXPECTED_DATA_COPY_REFUSED')
  assert(inserts.length > 0 && inserts.every(line => /^INSERT INTO (auth\.schema_migrations|storage\.migrations)\s/.test(line)), 'ONLY_NATIVE_PLATFORM_MIGRATION_METADATA_ALLOWED')
  assert(payload.roles.every(role => !Object.keys(role).some(key => /password|secret/i.test(key))))
  assert.equal(payload.functions.length, criticalNames.length)
  return payload
}

export function exportSnapshot() {
  const source = 'supabase_db_bw_email03_r1full_cleanroom_179137940498'
  const docker = args => {
    const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120000 })
    assert.equal(result.status, 0, `LOCAL_SNAPSHOT_EXPORT_FAILED:${args[0]}`)
    return result.stdout.trimEnd()
  }
  assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'REMOTE_DOCKER_REFUSED')
  assert.match(docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^(npipe:|unix:)/)
  const query = sql => docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', `BEGIN READ ONLY; ${sql}; COMMIT;`])
    .split('\n').filter(line => !['BEGIN', 'COMMIT'].includes(line)).join('\n')
  const schema = docker(['exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-publications', '--no-subscriptions'])
  const platformHistory = docker(['exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--column-inserts', '-t', 'auth.schema_migrations', '-t', 'storage.migrations'])
  const functions = JSON.parse(query("SELECT json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')"))
    .filter(fn => criticalNames.includes(fn.name.split('.')[1]))
  const roles = JSON.parse(query("SELECT json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls)) FROM pg_roles WHERE rolname !~ '^pg_'"))
  const payload = { sourceKind: 'LOCAL_SCHEMA_ONLY_NO_APPLICATION_DATA', source,
    image: docker(['inspect', source, '--format', '{{.Config.Image}}']), schema, schemaSha256: sha256(schema),
    platformHistory, platformHistorySha256: sha256(platformHistory), functions, roles, securityHash: query(securityCatalog) }
  const bytes = Buffer.from(JSON.stringify(payload))
  const envelope = JSON.stringify({ format: 'BW_NATIVE_QA_SCHEMA_ONLY_V1', payloadSha256: sha256(bytes), gzipBase64: gzipSync(bytes).toString('base64') }) + '\n'
  decodeSnapshot(envelope, sha256(envelope))
  return envelope
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--export-local-only') {
    assert.equal(process.argv.length, 3)
    process.stdout.write(exportSnapshot())
  } else {
    assert.deepEqual(process.argv.slice(2), ['--verify'])
    const manifest = JSON.parse(readFileSync(new URL('./main-integration-manifest.json', import.meta.url), 'utf8'))
    const payload = decodeSnapshot(readFileSync(manifest.nativeSnapshot.path, 'utf8'), manifest.nativeSnapshot.sha256)
    console.log(JSON.stringify({ result: 'PASS', source: payload.sourceKind, functions: payload.functions.length, schemaSha256: payload.schemaSha256 }))
  }
}
