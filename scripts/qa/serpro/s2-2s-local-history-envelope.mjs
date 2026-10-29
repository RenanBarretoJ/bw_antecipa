import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// LOCAL CERTIFICATION ONLY. No database driver, CLI, network or apply mode.
export const selection = Object.freeze([
  Object.freeze({ version: '20261028195850', name: 's2_2_serpro_operational_queue_history', sha256: '20ec5dc8ca746ed9af2ce9132ed56ec4b2c3032bf34f237289423afb18a1b2f7' }),
  Object.freeze({ version: '20261028204436', name: 's2_2r_serpro_outbound_fencing_recovery', sha256: '4fc2a0c34c1e6acee330a71622b1f44fa0b57ca6f55528cf18d87b591645d7d5' }),
])
const hash = text => createHash('sha256').update(text).digest('hex')
const literal = text => `'${text.replaceAll("'", "''")}'`

export function localHistoryEnvelope({ version, source, database, actor }) {
  assert.match(database, /^r42_[a-z0-9_]{1,48}$/, 'OWNED_LOCAL_DATABASE_REQUIRED')
  assert.match(actor, /^r42-local-[a-z0-9-]{1,64}$/, 'SYNTHETIC_LOCAL_ACTOR_REQUIRED')
  const index = selection.findIndex(item => item.version === version)
  assert.ok(index >= 0, 'EXACT_TWO_VERSION_ALLOWLIST_REQUIRED')
  const item = selection[index]
  assert.equal(hash(source.replace(/\r\n/g, '\n')), item.sha256, 'EXACT_SOURCE_HASH_REQUIRED')
  const begin = /^BEGIN;\r?$/m.exec(source)
  const commit = /\r?\nCOMMIT;\s*$/.exec(source)
  assert.ok(begin && commit, 'CERTIFIED_TRANSACTION_BOUNDARIES_REQUIRED')
  const delimiter = '$r42_original_source$'
  assert.ok(!source.includes(delimiter), 'SOURCE_DELIMITER_COLLISION')
  const guard = `
DO $r42_guard$ BEGIN
  IF current_database() <> ${literal(database)} OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'OWNED_LOCAL_DATABASE_AND_OWNER_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1942042, 20261028) THEN
    RAISE EXCEPTION 'SELECTIVE_APPLICATION_BUSY';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${literal(version)}) THEN
    RAISE EXCEPTION 'ALREADY_RECORDED_STOP_NO_REPLAY';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261028140420','20261028173558')) THEN
    RAISE EXCEPTION 'EXCLUDED_PILOT_HISTORY_PRESENT';
  END IF;
  ${index === 1 ? `IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${selection[0].version}' AND name='${selection[0].name}' AND encode(sha256(convert_to(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n'),'UTF8')),'hex')='${selection[0].sha256}') THEN RAISE EXCEPTION 'PREDECESSOR_HISTORY_HASH_REQUIRED'; END IF;` : ''}
  IF NOT EXISTS (SELECT 1 FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO'
    AND COALESCE(to_jsonb(nfe_fiscal_provider_state)->>'consumption_mode',${index === 0 ? "'OFF_ZERO_BUDGET'" : "'MISSING'"})='OFF_ZERO_BUDGET' AND capability_state='UNVERIFIED' AND circuit_state='OPEN' AND daily_budget=0) THEN
    RAISE EXCEPTION 'PROVIDER_OFF_REQUIRED';
  END IF;
END $r42_guard$;
SELECT jsonb_build_object('stage','TRANSACTION_STARTED','version',${literal(version)},'database',current_database(),'sessionUser',session_user,'effectiveUser',current_user,'startedAt',clock_timestamp(),'transactionId',pg_current_xact_id()::text);
`
  const history = `
INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by)
VALUES (${literal(version)}, ARRAY[${delimiter}${source}${delimiter}]::text[], ${literal(item.name)}, ${literal(actor)});
SELECT jsonb_build_object('stage','BEFORE_COMMIT_NOT_YET_CONFIRMED','version',${literal(version)},'observedAt',clock_timestamp(),'transactionId',pg_current_xact_id()::text);
`
  // Preserve original BEGIN/COMMIT and all business SQL. Only insert the local
  // guard after BEGIN and truthful native history before that same COMMIT.
  const payload = `${source.slice(0, begin.index + begin[0].length)}\n${guard}${source.slice(begin.index + begin[0].length, commit.index)}${history}${source.slice(commit.index)}`
  return { payload, version, name: item.name, originalRawSha256: hash(source), originalCanonicalLfSha256: item.sha256,
    transportSha256: hash(payload), sqlGo: false, atomicity: 'ONE_FILE_AND_ITS_NATIVE_HISTORY_ONLY',
    method: 'PROJECT_LOCAL_TRANSPORT_USING_NATIVE_LEDGER_NOT_SUPABASE_CLI_OR_MCP_CERTIFICATION' }
}
