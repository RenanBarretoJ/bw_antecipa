import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
import {applyR116} from './r1-16-forwards.mjs'
import {seed,actors,cedentes,funds,uid} from './r1-15-rls-fixture.mjs'
import {hash} from './r1-4-restorer.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {inventory} from '../../email-intake/disposable-resources.mjs'

assert(['--baseline','--candidate'].includes(process.argv[2]))
assert.equal(process.argv[3],'--local-only')
const candidate=process.argv[2]==='--candidate'
const r118=process.argv.includes('--r118')
if(r118){assert(candidate);const {requireR118Bootstrap}=await import('./r1-18-bootstrap-gate.mjs');await requireR118Bootstrap();assert.equal(JSON.parse(await readFile('rehearsal/reports/R1_18_SUPPLEMENTAL_SUITES.json','utf8')).result,'PASS')}
const path=`rehearsal/reports/${r118?'R1_18_AUTH':'R1_16_AUTH'}_${candidate?'CANDIDATE':'BASELINE'}_${Date.now()}.json`
const report={at:new Date().toISOString(),mode:candidate?'CANDIDATE':'BASELINE_OBSERVATION',result:'IN_PROGRESS',stacks:[],cases:[],remoteWrites:0}
const persist=()=>writeFile(path,JSON.stringify(report,null,2)+'\n')
const checkpoint={files:[],reports:[],docker:await inventory(),head:gitBytes(['rev-parse','HEAD']).toString().trim()}
assert.equal(gitBytes(['branch','--show-current']).toString().trim(),'reconcile/main-homolog-2026-10-06')
for(const file of [...new Set(gitBytes(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean))].sort())checkpoint.files.push({path:file,sha256:hash(await readFile(file))})
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await scan(p);else checkpoint.reports.push({path:p,sha256:hash(await readFile(p))})}}
await scan('rehearsal/reports')
await writeFile(path.replace('.json','_CHECKPOINT.json'),JSON.stringify(checkpoint,null,2)+'\n',{flag:'wx'})
await persist()
let stack
try {
  stack=await freshStack(candidate?'probeb':'probea',report.stacks)
  const {db}=stack
  await applyR116(db,stack.evidence)
  if(candidate){const {applyAuthFix}=await import('./r1-16-auth-forward.mjs');report.forward=await applyAuthFix(db)}
  report.fixture=await seed(db)
  await db.query('BEGIN')
  try {
    const c=cedentes[0],nf=uid(9901),dup=uid(9902),version=uid(9903)
    await db.query("INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status) SELECT $1,c.id,$2,$3,'R116-AUTH','1',current_date,current_date+30,c.cnpj,c.razao_social,'11222333000181','Sacado QA',100,90,'DOCUMENTO_EXPLICITO','rascunho' FROM public.cedentes c WHERE c.id=$4",[nf,uid(c.n+500),funds.A,c.id])
    await db.query('INSERT INTO public.duplicatas(id,fundo_id,cedente_fundo_id,cedente_id,nota_fiscal_id,criado_por) VALUES($1,$2,$3,$4,$5,$6)',[dup,funds.A,uid(c.n+500),c.id,nf,uid(1)])
    await db.query("INSERT INTO public.duplicata_versoes(id,duplicata_id,nota_fiscal_id,numero_versao,path,nome_original,mime_type,tamanho_bytes,sha256,metodo_extracao,enviado_por) VALUES($1,$2,$3,1,'r116/qa.pdf','qa.pdf','application/pdf',100,repeat('a',64),'MANUAL',$4)",[version,dup,nf,uid(1)])
    await db.query('UPDATE public.duplicatas SET versao_atual_id=$1 WHERE id=$2',[version,dup])
    async function state(){
      await db.query('RESET ROLE')
      const row=(await db.query('SELECT to_jsonb(d) AS row FROM public.duplicatas d WHERE id=$1',[dup])).rows[0].row
      const audits=(await db.query('SELECT campo,corrigido_por,valor_corrigido FROM public.duplicata_correcoes WHERE duplicata_id=$1 ORDER BY id',[dup])).rows
      const events=(await db.query("SELECT tipo_evento,ator_usuario_id,metadata FROM public.eventos_dominio WHERE nota_fiscal_id=$1 ORDER BY id",[nf])).rows
      return {row,audits,events}
    }
    for(const a of actors){
      const before=await state()
      await db.query('SAVEPOINT auth_case')
      const test={actor:a,expected:[1,2,7,10,11,19,20].includes(a.n)?'ALLOW':'DENY',query:'SELECT * FROM public.corrigir_duplicata($1,$2,$3,$4)',target:{duplicata:dup,cedente:c.id,fundo:funds.A}}
      report.cases.push(test);await persist()
      try{
        await db.query('SET LOCAL ROLE authenticated')
        await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({sub:a.id,role:'authenticated',aal:'aal2'}),a.id])
        test.proof=(await db.query("SELECT current_user AS role,auth.uid()::text AS uid,public.get_user_role() AS domain_role,public.get_user_cedente_id() AS cedente_id,rolsuper,rolbypassrls,current_setting('row_security') AS row_security FROM pg_roles WHERE rolname=current_user")).rows[0]
        assert.equal(test.proof.role,'authenticated');assert.equal(test.proof.uid,a.id);assert.equal(test.proof.domain_role,a.role);assert.equal(test.proof.rolsuper,false);assert.equal(test.proof.rolbypassrls,false);assert.equal(test.proof.row_security,'on')
        test.returned=(await db.query(test.query,[dup,{aceite_textual:'sim'},'QA authorization','COERENTE'])).rows.map(r=>({id:r.id,status:r.status_validacao,aceite:r.aceite_detectado_textualmente}))
        test.result='ALLOW'
        test.after=await state()
        assert.equal(test.after.audits.length-before.audits.length,1)
        assert.equal(test.after.events.length-before.events.length,1)
      }catch(e){
        if(e.code!=='P0001')throw e
        test.result='DENY';test.error={code:e.code,message:e.message}
        assert.match(e.message,/sem permissao/)
      }finally{await db.query('ROLLBACK TO SAVEPOINT auth_case; RELEASE SAVEPOINT auth_case')}
      assert.deepEqual(await state(),before,'CASE_ROLLBACK_CHANGED_DATA')
      test.rollback='PASS';await persist()
      console.log(JSON.stringify({actor:a.name,result:test.result,expected:test.expected,cedente_id:test.proof.cedente_id}))
      if(candidate)assert.equal(test.result,test.expected,'AUTH_CONTRACT:'+a.name)
    }
  }finally{await db.query('ROLLBACK')}
  if(candidate){const {verifyR116Directed}=await import('./r1-16-directed.mjs');report.directed=await verifyR116Directed(db)}
  report.result=candidate?'PASS':'BASELINE_CAPTURED'
  report.unexpected=report.cases.filter(c=>c.result!==c.expected).map(c=>({actor:c.actor.name,result:c.result,expected:c.expected}))
  stack.evidence.result='PASS';await stack.persist()
}catch(e){report.result='FAIL_STOPPED';report.failure={code:e.code,message:e.message};process.exitCode=1}
finally{
  await stack?.close()
  for(const f of [...checkpoint.files,...checkpoint.reports])assert.equal(hash(await readFile(f.path)),f.sha256,'ARTIFACT_CHANGED:'+f.path)
  assert.equal(gitBytes(['rev-parse','HEAD']).toString().trim(),checkpoint.head)
  assert.deepEqual(await inventory(),checkpoint.docker,'DOCKER_INVENTORY_CHANGED')
  report.preservation='PASS';report.cleanup='PASS';await persist()
}
console.log(JSON.stringify({path,result:report.result,unexpected:report.unexpected,failure:report.failure,cleanup:report.cleanup}))
