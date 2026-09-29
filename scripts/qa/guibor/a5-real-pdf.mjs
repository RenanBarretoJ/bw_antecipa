// Reuse the certified A3/A4 review flow as an A5 input; do not change its parser.
import assert from 'node:assert/strict'

export async function importRealPdfB({ page, base, admin, cedenteId, report, save }) {
  const response=await page.goto(`${base}/cedente/notas-fiscais`,{waitUntil:'networkidle2',timeout:60000})
  assert(response.ok())
  await page.waitForSelector('input[type=file]',{timeout:30000})
  await (await page.$('input[type=file]')).uploadFile('C:/Users/BrenoAlvim/Downloads/NFSe Guibor/232- HOSPITAL VIDA.pdf')
  const submit=()=>page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enviar 1 arquivo')).click())
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Enviar 1 arquivo')))
  await submit()
  // One extraction attempt only; no retries to the visual provider.
  await page.waitForSelector('#nfse-due-0',{timeout:100000})
  const text=await page.evaluate(()=>document.body.innerText)
  assert(text.includes('112.710,81') && text.includes('105.779,10'),'REAL_B_EXTRACTION_AMOUNTS')
  assert.equal(await page.$eval('#nfse-due-0',e=>e.value),'')
  const due=new Date();due.setUTCDate(due.getUTCDate()+45)
  const dueValue=due.toISOString().slice(0,10)
  await page.$eval('#nfse-due-0',(e,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value)
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))
  },dueValue)
  await submit()
  await page.waitForFunction(()=>/notas-fiscais\/[0-9a-f-]{36}/.test(location.pathname)||/1 de 1 arquivo/.test(document.body.innerText),{timeout:100000})
  const result=await admin.from('notas_fiscais').select('id,valor_bruto,valor_liquido,valor_liquido_origem,data_vencimento,fiscal_proveniencia').eq('cedente_id',cedenteId).eq('numero_nf','232').single()
  assert(!result.error,'REAL_B_PERSISTENCE')
  const note=result.data
  report.realPdfNote=note.id;save()
  assert.equal(Number(note.valor_bruto),112710.81);assert.equal(Number(note.valor_liquido),105779.10)
  assert.equal(note.valor_liquido_origem,'DOCUMENTO_EXPLICITO');assert.equal(note.data_vencimento,dueValue)
  assert.equal(note.fiscal_proveniencia.strategy,'danfse_v2_visual')
  report.realPdfFiscal={gross:112710.81,net:105779.10,origin:'DOCUMENTO_EXPLICITO',strategy:'danfse_v2_visual',due:dueValue};save()
  return note.id
}
