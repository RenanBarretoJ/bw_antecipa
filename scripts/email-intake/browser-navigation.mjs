import assert from 'node:assert/strict'

/** Header values are consumed in memory; only closed classifications are retained. */
export function navigationMetadata(event, localId, previousRedirectCount = 0) {
  const headers = Object.fromEntries(Object.entries(event.request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    requestClass: headers['next-router-prefetch'] === '1' && headers.rsc === '1' ? 'PREFETCH'
      : headers.rsc === '1' ? 'NAVIGATION_RSC' : 'UNKNOWN',
    initiatorClass: ['parser', 'script', 'preload', 'preflight', 'SignedExchange', 'other'].includes(event.initiator?.type) ? event.initiator.type : 'unknown',
    frame: localId('frame', event.frameId), navigation: localId('navigation', event.loaderId),
    redirectCount: previousRedirectCount + (event.redirectResponse ? 1 : 0),
  }
}

export function staleDiscovered(entry, now, limitMs = 20000) {
  return entry.required && entry.state === 'DISCOVERED' && now - entry.discoveredAtMs >= limitMs
}

/** A replaced document is a regression for the cookie action's in-place update. */
export function assertFundSwitchReady({ cookieMatches, selectionMatches, routeMatches, headingReady, hardReloads, pending, stale }) {
  assert.equal(hardReloads, 0, 'FUND_SWITCH_DOUBLE_NAVIGATION')
  assert.ok(cookieMatches && selectionMatches, 'FUND_SWITCH_CONTEXT_MISMATCH')
  assert.ok(routeMatches && headingReady, 'FUND_SWITCH_DESTINATION_NOT_READY')
  assert.equal(pending, 0, 'FUND_SWITCH_REQUIRED_REQUEST_PENDING')
  assert.equal(stale, 0, 'FUND_SWITCH_STALE_DISCOVERED')
}

export async function waitCedenteFundSwitch(page, inspection, { linkId, pathname, hardReloads = () => 0 }) {
  await page.waitForFunction((id, path) => {
    const selector = document.querySelector('select[aria-label="Fundo operacional do cedente"]')
    return selector?.value === id && !selector.disabled && location.pathname === path
      && [...document.querySelectorAll('main h1, main h2')].some(heading => heading.textContent.trim())
  }, { timeout: 20000 }, linkId, pathname)
  await inspection.awaitDrain()
  const cookieMatches = (await page.browserContext().cookies()).some(cookie => cookie.name === 'bw_cedente_fundo_ativo_id' && cookie.value === linkId)
  const state = inspection.snapshot()
  assertFundSwitchReady({ cookieMatches, selectionMatches: true, routeMatches: true, headingReady: true,
    hardReloads: hardReloads(), pending: state.pending, stale: state.staleDiscovered })
}
