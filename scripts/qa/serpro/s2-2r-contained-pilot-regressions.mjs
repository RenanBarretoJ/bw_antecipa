import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/** Run unchanged historical SQL assertions in TWO separate schema-only clones.
 * Only their old CLI bootstrap/teardown is replaced. No frozen file is edited,
 * no old CLI is invoked, and neither pilot migration enters the S2.2 database.
 * The generated module has an identified origin (the versioned script), is
 * sent over stdin, and never becomes an untracked temporary source file. */
export async function runContainedPilotRegressions({ docker, names, sql, password, phase }) {
  const report=[]
  for (const kind of ['a1','a4h']) {
    const database=`s22_pilot_${kind}`
    // This is the newly created, schema-only QA database. Postgres health/cron
    // connections can otherwise race CREATE DATABASE TEMPLATE. Temporarily
    // refuse connections while copying, then restore availability exactly.
    await sql('ALTER DATABASE postgres ALLOW_CONNECTIONS false;','template1')
    try {
      await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres';",'template1')
      // Match the historical CLI database owner, not the bootstrap restorer.
      // public remains owned by pg_database_owner; no schema grant is added.
      await sql(`CREATE DATABASE ${database} WITH OWNER=postgres TEMPLATE postgres;`,'template1')
    } finally { await sql('ALTER DATABASE postgres ALLOW_CONNECTIONS true;','template1') }
    await sql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);`,database)
    const migrations=['20261028140420_s2_1a1_serpro_selective_pilot_claim.sql',
      ...(kind==='a4h'?['20261028173558_s2_1a4h_serpro_audit_budget_hardening.sql']:[])]
    for(const name of migrations){
      await sql('SET ROLE postgres;\n'+await readFile('supabase/migrations/'+name,'utf8'),database)
      await sql(`INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('${name.slice(0,14)}','${name.slice(15,-4)}');`,database)
    }
    const path=kind==='a1'?'scripts/qa/serpro/s2-1a1-local-rehearsal.mjs':'scripts/qa/serpro/s2-1a4h-local-hardening-rehearsal.mjs'
    const source=(await readFile(path,'utf8')).replace(/\r\n/g,'\n')
    const start=source.indexOf('\nlet started = false'),tail=source.indexOf('\nfunction assertLocalOnly()')
    assert.ok(start>0&&tail>start,'HISTORICAL_SCRIPT_BOUNDARY_DRIFT')
    const prefix=source.slice(0,start).replace("from '../../perf9e/clean-room-lib.mjs'","from 'file:///work/scripts/perf9e/clean-room-lib.mjs'")
    const calls=kind==='a1'
      ?'await verifyMigrationApplied(admin);await runS1SqlRegression(admin);await seedSyntheticFixture(admin);await runIdentityAndGateMatrix(admin);await runAclProof(admin);await runConcurrencyAndReplayProof(admin);await runGenericRegression(admin);await runRollbackProof(admin);'
      :'await verifyMigration(admin);await seedFixture(admin);await proveAtomicCreatedRollback(admin);await proveStaleBudgetAndConcurrency(admin);await proveAclAndQueuePreservation(admin);'
    const generatedSource=prefix+`
      assert.ok(existsSync('/.dockerenv'));assert.equal(process.env.S22_CONTAINED_RUNNER,'true');
      assert.ok(process.env.S22_SYNTHETIC_PG_PASSWORD.length>=32);
      Object.assign(connection,{host:'s22-db',port:5432,database:'${database}',password:process.env.S22_SYNTHETIC_PG_PASSWORD});
      const admin=new Client(connection);await admin.connect();
      // Historical fixtures explicitly update role on conflict. First validate
      // the profile produced by the canonical trigger, before that adjustment.
      const originalQuery=admin.query.bind(admin);
      admin.query=async(text,...args)=>{
        if(typeof text==='string'&&text.trimStart().startsWith('INSERT INTO auth.users')&&text.includes('INSERT INTO public.profiles')){
          const at=text.indexOf('INSERT INTO public.profiles');await originalQuery(text.slice(0,at));
          const canonical=(await originalQuery(\`SELECT count(*)::int n,count(p.id)::int profiles,
            bool_and(p.role::text='cedente' AND p.status::text='ativo' AND p.email=u.email
              AND p.nome_completo=COALESCE(u.raw_user_meta_data->>'nome_completo',u.email)) valid
            FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.id=ANY($1::uuid[])\`,[Object.values(ids)])).rows[0];
          assert.deepEqual(canonical,{n:${kind==='a1'?5:3},profiles:${kind==='a1'?5:3},valid:true},'UNEXPECTED_AUTOMATIC_PROFILE');
          return originalQuery(text.slice(at),...args);
        }return originalQuery(text,...args);
      };
      try{${calls}evidence.success=true;console.log(JSON.stringify(evidence))}finally{await admin.end()}
    `+source.slice(tail)
    await phase('CONTAINED_HISTORICAL_SQL_'+kind.toUpperCase())
    const evidence=JSON.parse(await docker(['exec','-i','-e','S22_CONTAINED_RUNNER=true','-e',`S22_SYNTHETIC_PG_PASSWORD=${password}`,
      names.runner,'node','--input-type=module'],generatedSource,240000))
    assert.equal(evidence.success,true)
    report.push({path,canonicalLfSha256:createHash('sha256').update(source).digest('hex'),database,
      assertionsUnchanged:true,bootstrap:'CONTAINED_INTERNAL_NO_PORTS',migrations,evidence})
  }
  return report
}
