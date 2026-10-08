import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const old=JSON.parse(await readFile('rehearsal/reports/R1_8_STATUS.json','utf8'))
assert.equal(old.failure.sqlstate,'42501')
const result={at:new Date().toISOString(),result:'PASS',priorFailure:old.failure,
  whyPostgres:'The full Supabase rehearsal builds the canonical application schema in its default postgres database, also used by local Auth/Storage/PostgREST.',
  oldMethod:'CREATE DATABASE ... TEMPLATE postgres after denying connections and attempting to terminate all source backends.',
  problem:'Template cloning requires an idle source; the test postgres role correctly cannot terminate service-owned sessions. No such termination is needed for a logical dump.',
  selectedStrategy:'DUMP_RESTORE',LOCAL_INFRA_ADMIN_ONLY:'YES',
  infrastructureAdminScope:['read-only pg_dump in the just-created owned local container','CREATE DATABASE from empty template0','restore exact schema/ACL/owners as local infrastructure','DROP only tracked owned DB after all test clients close'],
  applicationTests:'postgres fixture runner, authenticated and service_role SQL boundaries; never supabase_admin',
  copied:{applicationSchemas:['public','private'],platformSchemaDependencies:['auth','storage','extensions'],extensionAllowlist:['pgcrypto','uuid-ossp','unaccent','pgtap'],dataAllowlist:['public.documento_tipos']},
  notCopied:['processes','sessions','secrets','runtime data','cron jobs','remote business rows','migration history'],
  suites:[{name:'integrations',requirements:'Current RPCs, ACL/owners, auth/profiles/fund schema and rollback-only synthetic actors.'},{name:'operators/inbox',requirements:'Current application schema, auth MFA/session tables and synthetic guibor fixture; generated inbox messages only.'},{name:'automation',requirements:'Current application schema, auth tables, synthetic guibor fixture and generated lease/subscription state. No external Graph or scheduler invocation.'}],
  fidelity:'Compare complete application catalog hashes including permissions and owner, and exact official document rows. Keep a simulated service_role connection open throughout dump/restore and cleanup.',
  docs:['https://www.postgresql.org/docs/17/app-pgdump.html','https://www.postgresql.org/docs/17/manage-ag-templatedbs.html'],
  remoteChanged:false,oldEvidencePreserved:true}
await writeFile('rehearsal/reports/R1_9_DB_PREP_DIAGNOSIS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:'PASS',strategy:result.selectedStrategy,LOCAL_INFRA_ADMIN_ONLY:'YES'}))
