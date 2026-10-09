// Synthetic QA only: states and HTTP status codes, never bodies/cookies/tokens.
export function observeActions(page) {
  const events=[], started=Date.now()
  const isAction=r=>r.method()==='POST'&&Boolean(r.headers()['next-action'])
  const kind=r=>{try{const args=JSON.parse(r.postData());const input=args[0];return input?.limit?'list-'+input.limit:input?.scope?'mark':'context'}catch{return 'other'}}
  const request=r=>{if(isAction(r))events.push({ms:Date.now()-started,event:'request',kind:kind(r)})}
  const response=r=>{if(isAction(r.request()))events.push({ms:Date.now()-started,event:'response',status:r.status(),kind:kind(r.request())})}
  const failed=r=>{if(isAction(r))events.push({ms:Date.now()-started,event:'failed',kind:kind(r)})}
  page.on('request',request);page.on('response',response);page.on('requestfailed',failed)
  return {events,stop(){page.off('request',request);page.off('response',response);page.off('requestfailed',failed)}}
}
// Readiness belongs to the main list, not a matching title inside the bell.
export async function clickMarkAllReady(page, title) {
  await page.waitForFunction(title=>{
    const section=document.querySelector('[aria-labelledby="notificacoes-title"]')
    const list=section?.querySelector('[aria-label="Lista de notificações"]')
    return list?.getAttribute('aria-busy')==='false'&&[...list.querySelectorAll('h2')].some(e=>e.textContent.startsWith(title))&&!section.querySelector('[role="alert"]')
  },{timeout:15000},title)
  // Locator waits for a visible, enabled, stable button; real pointer input.
  await page.locator('[aria-labelledby="notificacoes-title"] button:has(svg.lucide-check-check)').setTimeout(15000).click()
}
export async function readMarkState(page) {
  return page.evaluate(()=>{
    const section=document.querySelector('[aria-labelledby="notificacoes-title"]')
    const button=[...section.querySelectorAll('button')].find(b=>b.textContent==='Marcar todas como lidas'||b.textContent==='Marcando…')
    return {button:button?{text:button.textContent,disabled:button.disabled,ariaDisabled:button.getAttribute('aria-disabled')}:null,
      listBusy:section.querySelector('[aria-label="Lista de notificações"]')?.getAttribute('aria-busy'),
      status:section.querySelector('[role="status"]')?.textContent,
      alerts:[...section.querySelectorAll('[role="alert"]')].map(e=>e.textContent),
      popup:Boolean(document.querySelector('[role="dialog"]')),
      items:[...section.querySelectorAll('[data-notificacao-id] h2')].map(e=>e.textContent)}
  })
}
