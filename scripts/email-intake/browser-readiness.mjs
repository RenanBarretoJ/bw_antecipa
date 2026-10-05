/** Readiness of the rendered task, including a terminal empty result. Each stage fails separately. */
export async function waitFiscalDetail(page, noteId) {
  await page.waitForFunction(id => location.pathname === `/cedente/notas-fiscais/${id}`
    && [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Visualizar' && !button.disabled),
  { timeout: 20000 }, noteId)
}

export async function waitEmailDestination(page, diagnostics) {
  const params = new URL(page.url()).searchParams
  const screen = params.has('message') ? 'message' : params.has('integration') && !params.has('edit') ? 'detail'
    : ['inbox', 'review'].includes(params.get('tab')) ? params.get('tab') : 'integrations'
  await waitEmailScreen(page, diagnostics, screen)
}

export async function waitEmailScreen(page, diagnostics, screen, expectedHeading = null) {
  const step = async (name, run) => { await diagnostics.phase(`${screen}:${name}`); await run() }
  await step('SHELL', () => page.waitForSelector('main nav[aria-label="Operação de e-mail"]', { visible: true, timeout: 15000 }))
  await step('HEADING', () => page.waitForFunction((kind, expected) => {
    const label = kind === 'inbox' ? 'Importações por e-mail' : kind === 'review' ? 'Pendências de revisão' : expected
    return [...document.querySelectorAll('main h2')].some(h => label ? h.textContent.trim() === label : h.textContent.trim().length > 0)
  }, { timeout: 15000 }, screen, expectedHeading))
  if (screen === 'inbox' || screen === 'review') {
    const label = screen === 'inbox' ? 'Importações por e-mail' : 'Pendências de revisão'
    await step('RESULT_CONTAINER', () => page.waitForSelector(`section[aria-label="${label}"] nav[aria-label="Páginas da inbox"]`, { timeout: 15000 }))
    await step('FILTERS_ENABLED', () => page.waitForFunction(name => {
      const section = document.querySelector(`section[aria-label="${name}"]`)
      return section && !section.querySelector('[aria-busy="true"], [role="progressbar"]')
        && [...section.querySelectorAll('form input, form select, form button')].every(control => !control.disabled)
    }, { timeout: 15000 }, label))
    await step('TERMINAL_RESULT', () => page.waitForFunction(name => {
      const section = document.querySelector(`section[aria-label="${name}"]`)
      return section && (section.querySelector('article') || [...section.querySelectorAll('p')].some(p =>
        ['Nenhuma mensagem encontrada nestes filtros.', 'Não há documentos aguardando revisão nestes filtros.'].includes(p.textContent.trim())))
    }, { timeout: 15000 }, label))
  } else if (screen === 'detail') {
    await step('ACTIONS_READY', () => page.waitForSelector('section[aria-label="Ações da integração"]', { visible: true, timeout: 15000 }))
  } else if (screen === 'message') {
    await step('ATTACHMENTS_READY', () => page.waitForSelector('nav[aria-label="Páginas de anexos"]', { timeout: 15000 }))
  }
}
