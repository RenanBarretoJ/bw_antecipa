#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Testa o parser de DANFE PDF contra uma pasta de arquivos.
 *
 * Uso:
 *   node scripts/test-pdf-parser.js NOTAS_VIDA_SAUDE
 *   node scripts/test-pdf-parser.js caminho/para/pasta
 *
 * Mostra para cada PDF:
 *   - quais campos foram extraídos com sucesso
 *   - quais falharam
 *   - o texto bruto extraído pelo pdf-parse (útil para criar novos padrões)
 *
 * Flags:
 *   --texto     mostra os primeiros 3000 chars do texto bruto de cada PDF
 *   --falhas    mostra apenas os PDFs com pelo menos um campo faltando
 */

const pdfParse = require('../node_modules/pdf-parse/lib/pdf-parse.js')
const fs = require('fs')
const path = require('path')

const CAMPOS_IMPORTANTES = [
  'numero_nf',
  'chave_acesso',
  'data_emissao',
  'data_vencimento',
  'cnpj_destinatario',
  'valor_bruto',
  'valor_liquido',
]

const args = process.argv.slice(2)
const pasta = args.find(a => !a.startsWith('--')) || 'NOTAS_VIDA_SAUDE'
const mostrarTexto = args.includes('--texto')
const apenasFlhas = args.includes('--falhas')

if (!fs.existsSync(pasta)) {
  console.error(`Pasta nao encontrada: ${pasta}`)
  process.exit(1)
}

// Reproduz a lógica do pdf-nf-parser sem depender do TypeScript compilado
function extractNumeroNF(text) {
  const patterns = [
    /NF-?e[\s\n]+N[°º]\.?\s*(\d[\d.]{0,11})/i,
    /^N[°º]\.?\s+(\d[\d.]{0,11})/im,
    /ELETR[ÔO]NICA\s+N[°º]\.?\s*(\d[\d.,]{0,11})/i,
    /N[°º]\s+DA\s+NOTA\s*[:\-]?\s*(\d[\d.]{0,11})/i,
    /NOTA\s+FISCAL\s+N[°º\.]+\s*(\d[\d.]{0,11})/i,
    /N\.[°º]\s*\n\s*S[ÉE]R[^\n]*\n\s*(\d+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/[.,]/g, '')
  }
  return null
}

function extractChave(text) {
  const m = text.match(/(\d[\d. ]{50,65}\d)/)
  if (m?.[1]) { const d = m[1].replace(/\D/g, ''); if (d.length === 44) return d }
  return text.match(/\b(\d{44})\b/)?.[1] ?? null
}

function parseBRDate(raw) {
  const [d, mo, y] = raw.split('/')
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
}

function extractDataEmissao(text) {
  const patterns = [
    /DATA\s+(?:DE\s+)?EMISS[ÃA]O\s*[:\-\/]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /EMISS[ÃA]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /DATA\s+DA\s+EMISS[ÃA]O[\s\S]{0,600}?(\d{2}\/\d{2}\/\d{4})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return parseBRDate(m[1])
  }
  return null
}

function extractVencimento(text) {
  for (const re of [
    /DATA\s+(?:DE\s+)?VENCIMENTO\s*[:\-\/]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /VENCIMENTO\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /PARCELAS\s+\d+\s+(\d{2}\/\d{2}\/\d{4})/i,
  ]) {
    const m = text.match(re)
    if (m?.[1]) return parseBRDate(m[1])
  }
  const dups = [...text.matchAll(/\b\d[\d\-\/]*\s+(\d{2}\/\d{2}\/\d{4})\s+[\d.,]+/g)]
  if (dups.length > 0) return parseBRDate(dups[dups.length - 1][1])
  const faturaIdx = text.search(/FATURA\s*[\/\s]*DUPLICATA/i)
  if (faturaIdx >= 0) {
    const bloco = text.substring(Math.max(0, faturaIdx - 200), faturaIdx + 400)
    const datas = [...bloco.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)]
    if (datas.length > 0) return parseBRDate(datas[datas.length - 1][1])
  }
  return null
}

function extractCnpj(text) {
  const re = /(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/g
  const destIdx = text.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i)
  if (destIdx >= 0) {
    const bloco = text.substring(destIdx, destIdx + 1500)
    for (const m of bloco.matchAll(re)) {
      const d = m[1].replace(/\D/g, '')
      if (d.length === 14) return d
    }
  }
  const unique = [...new Set([...text.matchAll(re)].map(m => m[1].replace(/\D/g, '')).filter(d => d.length === 14))]
  return unique.length >= 2 ? unique[1] : null
}

function parseBRL(raw) {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0
}

function extractValorBruto(text) {
  for (const re of [
    /V\.?\s*TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
  ]) {
    const m = text.match(re)
    if (m?.[1]) { const v = parseBRL(m[1]); if (v > 0) return v }
  }
  const mBloco = text.match(/\n([\d.]+,\d{2})\n0,00(?:0,00)+/)
  if (mBloco?.[1]) { const v = parseBRL(mBloco[1]); if (v > 0) return v }
  return null
}

function extractValorNota(text) {
  for (const re of [
    /V\.?\s*TOTAL\s+DA\s+NOTA\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+TOTAL\s+DA\s+NOTA\s*R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+DA\s+(?:NF|NOTA)\s*R?\$?\s*([\d.,]+)/i,
  ]) {
    const m = text.match(re)
    if (m?.[1]) { const v = parseBRL(m[1]); if (v > 0) return v }
  }
  const mConcat = text.match(/\n(0,00(?:[\d.,]+,\d{2})+)\s*(?:\n|$)/m)
  if (mConcat?.[1]) {
    const vals = [...mConcat[1].matchAll(/([\d.]+,\d{2})/g)]
    if (vals.length > 0) { const v = parseBRL(vals[vals.length - 1][1]); if (v > 0) return v }
  }
  return null
}

const arquivos = fs.readdirSync(pasta).filter(f => /\.(pdf|PDF)$/.test(f)).sort()
if (arquivos.length === 0) {
  console.error('Nenhum PDF encontrado em:', pasta)
  process.exit(1)
}

let totalOk = 0, totalFalhas = 0

;(async () => {
  for (const f of arquivos) {
    const buf = fs.readFileSync(path.join(pasta, f))
    let text = ''
    try {
      const r = await pdfParse(buf)
      text = (r.text || '').replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim()
    } catch (e) {
      console.log(`\n${f}: ERRO ao ler PDF — ${e.message}`)
      totalFalhas++
      continue
    }

    if (text.replace(/\s/g, '').length < 50) {
      console.log(`\n${f}: PDF escaneado (sem texto embedado) — extração não suportada`)
      totalFalhas++
      continue
    }

    const resultado = {
      numero_nf: extractNumeroNF(text),
      chave_acesso: extractChave(text),
      data_emissao: extractDataEmissao(text),
      data_vencimento: extractVencimento(text),
      cnpj_destinatario: extractCnpj(text),
      valor_bruto: extractValorBruto(text),
      valor_liquido: extractValorNota(text),
    }

    const falhas = CAMPOS_IMPORTANTES.filter(c => resultado[c] === null || resultado[c] === undefined)
    const ok = CAMPOS_IMPORTANTES.filter(c => resultado[c] !== null && resultado[c] !== undefined)

    if (apenasFlhas && falhas.length === 0) continue

    totalOk += ok.length
    totalFalhas += falhas.length

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Arquivo: ${f}`)
    console.log(`  OK (${ok.length}/${CAMPOS_IMPORTANTES.length}): ${ok.join(', ') || '—'}`)
    if (falhas.length > 0) {
      console.log(`  FALHOU: ${falhas.join(', ')}`)
    }
    for (const [campo, val] of Object.entries(resultado)) {
      if (val !== null && val !== undefined) {
        const exibido = String(val).length > 50 ? String(val).substring(0, 47) + '...' : val
        console.log(`    ${campo}: ${exibido}`)
      }
    }

    if (mostrarTexto) {
      console.log('\n  --- TEXTO BRUTO (primeiros 3000 chars) ---')
      console.log(text.substring(0, 3000))
    }
  }

  const totalCampos = arquivos.length * CAMPOS_IMPORTANTES.length
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Total: ${arquivos.length} PDFs | ${totalOk}/${totalCampos} campos extraídos (${Math.round(totalOk/totalCampos*100)}%)`)
  if (totalFalhas > 0) {
    console.log(`Falhas: ${totalFalhas} campos — rode com --texto para inspecionar o layout`)
  }
})()
