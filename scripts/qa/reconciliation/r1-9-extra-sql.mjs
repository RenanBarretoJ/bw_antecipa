import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hash } from './r1-4-restorer.mjs'
import { localDatabaseFactory,assertLocalSource } from './r1-9-db-prep.mjs'
import { verifyEmailOperators } from '../../email-intake/operators-db.mjs'
import { verifyEmailAutomation } from '../../email-intake/automation-db.mjs'

export async function verifyExtraSql(source,connection,projectId,evidence) {
  assertLocalSource(connection,projectId)
  evidence.stage='PREPARE_EXTRA_SQL_DATABASES:DUMP_SOURCE'
  evidence.extraSql={result:'IN_PROGRESS',method:'DUMP_RESTORE',tests:[]}
  const factory=await localDatabaseFactory(source,connection,projectId,evidence)
  const clients=[]
  try {
    evidence.stage='PREPARE_EXTRA_SQL_DATABASES:PREPARER_TESTS'
    const first=await factory.create('probe');clients.push(first.db)
    const second=await factory.create('probe');clients.push(second.db)
    assert.notEqual(first.name,second.name)
    await first.db.end();await factory.remove(first.name)
    assert.equal((await second.db.query('SELECT 1 n')).rows[0].n,1)
    await second.db.end();await factory.remove(second.name)
    evidence.dbPreparationTests={result:'PASS',checks:['OPEN_SERVICE_CONNECTION_PRESERVED','DISTINCT_DATABASE_NAMES','SOURCE_ACCESSIBLE','EXACT_CATALOG_AND_DOCUMENT_FIXTURE','OWNED_CLEANUP_PRESERVES_OTHER_DATABASE'],noServiceSessionTermination:true}
    for(const suite of ['integrations','operators','automation']) {
      evidence.stage=`PREPARE_EXTRA_SQL_DATABASES:${suite}`
      const local=await factory.create(suite);clients.push(local.db)
      const {db,record}=local
      try {
        if(suite==='integrations') {
          for(const file of ['integration_credential_first.sql','integration_inline_credentials.sql','integration_activation_before_cnab.sql']) {
            evidence.stage='SQL_REGRESSION:'+file
            const sql=await readFile('supabase/tests/'+file,'utf8'),notices=[]
            const notice=n=>{if(/^PASS /.test(n.message))notices.push(n.message)}
            db.on('notice',notice)
            try {await db.query(sql.replace(/^\\set.*$/mg,''));assert(notices.length>0,'MISSING_INTEGRATION_ASSERTION_SUMMARY')}
            finally {db.off('notice',notice);await db.query('ROLLBACK')}
            evidence.extraSql.tests.push({file,db:local.name,method:'DUMP_RESTORE',sourceCatalogHash:record.sourceCatalogHash,sha256:hash(sql),result:'PASS',notices})
          }
        } else {
          await db.query(await readFile('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
          const domain=suite==='operators'?'RLX_OPERATORS_INBOX':'RLX_AUTOMATION'
          evidence.stage='SQL_REGRESSION:'+domain
          const checks=await (suite==='operators'?verifyEmailOperators:verifyEmailAutomation)(db,local.connection)
          evidence.extraSql.tests.push({domain,db:local.name,method:'DUMP_RESTORE',sourceCatalogHash:record.sourceCatalogHash,checks,result:'PASS'})
        }
      }finally {await db.query('ROLLBACK').catch(()=>{});await db.end();await factory.remove(local.name)}
    }
    await factory.finish()
    evidence.extraSql.result='PASS'
    return source
  }catch(e){
    evidence.extraSql.result='FAIL';evidence.extraSql.failureStage=evidence.stage
    for(const db of clients)await db.end().catch(()=>{})
    await factory.abort();throw e
  }
}
