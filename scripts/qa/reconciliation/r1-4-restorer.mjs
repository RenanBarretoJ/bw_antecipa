import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
export const hash=value=>createHash('sha256').update(value).digest('hex')
const md5=value=>createHash('md5').update(value).digest('hex')
const ident=s=>'"'+s.replaceAll('"','""')+'"'
// No trim, newline normalization, split/join or SQL replacement in this path.
export async function readRawRestore(path,expected){
  const bytes=await readFile(path),sql=bytes.toString('utf8')
  assert.equal(hash(bytes),expected,'SOURCE_SNAPSHOT_HASH_DRIFT')
  assert.equal(hash(Buffer.from(sql,'utf8')),expected,'UTF8_ROUNDTRIP_CHANGED_BYTES')
  return {sql,RAW_RESTORE_HASH:hash(sql),NORMALIZED_DIAGNOSTIC_HASH:hash(sql.replaceAll('\r\n','\n'))}
}
export function catalogDiff(a,b){
  const old=new Map(a.map(x=>[x.kind+':'+x.name,x])),next=new Map(b.map(x=>[x.kind+':'+x.name,x]))
  return [...new Set([...old.keys(),...next.keys()])].sort().filter(k=>old.get(k)?.hash!==next.get(k)?.hash).map(k=>({key:k,before:old.get(k)?.hash??null,after:next.get(k)?.hash??null}))
}
const cases={
  comunicacoes_remetente_nome_check:[['A',true],['Nome válido',true],['a'.repeat(120),true],[' a ',true],['',false],['   ',false],['a'.repeat(121),false],['a\nb',false],['a\rb',false],['a\r\nb',false],['n',true],['r',true]],
  documento_upload_intents_storage_path_check:[['a',true],['folder/file.pdf',true],['a'.repeat(1024),true],['..hidden/file',true],['file..pdf',true],['',false],['a'.repeat(1025),false],['../file',false],['folder/../file',false],['folder/..',false],['..',false],['folder\\file',false]],
}
function metadata(c){return {schema:c.schema,table:c.table,name:c.name,columns:c.columns,validated:c.validated,deferrable:c.deferrable,deferred:c.deferred,noinherit:c.noinherit}}
async function insertCases(db,table,column,values){
  const outcomes=[]
  for(const [value,valid] of values){
    await db.query('SAVEPOINT constraint_case')
    let code=null
    try{await db.query(`INSERT INTO ${ident(table)}(${ident(column)}) VALUES($1)`,[value])}catch(e){code=e.code}
    await db.query('ROLLBACK TO SAVEPOINT constraint_case;RELEASE SAVEPOINT constraint_case')
    assert.equal(code,valid?null:'23514',`${table}:CASE_LEN_${value.length}`)
    outcomes.push({length:value.length,valid,result:code??'ACCEPTED'})
  }
  return outcomes
}
export async function certifyRestore(db,name,schema,baselineCatalog,localCatalog){
  const source=JSON.parse(await readFile(`rehearsal/reports/R1_4_${name.toUpperCase()}_REMOTE_FIDELITY.json`,'utf8'))
  assert.equal(hash(schema),source.schemaSha256,'SNAPSHOT_REPLACED')
  await db.query("SET search_path=''")
  const local=(await db.query(await readFile('scripts/qa/reconciliation/r1-4-fidelity-catalog.sql','utf8'))).rows[0].evidence
  assert.deepEqual(local.functions,source.evidence.functions,'RAW_FUNCTION_BODY_FIDELITY_STOP')
  const proof={rawFunctionFidelity:'PASS',functions:local.functions.length,crlfFunctions:local.functions.filter(x=>x.crlf).length,localSettings:local.settings,constraints:[]}
  for(const remote of source.evidence.constraints){
    const actual=local.constraints.find(c=>c.name===remote.name)
    assert(actual);assert.deepEqual(metadata(actual),metadata(remote),'CONSTRAINT_METADATA_DRIFT')
    const snapshotLine=schema.split('\n').find(l=>l.includes('CONSTRAINT "'+remote.name+'"'))?.trim().replace(/,$/,'');assert(snapshotLine)
    const column=remote.columns[0].name,values=cases[remote.name];assert(values,'UNREVIEWED_CONSTRAINT')
    await db.query('BEGIN')
    try{
      // Reparse the exact captured expression against LIKE columns to preserve attnums/types/collation.
      await db.query(`CREATE TEMP TABLE r14_remote (LIKE ${ident(remote.schema)}.${ident(remote.table)}) ON COMMIT DROP`)
      await db.query(`ALTER TABLE r14_remote ADD CONSTRAINT r14_remote_check ${remote.definition}`)
      const remoteTree=(await db.query("SELECT conbin::text tree,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='pg_temp.r14_remote'::regclass AND conname='r14_remote_check'")).rows[0]
      const actualTree=(await db.query('SELECT conbin::text tree FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2',[remote.schema+'.'+remote.table,remote.name])).rows[0].tree
      assert.equal(remoteTree.tree,actualTree,'REPARSED_CONSTRAINT_TREE_DIFFERS')
      assert.equal(remoteTree.definition,actual.definition,'REPARSED_CONSTRAINT_DEFINITION_DIFFERS')
      // Three independent definitions: live remote, immutable dump line, restored catalog.
      const behavior=[]
      for(const [kind,ddl] of [['remote',`CONSTRAINT proof CHECK ${remote.expression}`],['snapshot',snapshotLine],['restored',`CONSTRAINT proof ${actual.definition}`]]){
        const table='r14_'+kind+'_cases'
        await db.query(`CREATE TEMP TABLE ${ident(table)}(${ident(column)} text NOT NULL,${ddl}) ON COMMIT DROP`)
        behavior.push({kind,cases:await insertCases(db,table,column,values)})
      }
      // Negative control: a stricter first bound must not pass this proof.
      const mutated=remote.definition.replace('>= 1','> 1');assert.notEqual(mutated,remote.definition)
      await db.query(`CREATE TEMP TABLE r14_mutant (LIKE ${ident(remote.schema)}.${ident(remote.table)}) ON COMMIT DROP`)
      await db.query(`ALTER TABLE r14_mutant ADD CONSTRAINT mutant ${mutated}`)
      const mutant=(await db.query("SELECT conbin::text tree FROM pg_constraint WHERE conrelid='pg_temp.r14_mutant'::regclass AND conname='mutant'")).rows[0].tree
      assert.notEqual(mutant,actualTree,'NEGATIVE_CONTROL_DID_NOT_DETECT_RULE_CHANGE')
      proof.constraints.push({name:remote.name,key:'constraint:'+remote.schema+'.'+remote.table+'.'+remote.name,
        classification:actual.definition===remote.definition?'RAW_IDENTICAL':'REPRESENTATION_ONLY_AND_REASSOCIATION',
        before:md5(remote.definition),after:md5(actual.definition),remote,snapshotLine,restored:actual,
        reparsedTreeHash:hash(remoteTree.tree),restoredTreeHash:hash(actualTree),behavior,negativeControl:'PASS',result:'PASS'})
    }finally{await db.query('ROLLBACK')}
  }
  proof.rawCatalogDifferences=catalogDiff(baselineCatalog,localCatalog)
  // Only exact before/after pairs with a successful structural and behavioral proof qualify.
  proof.unexplainedDifferences=proof.rawCatalogDifferences.filter(d=>!proof.constraints.some(p=>p.result==='PASS'&&p.key===d.key&&p.before===d.before&&p.after===d.after))
  assert.deepEqual(proof.unexplainedDifferences,[],'UNEXPLAINED_BASELINE_CATALOG_DRIFT_STOP')
  await db.query('SET search_path=public,extensions')
  proof.result='PASS';return proof
}
