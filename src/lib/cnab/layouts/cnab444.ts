import type { CampoCnabMapping, GeradorCnab, RemessaOperacao, ResultadoGeracao, ResultadoValidacao } from '@/lib/cnab/domain'
import { sha256Hex } from '@/lib/cnab/domain'

function sanitize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,-/]/g, ' ')
    .toUpperCase()
}

function alfa(value: string | null | undefined, len: number): string {
  const s = sanitize(value ?? '').slice(0, len)
  return s.padEnd(len, ' ')
}

function num(value: number | string | null | undefined, len: number): string {
  return String(Math.round(Number(value) || 0))
    .padStart(len, '0')
    .slice(-len)
}

function numText(value: string | null | undefined, len: number): string {
  return String(value ?? '').padStart(len, '0')
}

function toCents(valor: number | null | undefined, len = 13): string {
  return num(Math.round((valor || 0) * 100), len)
}

function toDDMMYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '000000'
  const d = new Date(dateStr)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

function toYYYYMMDD(dateStr: string | null | undefined): string {
  if (!dateStr) return '00000000'
  const d = new Date(dateStr)
  const yyyy = String(d.getUTCFullYear())
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function digitsOnly(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '')
}

function chaveNfePad(chave: string | null | undefined): string {
  const d = digitsOnly(chave)
  return d.padStart(44, '0').slice(-44)
}

function buildRecord(fields: Array<[number, string]>): string {
  const buf = new Array(444).fill(' ')
  for (const [pos1, value] of fields) {
    for (let i = 0; i < value.length; i++) {
      if (pos1 - 1 + i < 444) buf[pos1 - 1 + i] = value[i]
    }
  }
  return buf.join('')
}

function montarHeader(input: RemessaOperacao): string {
  const cfg = input.configuracao
  const opt = cfg.configuracao
  return buildRecord([
    [1, '0'],
    [2, '1'],
    [3, alfa(opt.literalRemessa || 'REMESSA', 7)],
    [10, num(opt.codigoServico || '01', 2)],
    [12, alfa(opt.literalServico || 'COBRANCA', 15)],
    [27, numText(cfg.codigoOriginador, 20)],
    [47, alfa(input.cedente.razaoSocial, 30)],
    [77, num(cfg.codigoBanco, 3)],
    [80, alfa(cfg.banco, 15)],
    [95, toDDMMYY(input.identificadores.dataGeracao)],
    [109, alfa(opt.identificacaoSistema || 'MX', 2)],
    [111, num(input.identificadores.sequencial, 7)],
    [439, num(1, 6)],
  ])
}

function montarDetalhe(input: RemessaOperacao, tituloIndex: number, seq: number): string {
  const cfg = input.configuracao
  const opt = cfg.configuracao
  const cedente = input.cedente
  const operacao = input.operacoes[0]
  const titulo = input.titulos[tituloIndex]
  const cnpjCedente = digitsOnly(cedente.cnpj)
  const nfNumeroRaw = String(titulo.numero || '')
  const nomeLetras = sanitize(cedente.razaoSocial).replace(/ /g, '').slice(0, 3).padEnd(3, 'X')
  const cnpjPrimeiros3 = cnpjCedente.slice(0, 3).padEnd(3, '0')
  const cnpjUltimos3 = cnpjCedente.slice(-3).padStart(3, '0')
  const nfUltimos3 = digitsOnly(nfNumeroRaw).slice(-3).padStart(3, '0')
  const dataCessao = toYYYYMMDD(operacao.aprovadoEm || operacao.createdAt)
  const seuNumero = alfa(`${nomeLetras}${cnpjPrimeiros3}${nfUltimos3}${dataCessao}${cnpjUltimos3}-1`, 25)
  const termoCessao = alfa(operacao.id.replace(/-/g, '').slice(0, 19), 19)

  return buildRecord([
    [1, '1'],
    [2, '         0000000000'],
    [21, num(cedente.coobrigacao !== false ? 1 : 2, 2)],
    [23, num(opt.caracteristicaEspecial || '00', 2)],
    [25, num(opt.modalidadeOperacao || '0000', 4)],
    [29, num(opt.naturezaOperacao || '00', 2)],
    [31, num(opt.origemRecurso || '0000', 4)],
    [35, '  '],
    [37, '0'],
    [38, seuNumero],
    [63, num(opt.numeroBancoCobranca || '000', 3)],
    [66, '00000'],
    [71, num(0, 11)],
    [82, '1'],
    [83, num(0, 10)],
    [93, alfa(opt.condicaoPapeleta || '1', 1)],
    [94, alfa(opt.emitePapeletaDebAuto || 'N', 1)],
    [95, '000000'],
    [105, ' '],
    [106, '0'],
    [109, num(opt.ocorrencia || '01', 2)],
    [111, alfa(nfNumeroRaw.slice(-10), 10)],
    [121, toDDMMYY(titulo.dataVencimento)],
    [127, toCents(titulo.valorFace, 13)],
    [140, num(opt.numeroBancoCobranca || '000', 3)],
    [143, num(opt.agenciaDepositaria || '00000', 5)],
    [148, num(cfg.especieTitulo, 2)],
    [150, ' '],
    [151, toDDMMYY(titulo.dataEmissao)],
    [157, '00'],
    [159, '0'],
    [160, alfa(opt.tipoPessoaCedente || cfg.tipoInscricao || '02', 2)],
    [162, '000000000000'],
    [174, termoCessao],
    [193, toCents(titulo.valorPresente, 13)],
    [206, num(0, 13)],
    [219, num(opt.tipoInscricaoSacado || '02', 2)],
    [221, num(digitsOnly(titulo.sacadoCnpj), 14)],
    [235, alfa(titulo.sacadoNome, 40)],
    [315, alfa(nfNumeroRaw.slice(-9), 9)],
    [327, num(opt.cepSacadoDefault || '00000000', 8)],
    [335, alfa(cedente.razaoSocial, 46)],
    [381, num(cnpjCedente, 14)],
    [395, chaveNfePad(titulo.chaveAcesso)],
    [439, num(seq, 6)],
  ])
}

function montarTrailer(totalLinhas: number): string {
  return buildRecord([
    [1, '9'],
    [439, num(totalLinhas, 6)],
  ])
}

export const CNAB444_FIELD_MAPPING: CampoCnabMapping[] = [
  { registro: 'header', campo: 'codigo_originador', origem: 'configuracao_cnab_versoes.codigo_originador', transformacao: 'texto numerico padStart(20, zero)', posicao: '27-46', tamanho: 20, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'obrigatorio, somente digitos, maximo 20 caracteres, preserva zeros a esquerda' },
  { registro: 'header', campo: 'nome_originador', origem: 'cedente.razaoSocial', transformacao: 'alfa(30)', posicao: '47-76', tamanho: 30, tipo: 'alfa', alinhamento: 'esquerda', preenchimento: 'espaco', validacao: 'obrigatorio' },
  { registro: 'header', campo: 'codigo_banco', origem: 'configuracao.codigoBanco', transformacao: 'num(3)', posicao: '77-79', tamanho: 3, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'obrigatorio numerico' },
  { registro: 'header', campo: 'nome_banco', origem: 'configuracao.banco', transformacao: 'alfa(15)', posicao: '80-94', tamanho: 15, tipo: 'alfa', alinhamento: 'esquerda', preenchimento: 'espaco', validacao: 'obrigatorio' },
  { registro: 'header', campo: 'sequencial_arquivo', origem: 'identificadores.sequencial', transformacao: 'num(7)', posicao: '111-117', tamanho: 7, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'reservado transacionalmente' },
  { registro: 'detalhe', campo: 'coobrigacao', origem: 'cedente.coobrigacao', transformacao: '01 se true, 02 se false', posicao: '21-22', tamanho: 2, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: '01 ou 02' },
  { registro: 'detalhe', campo: 'seu_numero', origem: 'cedente + nf + operacao', transformacao: 'alfa(25)', posicao: '38-62', tamanho: 25, tipo: 'alfa', alinhamento: 'esquerda', preenchimento: 'espaco', validacao: 'derivado deterministico' },
  { registro: 'detalhe', campo: 'vencimento', origem: 'titulo.dataVencimento', transformacao: 'DDMMAA', posicao: '121-126', tamanho: 6, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'data valida' },
  { registro: 'detalhe', campo: 'valor_titulo', origem: 'titulo.valorFace', transformacao: 'centavos num(13)', posicao: '127-139', tamanho: 13, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'maior que zero' },
  { registro: 'detalhe', campo: 'especie_titulo', origem: 'configuracao.especieTitulo', transformacao: 'num(2)', posicao: '148-149', tamanho: 2, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'obrigatorio' },
  { registro: 'detalhe', campo: 'valor_presente', origem: 'titulo.valorPresente', transformacao: 'centavos num(13)', posicao: '193-205', tamanho: 13, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'maior que zero' },
  { registro: 'detalhe', campo: 'sacado_cnpj', origem: 'titulo.sacadoCnpj', transformacao: 'digits num(14)', posicao: '221-234', tamanho: 14, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: '14 digitos' },
  { registro: 'detalhe', campo: 'cedente_cnpj', origem: 'cedente.cnpj', transformacao: 'digits num(14)', posicao: '381-394', tamanho: 14, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: '14 digitos' },
  { registro: 'detalhe', campo: 'chave_nfe', origem: 'titulo.chaveAcesso', transformacao: 'digits padStart(44)', posicao: '395-438', tamanho: 44, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'ate 44 digitos' },
  { registro: 'trailer', campo: 'seq_ultimo_registro', origem: 'linhas.length', transformacao: 'num(6)', posicao: '439-444', tamanho: 6, tipo: 'num', alinhamento: 'direita', preenchimento: 'zero', validacao: 'igual quantidade de registros' },
]

function validarInput(input: RemessaOperacao): ResultadoValidacao {
  const erros: string[] = []
  const avisos: string[] = []

  if (input.configuracao.layout !== 'cnab444') erros.push('Layout CNAB diferente de cnab444.')
  if (!input.fundo.id) erros.push('Fundo ausente.')
  if (!input.cedente.id || !input.cedente.razaoSocial || digitsOnly(input.cedente.cnpj).length !== 14) erros.push('Cedente incompleto ou CNPJ invalido.')
  if (!input.configuracao.codigoOriginador) erros.push('Codigo originador e obrigatorio.')
  if (input.configuracao.codigoOriginador && !/^\d+$/.test(input.configuracao.codigoOriginador)) erros.push('Codigo originador deve conter somente digitos.')
  if (input.configuracao.codigoOriginador.length > 20) erros.push('Codigo originador deve ter no maximo 20 caracteres no CNAB444.')
  if (!input.configuracao.codigoEmpresa || !/^\d+$/.test(input.configuracao.codigoEmpresa)) erros.push('Codigo da empresa deve ser numerico.')
  if (!input.configuracao.codigoBanco || !/^\d+$/.test(input.configuracao.codigoBanco)) erros.push('Codigo do banco deve ser numerico.')
  if (!input.configuracao.especieTitulo || !/^\d+$/.test(input.configuracao.especieTitulo)) erros.push('Especie do titulo deve ser numerica.')
  if (input.operacoes.length !== 1) erros.push('A primeira versao da Fase 7 gera uma remessa por operacao.')
  if (input.operacoes.some((operacao) => !operacao.cedenteFundoId)) erros.push('Operacao sem vinculo historico cedente-fundo.')
  if (input.titulos.length === 0) erros.push('Remessa sem titulos.')
  if (input.identificadores.sequencial <= 0) erros.push('Sequencial nao reservado.')

  input.titulos.forEach((titulo, index) => {
    const prefix = `Titulo ${index + 1}:`
    if (!titulo.numero) erros.push(`${prefix} numero da NF ausente.`)
    if (!titulo.dataEmissao || Number.isNaN(new Date(titulo.dataEmissao).getTime())) erros.push(`${prefix} data de emissao invalida.`)
    if (!titulo.dataVencimento || Number.isNaN(new Date(titulo.dataVencimento).getTime())) erros.push(`${prefix} data de vencimento invalida.`)
    if (titulo.valorFace <= 0) erros.push(`${prefix} valor de face deve ser maior que zero.`)
    if (titulo.valorPresente <= 0) erros.push(`${prefix} valor presente deve ser maior que zero.`)
    if (digitsOnly(titulo.sacadoCnpj).length !== 14) erros.push(`${prefix} CNPJ do sacado invalido.`)
    if (!titulo.sacadoNome) erros.push(`${prefix} nome do sacado ausente.`)
    if (titulo.chaveAcesso && digitsOnly(titulo.chaveAcesso).length > 44) avisos.push(`${prefix} chave NF-e excede 44 digitos e sera truncada pela esquerda.`)
  })

  return { valido: erros.length === 0, erros, avisos }
}

function validarLinhas(linhas: string[], titulos: number): ResultadoValidacao {
  const erros: string[] = []
  const avisos: string[] = []
  if (linhas.length !== titulos + 2) erros.push('Quantidade de linhas nao corresponde a header + titulos + trailer.')
  if (linhas[0]?.[0] !== '0') erros.push('Header ausente ou invalido.')
  if (linhas.slice(1, -1).some((linha) => linha[0] !== '1')) erros.push('Ha detalhes com tipo de registro invalido.')
  if (linhas.at(-1)?.[0] !== '9') erros.push('Trailer ausente ou invalido.')
  linhas.forEach((linha, index) => {
    if (linha.length !== 444) erros.push(`Linha ${index + 1} possui ${linha.length} caracteres; esperado 444.`)
    if (/[^\x20-\x7E]/.test(linha)) erros.push(`Linha ${index + 1} contem caractere fora de ASCII imprimivel.`)
    const seq = Number(linha.slice(438, 444))
    if (seq !== index + 1) erros.push(`Linha ${index + 1} possui sequencial ${seq}; esperado ${index + 1}.`)
  })
  const trailerSeq = Number(linhas.at(-1)?.slice(438, 444) || 0)
  if (trailerSeq !== linhas.length) erros.push('Sequencial do trailer nao corresponde ao total de linhas.')
  return { valido: erros.length === 0, erros, avisos }
}

export const geradorCnab444: GeradorCnab = {
  validar: validarInput,
  gerar(input: RemessaOperacao): ResultadoGeracao {
    const validacao = validarInput(input)
    if (!validacao.valido) throw new Error(`Remessa CNAB invalida: ${validacao.erros.join('; ')}`)

    const linhas = [montarHeader(input)]
    input.titulos.forEach((_, index) => linhas.push(montarDetalhe(input, index, index + 2)))
    linhas.push(montarTrailer(linhas.length + 1))

    const validacaoLinhas = validarLinhas(linhas, input.titulos.length)
    if (!validacaoLinhas.valido) throw new Error(`CNAB gerado invalido: ${validacaoLinhas.erros.join('; ')}`)

    const conteudo = linhas.join('\r\n')
    return {
      conteudo,
      linhas,
      quantidadeRegistros: linhas.length,
      quantidadeTitulos: input.titulos.length,
      valorTotal: input.titulos.reduce((total, titulo) => total + titulo.valorFace, 0),
      sha256: sha256Hex(Buffer.from(conteudo, 'utf8')),
    }
  },
}

export function validarCnab444Conteudo(conteudo: string, quantidadeTitulos: number): ResultadoValidacao {
  return validarLinhas(conteudo.split(/\r\n/), quantidadeTitulos)
}
