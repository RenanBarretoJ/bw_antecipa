// Real JWT + MFA and browser certification, strictly on the disposable Preview.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'

const ref = 'prnudoydwiramsxjnxzn'
const base = process.argv[2]
assert(/^https:\/\/bw-antecipa-[a-z0-9-]+\.vercel\.app$/.test(base))
assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref)
const run = randomUUID().slice(0, 8)
const reportPath = `rehearsal/reports/GUIBOR_A5_A6_AUTH_${run}.json`
const report = { target: ref, base, run, users: {}, ids: {}, checks: [], success: false, cleanup: false }
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2))
const check = name => { report.checks.push(name); save(); console.log(name) }
function cli(args) {
  const r = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8000000 })
  if (r.status !== 0) { writeFileSync(`rehearsal/reports/GUIBOR_A5_A6_${run}_CLI_ERROR.txt`, r.stderr); throw new Error('QA_CLI_FAILED') }
  return JSON.parse(r.stdout)
}
function sql(query) {
  assert.equal(readFileSync('supabase/.temp/project-ref', 'utf8').trim(), ref)
  const file = `rehearsal/tmp/guibor-a5-a6-${run}.sql`
  writeFileSync(file, query)
  return cli(['db', 'query', '--linked', '--file', file, '--output', 'json']).rows
}
const val = r => { if (r.error) throw new Error(r.error.message); return r.data }
const keys = cli(['projects', 'api-keys', '--project-ref', ref, '--output', 'json'])
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(`https://${ref}.supabase.co`, keys.find(k => k.name === 'service_role').api_key, options)
const anon = keys.find(k => k.name === 'anon').api_key
const clients = {}, credentials = {}, contexts = {}
let browser, seeded = false
function cnpj() {
  const d = Array.from(randomBytes(12), b => b % 10)
  for (const w of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const remainder = d.reduce((s,n,i) => s+n*w[i], 0) % 11; d.push(remainder < 2 ? 0 : 11-remainder)
  }
  return d.join('')
}
function totp(secret) {
  const bits = [...secret.replace(/=/g, '').toUpperCase()].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('')
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
  const digest = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b,2)))).update(ctr).digest()
  return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0')
}
const oldId = (prefix, n=1) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const id = (prefix, n=1) => report.ids[oldId(prefix,n)]
async function rpc(role, name, args) { return val(await clients[role].rpc(name,args)) }
async function denied(role, name, args) { const r = await clients[role].rpc(name,args); assert(r.error, `${role}_${name}_MUST_DENY`) }
async function pageFor(role) {
  const context = await browser.createBrowserContext()
  const session = val(await clients[role].auth.getSession()).session
  const chunks = ('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
  await context.setCookie(...chunks.map((value,i) => ({ name: chunks.length===1?`sb-${ref}-auth-token`:`sb-${ref}-auth-token.${i}`, value, domain:new URL(base).hostname, path:'/', secure:true, httpOnly:false, sameSite:'Lax' })),
    { name:'bw_fundo_ativo_id', value:id('22'), domain:new URL(base).hostname, path:'/', secure:true, sameSite:'Lax' })
  contexts[role] = context
  return context.newPage()
}
async function navigate(page,path) {
  const response = await page.goto(base+path,{waitUntil:'networkidle2',timeout:60000})
  assert(response.status() < 400, `HTTP_${response.status()}`)
  assert((response.headers()['content-security-policy']||'').includes(ref+'.supabase.co'),'DEPLOYMENT_DATABASE_MISMATCH')
  await page.waitForSelector('main h1',{visible:true,timeout:30000})
  await page.waitForFunction(()=>!document.body.innerText.includes('Carregando portal'),{timeout:30000})
  assert(new URL(page.url()).pathname===path.split('?')[0],`UNEXPECTED_REDIRECT_${new URL(page.url()).pathname}`)
  return page.evaluate(()=>document.body.innerText)
}
function args(nfs) {
  return { p_cedente_id:id('23'),p_cedente_fundo_id:id('24'),p_politica_operacional_id:id('26'),p_politica_operacional_versao_id:id('27'),
    p_politica_versao:1,p_politica_snapshot:{calculo_financeiro:{metodo:'TRINTA_360'}},p_politica_snapshot_hash:'a'.repeat(64),
    p_aceite_sacado_exigido:false,p_aceite_sacado_status:'dispensado',p_nota_fiscal_ids:nfs,p_idempotency_key:`GUIBOR-${run}-${randomUUID()}`,p_parcela_ids:null }
}
const operation = async op => val(await admin.from('operacoes').select('id,valor_bruto_total,base_antecipacao_snapshot,valor_liquido_desembolso,taxa_proposta_consultor').eq('id',op).single())
try {
  assert.equal(sql('select count(*)::int n from auth.users')[0].n,0,'DISPOSABLE_PREVIEW_NOT_EMPTY')
  const login = await fetch(base+'/login')
  assert(login.ok,'PREVIEW_NOT_READY')
  assert((login.headers.get('content-security-policy')||'').includes(ref+'.supabase.co'),'PREVIEW_TARGET_WRONG')
  check('DEPLOYMENT_ISOLATED_PREVIEW')
  for (const [n,role] of ['consultor','leitor','cedente','gestor'].entries()) {
    const email=`guibor-${run}-${role}@example.invalid`, password=`Guibor!A1${randomBytes(24).toString('base64url')}`
    const {user}=val(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nome_completo:`QA GUIBOR ${role}`}}))
    report.users[role]=user.id; report.ids[oldId('21',n+1)]=user.id; credentials[role]={email,password}; save()
  }
  let setup=readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8').replace(/  INSERT INTO auth.users[\s\S]*?(?=  INSERT INTO public.profiles)/,'')
  const a6=readFileSync('supabase/tests/guibor_a6_comissao.test.sql','utf8')
  setup+='\n'+a6.slice(a6.indexOf('UPDATE public.consultor_cedentes'),a6.indexOf("SELECT set_config('qa.financial_before'"))
  for (const uuid of new Set(setup.match(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g))) report.ids[uuid] ||= randomUUID()
  for (const [from,to] of Object.entries(report.ids)) setup=setup.replaceAll(from,to)
  for (const number of new Set(setup.match(/'\d{14}'/g))) setup=setup.replaceAll(number,`'${cnpj()}'`)
  setup=setup.replaceAll('QA_C2_1',`QA_GUIBOR_${run}`).replaceAll('C2.1',`GUIBOR ${run}`).replaceAll('ESCROW-C21',`ESCROW-GUIBOR-${run}`).replaceAll('QA OFF',`QA GUIBOR ${run} OFF`).replaceAll('ESCROW-QA-OFF',`ESCROW-GUIBOR-${run}-OFF`)
  for (const role of Object.keys(report.users)) setup=setup.replaceAll(`${role==='consultor'?'operador':role}-c21@example.invalid`,credentials[role].email)
  save(); sql(`BEGIN;${setup}COMMIT;SELECT true seeded;`); seeded=true
  for (const role of Object.keys(report.users)) {
    const client=createClient(`https://${ref}.supabase.co`,anon,options); clients[role]=client
    val(await client.auth.signInWithPassword(credentials[role]))
    const factor=val(await client.auth.mfa.enroll({factorType:'totp',friendlyName:`GUIBOR ${run}`}))
    const challenge=val(await client.auth.mfa.challenge({factorId:factor.id}))
    val(await client.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:totp(factor.totp.secret)}))
    val(await client.rpc('registrar_sessao_mfa_atual',{p_factor_id:factor.id}))
    delete credentials[role]
  }
  check('FOUR_REAL_AUTH_AAL2_ROLES')
  const baseArgs={p_cedente_fundo_id:id('24'),p_base:'LIQUIDO'}
  const commissionArgs={p_consultor_id:id('29'),p_fundo_id:id('22'),p_habilitada:true}
  for (const role of ['consultor','leitor','cedente']) {
    await denied(role,'configurar_base_antecipacao',baseArgs)
    await denied(role,'configurar_comissao_consultor_fundo',commissionArgs)
  }
  await denied('gestor','configurar_base_antecipacao',{...baseArgs,p_cedente_fundo_id:id('24',2)})
  await denied('gestor','configurar_comissao_consultor_fundo',{...commissionArgs,p_fundo_id:id('22',2)})
  check('AUTH_GOVERNANCE_CROSS_FUND_DENIED')
  const gross=await rpc('consultor','solicitar_operacao_antecipacao_consultor_atomica',{...args([id('2a')]),p_taxa_proposta_consultor:2.4})
  const grossBefore=await operation(gross.operacao_id)
  assert.equal(Number(grossBefore.valor_bruto_total),100000)
  assert.equal(grossBefore.base_antecipacao_snapshot.base,'BRUTO')
  await rpc('gestor','configurar_base_antecipacao',baseArgs)
  await denied('consultor','solicitar_operacao_antecipacao_consultor_atomica',{...args([id('2a',4)]),p_taxa_proposta_consultor:2.4})
  const net=await rpc('consultor','solicitar_operacao_antecipacao_consultor_atomica',{...args([id('2a',2),id('2a',3)]),p_taxa_proposta_consultor:2.4})
  const netBefore=await operation(net.operacao_id)
  assert.equal(Number(netBefore.valor_bruto_total),143008.8)
  assert.equal(netBefore.base_antecipacao_snapshot.base,'LIQUIDO')
  assert.equal(netBefore.base_antecipacao_snapshot.notas.length,2)
  assert.deepEqual(await operation(gross.operacao_id),grossBefore)
  await rpc('gestor','configurar_base_antecipacao',{...baseArgs,p_base:'BRUTO'})
  assert.deepEqual(await operation(net.operacao_id),netBefore)
  const direct=await rpc('cedente','solicitar_operacao_antecipacao_cedente_atomica',{...args([id('2a',4)]),p_valor_bruto_total:1,p_taxa_desconto:2.5,p_prazo_dias:1,p_valor_liquido_desembolso:1,p_data_vencimento:'2026-11-13'})
  assert.equal(Number((await operation(direct.operacao_id)).valor_bruto_total),900)
  report.operations={gross:gross.operacao_id,net:net.operacao_id,direct:direct.operacao_id};save()
  check('AUTH_BRUTO_LIQUIDO_MULTI_SNAPSHOT_FREE_RATE_CEDENTE_DIRECT')
  const dashboard=await rpc('consultor','dashboard_consultor_resumo',{})
  assert.equal(dashboard.comissaoHabilitada,false); assert(!('comissaoEstimada' in dashboard))
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--disable-dev-shm-usage']})
  const pages={}
  for(const role of Object.keys(report.users)) pages[role]=await pageFor(role)
  for(const enabled of [false,true,false]) {
    if(enabled || report.checks.includes('COMMISSION_ON_UI')) await rpc('gestor','configurar_comissao_consultor_fundo',{...commissionArgs,p_habilitada:enabled})
    const summary=await rpc('leitor','dashboard_consultor_resumo',{})
    assert.equal(summary.comissaoHabilitada,enabled)
    if(enabled) assert.equal(Number(summary.comissaoEstimada),900)
    else assert(!('comissaoEstimada' in summary))
    const analytics=await rpc('consultor','relatorio_consultor_analitico',{p_mes:new Date().toISOString().slice(0,7)})
    if(enabled) assert.equal(Number(analytics.resumo.comissaoMes),900)
    else assert(!('comissaoMes' in analytics.resumo))
    const offRow=analytics.items.find(row=>row.cedenteId===id('23',2))
    assert(offRow && !('comissaoMes' in offRow) && !('percentual' in offRow))
    const widths=report.checks.includes('COMMISSION_ON_UI')?[1440]:[390,430,820,1440,1920]
    for(const path of ['/consultor/dashboard','/consultor/relatorios']) {
      const text=await navigate(pages.consultor,path)
      assert.equal(/comiss[aãõ]/i.test(text),enabled,'COMMISSION_DOM_VISIBILITY')
      for(const mode of ['light','dark']) for(const width of widths) {
        await pages.consultor.setViewport({width,height:1100})
        await pages.consultor.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme},mode)
        await pages.consultor.waitForSelector('main h1',{visible:true,timeout:30000})
        await pages.consultor.waitForFunction(()=>{const r=document.querySelector('aside')?.getBoundingClientRect();return !!r&&(innerWidth<1024?r.right<=0.1:Math.abs(r.left)<0.1)},{timeout:10000})
        const overflow=await pages.consultor.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.querySelector('main')?.scrollWidth||0)-innerWidth)
        assert(overflow<=1,`BODY_OVERFLOW_${width}_${path}_${overflow}`)
        await pages.consultor.screenshot({path:`rehearsal/reports/GUIBOR_A5_A6_${run}_${path.split('/').pop()}_${enabled?'ON':'OFF'}_${mode}_${width}.png`,fullPage:true})
      }
      const readerText=await navigate(pages.leitor,path)
      assert.equal(/comiss[aãõ]/i.test(readerText),enabled,'READER_COMMISSION_DOM_VISIBILITY')
    }
    check(enabled?'COMMISSION_ON_UI':'COMMISSION_OFF_UI')
  }
  for(const role of ['gestor','cedente','consultor']) {
    const text=await navigate(pages[role],`/${role}/operacoes/${net.operacao_id}`)
    await pages[role].screenshot({path:`rehearsal/reports/GUIBOR_A5_A6_${run}_SNAPSHOT_${role}.png`,fullPage:true})
    writeFileSync(`rehearsal/reports/GUIBOR_A5_A6_${run}_SNAPSHOT_${role}.txt`,text)
    assert(/143\.008,80/.test(text),'SNAPSHOT_BASE_NOT_SHOWN')
    assert(/l[ií]quido/i.test(text),'SNAPSHOT_POLICY_NOT_SHOWN')
  }
  check('THREE_PORTALS_SNAPSHOT_READ')
  report.success=true
} catch(error) { report.error=error.message; process.exitCode=1 }
finally {
  if(browser) await browser.close()
  for(const client of Object.values(clients)) await client.auth.signOut({scope:'global'}).catch(()=>{})
  save()
  // Only manifest-owned synthetic entities; no imported PDF/Storage is created by this harness.
  if(seeded) {
    const list=values=>values.map(v=>{assert(/^[0-9a-f-]{36}$/.test(v));return `'${v}'`}).join(',')
    const cs=list([id('23'),id('23',2)]), fs=list([id('22'),id('22',2)]), us=list(Object.values(report.users)), org=`'${id('29')}'`
    try {
      const owners=sql(`select id,razao_social from public.cedentes where id in (${cs})`)
      assert.equal(owners.length,2);assert(owners.every(row=>row.razao_social.includes(`GUIBOR ${run}`)))
      const ops=sql(`select id from public.operacoes where cedente_id in (${cs})`)
      assert(ops.length<=5,'UNEXPECTED_OPERATION_COUNT_STOP')
      const opIds=list(ops.map(o=>o.id)), noteIds=list([1,2,3,4].map(n=>id('2a',n)))
      assert.equal(sql(`select count(*)::int n from storage.objects where split_part(name,'/',1) in (${cs})`)[0].n,0,'UNEXPECTED_STORAGE_STOP')
      const deletes=[
        ['eventos_dominio',`ator_usuario_id in (${us})`],['operacao_calculo_nfs',`operacao_id in (${opIds})`],
        ['operacoes_nf_parcelas',`operacao_id in (${opIds})`],['operacoes_nfs',`operacao_id in (${opIds})`],['operacoes',`id in (${opIds})`],
        ['nota_fiscal_entregas',`nota_fiscal_id in (${noteIds})`],['notas_fiscais',`id in (${noteIds})`],
        ['consultor_cedentes',`consultor_id=${org}`],['consultor_fundos',`consultor_id=${org}`],['consultor_usuarios',`consultor_id=${org}`],['consultores',`id=${org}`],
        ['cedente_fundo_politicas',`id='${id('28')}'`],['politica_operacional_versoes',`id='${id('27')}'`],['politicas_operacionais',`id='${id('26')}'`],
        ['taxas_cedente',`cedente_id in (${cs})`],['contas_escrow',`cedente_id in (${cs})`],['cedente_fundos',`id in (${list([id('24'),id('24',2)])})`],
        ['cedente_acessos',`cedente_id in (${cs})`],['cedente_estabelecimentos',`cedente_id in (${cs})`],['cedentes',`id in (${cs})`],
        ['usuario_fundos',`usuario_id in (${us}) and fundo_id in (${fs})`],['fundos',`id in (${fs})`],
        ['logs_auditoria',`usuario_id in (${us})`],['sessoes_elevadas',`user_id in (${us})`],['seguranca_eventos',`usuario_id in (${us}) or ator_usuario_id in (${us})`]
      ]
      sql(`BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL session_replication_role='replica';${deletes.map(([table,where])=>`DELETE FROM public.${table} WHERE ${where};`).join('\n')}SET LOCAL session_replication_role='origin';COMMIT;SELECT true cleaned;`)
      report.removed={operations:ops.length,notes:4,cedentes:2,funds:2}
    }catch(error) {report.cleanupError=error.message;process.exitCode=1}
  }
  if(!report.cleanupError) {
    for(const user of Object.values(report.users)) { const r=await admin.auth.admin.deleteUser(user);if(r.error){report.cleanupError='AUTH_CLEANUP_FAILED';process.exitCode=1} }
    report.cleanup=!report.cleanupError
  }
  save();console.log(JSON.stringify({report:reportPath,success:report.success,cleanup:report.cleanup,error:report.error,cleanupError:report.cleanupError}))
}
