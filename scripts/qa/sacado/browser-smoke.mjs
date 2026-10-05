// Authenticated UI mutations only against synthetic QA actors in the SACADO Preview.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { connect, ref, base } from './preview-runtime.mjs'
import { d, state, id, val, login, nextCode, pageFor, navigate } from './auth-runtime.mjs'

const mode=process.argv[2]
assert(['--add','--access-actions','--portal','--visual'].includes(mode))
const file='rehearsal/reports/SACADO_R2_BROWSER.json'
const report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{ref,base,checks:[],screens:[]}
const save=()=>writeFileSync(file,JSON.stringify(report,null,2))
const check=name=>{if(!report.checks.includes(name))report.checks.push(name);save();console.log(name)}
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-features=PasswordLeakDetection'],defaultViewport:{width:1440,height:1000}})
const db=await connect(d)
async function clickText(page,text) {
  const clicked=await page.evaluate(text=>{const b=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===text);if(!b)return false;b.click();return true},text)
  assert(clicked,`BUTTON_NOT_FOUND_${text}`)
}
async function openUser(page,name) {
  const url=`/gestor/configuracoes/sacados?fundo=${id('22')}&busca=${encodeURIComponent(state.actors[name].email)}`
  const text=await navigate(page,url);assert(text.includes('1 usuario(s) encontrado(s)'),'USER_SEARCH_FAILED')
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle2'}),clickText(page,'Abrir acessos')])
  assert((await page.evaluate(()=>document.body.innerText)).includes('Este usuario pode aprovar documentos destas empresas:'))
}
async function formFor(page,cnpj,add) {
  const handle=await page.evaluateHandle(({cnpj,add})=>[...document.querySelectorAll('form')].find(f=>{
    const field=f.querySelector('[name="cnpj"]');return field && (add ? !field.readOnly : field.value.replace(/\D/g,'')===cnpj)
  }),{cnpj,add})
  const form=handle.asElement();assert(form,'ACCESS_FORM_NOT_FOUND')
  if(!add) await form.evaluate(f=>{const details=f.closest('details');if(details)details.open=true})
  return form
}
async function manage(page,name,cnpj,acao,razao='Empresa QA 0020') {
  await openUser(page,name)
  const form=await formFor(page,cnpj,acao==='adicionar')
  if(acao==='adicionar') {
    await (await form.$('[name="cnpj"]')).type(cnpj)
    await (await form.$('[name="razao"]')).click()
    await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(e=>/Empresa encontrada|Empresa ainda nao/.test(e.textContent)),{timeout:30000})
  } else await (await form.$('[name="acao"]')).select(acao)
  const field=await form.$('[name="razao"]')
  await field.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await field.type(razao)
  await (await form.$('[name="confirmacao"]')).click()
  const code=await nextCode('gestor')
  await (await form.$('[name="mfa"]')).type(code)
  await (await form.$('button[type="submit"]')).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('form [role="status"],form [role="alert"]')].some(e=>/Acesso atualizado|Nao foi possivel|Acesso negado|Confira os dados/.test(e.textContent)),{timeout:45000})
  const feedback=await page.$$eval('form [role="status"],form [role="alert"]',es=>es.map(e=>e.textContent))
  assert(feedback.some(t=>t.includes('Acesso atualizado')),`UI_MUTATION_FAILED_${feedback.join('|')}`)
  await page.reload({waitUntil:'networkidle2'})
  const row=(await db.query(`select a.status from public.sacado_acessos a join public.sacados s on s.id=a.sacado_id where a.user_id=$1 and a.fundo_id=$2 and regexp_replace(s.cnpj,'[^0-9]','','g')=$3`,[state.actors[name].id,id('22'),cnpj])).rows
  assert.equal(row.length,1)
  assert.equal(row[0].status,{adicionar:'ativo',ativar:'ativo',desativar:'inativo',revogar:'revogado',atualizar_empresa:'ativo'}[acao])
}
try {
  if(mode==='--add') {
    const gestor=await login('gestor'), page=await pageFor(browser,gestor)
    for(const [name,label] of [['sacadoA','UI_ADD_0020_MFA'],['sacadoB','UI_SECOND_USER_SAME_CNPJ_MFA']]) {
      if(!report.checks.includes(label)) { await manage(page,name,'11344038002060','adicionar');check(label) }
    }
    check('FRONT_LIST_DETAIL_RELOAD_PERSISTENCE')
  }
  if(mode==='--access-actions') {
    assert(report.checks.includes('UI_SECOND_USER_SAME_CNPJ_MFA'))
    const gestor=await login('gestor'),page=await pageFor(browser,gestor)
    const a=await login('sacadoA'),b=await login('sacadoB')
    for(const action of ['revogar','ativar','desativar','ativar','atualizar_empresa'].map((action,i)=>({action,label:`UI_${i}_${action.toUpperCase()}_MFA`}))) {
      if(report.checks.includes(action.label)) continue
      await manage(page,'sacadoA','11344038002060',action.action,'Empresa QA 0020 validada')
      const aLinks=val(await a.rpc('get_user_sacado_context')),bLinks=val(await b.rpc('get_user_sacado_context'))
      assert.equal(bLinks.length,1);assert.equal(bLinks[0].cnpj,'11344038002060')
      assert.equal(aLinks.length,['revogar','desativar'].includes(action.action)?1:2)
      check(action.label)
    }
    check('REVOKE_A_PRESERVES_B')
  }
  if(mode==='--portal') {
    for(const name of ['sacadoA','sacadoB']) {
      const client=await login(name),page=await pageFor(browser,client)
      for(const route of ['dashboard','notas-fiscais','aprovacao','pagamentos']) {
        const text=await navigate(page,`/sacado/${route}`)
        assert(text.includes('Todos os meus CNPJs'))
        const values=await page.$$eval('select[name="cnpj"] option',es=>es.map(e=>e.value))
        assert(values.includes('11344038002060'))
        assert.equal(values.includes('11344038002141'),name==='sacadoA')
        assert(!values.includes('11344038009910'))
        check(`${name.toUpperCase()}_${route.toUpperCase()}_SET`)
      }
      const text=await navigate(page,'/sacado/notas-fiscais?cnpj=11344038002060')
      assert(text.includes('C21-CEDENTE'));assert(!text.includes('C21-CONSULTOR-LIVRE'))
      check(`${name.toUpperCase()}_CNPJ_FILTER`)
    }
  }
  if(mode==='--visual') {
    report.screens=[]
    mkdirSync('rehearsal/reports/sacado-r2-browser',{recursive:true})
    const gestor=await login('gestor'),g=await pageFor(browser,gestor)
    const sacado=await login('sacadoA'),s=await pageFor(browser,sacado)
    await openUser(g,'sacadoA');await navigate(s,'/sacado/notas-fiscais')
    for(const [name,page] of [['gestao',g],['portal',s]]) {
      await page.addScriptTag({content:readFileSync('node_modules/axe-core/axe.min.js','utf8')})
      for(const width of [390,430,820,1440,1920]) for(const theme of ['light','dark']) {
        await page.setViewport({width,height:1000})
        await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme},theme)
        await new Promise(r=>setTimeout(r,500)) // Wait for the application's color transitions.
        const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,unlabeled:[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[aria-hidden="true"]')&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.getAttribute('placeholder')).map(e=>({tag:e.tagName,html:e.outerHTML.slice(0,400)}))}))
        assert(metrics.scroll<=metrics.width+1,`${name}_${width}_DOCUMENT_CLIPPING`)
        const accessibility=await page.evaluate(async()=>{
          const results=await window.axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})
          return results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))
        })
        const path=`rehearsal/reports/sacado-r2-browser/${name}-${width}-${theme}.png`
        await page.screenshot({path,fullPage:true})
        report.screens.push({name,width,theme,path,...metrics,accessibility});save()
      }
      await page.keyboard.press('Tab')
      assert(await page.evaluate(()=>document.activeElement!==document.body),'KEYBOARD_FOCUS')
    }
    assert(!report.screens.some(s=>s.accessibility.length || s.unlabeled.length),'WCAG_VIOLATIONS_SEE_REPORT')
    check('RESPONSIVE_5_WIDTHS_LIGHT_DARK');check('KEYBOARD_AND_INPUT_LABELS')
  }
} catch(e) { report.lastFailure={mode,message:e.message};save();throw e }
finally { await browser.close();await db.end() }
