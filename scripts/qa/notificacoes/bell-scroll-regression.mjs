import assert from 'node:assert/strict'
import {openReady, triggerSelector} from './focus-probe.mjs'
import {keyboardClose, assertInside} from './focus-keyboard.mjs'

// Mirror PortalShell's viewport-height / internally scrolling main structure.
// Real bell + context; only transport and surrounding navigation are synthetic.
export const scrollShellFixture = `
function ScrollShell(){return <NotificacoesProvider userId='qa-user'>
  <div data-scroll-shell className='flex h-dvh min-h-0 overflow-hidden bg-background'>
    <aside data-scroll-sidebar className='fixed inset-y-0 left-0 z-50 flex h-dvh w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground -translate-x-full lg:sticky lg:top-0 lg:z-auto lg:w-64 lg:shrink-0 lg:translate-x-0'>
      <div className='p-6'>Antecipa QA</div><nav className='min-h-0 flex-1 overflow-y-auto px-3 py-4'>Dashboard</nav><footer className='p-4'>QA</footer>
    </aside>
    <div className='flex min-w-0 flex-1 flex-col'>
      <header className='sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 backdrop-blur-md sm:px-6'>
        <div className='ml-auto flex items-center gap-2 sm:gap-4'><NotificationBell userId='qa-user'/><button>Fundo QA</button></div>
      </header>
      <main className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-5 sm:pt-6 lg:pt-8'><div style={{height:2500,padding:30}}>Conteúdo sintético</div></main>
    </div>
  </div>
</NotificacoesProvider>}
`

async function layout(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector)
      const bounds = element.getBoundingClientRect()
      return {top:bounds.top, bottom:bounds.bottom, scrollTop:element.scrollTop}
    }
    return {
      height:document.documentElement.scrollHeight,
      width:document.documentElement.scrollWidth,
      viewportHeight:innerHeight, viewportWidth:innerWidth, windowY:scrollY,
      shell:rect('[data-scroll-shell]'), sidebar:rect('[data-scroll-sidebar]'), main:rect('main'),
    }
  })
}

function assertStable(before, after) {
  assert.equal(after.height, before.height, 'BELL_DOCUMENT_SCROLL_GREW')
  assert(after.height <= after.viewportHeight, 'BELL_EXTRA_VERTICAL_SCROLL')
  assert(after.width <= after.viewportWidth, 'BELL_EXTRA_HORIZONTAL_SCROLL')
  assert.equal(after.windowY, before.windowY, 'BELL_MOVED_DOCUMENT')
  assert.deepEqual(after.shell, before.shell, 'BELL_MOVED_SHELL')
  assert.deepEqual(after.sidebar, before.sidebar, 'BELL_MOVED_SIDEBAR')
  assert.deepEqual(after.main, before.main, 'BELL_MOVED_MAIN')
}

export async function bellScrollRegression(page, base) {
  const results = []
  for (const width of [390,1366,1920]) for (const count of [0,10]) for (const method of ['click','keyboard']) {
    await page.setViewport({width,height:768})
    await page.goto(`${base}/?role=gestor&layout=scroll-shell`, {waitUntil:'domcontentloaded'})
    await page.waitForFunction(() => document.querySelector('header button[aria-label^="Notificações,"]') && window.qa.requests.length > 0)
    await page.evaluate(count => {
      window.qa.rows = Array.from({length:count}, (_,i) => ({
        ...window.qa.row('A'+i,'A','nf_aprovada'),
        mensagem:'Notificação sintética para testar a rolagem sem dados reais. '.repeat(4),
      }))
      window.qa.refresh()
      document.querySelector('main').scrollTop = 350
    }, count)
    await page.waitForFunction(count => document.querySelector('header button[aria-label^="Notificações,"]')?.getAttribute('aria-label') === `Notificações, ${count} não lidas no contexto atual`, {}, count)
    const before = await layout(page)
    assert.equal(before.main.scrollTop,350,'FIXTURE_MAIN_NOT_SCROLLABLE')
    if (method === 'click') await page.click(triggerSelector)
    else {await page.focus(triggerSelector);await page.keyboard.press('Enter')}
    await openReady(page)
    await page.waitForFunction(count => document.querySelectorAll('[role="dialog"] article').length === count && document.querySelector('[role="dialog"] [aria-busy]')?.getAttribute('aria-busy') === 'false', {}, count)
    const opened = await layout(page)
    assertStable(before, opened)
    const popup = await page.$eval('[role="dialog"]', element => {
      const bounds = element.getBoundingClientRect()
      return {top:bounds.top, bottom:bounds.bottom, left:bounds.left, right:bounds.right, height:element.clientHeight, contentHeight:element.scrollHeight}
    })
    assert(popup.top >= 0 && popup.bottom <= 768 && popup.left >= 0 && popup.right <= width, 'BELL_OUTSIDE_VIEWPORT')
    if (count) {
      assert(popup.contentHeight > popup.height, 'FIXTURE_MUST_OVERFLOW_POPUP')
      // Real wheel input must scroll the panel without moving the shell/main.
      await page.mouse.move((popup.left+popup.right)/2, (popup.top+popup.bottom)/2)
      await page.mouse.wheel({deltaY:450})
      await page.waitForFunction(() => document.querySelector('[role="dialog"]').scrollTop > 0)
      assertStable(before, await layout(page))
    }
    // Exercise focus guards through the whole overflowing list, both directions.
    const focusables = await page.$$eval('[role="dialog"] button,[role="dialog"] a[href]', elements => elements.length)
    for (const backwards of [false,true]) {
      if (backwards) await page.keyboard.down('Shift')
      for (let i=0;i<focusables+2;i++) {
        await page.keyboard.press('Tab')
        await page.waitForFunction(() => !document.activeElement?.hasAttribute('data-base-ui-focus-guard'))
        await assertInside(page)
        assertStable(before, await layout(page))
      }
      if (backwards) await page.keyboard.up('Shift')
    }
    await keyboardClose(page)
    assertStable(before, await layout(page))
    results.push({width,count,method,before,opened,popup,pass:true})
  }
  return results
}
