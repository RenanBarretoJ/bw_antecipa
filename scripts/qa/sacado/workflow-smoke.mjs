import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { connect, ref, saveCredentials } from './preview-runtime.mjs'
import { d, state, id, val, login, pageFor, navigate } from './auth-runtime.mjs'

assert.deepEqual(process.argv.slice(2),['--run'])
const file='rehearsal/reports/SACADO_R2_WORKFLOW.json'
const report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{ref,checks:[]}
const check=name=>{if(!report.checks.includes(name))report.checks.push(name);writeFileSync(file,JSON.stringify(report,null,2));console.log(name)}
const db=await connect(d)
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1440,height:1000}})
async function clickText(page,text) {
  assert(await page.evaluate(text=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!el)return false;el.click();return true},text),`BUTTON_${text}_NOT_FOUND`)
}
try {
  if(!state.workflowSeeded) {
    state.workflow ||= [5,6,7,8].map(n=>({n,nf:randomUUID(),op:randomUUID(),cnpj:n%2?'11344038002141':'11344038002060',value:n%2?100:200}))
    saveCredentials(state)
    await db.query('BEGIN')
    for(const row of state.workflow) {
      await db.query(`insert into public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status) values($1,$2,$3,$4,$5,'QA',current_date,current_date+30,'98100000000168','Cedente QA SACADO',$6,$7,$8,$8,'LEGACY_BRUTO','em_antecipacao')`,[row.nf,id('23'),id('24'),id('22'),`SACADO-QA-${row.n}`,row.cnpj,`Empresa QA ${row.cnpj.slice(-6)}`,row.value])
      // Synthetic initial states, not approval/disbursement actions. No trigger bypass.
      await db.query(`insert into public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status,aceite_sacado_exigido,aceite_sacado_status) values($1,$2,$3,$4,30,current_date+30,$5,true,$6)`,[row.op,id('23'),id('24'),row.value,row.n<7?'solicitada':'em_andamento',row.n<7?'pendente':'aceito'])
      await db.query('insert into public.operacoes_nfs(operacao_id,nota_fiscal_id) values($1,$2)',[row.op,row.nf])
    }
    await db.query('COMMIT');state.workflowSeeded=true;saveCredentials(state)
  }
  const a=await login('sacadoA'),b=await login('sacadoB'),page=await pageFor(browser,a)
  const dashboard=val(await a.rpc('carregar_dashboard_sacado'))
  assert.equal(dashboard.indicadores.totalDevido,300);assert.equal(dashboard.indicadores.nfsAtivas,2)
  assert.equal(val(await b.rpc('carregar_dashboard_sacado')).indicadores.totalDevido,200)
  assert.equal(val(await a.rpc('carregar_dashboard_sacado',{p_cnpj:'11344038002060'})).indicadores.totalDevido,200)
  assert.equal(val(await a.rpc('carregar_indicadores_nfs_sacado')).total,6)
  assert.equal(val(await b.rpc('carregar_indicadores_nfs_sacado')).total,3)
  check('DASHBOARD_INDICATORS_NO_DOUBLE_COUNT')
  if(!report.checks.includes('UI_APPROVE_MULTI_CNPJ_BATCH')) {
    await navigate(page,'/sacado/aprovacao')
    await page.click('[aria-label="Selecionar NF C21-CONSULTOR"]')
    await page.click('[aria-label="Selecionar NF C21-CEDENTE"]')
    await clickText(page,'Aprovar 2 NF(s)')
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Selecionar NF C21-CONSULTOR"]'),{timeout:45000})
    assert.equal((await db.query('select aceite_sacado_status from public.operacoes where id=$1',[id('33')])).rows[0].aceite_sacado_status,'aceito')
    assert.equal((await db.query("select count(*)::int n from public.notas_fiscais where id=any($1::uuid[]) and status='aceita'",[[id('2a'),id('2a',2)]])).rows[0].n,2)
    check('UI_APPROVE_MULTI_CNPJ_BATCH')
  }
  for(const row of state.workflow.filter(r=>r.n<7)) {
    const label=`UI_CONTEST_CNPJ_${row.cnpj}`
    if(report.checks.includes(label))continue
    await navigate(page,`/sacado/aprovacao?cnpj=${row.cnpj}`)
    const button=await page.evaluateHandle(n=>[...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent.includes(`SACADO-QA-${n}`))?.querySelector('button.bg-destructive') || [...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent.includes(`SACADO-QA-${n}`))?.querySelector('td:last-child button:last-child'),row.n)
    assert(button.asElement(),'CONTEST_BUTTON_MISSING');await button.asElement().click()
    await page.type('textarea','Contestacao sintetica QA SACADO - validar isolamento por empresa e Fundo.')
    await clickText(page,'Confirmar Contestacao')
    await page.waitForFunction(n=>!document.querySelector(`[aria-label="Selecionar NF SACADO-QA-${n}"]`),{timeout:45000},row.n)
    assert.equal((await db.query('select status::text from public.notas_fiscais where id=$1',[row.nf])).rows[0].status,'contestada')
    check(label)
  }
  const audit=(await db.query("select count(*)::int n from public.logs_auditoria where origem='rpc_sacado' and dados_depois ?& array['user_id','sacado_id','sacado_cnpj','fundo_id','nota_fiscal_id','operacao_id','acao','timestamp']")).rows[0].n
  assert.equal(audit,4);check('REAL_UI_ACCEPT_CONTEST_AUDIT_COMPLETE')
  const events=(await db.query("select distinct tipo_evento from public.plataforma_auditoria where tipo_evento like 'SACADO_%'")).rows.map(r=>r.tipo_evento)
  for(const name of ['SACADO_ACCESS_CREATED','SACADO_ACCESS_REVOKED','SACADO_ACCESS_ENABLED','SACADO_ACCESS_DISABLED','SACADO_COMPANY_CREATED','SACADO_COMPANY_UPDATED'])assert(events.includes(name),name)
  check('ALL_SIX_ADMIN_AUDIT_EVENTS')
} finally { await browser.close();await db.end() }
