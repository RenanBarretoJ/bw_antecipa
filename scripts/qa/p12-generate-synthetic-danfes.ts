/** Local-only P12 UI fixtures. No real customer document is read or copied. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { extractDanfeFromPdf, validarDanfeParaPersistencia } from '@/lib/pdf-nf-parser'
import { validarXmlNfeParaUploadCedente } from '@/lib/notas-fiscais/emitente-autorizado'

const cnpj = process.argv.find((arg) => arg.startsWith('--cnpj='))?.slice('--cnpj='.length).replace(/\D/g, '') ?? ''
if (!/^\d{14}$/.test(cnpj)) throw new Error('Informe --cnpj=14_DIGITOS do Cedente QA autorizado em homologacao.')
const numberOffset = Number(process.argv.find((arg) => arg.startsWith('--number-offset='))?.slice('--number-offset='.length) ?? 0)
if (!Number.isInteger(numberOffset) || numberOffset < 0 || numberOffset > 1000) throw new Error('Use --number-offset=0..1000 para uma rodada QA distinta.')

function accessKey(numero: number, serie: number): string {
  const body = `292609${cnpj}55${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}112345678`
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(body[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return body + (remainder < 2 ? 0 : 11 - remainder)
}

const formatCnpj = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
const destinatario = '11.222.333/0001-81'
async function makePdf(lines: string[], browser: Browser): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    await page.setContent(`<html><head><meta charset="utf-8"><style>body{font:14px Arial;padding:28px}pre{white-space:pre-wrap;line-height:1.5}</style></head><body><pre>${lines.join('\n')}</pre></body></html>`)
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }))
  } finally {
    await page.close()
  }
}
const cases = [
  { name: 'MK-like', numero: 990154801 + numberOffset, serie: 1, total: 97792.26, pt: '97.792,26', dot: '97792.26', layout: 'canhoto_total' },
  { name: 'BAHIAMED-like-154806', numero: 990154806 + numberOffset, serie: 2, total: 8371.99, pt: '8.371,99', dot: '8371.99', layout: 'fiscal_grid_after_labels' },
  { name: 'BAHIAMED-like-154810', numero: 990154810 + numberOffset, serie: 2, total: 12388.10, pt: '12.388,10', dot: '12388.10', layout: 'fiscal_grid_after_labels' },
  { name: 'ambiguous-blocked', numero: 990154811 + numberOffset, serie: 2, total: 8371.99, pt: '8.371,99', dot: '8372.99', layout: 'generic_danfe' },
] as const

async function main() {
const directory = mkdtempSync(join(tmpdir(), 'bw-p12-qa-'))
process.stdout.write(`Fixture directory: ${directory}\n`)
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  for (const item of cases) {
    const lines = [
      'DANFE - DOCUMENTO SINTETICO PARA QA EM HOMOLOGACAO',
      'IDENTIFICACAO DO EMITENTE',
      `CEDENTE QA ${formatCnpj}`,
      'CHAVE DE ACESSO', accessKey(item.numero, item.serie),
      `NF-e N° ${item.numero}`,
      `SERIE ${item.serie}`,
      'DESTINATARIO/REMETENTE',
      `SACADO SINTETICO ${destinatario}`,
      'DATA DA EMISSAO 18/09/2026',
    ]
    if (item.name === 'MK-like') lines.push(
      'VALOR TOTAL DA NOTA', '0,0097.792,260,000,000,000,00',
      `SALVADOR - EMISSAO: 18-09-2026 - VALOR TOTAL: R$ ${item.pt}`,
      'VENCIMENTO 31/10/2026',
    )
    else if (item.name === 'ambiguous-blocked') lines.push(
      `VALOR TOTAL DA NOTA R$ ${item.pt}`,
      `${item.numero}-01/01 31/10/2026 ${item.dot} |`,
    )
    else lines.push(
      `${item.numero}-01/01 31/10/2026 ${item.dot} |`,
      'FATURA / DUPLICATA',
      'CALCULO DO IMPOSTO',
      'BASE DE CALCULO DO ICMS VALOR DO ICMS BASE DE CALCULO DO ICMS ST VALOR DO ICMS ST VALOR TOTAL DOS PRODUTOS',
      'VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSORIAS VALOR DO IPI VALOR TOTAL DA NOTA',
      'TRANSPORTADOR / VOLUMES TRANSPORTADOS',
      item.name.includes('154810') ? '200,00' : '0,00',
      item.name.includes('154810') ? '41,00' : '0,00',
      '0,00', '0,00', item.pt,
      `0,000,000,000,00${item.pt}`,
    )
    const pdf = await makePdf(lines, browser)
    const path = join(directory, `QA_P12_${item.name}${numberOffset ? `-r${numberOffset}` : ''}.pdf`)
    writeFileSync(path, pdf)
    const parsed = await extractDanfeFromPdf(pdf)
    const gate = validarDanfeParaPersistencia(parsed)
    const shouldPass = item.name !== 'ambiguous-blocked'
    if (gate.ok !== shouldPass || parsed.numero_nf !== String(item.numero) || parsed.valor_bruto !== item.total) {
      throw new Error(`${item.name}: fixture nao validada: ${JSON.stringify({ gate, numero: parsed.numero_nf, total: parsed.valor_bruto, reasons: parsed.motivos_bloqueio })}`)
    }
    process.stdout.write(`${item.name}: ${path} | expected=${item.total} | gate=${gate.ok}\n`)
  }
  const numero = 990154812 + numberOffset
  const key = accessKey(numero, 2)
  const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><nNF>${numero}</nNF><serie>2</serie><dhEmi>2026-09-18T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ><xNome>CEDENTE QA</xNome></emit><dest><CNPJ>11222333000181</CNPJ><xNome>SACADO SINTETICO</xNome></dest><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-10-31</dVenc><vDup>100.00</vDup></dup></cobr></infNFe></NFe></nfeProc>`
  const xmlValidation = validarXmlNfeParaUploadCedente({ xmlContent: xml, cnpjCedente: cnpj, permitirEstabelecimentoDoCedente: true })
  if (!xmlValidation.ok) throw new Error(`XML QA invalido: ${xmlValidation.message}`)
  const xmlPath = join(directory, `QA_P12_XML-regression${numberOffset ? `-r${numberOffset}` : ''}.xml`)
  writeFileSync(xmlPath, xml, 'utf8')
  process.stdout.write(`XML-regression: ${xmlPath}\n`)
} finally {
  await browser.close()
}
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
