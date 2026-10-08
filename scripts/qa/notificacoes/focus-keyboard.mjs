import assert from 'node:assert/strict'
import {closedReady,openReady,installFocusTrace} from './focus-probe.mjs'

export async function assertInside(page) {
  const state=await page.evaluate(()=>{
    const active=document.activeElement,popup=document.querySelector('[role="dialog"]')
    return {inside:Boolean(popup?.contains(active)),visible:active?.checkVisibility(),inert:Boolean(active?.closest('[inert],[aria-hidden="true"]')),tag:active?.tagName}
  })
  assert(state.inside&&state.visible&&!state.inert,'FOCUS_ESCAPED:'+JSON.stringify(state))
}
export async function keyboardOpen(page) {
  // Reach the trigger through the real tab order, including backwards from list.
  for(let i=0;i<120;i++) {
    if(await page.evaluate(()=>document.activeElement===document.querySelector('button[aria-label^="Notificações,"]')))break
    await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift')
  }
  assert(await page.evaluate(()=>document.activeElement===document.querySelector('button[aria-label^="Notificações,"]')),'TRIGGER_UNREACHABLE')
  await page.keyboard.press('Enter');await openReady(page)
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Fechar notificações','INITIAL_FOCUS_WRONG')
}
export async function keyboardClose(page) {await page.keyboard.press('Escape');await closedReady(page)}

export async function keyboardCycle(page,{negative=false}={}) {
  await installFocusTrace(page)
  if(await page.$('[role="dialog"]'))await keyboardClose(page)
  await page.evaluate(()=>{window.qaTriggerNode=document.querySelector('button[aria-label^="Notificações,"]')})
  await keyboardOpen(page)
  const semantics=await page.evaluate(()=>{
    const trigger=document.querySelector('button[aria-label^="Notificações,"]'),popup=document.querySelector('[role="dialog"]')
    return {expanded:trigger.getAttribute('aria-expanded'),haspopup:trigger.getAttribute('aria-haspopup'),controls:trigger.getAttribute('aria-controls')===popup.id,
      title:document.getElementById(popup.getAttribute('aria-labelledby'))?.textContent,
      badgeHidden:!trigger.querySelector('[data-testid="notificacao-badge"]')||trigger.querySelector('[data-testid="notificacao-badge"]').getAttribute('aria-hidden')==='true'}
  })
  assert.deepEqual(semantics,{expanded:'true',haspopup:'dialog',controls:true,title:'Notificações',badgeHidden:true})
  for(let cycle=0;cycle<3;cycle++){
    // Traverse beyond the full set so both native trap boundaries are exercised.
    const count=await page.$$eval('[role="dialog"] a[href], [role="dialog"] button, [role="dialog"] select',els=>els.filter(e=>!e.disabled).length)
    for(const backwards of [false,true]) {
      if(backwards)await page.keyboard.down('Shift')
      for(let i=0;i<count+2;i++) {
        await page.keyboard.press('Tab')
        // Native focus guards use requestAnimationFrame. Wait only while on a
        // guard, not for arbitrary focus to "recover" from body/root.
        await page.waitForFunction(()=>!document.activeElement?.hasAttribute('data-base-ui-focus-guard'))
        await assertInside(page)
        const visible=await page.evaluate(()=>{
          const r=document.activeElement.getBoundingClientRect(),p=document.querySelector('[role="dialog"]').getBoundingClientRect()
          const style=getComputedStyle(document.activeElement)
          return {fits:r.top>=p.top&&r.bottom<=p.bottom+1&&r.left>=p.left&&r.right<=p.right+1,ring:style.outlineStyle!=='none'||style.boxShadow!=='none'}
        })
        assert(visible.fits,'FOCUSED_ITEM_CLIPPED')
        assert(visible.ring,'FOCUS_RING_MISSING')
      }
      if(backwards)await page.keyboard.up('Shift')
    }
    await keyboardClose(page)
    assert(await page.evaluate(()=>window.qaTriggerNode===document.querySelector('button[aria-label^="Notificações,"]')),'TRIGGER_REMOUNTED')
    await keyboardOpen(page)
  }
  if(negative) {
    // Deliberately remove focus without a replacement. Same invariant must fail.
    await page.evaluate(()=>document.activeElement.blur())
    await assert.rejects(assertInside(page),/FOCUS_ESCAPED/)
    await keyboardClose(page);await keyboardOpen(page)
  }
  const trace=await page.evaluate(()=>window.focusTrace.events)
  await keyboardClose(page)
  return {semantics,negative,trace}
}

export async function rememberFocus(page) {
  await page.evaluate(()=>{window.qaFocusNode=document.activeElement;window.qaFocusTrigger=document.querySelector('button[aria-label^="Notificações,"]')})
}
export async function unchangedFocus(page) {
  assert(await page.evaluate(()=>document.activeElement===window.qaFocusNode&&window.qaFocusNode.isConnected),'UPDATE_STOLE_FOCUS')
  assert(await page.evaluate(()=>document.querySelector('button[aria-label^="Notificações,"]')===window.qaFocusTrigger),'UPDATE_REMOUNTED_TRIGGER')
  await assertInside(page)
}
