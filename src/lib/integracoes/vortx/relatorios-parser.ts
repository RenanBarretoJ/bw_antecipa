import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { normalizeDate, normalizeDecimal } from '@/lib/financeiro/ingestao/parser'
import { CODIGO_CARTEIRA_PATTERN } from '@/lib/integracoes/configuracao-vortx-vrs'
import { LAYOUTS_CSV_VORTX, normalizarStatusEntradaVortx, TIPOS_CSV_VORTX, type TipoCsvVortx } from './relatorios-layout'

const contextoSchema = z.object({
  fundoId: z.uuid(),
  ambiente: z.enum(['homologacao', 'producao']),
  codigoCarteira: z.string().regex(CODIGO_CARTEIRA_PATTERN),
  dataReferencia: z.iso.date(),
  dataInicio: z.iso.date(),
  dataFim: z.iso.date(),
}).strict().refine((value) => value.dataInicio <= value.dataFim)
export type ContextoRelatorioVortx = z.output<typeof contextoSchema>
export type LinhaRelatorioVortx = {
  numeroLinha: number
  status: 'VALIDA' | 'INVALIDA'
  dadosBrutos: Record<string, string>
  dadosNormalizados: Record<string, string>
  erros: string[]
  avisos: string[]
}
export type RelatorioVortxProcessado = {
  tipoRelatorio: TipoCsvVortx
  contexto: ContextoRelatorioVortx
  versaoLayout: 'VORTX_RELATORIOS_CSV_V1'
  hashArquivo: string
  encoding: 'utf-8'
  linhas: LinhaRelatorioVortx[]
  completo: boolean
}

export class RelatorioVortxError extends Error {
  constructor(readonly codigo: string, message: string) {
    super(message)
    this.name = 'RelatorioVortxError'
  }
}

function identidade(contexto: ContextoRelatorioVortx, dados: Record<string, string>, parcela: boolean): string {
  const partes = ['VORTX_RECEBIVEL_V1', contexto.fundoId, contexto.ambiente, contexto.codigoCarteira,
    dados.cedente_documento, dados.chave_ativo, ...(parcela ? [dados.chave_parcela] : [])]
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex')
}

/** Parser puro: contexto validado em formato, nao autorizado; sem banco/HTTP. */
export function processarCsvRelatorioVortx(input: {
  arquivo: Uint8Array
  tipoRelatorio: TipoCsvVortx
  contexto: ContextoRelatorioVortx
}): RelatorioVortxProcessado {
  const contexto = contextoSchema.safeParse(input.contexto)
  if (!contexto.success || !z.enum(TIPOS_CSV_VORTX).safeParse(input.tipoRelatorio).success) {
    throw new RelatorioVortxError('CONTEXTO_INVALIDO', 'Contexto do relatorio Vortx invalido.')
  }
  if (!(input.arquivo instanceof Uint8Array) || !input.arquivo.byteLength || input.arquivo.byteLength > 20 * 1024 * 1024) {
    throw new RelatorioVortxError('TAMANHO_INVALIDO', 'O CSV Vortx deve possuir ate 20 MiB.')
  }
  let records: string[][]
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input.arquivo)
    records = parse(text, { bom: true, delimiter: ';', skip_empty_lines: true, max_record_size: 1024 * 1024 })
  } catch {
    throw new RelatorioVortxError('CSV_INVALIDO', 'CSV Vortx invalido ou fora do encoding UTF-8 confirmado.')
  }
  if (records.length < 2 || records.length > 100_001) {
    throw new RelatorioVortxError('LINHAS_INVALIDAS', 'CSV Vortx vazio ou acima de 100 mil linhas.')
  }
  const [rawHeaders, ...rows] = records
  const headers = rawHeaders.map((header) => header.trim())
  const layout = LAYOUTS_CSV_VORTX[input.tipoRelatorio]
  const esperados = new Set(layout.map((field) => field.header))
  if (new Set(headers).size !== headers.length || headers.length !== esperados.size || headers.some((header) => !esperados.has(header))) {
    throw new RelatorioVortxError('LAYOUT_DIVERGENTE', 'Cabecalhos diferentes do layout Vortx confirmado.')
  }
  const ctx = contexto.data
  const linhas: LinhaRelatorioVortx[] = rows.map((values, index) => {
    const bruto = Object.fromEntries(headers.map((header, position) => [header, values[position]]))
    const dados: Record<string, string> = { fundo_id: ctx.fundoId, data_referencia: ctx.dataReferencia }
    const erros: string[] = [], avisos: string[] = []
    for (const field of layout) {
      const valor = bruto[field.header].trim()
      if (!valor && field.obrigatorio) { erros.push(`${field.nome}: obrigatorio.`); continue }
      try {
        let normalizado = valor
        if (field.tipo === 'status') normalizado = normalizarStatusEntradaVortx(valor)
        else if (valor && field.tipo === 'data') normalizado = normalizeDate(valor)
        else if (valor && field.tipo === 'dinheiro') {
          // Formato observado: ponto decimal e duas casas, nunca separador de milhar.
          if (!/^-?\d{1,16}\.\d{2}$/.test(valor)) throw new Error('decimal')
          normalizado = normalizeDecimal(valor)
        } else if (valor && field.tipo === 'documento') {
          if (!/^[\d./-]+$/.test(valor)) throw new Error('documento')
          normalizado = valor.replace(/\D/g, '')
          if (![11, 14].includes(normalizado.length)) throw new Error('documento')
        } else if (valor.length > 500 || /[\u0000-\u001f]/.test(valor)) throw new Error('texto')
        dados[field.nome] = normalizado
      } catch { erros.push(`${field.nome}: formato invalido.`) }
    }
    if (dados.codigo_carteira !== ctx.codigoCarteira) erros.push('codigo_carteira: divergente do contexto.')
    if (dados.data_movimento && (dados.data_movimento < ctx.dataInicio || dados.data_movimento > ctx.dataFim)) {
      erros.push('data_movimento: fora do periodo solicitado.')
    }
    if (dados.status_entrada_provedor === 'NAO_INFORMADO') avisos.push('STATUS_ENTRADA_NAO_INFORMADO')
    if (!erros.length) {
      dados.identidade_ativo = identidade(ctx, dados, false)
      if (input.tipoRelatorio !== 'PosicaoAtivo') dados.external_title_key = identidade(ctx, dados, true)
    }
    return { numeroLinha: index + 2, status: erros.length ? 'INVALIDA' : 'VALIDA', dadosBrutos: bruto, dadosNormalizados: dados, erros, avisos }
  })
  const porChave = new Map<string, LinhaRelatorioVortx[]>()
  for (const linha of linhas.filter((linha) => linha.status === 'VALIDA')) {
    const dados = linha.dadosNormalizados
    const chave = input.tipoRelatorio === 'PosicaoAtivo' ? dados.identidade_ativo
      : JSON.stringify([dados.external_title_key, input.tipoRelatorio === 'Inclusao' ? dados.data_movimento : 'POSICAO'])
    const grupo = porChave.get(chave) ?? []
    grupo.push(linha)
    porChave.set(chave, grupo)
  }
  for (const grupo of porChave.values()) {
    if (grupo.length < 2) continue
    for (const linha of grupo) { linha.status = 'INVALIDA'; linha.erros.push('IDENTIDADE_DUPLICADA_NO_ESCOPO') }
  }
  return {
    tipoRelatorio: input.tipoRelatorio, contexto: ctx, versaoLayout: 'VORTX_RELATORIOS_CSV_V1',
    hashArquivo: createHash('sha256').update(input.arquivo).digest('hex'), encoding: 'utf-8',
    linhas, completo: linhas.every((linha) => linha.status === 'VALIDA'),
  }
}
