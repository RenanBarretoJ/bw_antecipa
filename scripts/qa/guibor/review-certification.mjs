import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
const ref='prnudoydwiramsxjnxzn'
const base=process.argv[2]
const label=process.argv[3]||'A'
const phase='R3'
assert(['A','B'].includes(label))
const issuer=label==='A'?'51464297000187':'37034852000100'
const pdf=label==='A'?'NF 202649 - CONSISA.pdf':'232- HOSPITAL VIDA.pdf'
assert(base?.startsWith('https://bw-antecipa-') && base.endsWith('.vercel.app'))
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
const run=randomUUID().slice(0,8)
const report={target:ref,base,run,users:{},fixtures:{},checks:[],success:false}
const reportPath=`rehearsal/reports/GUIBOR_${phase}_${label}.json`
assert(!existsSync(reportPath), 'ONE_CONTROLLED_RUN_ONLY')
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2))
function cli(args){
 const result=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8000000})
 if(result.status!==0)throw new Error('GUIBOR_QA_CLI_FAILED')
 return JSON.parse(result.stdout)
}
const keys=cli(['projects','api-keys','--project-ref',ref,'--output','json'])
const admin=createClient(`https://${ref}.supabase.co`,keys.find(k=>k.name==='service_role').api_key,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=keys.find(k=>k.name==='anon').api_key
const val=result=>{if(result.error)throw new Error(result.error.message);return result.data}
function sql(query){
 assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref)
 writeFileSync('rehearsal/tmp/guibor-preview-qa.sql',query)
 return cli(['db','query','--linked','--file','rehearsal/tmp/guibor-preview-qa.sql','--output','json']).rows
}
function cnpj(){
 const d=Array.from(randomBytes(12),b=>b%10)
 for(const w of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const r=d.reduce((s,n,i)=>s+n*w[i],0)%11;d.push(r<2?0:11-r)}
 return d.join('')
}
function totp(secret){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
 const bits=[...secret.replace(/=/g,'').toUpperCase()].map(c=>chars.indexOf(c).toString(2).padStart(5,'0')).join('')
 const bytes=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))
 const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
 const digest=createHmac('sha1',bytes).update(ctr).digest();const offset=digest[19]&15
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
const clients={}
let browser
try{
 assert.equal(sql(`select count(*)::int n from public.cedentes where cnpj='${issuer}'`)[0].n,0,'QA_CNPJ_COLLISION_STOP')
 const map=new Map()
 for(const [n,role] of [[1,'consultor'],[2,'leitor'],[3,'cedente'],[4,'gestor']]){
  const email=`guibor-${run}-${role}@example.invalid`
  const password=`Guibor!A1${randomBytes(24).toString('base64url')}`
  const {user}=val(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:`QA GUIBOR ${role}`}}))
  report.users[role]=user.id;save();map.set(`21000000-0000-4000-8000-00000000000${n}`,user.id)
  if(role==='cedente'){
   const client=createClient(`https://${ref}.supabase.co`,anon,{auth:{persistSession:false,autoRefreshToken:false}})
   val(await client.auth.signInWithPassword({email,password}));clients[role]=client
  }
 }
 let setup=readFileSync('supabase/tests/c2_1_r2_fluxo_taxa.test.sql','utf8').match(/DO \$setup\$[\s\S]*?\$setup\$;/)[0]
 setup=setup.replace(/  INSERT INTO auth.users[\s\S]*?(?=  INSERT INTO public.profiles)/,'')
 setup=setup.slice(0,setup.indexOf('  INSERT INTO public.notas_fiscais'))+'END;\n$setup$;'
 for(const id of new Set(setup.match(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g)))if(!map.has(id))map.set(id,randomUUID())
 for(const [from,to] of map)setup=setup.replaceAll(from,to)
 for(const number of ['98000000000196','98000000000277','98000000000358','98200010000175'])setup=setup.replaceAll(number,cnpj())
 setup=setup.replaceAll('98100000000168',issuer).replaceAll('QA_C2_1',`QA_GUIBOR_${run}`).replaceAll('C2.1',`GUIBOR ${run}`).replaceAll('ESCROW-C21',`ESCROW-GUIBOR-${run}`)
 for(const role of Object.keys(report.users))setup=setup.replaceAll(`${role==='consultor'?'operador':role}-c21@example.invalid`,`guibor-${run}-${role}@example.invalid`)
 const id=prefix=>map.get(`${prefix}000000-0000-4000-8000-000000000001`)
 report.fixtures={fund:id('22'),cedente:id('23'),link:id('24'),escrow:id('25'),policy:id('26'),version:id('27'),policyLink:id('28'),org:id('29')};save()
 sql(`BEGIN;${setup}COMMIT;SELECT true seeded;`)
 report.checks.push('QA_FIXTURES_CREATED');save()
 const client=clients.cedente
 const factor=val(await client.auth.mfa.enroll({factorType:'totp',friendlyName:`GUIBOR ${run}`}))
 const challenge=val(await client.auth.mfa.challenge({factorId:factor.id}))
 val(await client.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:totp(factor.totp.secret)}))
 val(await client.rpc('registrar_sessao_mfa_atual',{p_factor_id:factor.id}))
 report.checks.push('REAL_AUTH_AAL2');save()
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--disable-dev-shm-usage']})
 const context=await browser.createBrowserContext();const page=await context.newPage()
 await page.setViewport({width:1600,height:1400})
 const session=val(await client.auth.getSession()).session
 const cookie='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')
 const chunks=cookie.match(/.{1,3180}/g);const name=`sb-${ref}-auth-token`
 await context.setCookie(...chunks.map((value,i)=>({name:chunks.length===1?name:`${name}.${i}`,value,domain:new URL(base).hostname,path:'/',secure:true,httpOnly:false,sameSite:'Lax'})))
 const response=await page.goto(`${base}/cedente/notas-fiscais`,{waitUntil:'networkidle2',timeout:60000})
 const csp=response.headers()['content-security-policy']||''
 assert(csp.includes(`${ref}.supabase.co`),'PREVIEW_TARGET_MISMATCH')
 report.checks.push('DEPLOYMENT_TARGET_ISOLATED_PREVIEW');save()
 await page.waitForSelector('input[type=file]',{timeout:15000})
 const before=sql(`select (select count(*) from public.notas_fiscais where cedente_id='${report.fixtures.cedente}') notes,(select count(*) from storage.objects where (bucket_id='notas-fiscais' and name like '${issuer}/nf/%') or (bucket_id='documentos-v2' and name like '${report.fixtures.cedente}/%')) objects`)[0]
 const file=await page.$('input[type=file]')
 await file.uploadFile(`C:/Users/BrenoAlvim/Downloads/NFSe Guibor/${pdf}`)
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Enviar 1 arquivo')),{timeout:10000})
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enviar 1 arquivo')).click())
 try{await page.waitForSelector('#nfse-due-0',{timeout:90000})}catch{
  writeFileSync(`rehearsal/reports/GUIBOR_${phase}_${label}_UI_ERROR.txt`,await page.evaluate(()=>document.body.innerText))
  await page.screenshot({path:`rehearsal/reports/GUIBOR_${phase}_${label}_ERROR.png`,fullPage:true})
  throw new Error(`GUIBOR_${label}_REVIEW_NOT_SHOWN_STOP`)
 }
 const due=await page.$eval('#nfse-due-0',e=>({value:e.value,required:e.required}))
 assert.equal(due.value,'');assert.equal(due.required,true)
 const ui=await page.evaluate(()=>document.body.innerText)
 const amounts=label==='A'?['39.521,98','37.229,70']:['112.710,81','105.779,10']
 assert(amounts.every(v=>ui.includes(v)),`GUIBOR_${label}_FISCAL_AMOUNTS_MISMATCH`)
 assert(ui.includes(`NFS-e ${label==='A'?'49':'232'}`),'GUIBOR_NF_NUMBER_MISMATCH')
 assert(ui.includes('Vencimento nÃ£o informado no documento'))
 const after=sql(`select (select count(*) from public.notas_fiscais where cedente_id='${report.fixtures.cedente}') notes,(select count(*) from storage.objects where (bucket_id='notas-fiscais' and name like '${issuer}/nf/%') or (bucket_id='documentos-v2' and name like '${report.fixtures.cedente}/%')) objects`)[0]
 assert.deepEqual(after,before,'GUIBOR_A_PREMATURE_PERSISTENCE_STOP')
 await page.screenshot({path:`rehearsal/reports/GUIBOR_${phase}_${label}_REVIEW.png`,fullPage:true})
 report.checks.push(`REAL_PDF_${label}_REQUIRES_REVIEW`,'MANUAL_DUE_BLANK_REQUIRED','NO_NF_OR_STORAGE_BEFORE_MANUAL_DUE')

 report.before=before; report.afterReview=after; save()
 for(const width of [390,430,820,1440]){
  await page.setViewport({width,height:1000})
  const bounds=await page.$eval('#nfse-due-0',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})
  assert(bounds.left>=0&&bounds.right<=bounds.width,'REVIEW_RESPONSIVE_OVERFLOW')
  await page.screenshot({path:`rehearsal/reports/GUIBOR_R3_${label}_REVIEW_${width}.png`,fullPage:true})
 }
 report.checks.push('REVIEW_RESPONSIVE_390_430_820_1440');save()
 // Missing date must never submit or persist.
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enviar 1 arquivo')).click())
 await page.waitForFunction(()=>document.body.innerText.includes('vencimento'),{timeout:5000})
 assert.equal(sql(`select count(*)::int n from public.notas_fiscais where cedente_id='${report.fixtures.cedente}'`)[0].n,0)
 const qaDue=new Date();qaDue.setUTCDate(qaDue.getUTCDate()+45)
 const dueValue=qaDue.toISOString().slice(0,10)
 await page.$eval('#nfse-due-0',(e,value)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value)
  e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))
 },dueValue)
 await page.waitForFunction(value=>document.querySelector('#nfse-due-0')?.value===value,{},dueValue)
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enviar 1 arquivo')).click())
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.disabled&&/Enviando|Processando/.test(b.textContent)),{timeout:10000})
 report.checks.push('REVIEW_LOADING');save()
 // Exactly one controlled server re-extraction. Never retry the visual provider on failure.
 try {
  await page.waitForFunction(()=>location.pathname.match(/notas-fiscais\/[0-9a-f-]{36}/)||/importado\(s\)/.test(document.body.innerText)&&document.body.innerText.includes('1 de 1'),{timeout:100000})
 } catch {
  const messages=await page.evaluate(()=>document.body.innerText)
  writeFileSync(`rehearsal/reports/GUIBOR_R3_${label}_PERSIST_ERROR.txt`,messages)
  await page.screenshot({path:`rehearsal/reports/GUIBOR_R3_${label}_PERSIST_ERROR.png`,fullPage:true})
  throw new Error(`GUIBOR_${label}_PERSIST_FAILED_STOP`)
 }
 const notes=val(await admin.from('notas_fiscais').select('id,numero_nf,tipo_documento_fiscal,valor_bruto,valor_liquido,valor_liquido_origem,data_vencimento,vencimento_origem,fiscal_proveniencia,arquivo_url').eq('cedente_id',report.fixtures.cedente))
 assert.equal(notes.length,1,'EXACTLY_ONE_NF')
 const note=notes[0]; report.nfId=note.id;report.due=dueValue;save()
 assert.equal(Number(note.valor_bruto),label==='A'?39521.98:112710.81)
 assert.equal(Number(note.valor_liquido),label==='A'?37229.70:105779.10)
 assert.equal(note.numero_nf,label==='A'?'49':'232');assert.equal(note.tipo_documento_fiscal,'NFSE')
 assert.equal(note.valor_liquido_origem,'DOCUMENTO_EXPLICITO');assert.equal(note.vencimento_origem,'MANUAL')
 assert.equal(note.data_vencimento,dueValue)
 assert.equal(note.fiscal_proveniencia.strategy,label==='A'?'danfse_v2_labels':'danfse_v2_visual')
 assert(note.fiscal_proveniencia.review_intent_id)
 const audit=val(await admin.from('logs_auditoria').select('usuario_id,created_at,dados_depois').eq('entidade_id',note.id).eq('tipo_evento','NFSE_VENCIMENTO_MANUAL'))
 assert.equal(audit.length,1);assert.equal(audit[0].usuario_id,report.users.cedente)
 assert.equal(audit[0].dados_depois.source,'MANUAL');assert.equal(audit[0].dados_depois.data_vencimento,dueValue)
 assert(Number.isFinite(Date.parse(audit[0].created_at)))
 const storage=sql(`select count(*)::int n from storage.objects where (bucket_id='notas-fiscais' and name like '${issuer}/nf/%') or (bucket_id='documentos-v2' and name like '${report.fixtures.cedente}/%')`)[0].n
 assert.equal(storage,before.objects+1,'EXACTLY_ONE_FINAL_OBJECT')
 report.afterCreate={notes:1,objects:storage,audit:audit.length};report.checks.push('PERSISTENCE','MANUAL_AUDIT','ONE_FINAL_STORAGE','PROVENANCE');save()
 await page.goto(`${base}/cedente/notas-fiscais`,{waitUntil:'networkidle2',timeout:60000})
 await page.waitForSelector('input[type=file]')
 await (await page.$('input[type=file]')).uploadFile(`C:/Users/BrenoAlvim/Downloads/NFSe Guibor/${pdf}`)
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Enviar 1 arquivo')))
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enviar 1 arquivo')).click())
 await page.waitForFunction(()=>/ja foi cadastrada|já foi cadastrada|ja esta sendo processada/.test(document.body.innerText),{timeout:100000})
 const afterDuplicate=sql(`select (select count(*)::int from public.notas_fiscais where cedente_id='${report.fixtures.cedente}') notes,(select count(*)::int from storage.objects where (bucket_id='notas-fiscais' and name like '${issuer}/nf/%') or (bucket_id='documentos-v2' and name like '${report.fixtures.cedente}/%')) objects,(select count(*)::int from public.logs_auditoria where entidade_id='${note.id}' and tipo_evento='NFSE_VENCIMENTO_MANUAL') audit`)[0]
 assert.deepEqual(afterDuplicate,report.afterCreate,'DUPLICATE_CREATED_SIDE_EFFECT')
 report.afterDuplicate=afterDuplicate;report.checks.push('DUPLICATE_NO_NEW_NF_STORAGE_AUDIT')
 report.success=true

}catch(error){report.error=error.message;process.exitCode=1}
finally{
 if(browser)await browser.close()
 for(const client of Object.values(clients))await client.auth.signOut().catch(()=>{})
 save();console.log(JSON.stringify(report))
}


