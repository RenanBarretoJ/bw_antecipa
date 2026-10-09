// Real Auth sessions, QA-only credentials encrypted outside the repository.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { details, loadCredentials, saveCredentials, ref, base } from './preview-runtime.mjs'

export const state = loadCredentials()
export const d = details()
export const id = (prefix, n=1) => state.ids[`${prefix}000000-0000-4000-8000-${String(n).padStart(12,'0')}`]
export const val = r => { assert(!r.error, r.error?.message || 'REQUEST_FAILED'); return r.data }
export function totp(secret) {
  const bits=[...secret.replace(/=/g,'').toUpperCase()].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('')
  const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
  const digest=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(ctr).digest()
  return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0')
}
export async function nextCode(name) {
  const a=state.actors[name], tick=Math.floor(Date.now()/30000)
  if(a.lastTick===tick) await new Promise(r=>setTimeout(r,30100-Date.now()%30000))
  a.lastTick=Math.floor(Date.now()/30000);saveCredentials(state)
  return totp(a.secret)
}
export async function login(name, elevated=true) {
  const a=state.actors[name]
  assert(a && a.email.endsWith('@example.invalid'),'QA_ACTOR_REQUIRED')
  const client=createClient(d.SUPABASE_URL,d.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  val(await client.auth.signInWithPassword({email:a.email,password:a.password}))
  if(elevated) {
    if(!a.factor) {
      const factor=val(await client.auth.mfa.enroll({factorType:'totp',friendlyName:'SACADO Preview QA'}))
      a.factor=factor.id;a.secret=factor.totp.secret;saveCredentials(state)
    }
    const challenge=val(await client.auth.mfa.challenge({factorId:a.factor}))
    val(await client.auth.mfa.verify({factorId:a.factor,challengeId:challenge.id,code:await nextCode(name)}))
    val(await client.rpc('registrar_sessao_mfa_atual',{p_factor_id:a.factor}))
  }
  return client
}
export async function pageFor(browser, client) {
  const context=await browser.createBrowserContext()
  const session=val(await client.auth.getSession()).session
  const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3180}/g)
  await context.setCookie(...chunks.map((value,i)=>({name:chunks.length===1?`sb-${ref}-auth-token`:`sb-${ref}-auth-token.${i}`,value,domain:new URL(base).hostname,path:'/',secure:true,sameSite:'Lax'})),
    {name:'bw_fundo_ativo_id',value:id('22'),domain:new URL(base).hostname,path:'/',secure:true,sameSite:'Lax'})
  return context.newPage()
}
export async function navigate(page,path) {
  const r=await page.goto(base+path,{waitUntil:'networkidle2',timeout:60000})
  assert(r.status()<400,`HTTP_${r.status()}`)
  assert((r.headers()['content-security-policy']||'').includes(ref+'.supabase.co'),'DEPLOYMENT_DATABASE_MISMATCH')
  assert.equal(new URL(page.url()).pathname,path.split('?')[0],'UNEXPECTED_REDIRECT')
  await page.waitForSelector('main h1',{visible:true,timeout:30000})
  return page.evaluate(()=>document.body.innerText)
}
