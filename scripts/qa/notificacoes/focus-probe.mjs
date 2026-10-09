// Test-only lifecycle recorder. Never bundled into the application.
import assert from 'node:assert/strict'
export const triggerSelector = 'button[aria-label^="Notificações,"]'
export async function installFocusTrace(page) {
  await page.evaluate(() => {
    window.focusTrace?.disconnect()
    const start = performance.now(), events = [], ids = new WeakMap()
    let nextId = 0
    const describe = el => el instanceof Element ? {
      node: ids.has(el) ? ids.get(el) : (ids.set(el, ++nextId), nextId),
      tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'),
      testid: el.getAttribute('data-testid'), id: el.id, connected: el.isConnected, guard: el.hasAttribute('data-base-ui-focus-guard'),
    } : null
    const snapshot = (event, detail = {}) => {
      const trigger = document.querySelector('button[aria-label^="Notificações,"]')
      const popup = document.querySelector('[role="dialog"]')
      const entry = {ms: performance.now() - start, event, ...detail, active: describe(document.activeElement),
        trigger: describe(trigger), expanded: trigger?.getAttribute('aria-expanded'),
        popup: describe(popup), popupAttrs: popup ? [...popup.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name,a.value]) : [],
        inside: Boolean(popup?.contains(document.activeElement))}
      events.push(entry); return entry
    }
    const listener = e => {if(!['animationend','transitionend'].includes(e.type) || e.target.closest('[role="dialog"]') || e.target.matches('button[aria-label^="Notificações,"]')) snapshot(e.type, {key: e.key, target: describe(e.target), related: describe(e.relatedTarget)})}
    const types = ['focusin','focusout','keydown','animationend','transitionend']
    types.forEach(type => document.addEventListener(type, listener, true))
    const observer = new MutationObserver(records => {
      if (records.some(r => r.type === 'childList' || ['aria-expanded','data-open','data-closed','data-starting-style','data-ending-style'].includes(r.attributeName))) snapshot('mutation')
    })
    observer.observe(document.body,{subtree:true,childList:true,attributes:true})
    window.focusTrace = {events, snapshot, disconnect(){observer.disconnect();types.forEach(type => document.removeEventListener(type,listener,true))}}
    snapshot('installed')
  })
}
export async function probeLegacySequence(page, rounds = 40) {
  await installFocusTrace(page)
  const failures = []
  for(let round=0; round<rounds; round++) {
    await page.click(triggerSelector)
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
    await page.evaluate(round => window.focusTrace.snapshot('legacy-closed',{round}),round)
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"]')
    await page.evaluate(round => window.focusTrace.snapshot('legacy-before-tab',{round}),round)
    await page.keyboard.press('Tab')
    const state = await page.evaluate(round => window.focusTrace.snapshot('legacy-after-tab',{round}),round)
    if(!state.inside) failures.push(state)
    // Observe eventual library readiness, never fix focus in the app under test.
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    await page.evaluate(round => window.focusTrace.snapshot('eventual-ready',{round}),round)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.activeElement === document.querySelector('button[aria-label^="Notificações,"]'))
  }
  const events = await page.evaluate(() => window.focusTrace.events)
  return {rounds,failures,events}
}

export async function controlledOpeningProbe(page) {
  await installFocusTrace(page)
  const results=[]
  for(let round=0;round<3;round++) {
    await page.click(triggerSelector)
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    await page.keyboard.press('Escape')
    await closedReady(page)
    // Hold the browser's animation-frame queue at the known OPENING boundary.
    // This schedules the race deterministically; no application state is changed.
    await page.evaluate(()=>{
      const raf=window.requestAnimationFrame, cancel=window.cancelAnimationFrame, pending=new Map();let id=1000000
      window.requestAnimationFrame=cb=>{pending.set(++id,cb);return id}
      window.cancelAnimationFrame=id=>{if(!pending.delete(id))cancel(id)}
      window.releaseFocusFrames=()=>{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;for(const cb of pending.values())raf(cb);pending.clear()}
    })
    await page.keyboard.press('Enter');await page.waitForSelector('[role="dialog"]')
    await page.keyboard.press('Tab')
    const premature=await page.evaluate(()=>window.focusTrace.snapshot('controlled-premature-tab'))
    await page.evaluate(()=>window.releaseFocusFrames())
    await openReady(page)
    const settled=await page.evaluate(()=>window.focusTrace.snapshot('controlled-settled'))
    results.push({premature,settled})
    await page.keyboard.press('Escape');await closedReady(page)
  }
  assert(results.every(r=>!r.premature.inside&&r.settled.inside),'CONTROLLED_RACE_NOT_REPRODUCED')
  return {results,events:await page.evaluate(()=>window.focusTrace.events)}
}
export async function closedReady(page) {
  await page.waitForFunction(()=>{
    const trigger=document.querySelector('button[aria-label^="Notificações,"]')
    return !document.querySelector('[role="dialog"]')&&trigger?.getAttribute('aria-expanded')==='false'&&document.activeElement===trigger
  })
}
export async function openReady(page) {
  await page.waitForFunction(()=>{
    const popup=document.querySelector('[role="dialog"]'),trigger=document.querySelector('button[aria-label^="Notificações,"]')
    return trigger?.getAttribute('aria-expanded')==='true'&&popup?.checkVisibility()&&!popup.hasAttribute('data-starting-style')&&!popup.hasAttribute('data-ending-style')&&popup.contains(document.activeElement)
  })
}
