import assert from 'node:assert/strict'

const rowSelector = 'ul[aria-label="Mensagens recebidas"] > li > a'

/** Real rendered dimensions and native link keyboard behavior, in authenticated QA. */
export async function inspectInboxRows(page, width) {
  const rows = await page.$$eval(rowSelector, links => links.map(link => {
    const subject = link.querySelector('span.truncate.font-medium[title]')
    const style = subject && getComputedStyle(subject)
    return { height: link.getBoundingClientRect().height, singleLine: style?.whiteSpace === 'nowrap',
      ellipsis: style?.textOverflow === 'ellipsis', subjectTitle: Boolean(subject?.title),
      accessible: Boolean(link.getAttribute('aria-label')), chips: link.querySelectorAll('span.text-\\[10px\\]').length }
  }))
  if (!rows.length) return
  for (const row of rows) {
    assert(row.singleLine && row.ellipsis && row.subjectTitle, 'INBOX_SUBJECT_TRUNCATION_AND_TITLE')
    assert(row.accessible, 'INBOX_ACCESSIBLE_ROW_LINK')
    assert(row.height <= (width >= 1024 ? 72 : 154), `INBOX_ROW_DENSITY:${width}:${row.height}`)
  }
  assert(rows.some(row => row.chips), 'INBOX_ATTACHMENT_TYPE_CHIPS')
}

export async function verifyInboxKeyboard({ page, navigate, waitMessage }) {
  const first = await page.$(rowSelector)
  assert(first, 'INBOX_FIRST_ROW')
  const original = page.url()
  const href = await first.evaluate(link => link.href)
  await first.focus()
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), rowSelector), true, 'INBOX_SHIFT_TAB_AND_TAB')
  const focus = await page.evaluate(() => ({ visible: document.activeElement.matches(':focus-visible'), outline: Number.parseFloat(getComputedStyle(document.activeElement).outlineWidth) }))
  assert(focus.visible && focus.outline >= 2, 'INBOX_VISIBLE_FOCUS_RING')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(selector => document.activeElement === document.querySelectorAll(selector)[1], rowSelector), true, 'INBOX_PREDICTABLE_TAB_ORDER')
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  await page.keyboard.press('Space')
  assert.equal(page.url(), original, 'INBOX_SPACE_PRESERVES_NATIVE_LINK_SEMANTICS')
  await navigate(() => page.keyboard.press('Enter'))
  await page.waitForFunction(expected => location.href === expected, { timeout: 30000 }, href)
  await waitMessage()
  await navigate(() => page.goto(original, { waitUntil: 'domcontentloaded' }))
  await first.dispose()
  return ['INBOX_TAB_SHIFT_TAB_ORDER', 'INBOX_ENTER_OPENS_MESSAGE', 'INBOX_SPACE_NATIVE_LINK', 'INBOX_VISIBLE_FOCUS_RING']
}
