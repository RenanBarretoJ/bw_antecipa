import { createClient } from '@supabase/supabase-js'

// Código do originador FIDC DLZ — fixo
const CODIGO_ORIGINADOR = '00000000000000500497'
const NUM_BANCO = '001'
const NOME_BANCO = 'BANCO DO BRASIL SA'
const ESPECIE_TITULO = '61'

// ——— Utilitários de formatação ———

function sanitize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,-/]/g, ' ')
    .toUpperCase()
}

// Alfa: left-justified, space-padded à direita
function alfa(value: string, len: number): string {
  const s = sanitize(value ?? '').slice(0, len)
  return s.padEnd(len, ' ')
}

// Numérico inteiro: right-justified, zero-padded à esquerda (seguro para N ≤ 15 dígitos)
function num(value: number | string, len: number): string {
  return String(Math.round(Number(value) || 0))
    .padStart(len, '0')
    .slice(-len)
}

// Valor monetário → centavos, N dígitos
function toCents(valor: number | null | undefined, len = 13): string {
  return num(Math.round((valor || 0) * 100), len)
}

// Data ISO → DDMMAA
function toDDMMYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '000000'
  const d = new Date(dateStr)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

// Data ISO → YYYYMMDD
function toYYYYMMDD(dateStr: string | null | undefined): string {
  if (!dateStr) return '00000000'
  const d = new Date(dateStr)
  const yyyy = String(d.getUTCFullYear())
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

// Apenas dígitos
function digitsOnly(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '')
}

// Chave NFe: 44 dígitos, right-justified com zeros (não usa num() para evitar perda de precisão)
function chaveNfePad(chave: string | null | undefined): string {
  const d = digitsOnly(chave)
  return d.padStart(44, '0').slice(-44)
}

// Monta registro de exatamente 444 chars a partir de campos posicionais (1-based)
function buildRecord(fields: Array<[number, string]>): string {
  const buf = new Array(444).fill(' ')
  for (const [pos1, value] of fields) {
    for (let i = 0; i < value.length; i++) {
      buf[pos1 - 1 + i] = value[i]
    }
  }
  return buf.join('')
}

// ——— HEADER (tipo 0) — Layout H ———
// pos  1:      identificacao_registro = '0'
// pos  2:      identificacao_arquivo  = '1'
// pos  3-9:    literal_remessa        = 'REMESSA' (7 alfa)
// pos 10-11:   codigo_servico         = '01' (2 num)
// pos 12-26:   literal_servico        = 'COBRANCA       ' (15 alfa)
// pos 27-46:   codigo_originador      = '00000000000000500497' (20 num)
// pos 47-76:   nome_originador        = cedente.razao_social (30 alfa)
// pos 77-79:   num_banco              = '001' (3 num)
// pos 80-94:   nome_banco             = 'BANCO DO BRASIL SA ' (15 alfa)
// pos 95-100:  data_gravacao          = DDMMAA (6 num)
// pos 101-108: branco                 (8 alfa)
// pos 109-110: identificacao_sistema  = 'MX' (2 alfa)
// pos 111-117: sequencial_arquivo     = '0000001' (7 num)
// pos 118-438: branco                 (321 alfa)
// pos 439-444: seq_registro           = '000001' (6 num)

function montarHeader(cedente: Record<string, unknown>, dataGravacao: string): string {
  return buildRecord([
    [1,   '0'],
    [2,   '1'],
    [3,   alfa('REMESSA', 7)],
    [10,  '01'],
    [12,  alfa('COBRANCA', 15)],
    [27,  CODIGO_ORIGINADOR],
    [47,  alfa(cedente.razao_social as string, 30)],
    [77,  NUM_BANCO],
    [80,  alfa(NOME_BANCO, 15)],
    [95,  dataGravacao],
    // 101-108: brancos (default)
    [109, 'MX'],
    [111, num(1, 7)],
    // 118-438: brancos (default)
    [439, num(1, 6)],
  ])
}

// ——— DETALHE (tipo 1) — Layout D ———
// pos  1:      identificacao_registro  = '1'
// pos  2-20:   debito_automatico       = '         0000000000' (19 alfa: 9 espaços + 10 zeros)
// pos 21-22:   coobrigacao             = '00' (2 num)
// pos 23-24:   caracteristica_especial = '00' (2 num)
// pos 25-28:   modalidade_operacao     = '0000' (4 num)
// pos 29-30:   natureza_operacao       = '00' (2 num)
// pos 31-34:   origem_recurso          = '0000' (4 num)
// pos 35-36:   classe_risco            = '  ' (2 alfa)
// pos 37:      zeros_37                = '0'
// pos 38-62:   seu_numero              = numero_nf (25 alfa)
// pos 63-65:   numero_banco            = '000' (3 num)
// pos 66-70:   zeros                   = '00000' (5 num)
// pos 71-81:   id_titulo_banco         = zeros (11 num)
// pos 82:      dv_nosso_numero         = '1' (1 alfa)
// pos 83-92:   valor_pago              = '0000000000' (10 num)
// pos 93:      condicao_papeleta       = '1'
// pos 94:      emite_papeleta_deb_auto = 'N'
// pos 95-100:  data_liquidacao         = '000000' (6 num)
// pos 101-104: id_operacao_banco       = '    ' (4 alfa)
// pos 105:     indicador_rateio        = ' ' (1 alfa)
// pos 106:     ender_aviso_deb_auto    = '0' (1 num)
// pos 107-108: branco                  (2 alfa)
// pos 109-110: ocorrencia              = '01' (2 num)
// pos 111-120: documento               = nr_nf (10 alfa, last 10 chars)
// pos 121-126: vencimento              = DDMMAA (6 num)
// pos 127-139: valor_titulo            = centavos (13 num)
// pos 140-142: banco_cobranca          = '000' (3 num)
// pos 143-147: agencia_depositaria     = '00000' (5 num)
// pos 148-149: especie_titulo          = '61' (2 num)
// pos 150:     identificacao_150       = ' ' (1 alfa)
// pos 151-156: emissao                 = DDMMAA (6 num)
// pos 157-158: instrucao1              = '00' (2 num)
// pos 159:     instrucao2              = '0' (1 num)
// pos 160-161: tipo_pessoa_cedente     = '02' (2 alfa)
// pos 162-173: zeros_162_173           = '000000000000' (12 alfa zeros)
// pos 174-192: termo_cessao            = op_id (19 alfa)
// pos 193-205: valor_presente_parcela  = centavos (13 num)
// pos 206-218: valor_abatimento        = '0000000000000' (13 num)
// pos 219-220: tipo_insc_sacado        = '02' (2 num)
// pos 221-234: num_insc_sacado         = CNPJ sacado (14 num)
// pos 235-274: nome_sacado             = razao_social_destinatario (40 alfa)
// pos 275-314: endereco_sacado         = ' ' (40 alfa)
// pos 315-323: nr_nota_fiscal          = numero_nf (9 alfa)
// pos 324-326: serie_nota_fiscal       = '   ' (3 alfa)
// pos 327-334: cep_sacado              = '00000000' (8 num)
// pos 335-380: nome_cedente            = razao_social (46 alfa)
// pos 381-394: num_insc_cedente        = CNPJ cedente (14 num)
// pos 395-438: chave_nfe               = chave_acesso (44 num, right-padded zeros)
// pos 439-444: seq_registro            = seq (6 num)

function montarDetalhe(
  cedente: Record<string, unknown>,
  nf: Record<string, unknown>,
  operacao: Record<string, unknown>,
  seq: number
): string {
  const cnpjCedente = digitsOnly(cedente.cnpj as string)
  const nfNumeroRaw = String(nf.numero_nf || '')
  const vencimento = toDDMMYY(nf.data_vencimento as string)

  // seu_numero: identificador único 25 chars
  // = 3 letras cedente (sem espaços) + 3 primeiros dígitos CNPJ + 3 últimos dígitos NF
  //   + data cessão YYYYMMDD + 3 últimos dígitos CNPJ + "-1"
  const nomeLetras = sanitize(cedente.razao_social as string)
    .replace(/ /g, '')
    .slice(0, 3)
    .padEnd(3, 'X')
  const cnpjPrimeiros3 = cnpjCedente.slice(0, 3).padEnd(3, '0')
  const cnpjUltimos3 = cnpjCedente.slice(-3).padStart(3, '0')
  const nfUltimos3 = digitsOnly(nfNumeroRaw).slice(-3).padStart(3, '0')
  const dataCessao = toYYYYMMDD((operacao.aprovado_em as string) || (operacao.created_at as string))
  const seuNumero = alfa(`${nomeLetras}${cnpjPrimeiros3}${nfUltimos3}${dataCessao}${cnpjUltimos3}-1`, 25)

  // documento: last 10 chars of NF number, alfa
  const documento = alfa(nfNumeroRaw.slice(-10), 10)

  // nr_nota_fiscal: last 9 chars, alfa
  const nrNota = alfa(nfNumeroRaw.slice(-9), 9)

  // termo_cessao: op id sem hífens, 19 chars
  const termoCessao = alfa((operacao.id as string).replace(/-/g, '').slice(0, 19), 19)

  return buildRecord([
    [1,   '1'],
    [2,   '         0000000000'],          // debito_automatico (19 chars: 9 espaços + 10 zeros)
    [21,  num(0, 2)],                       // coobrigacao
    [23,  num(0, 2)],                       // caracteristica_especial
    [25,  num(0, 4)],                       // modalidade_operacao
    [29,  num(0, 2)],                       // natureza_operacao
    [31,  num(0, 4)],                       // origem_recurso
    [35,  '  '],                            // classe_risco (2 alfa, spaces)
    [37,  '0'],                             // zeros_37
    [38,  seuNumero],                       // seu_numero (25 alfa)
    [63,  num(0, 3)],                       // numero_banco = 000
    [66,  '00000'],                         // zeros (5)
    [71,  num(0, 11)],                      // id_titulo_banco
    [82,  '1'],                             // dv_nosso_numero
    [83,  num(0, 10)],                      // valor_pago = 0
    [93,  '1'],                             // condicao_papeleta
    [94,  'N'],                             // emite_papeleta_deb_auto
    [95,  '000000'],                        // data_liquidacao
    // 101-104: id_operacao_banco (spaces)
    [105, ' '],                             // indicador_rateio
    [106, '0'],                             // ender_aviso_deb_auto
    // 107-108: branco
    [109, '01'],                            // ocorrencia
    [111, documento],                       // documento (10 alfa)
    [121, vencimento],                      // vencimento DDMMAA
    [127, toCents(nf.valor_bruto as number, 13)], // valor_titulo
    [140, num(0, 3)],                       // banco_cobranca
    [143, num(0, 5)],                       // agencia_depositaria
    [148, ESPECIE_TITULO],                  // especie_titulo
    [150, ' '],                             // identificacao_150 (space, não 'A')
    [151, toDDMMYY(nf.data_emissao as string)], // emissao
    [157, '00'],                            // instrucao1
    [159, '0'],                             // instrucao2
    [160, '02'],                            // tipo_pessoa_cedente
    [162, '000000000000'],                  // zeros_162_173 (12 zeros, NÃO CNPJ)
    [174, termoCessao],                     // termo_cessao (19 alfa)
    [193, toCents((nf.valor_antecipado as number) || (nf.valor_liquido as number), 13)],
    [206, num(0, 13)],                      // valor_abatimento = 0
    [219, '02'],                            // tipo_insc_sacado
    [221, num(digitsOnly(nf.cnpj_destinatario as string), 14)],
    [235, alfa((nf.razao_social_destinatario as string) || '', 40)],
    // 275-314: endereco_sacado (spaces)
    [315, nrNota],                          // nr_nota_fiscal (9 alfa)
    // 324-326: serie_nota_fiscal (spaces)
    [327, num(0, 8)],                       // cep_sacado = 00000000
    [335, alfa(cedente.razao_social as string, 46)],
    [381, num(cnpjCedente, 14)],            // num_insc_cedente
    [395, chaveNfePad(nf.chave_acesso as string)], // chave_nfe (44, right-padded)
    [439, num(seq, 6)],                     // seq_registro
  ])
}

// ——— TRAILER (tipo 9) — Layout T ———
// pos  1:      identificacao_registro  = '9'
// pos  2-438:  branco                  (437 alfa)
// pos 439-444: seq_ultimo_registro     = seq total (6 num)

function montarTrailer(totalLinhas: number): string {
  return buildRecord([
    [1,   '9'],
    // 2-438: brancos (default)
    [439, num(totalLinhas, 6)],
  ])
}

// ——— Exportação principal ———

export async function gerarCnab444(operacaoId: string): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: operacao, error: erroOp } = await supabase
    .from('operacoes')
    .select('*')
    .eq('id', operacaoId)
    .single()

  if (erroOp || !operacao) throw new Error('Operacao nao encontrada')
  const op = operacao as Record<string, unknown>

  const { data: cedente, error: erroCed } = await supabase
    .from('cedentes')
    .select('*')
    .eq('id', op.cedente_id as string)
    .single()

  if (erroCed || !cedente) throw new Error('Cedente nao encontrado')
  const ced = cedente as Record<string, unknown>

  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  const nfIds = ((opNfs || []) as Array<{ nota_fiscal_id: string }>).map(n => n.nota_fiscal_id)

  let notas: Array<Record<string, unknown>> = []
  if (nfIds.length > 0) {
    const { data: nfsData } = await supabase
      .from('notas_fiscais')
      .select('*')
      .in('id', nfIds)
    notas = (nfsData || []) as Array<Record<string, unknown>>
  }

  if (notas.length === 0) throw new Error('Nenhuma nota fiscal encontrada para esta operacao')

  const dataGravacao = toDDMMYY(new Date().toISOString())

  const linhas: string[] = []
  linhas.push(montarHeader(ced, dataGravacao))

  notas.forEach((nf, idx) => {
    linhas.push(montarDetalhe(ced, nf, op, idx + 2))
  })

  const totalLinhas = linhas.length + 1 // +1 para o trailer
  linhas.push(montarTrailer(totalLinhas))

  return linhas.join('\r\n')
}
