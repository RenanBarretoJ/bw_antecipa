import { createHash } from 'node:crypto'
import type { ComunicacaoCategoria, GrupoComunicacao, ItemComunicacao } from './tipos'

const VARIAVEIS_GERAIS = ['fundo_nome', 'destinatario_nome', 'data_envio', 'quantidade_itens', 'link_portal'] as const
const VARIAVEIS_LOGISTICA = ['quantidade_ctes', 'quantidade_comprovantes', 'quantidade_rejeitados', 'quantidade_vencidos', 'tabela_itens'] as const
const VARIAVEIS_FINANCEIRO = ['quantidade_titulos', 'total_aberto', 'quantidade_vencidos', 'tabela_titulos'] as const

export const VARIAVEIS_PERMITIDAS = [...VARIAVEIS_GERAIS, ...VARIAVEIS_LOGISTICA, ...VARIAVEIS_FINANCEIRO] as const

export type TemplateComunicacao = {
  assunto: string
  html: string
  texto: string
}
const PADROES: Record<ComunicacaoCategoria, TemplateComunicacao> = {
  LOGISTICA_LEMBRETE: {
    assunto: 'Pendencias logisticas - {{fundo_nome}}',
    html: '<h2>Pendencias logisticas</h2><p>Ola, {{destinatario_nome}}.</p><p>Existem {{quantidade_itens}} item(ns) que exigem acompanhamento.</p>{{tabela_itens}}<p><a href="{{link_portal}}">Acessar o portal</a></p>',
    texto: 'Pendencias logisticas - {{fundo_nome}}\nOla, {{destinatario_nome}}. Existem {{quantidade_itens}} item(ns).\n{{tabela_itens}}\n{{link_portal}}',
  },
  LOGISTICA_VENCE_HOJE: {
    assunto: 'Documento logistico vence hoje - {{fundo_nome}}',
    html: '<h2>Prazo logistico vence hoje</h2><p>Ola, {{destinatario_nome}}.</p>{{tabela_itens}}<p><a href="{{link_portal}}">Acessar o portal</a></p>',
    texto: 'Prazo logistico vence hoje - {{fundo_nome}}\n{{tabela_itens}}\n{{link_portal}}',
  },
  LOGISTICA_VENCIDO: {
    assunto: 'Pendencias logisticas vencidas - {{fundo_nome}}',
    html: '<h2>Pendencias logisticas vencidas</h2><p>Ola, {{destinatario_nome}}.</p>{{tabela_itens}}<p><a href="{{link_portal}}">Regularizar no portal</a></p>',
    texto: 'Pendencias logisticas vencidas - {{fundo_nome}}\n{{tabela_itens}}\n{{link_portal}}',
  },
  LOGISTICA_REJEITADO: {
    assunto: 'Documento logistico requer novo envio - {{fundo_nome}}',
    html: '<h2>Documento rejeitado</h2><p>Ola, {{destinatario_nome}}.</p><p>Revise o motivo e envie uma nova versao.</p>{{tabela_itens}}<p><a href="{{link_portal}}">Reenviar documento</a></p>',
    texto: 'Documento rejeitado - {{fundo_nome}}\nRevise o motivo e envie nova versao.\n{{tabela_itens}}\n{{link_portal}}',
  },
  FINANCEIRO_LEMBRETE: {
    assunto: 'Vencimentos de recebiveis - {{fundo_nome}}',
    html: '<h2>Vencimentos de recebiveis</h2><p>Ola, {{destinatario_nome}}.</p><p>{{quantidade_titulos}} titulo(s), total de {{total_aberto}}.</p>{{tabela_titulos}}<p><a href="{{link_portal}}">Consultar no portal</a></p>',
    texto: 'Vencimentos de recebiveis - {{fundo_nome}}\n{{quantidade_titulos}} titulo(s), {{total_aberto}}.\n{{tabela_titulos}}\n{{link_portal}}',
  },
  FINANCEIRO_VENCE_HOJE: {
    assunto: 'Recebiveis vencem hoje - {{fundo_nome}}',
    html: '<h2>Recebiveis vencem hoje</h2><p>Ola, {{destinatario_nome}}.</p>{{tabela_titulos}}<p><a href="{{link_portal}}">Consultar no portal</a></p>',
    texto: 'Recebiveis vencem hoje - {{fundo_nome}}\n{{tabela_titulos}}\n{{link_portal}}',
  },
  FINANCEIRO_VENCIDO: {
    assunto: 'Cobranca de titulos vencidos - {{fundo_nome}}',
    html: '<h2>Titulos vencidos</h2><p>Ola, {{destinatario_nome}}.</p><p>Consulte os titulos em aberto e as instrucoes autorizadas no portal.</p>{{tabela_titulos}}<p><a href="{{link_portal}}">Acessar o portal</a></p>',
    texto: 'Cobranca de titulos vencidos - {{fundo_nome}}\n{{tabela_titulos}}\n{{link_portal}}',
  },
}

export function obterTemplatePadrao(categoria: ComunicacaoCategoria): TemplateComunicacao {
  return PADROES[categoria]
}

export function escaparHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatarData(value: string | null): string {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatarMoeda(value: number | null): string {
  if (value === null) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function linhaLogistica(item: ItemComunicacao): string {
  const prazo = item.novaPrevisao
    ? `Original ${formatarData(item.prazoOriginal)}; previsao ${formatarData(item.novaPrevisao)}`
    : formatarData(item.dataObrigacao)
  return `<tr><td>${escaparHtml(item.numeroNf)}</td><td>${escaparHtml(item.tipoDocumento)}</td><td>${escaparHtml(prazo)}</td><td>${escaparHtml(item.motivoRejeicao || item.categoria)}</td></tr>`
}

function linhaFinanceira(item: ItemComunicacao): string {
  return `<tr><td>${escaparHtml(item.numeroNf)}</td><td>${escaparHtml(item.cedenteNome)}</td><td>${escaparHtml(item.sacadoNome || '-')}</td><td>${escaparHtml(formatarMoeda(item.valor))}</td><td>${escaparHtml(formatarData(item.dataObrigacao))}</td><td>${escaparHtml(item.categoria)}</td></tr>`
}

export function gerarTabelaSistema(grupo: GrupoComunicacao): { html: string; texto: string } {
  if (grupo.familia === 'LOGISTICA') {
    const html = `<table role="table" style="width:100%;border-collapse:collapse"><thead><tr><th>NF</th><th>Documento</th><th>Prazo</th><th>Situacao</th></tr></thead><tbody>${grupo.itens.map(linhaLogistica).join('')}</tbody></table>`
    const texto = grupo.itens.map((item) => `NF ${item.numeroNf} | ${item.tipoDocumento || '-'} | ${formatarData(item.dataObrigacao)} | ${item.motivoRejeicao || item.categoria}`).join('\n')
    return { html, texto }
  }
  const html = `<table role="table" style="width:100%;border-collapse:collapse"><thead><tr><th>NF</th><th>Cedente</th><th>Sacado</th><th>Valor</th><th>Vencimento</th><th>Situacao</th></tr></thead><tbody>${grupo.itens.map(linhaFinanceira).join('')}</tbody></table>`
  const texto = grupo.itens.map((item) => `NF ${item.numeroNf} | ${item.cedenteNome} | ${item.sacadoNome || '-'} | ${formatarMoeda(item.valor)} | ${formatarData(item.dataObrigacao)} | ${item.categoria}`).join('\n')
  return { html, texto }
}

export function extrairVariaveis(template: string): string[] {
  return [...template.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1].trim())
}

export function validarTemplate(template: TemplateComunicacao, familia: 'LOGISTICA' | 'FINANCEIRO'): void {
  const allowed = new Set<string>([
    ...VARIAVEIS_GERAIS,
    ...(familia === 'LOGISTICA' ? VARIAVEIS_LOGISTICA : VARIAVEIS_FINANCEIRO),
  ])
  for (const value of [template.assunto, template.html, template.texto]) {
    for (const variable of extrairVariaveis(value)) {
      if (!/^[a-z_]+$/.test(variable) || !allowed.has(variable)) throw new Error(`Variavel de template nao permitida: ${variable}.`)
    }
  }
}

function substituir(template: string, values: Record<string, string>, raw: ReadonlySet<string>): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, variable: string) => {
    const key = variable.trim()
    const value = values[key] ?? ''
    return raw.has(key) ? value : escaparHtml(value)
  })
}

export function renderizarComunicacao(grupo: GrupoComunicacao, template: TemplateComunicacao): TemplateComunicacao & { hash: string } {
  validarTemplate(template, grupo.familia)
  const table = gerarTabelaSistema(grupo)
  const total = grupo.itens.reduce((sum, item) => sum + (item.valor || 0), 0)
  const values = {
    fundo_nome: grupo.fundoNome,
    destinatario_nome: grupo.destinatarioNome,
    data_envio: formatarData(grupo.dataEfetiva),
    quantidade_itens: String(grupo.itens.length),
    link_portal: grupo.itens[0]?.linkPortal || '',
    quantidade_ctes: String(grupo.itens.filter((item) => item.tipoDocumento?.toLowerCase().includes('ct-e')).length),
    quantidade_comprovantes: String(grupo.itens.filter((item) => item.tipoDocumento?.toLowerCase().includes('comprovante')).length),
    quantidade_rejeitados: String(grupo.itens.filter((item) => item.categoria === 'LOGISTICA_REJEITADO').length),
    quantidade_vencidos: String(grupo.itens.filter((item) => item.etapa.offset > 0).length),
    tabela_itens: table.html,
    quantidade_titulos: String(grupo.itens.length),
    total_aberto: formatarMoeda(total),
    tabela_titulos: table.html,
  }
  const assunto = substituir(template.assunto, values, new Set())
  const html = substituir(template.html, values, new Set(['tabela_itens', 'tabela_titulos']))
  const textValues = { ...values, tabela_itens: table.texto, tabela_titulos: table.texto }
  const texto = substituir(template.texto, textValues, new Set(['tabela_itens', 'tabela_titulos']))
  const hash = createHash('sha256').update(JSON.stringify({ assunto, html, texto })).digest('hex')
  return { assunto, html, texto, hash }
}

export function hashTemplate(template: TemplateComunicacao): string {
  return createHash('sha256').update(JSON.stringify(template)).digest('hex')
}

export function criarGrupoPreview(familia: 'LOGISTICA' | 'FINANCEIRO'): GrupoComunicacao {
  const category = familia === 'LOGISTICA' ? 'LOGISTICA_VENCIDO' : 'FINANCEIRO_VENCIDO'
  const item: ItemComunicacao = {
    familia,
    fundoId: 'sintetico', fundoNome: 'Fundo de homologacao', itemKey: 'sintetico-1', entidadeTipo: 'sintetico', entidadeId: null,
    notaFiscalId: null, operacaoId: null, numeroNf: '000001234', cedenteNome: 'Cedente Exemplo Ltda.', sacadoNome: 'Sacado Exemplo S.A.',
    destinatarioNome: 'Contato de Homologacao', destinatarioEmail: 'teste@example.invalid', dataObrigacao: '2026-08-10',
    etapa: { chave: 'D+1', offset: 1, dataObrigacao: '2026-08-10', dataNominal: '2026-08-11', dataEfetiva: '2026-08-11', motivoAjuste: null, recorrente: false },
    categoria: category, valor: familia === 'FINANCEIRO' ? 12500 : null,
    tipoDocumento: familia === 'LOGISTICA' ? 'Comprovante de entrega' : null,
    motivoRejeicao: null, prazoOriginal: '2026-08-10', novaPrevisao: null,
    linkPortal: 'https://portal.example.invalid', rejeicaoVersaoId: null, critico: true,
  }
  return { familia, fundoId: item.fundoId, fundoNome: item.fundoNome, destinatarioNome: item.destinatarioNome, destinatarioEmail: item.destinatarioEmail, dataEfetiva: item.etapa.dataEfetiva, categoria: category, itens: [item] }
}
