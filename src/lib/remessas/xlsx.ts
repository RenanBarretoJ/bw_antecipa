import JSZip from 'jszip'
import { chaveUnicaAtivo, chaveUnicaParcela, type EstrategiaAgrupamentoRemessa, type RemessaFormato, type RemessaLoteCanonico } from './domain'

function xml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function colunaExcel(index: number) {
  let atual = index + 1
  let resultado = ''
  while (atual > 0) {
    atual -= 1
    resultado = String.fromCharCode(65 + (atual % 26)) + resultado
    atual = Math.floor(atual / 26)
  }
  return resultado
}

function planilhaXml(linhas: string[][]) {
  const rows = linhas.map((linha, rowIndex) => {
    const cells = linha.map((valor, columnIndex) => `<c r="${colunaExcel(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(valor)}</t></is></c>`).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
}

export async function gerarExcelConferenciaRemessa(
  lote: RemessaLoteCanonico,
  formato: RemessaFormato,
  agrupamento: EstrategiaAgrupamentoRemessa,
) {
  const linhas: string[][] = [[
    'Cedente', 'CNPJ Cedente', 'Operacao', 'NF', 'Parcela', 'Vencimento',
    'Valor nominal', 'Valor presente', 'Chave ATIVO', 'Chave FLUXO', 'Formato', 'Agrupamento',
  ]]
  for (const operacao of lote.operacoes) {
    for (const nota of operacao.notas) {
      for (const parcela of nota.parcelasSelecionadas) {
        linhas.push([
          operacao.cedente.razaoSocial,
          operacao.cedente.cnpj.replace(/\D/g, ''),
          operacao.id,
          nota.numero,
          String(parcela.numero),
          parcela.vencimento,
          parcela.valorNominal.toFixed(2),
          parcela.valorPresente.toFixed(2),
          chaveUnicaAtivo(nota.id),
          chaveUnicaParcela(parcela.id),
          formato,
          agrupamento,
        ])
      }
    }
  }

  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Conferencia" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', planilhaXml(linhas))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
