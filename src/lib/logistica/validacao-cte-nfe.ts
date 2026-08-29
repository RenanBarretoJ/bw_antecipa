import type { CteXmlParseResult } from './cte-parser'
import { VALIDACAO_CTE_CONFIG } from './validacao-cte-config'

export type ValidacaoCteStatus = 'aprovado' | 'aprovado_com_alertas' | 'rejeitado' | 'validacao_parcial'
export type ValidacaoCteCheckStatus = 'ok' | 'bloqueado' | 'alerta' | 'nao_comparavel' | 'nao_validado'

export interface NfeParaValidacaoCte {
  id: string
  chave_acesso: string | null
  data_emissao: string | null
  cnpj_emitente: string | null
  razao_social_emitente?: string | null
  cnpj_destinatario: string | null
  razao_social_destinatario?: string | null
  valor_bruto: number | null
  descricao_itens?: string | null
  ambiente?: string | null
  municipio_emitente_codigo?: string | null
  uf_emitente?: string | null
  municipio_destinatario_codigo?: string | null
  uf_destinatario?: string | null
  quantidade_total?: number | null
}

export interface DivergenciaCte {
  codigo: string
  severidade: 'bloqueio' | 'alerta' | 'info'
  mensagem: string
  esperado?: string | number | null
  encontrado?: string | number | null
  notaFiscalId?: string
}

export interface ResultadoValidacaoCte {
  status: ValidacaoCteStatus
  bloqueios: DivergenciaCte[]
  alertas: DivergenciaCte[]
  informativos: DivergenciaCte[]
  checks: Record<string, ValidacaoCteCheckStatus>
  chavesNfeReferenciadas: string[]
  chavesNfeNaoCadastradas: string[]
  validacoesPorNf: Array<{
    notaFiscalId: string
    chaveNfe: string | null
    status: ValidacaoCteStatus
    bloqueios: DivergenciaCte[]
    alertas: DivergenciaCte[]
  }>
}

function onlyDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

function sameDigits(a: string | null | undefined, b: string | null | undefined) {
  return onlyDigits(a) === onlyDigits(b)
}

function add(target: DivergenciaCte[], item: Omit<DivergenciaCte, 'severidade'> & { severidade?: DivergenciaCte['severidade'] }) {
  target.push({ severidade: 'bloqueio', ...item })
}

function diffAbs(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.abs(a - b)
}

function isoDateValue(value: string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
  return Number.isFinite(time) ? time : null
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\b(de|da|do|das|dos|e|a|o|as|os|para|com)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function produtoPareceCompatível(cteProduto: string | null | undefined, descricaoNfe: string | null | undefined) {
  const a = normalizeText(cteProduto)
  const b = normalizeText(descricaoNfe)
  if (!a || !b) return null
  const termos = a.split(' ').filter((token) => token.length > 2)
  if (!termos.length) return null
  const encontrados = termos.filter((token) => b.includes(token)).length
  return encontrados / termos.length >= 0.5
}

export function validarCteContraNfes(input: { cte: CteXmlParseResult; nfs: NfeParaValidacaoCte[] }): ResultadoValidacaoCte {
  const { cte, nfs } = input
  const bloqueios: DivergenciaCte[] = []
  const alertas: DivergenciaCte[] = []
  const informativos: DivergenciaCte[] = []
  const checks: ResultadoValidacaoCte['checks'] = {}
  const chavesReferenciadas = [...new Set(cte.chaves_nfe_referenciadas)]

  if (!cte.valido) {
    checks.xml = 'bloqueado'
    for (const erro of cte.erros) add(bloqueios, { codigo: 'xml_invalido', mensagem: erro })
  } else {
    checks.xml = 'ok'
  }

  if (!cte.versao_layout || !VALIDACAO_CTE_CONFIG.versoesSuportadas.includes(cte.versao_layout as '4.00')) {
    checks.versao = 'bloqueado'
    add(bloqueios, {
      codigo: 'versao_cte_nao_suportada',
      mensagem: 'O arquivo enviado nao e um CT-e valido ou utiliza versao nao suportada.',
      esperado: VALIDACAO_CTE_CONFIG.versoesSuportadas.join(', '),
      encontrado: cte.versao_layout,
    })
  } else checks.versao = 'ok'

  if (cte.modelo !== VALIDACAO_CTE_CONFIG.modeloCte) {
    checks.modelo = 'bloqueado'
    add(bloqueios, { codigo: 'modelo_cte_invalido', mensagem: 'O arquivo enviado nao e um CT-e valido ou utiliza versao nao suportada.', esperado: VALIDACAO_CTE_CONFIG.modeloCte, encontrado: cte.modelo })
  } else checks.modelo = 'ok'

  if (cte.status_autorizacao !== VALIDACAO_CTE_CONFIG.statusAutorizado) {
    checks.autorizacao = 'bloqueado'
    add(bloqueios, { codigo: 'cte_nao_autorizado', mensagem: 'O CT-e nao esta autorizado para uso.', esperado: VALIDACAO_CTE_CONFIG.statusAutorizado, encontrado: cte.status_autorizacao })
  } else checks.autorizacao = 'ok'

  if (cte.chave_cte_infcte && cte.chave_cte_protocolo && cte.chave_cte_infcte !== cte.chave_cte_protocolo) {
    checks.chave_cte = 'bloqueado'
    add(bloqueios, { codigo: 'chave_cte_inconsistente', mensagem: 'A chave do CT-e no documento diverge da chave autorizada no protocolo.', esperado: cte.chave_cte_infcte, encontrado: cte.chave_cte_protocolo })
  } else checks.chave_cte = 'ok'

  const chavesNfsCadastradas = nfs.map((nf) => String(nf.chave_acesso || '')).filter(Boolean)
  const chavesNaoCadastradas = chavesReferenciadas.filter((chave) => !chavesNfsCadastradas.includes(chave))
  const validacaoParcial = chavesReferenciadas.length > nfs.length || chavesNaoCadastradas.length > 0

  const validacoesPorNf = nfs.map((nf) => {
    const nfBloqueios: DivergenciaCte[] = []
    const nfAlertas: DivergenciaCte[] = []
    const chaveNfe = nf.chave_acesso

    if (!chaveNfe || !chavesReferenciadas.includes(chaveNfe)) {
      add(nfBloqueios, { codigo: 'nfe_nao_referenciada', mensagem: 'O CT-e nao referencia a chave da NF-e selecionada.', esperado: chaveNfe, encontrado: chavesReferenciadas.join(', ') || null, notaFiscalId: nf.id })
    }

    if (nf.ambiente && cte.ambiente && nf.ambiente !== cte.ambiente) {
      add(nfBloqueios, { codigo: 'ambiente_divergente', mensagem: 'O ambiente fiscal do CT-e e diferente do ambiente da NF-e.', esperado: nf.ambiente, encontrado: cte.ambiente, notaFiscalId: nf.id })
    }

    if (nf.cnpj_emitente && cte.cnpj_remetente && !sameDigits(cte.cnpj_remetente, nf.cnpj_emitente)) {
      add(nfBloqueios, { codigo: 'remetente_divergente', mensagem: 'O remetente do CT-e nao corresponde ao emitente da NF-e.', esperado: onlyDigits(nf.cnpj_emitente), encontrado: onlyDigits(cte.cnpj_remetente), notaFiscalId: nf.id })
    }

    if (nf.cnpj_destinatario && cte.cnpj_destinatario && !sameDigits(cte.cnpj_destinatario, nf.cnpj_destinatario)) {
      add(nfBloqueios, { codigo: 'destinatario_divergente', mensagem: 'O destinatario do CT-e nao corresponde ao destinatario da NF-e.', esperado: onlyDigits(nf.cnpj_destinatario), encontrado: onlyDigits(cte.cnpj_destinatario), notaFiscalId: nf.id })
    }

    const cteDate = isoDateValue(cte.data_emissao)
    const nfDate = isoDateValue(nf.data_emissao)
    if (cteDate !== null && nfDate !== null && cteDate < nfDate) {
      add(nfBloqueios, { codigo: 'data_cte_anterior_nfe', mensagem: 'A data de emissao do CT-e e anterior a emissao da NF-e.', esperado: nf.data_emissao, encontrado: cte.data_emissao, notaFiscalId: nf.id })
    }

    if (VALIDACAO_CTE_CONFIG.bloquearOrigemDivergente) {
      if (nf.uf_emitente && cte.uf_origem && nf.uf_emitente !== cte.uf_origem) {
        add(nfBloqueios, { codigo: 'origem_uf_divergente', mensagem: 'A UF de origem do CT-e diverge da UF do emitente da NF-e.', esperado: nf.uf_emitente, encontrado: cte.uf_origem, notaFiscalId: nf.id })
      }
      if (nf.municipio_emitente_codigo && cte.municipio_origem_codigo && nf.municipio_emitente_codigo !== cte.municipio_origem_codigo) {
        add(nfBloqueios, { codigo: 'origem_municipio_divergente', mensagem: 'O municipio de origem do CT-e diverge do municipio do emitente da NF-e.', esperado: nf.municipio_emitente_codigo, encontrado: cte.municipio_origem_codigo, notaFiscalId: nf.id })
      }
    }

    if (VALIDACAO_CTE_CONFIG.bloquearDestinoDivergente) {
      if (nf.uf_destinatario && cte.uf_destino && nf.uf_destinatario !== cte.uf_destino) {
        add(nfBloqueios, { codigo: 'destino_uf_divergente', mensagem: 'O destino do CT-e diverge do destino da NF-e.', esperado: nf.uf_destinatario, encontrado: cte.uf_destino, notaFiscalId: nf.id })
      }
      if (nf.municipio_destinatario_codigo && cte.municipio_destino_codigo && nf.municipio_destinatario_codigo !== cte.municipio_destino_codigo) {
        add(nfBloqueios, { codigo: 'destino_municipio_divergente', mensagem: 'O destino do CT-e diverge do destino da NF-e.', esperado: nf.municipio_destinatario_codigo, encontrado: cte.municipio_destino_codigo, notaFiscalId: nf.id })
      }
    }

    const quantidadeDiff = diffAbs(cte.quantidade_carga, nf.quantidade_total)
    if (quantidadeDiff !== null && quantidadeDiff > VALIDACAO_CTE_CONFIG.toleranciaQuantidade) {
      add(nfBloqueios, { codigo: 'quantidade_divergente', mensagem: 'A quantidade transportada no CT-e diverge da quantidade informada na NF-e.', esperado: nf.quantidade_total, encontrado: cte.quantidade_carga, notaFiscalId: nf.id })
    } else if (cte.quantidade_carga !== null && nf.quantidade_total == null) {
      add(nfAlertas, { codigo: 'quantidade_nao_comparavel', severidade: 'alerta', mensagem: 'A quantidade do CT-e foi extraida, mas a NF-e cadastrada nao possui quantidade total estruturada para comparacao.', encontrado: cte.quantidade_carga, notaFiscalId: nf.id })
    }

    const produtoCompat = produtoPareceCompatível(cte.produto_predominante, nf.descricao_itens)
    if (produtoCompat === false) {
      add(nfAlertas, { codigo: 'produto_predominante_incompativel', severidade: 'alerta', mensagem: 'O produto predominante do CT-e aparenta divergir da descricao dos itens da NF-e.', esperado: nf.descricao_itens, encontrado: cte.produto_predominante, notaFiscalId: nf.id })
    }

    return {
      notaFiscalId: nf.id,
      chaveNfe,
      status: nfBloqueios.length ? 'rejeitado' as const : nfAlertas.length ? 'aprovado_com_alertas' as const : 'aprovado' as const,
      bloqueios: nfBloqueios,
      alertas: nfAlertas,
    }
  })

  bloqueios.push(...validacoesPorNf.flatMap((item) => item.bloqueios))
  alertas.push(...validacoesPorNf.flatMap((item) => item.alertas))

  if (validacaoParcial) {
    add(informativos, {
      codigo: 'validacao_parcial_multiplas_nfes',
      severidade: 'info',
      mensagem: 'O CT-e referencia multiplas NF-e. A validacao financeira sera concluida apos o vinculo de todas as notas cadastradas.',
      encontrado: chavesNaoCadastradas.join(', ') || null,
    })
  } else {
    const valorNfs = nfs.reduce((total, nf) => total + (nf.valor_bruto || 0), 0)
    const valorDiff = diffAbs(cte.valor_carga, valorNfs)
    if (valorDiff !== null && valorDiff > VALIDACAO_CTE_CONFIG.toleranciaMonetaria) {
      checks.valor_carga = 'bloqueado'
      add(bloqueios, { codigo: 'valor_carga_divergente', mensagem: 'O valor da carga informado no CT-e diverge do valor total da NF-e.', esperado: valorNfs, encontrado: cte.valor_carga })
    } else if (valorDiff !== null) checks.valor_carga = 'ok'
    else checks.valor_carga = 'nao_comparavel'
  }

  if (!checks.valor_carga) checks.valor_carga = validacaoParcial ? 'nao_validado' : 'nao_comparavel'
  checks.chave_nfe = validacoesPorNf.some((item) => item.bloqueios.some((b) => b.codigo === 'nfe_nao_referenciada')) ? 'bloqueado' : 'ok'
  checks.remetente = validacoesPorNf.some((item) => item.bloqueios.some((b) => b.codigo === 'remetente_divergente')) ? 'bloqueado' : 'ok'
  checks.destinatario = validacoesPorNf.some((item) => item.bloqueios.some((b) => b.codigo === 'destinatario_divergente')) ? 'bloqueado' : 'ok'
  checks.quantidade = validacoesPorNf.some((item) => item.bloqueios.some((b) => b.codigo === 'quantidade_divergente')) ? 'bloqueado' : validacoesPorNf.some((item) => item.alertas.some((a) => a.codigo === 'quantidade_nao_comparavel')) ? 'nao_comparavel' : 'ok'
  checks.produto = validacoesPorNf.some((item) => item.alertas.some((a) => a.codigo === 'produto_predominante_incompativel')) ? 'alerta' : 'ok'

  const status: ValidacaoCteStatus = bloqueios.length
    ? 'rejeitado'
    : validacaoParcial
      ? 'validacao_parcial'
      : alertas.length
        ? 'aprovado_com_alertas'
        : 'aprovado'

  return {
    status,
    bloqueios,
    alertas,
    informativos,
    checks,
    chavesNfeReferenciadas: chavesReferenciadas,
    chavesNfeNaoCadastradas: chavesNaoCadastradas,
    validacoesPorNf,
  }
}

export function mensagemValidacaoCte(resultado: ResultadoValidacaoCte): string {
  if (resultado.status === 'rejeitado') {
    const detalhes = resultado.bloqueios.slice(0, 4).map((b) => b.mensagem).join(' ')
    return `CT-e incompativel com a NF-e.${detalhes ? ` ${detalhes}` : ''}`
  }
  if (resultado.status === 'validacao_parcial') return 'CT-e recebido e validado parcialmente. A chave da NF-e vinculada foi confirmada; ha outras NF-e referenciadas ainda nao cadastradas.'
  if (resultado.status === 'aprovado_com_alertas') return 'CT-e validado com alertas. A chave, partes principais e valores bloqueantes sao compativeis com a NF-e.'
  return 'CT-e validado com sucesso. A chave, remetente, destinatario, valor da carga e rota sao compativeis com a NF-e.'
}
