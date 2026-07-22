import crypto from 'crypto'
import Handlebars from 'handlebars'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type TemplateTipoDocumento = 'contrato_mae' | 'contrato_mae_sem_coobrigacao' | 'termo_cessao' | 'notificacao_sacado' | 'termo_quitacao'

export interface TemplateDocumentoRow {
  id: string
  fundo_id: string
  codigo: string
  tipo_documento: TemplateTipoDocumento
  nome: string
  descricao: string | null
  status: 'rascunho' | 'ativo' | 'desativado'
}

export interface TemplateVersaoRow {
  id: string
  template_id: string
  versao: number
  vigente_desde: string
  vigente_ate: string | null
  conteudo_html: string
  variaveis_schema: TemplateVariaveisSchema
  sha256: string
  status: 'rascunho' | 'publicada' | 'substituida' | 'cancelada'
  publicada_por: string | null
  publicada_em: string | null
}

export interface TemplateResolvido {
  template: TemplateDocumentoRow
  versao: TemplateVersaoRow
}

export interface TemplateVariavelDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
}

export interface TemplateVariaveisSchema {
  variaveis?: Record<string, TemplateVariavelDef>
  helpers?: string[]
}

export const TEMPLATE_TIPOS: Array<{ tipo: TemplateTipoDocumento; codigo: string; nome: string; arquivo: string }> = [
  { tipo: 'contrato_mae', codigo: 'contrato_mae', nome: 'Contrato-mãe', arquivo: 'contrato-cessao.html' },
  { tipo: 'contrato_mae_sem_coobrigacao', codigo: 'contrato_mae_sem_coobrigacao', nome: 'Contrato-mãe sem coobrigação', arquivo: 'contrato-cessao-sem-coobrigacao.html' },
  { tipo: 'termo_cessao', codigo: 'termo_cessao', nome: 'Termo de cessão', arquivo: 'termo-cessao.html' },
  { tipo: 'notificacao_sacado', codigo: 'notificacao_sacado', nome: 'Notificação ao sacado', arquivo: 'notificacao-cessao-ao-sacado.html' },
  { tipo: 'termo_quitacao', codigo: 'termo_quitacao', nome: 'Termo de quitação', arquivo: 'termo_quitacao.html' },
]

export const SCHEMAS_POR_TIPO: Record<TemplateTipoDocumento, TemplateVariaveisSchema> = {
  contrato_mae: {
    variaveis: {
      cedente: { type: 'object', required: true },
      contrato: { type: 'object', required: true },
      testemunha_1: { type: 'object', required: true },
      testemunha_2: { type: 'object', required: true },
    },
    helpers: ['if', 'each'],
  },
  contrato_mae_sem_coobrigacao: {
    variaveis: {
      cedente: { type: 'object', required: true },
      contrato: { type: 'object', required: true },
      testemunha_1: { type: 'object', required: true },
      testemunha_2: { type: 'object', required: true },
    },
    helpers: ['if', 'each'],
  },
  termo_cessao: {
    variaveis: {
      cedente: { type: 'object', required: true },
      termo: { type: 'object', required: true },
      notas_fiscais: { type: 'array', required: true },
      testemunha_1: { type: 'object', required: true },
      testemunha_2: { type: 'object', required: true },
    },
    helpers: ['if', 'each'],
  },
  notificacao_sacado: {
    variaveis: {
      cedente: { type: 'object', required: true },
      contrato: { type: 'object', required: true },
      termo: { type: 'object', required: true },
    },
    helpers: ['if', 'each'],
  },
  termo_quitacao: {
    variaveis: {
      cedente: { type: 'object', required: true },
      contrato: { type: 'object', required: true },
      termo: { type: 'object', required: true },
      quitacao: { type: 'object', required: true },
      notas_fiscais: { type: 'array', required: true },
    },
    helpers: ['if', 'each'],
  },
}

const PROHIBITED_HTML_PATTERNS = [
  /<\s*script\b/i,
  /<\s*iframe\b/i,
  /<\s*object\b/i,
  /<\s*embed\b/i,
  /javascript\s*:/i,
  /\son[a-z]+\s*=/i,
]

const RESERVED_HELPERS = new Set(['if', 'each', 'unless', 'with', 'lookup', 'log'])

export function calcularSha256Canonico(conteudo: string): string {
  return crypto.createHash('sha256').update(conteudo.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
}

export function sanitizarTemplateHtml(html: string): string {
  for (const pattern of PROHIBITED_HTML_PATTERNS) {
    if (pattern.test(html)) {
      throw new Error('Template contem HTML ou atributo proibido por seguranca.')
    }
  }
  return html
}

function tipoValor(value: unknown): TemplateVariavelDef['type'] {
  if (Array.isArray(value)) return 'array'
  if (value === null || value === undefined) return 'string'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function coletarPathsHandlebars(html: string): string[] {
  const ast = Handlebars.parseWithoutProcessing(html)
  const paths = new Set<string>()

  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (rec.type === 'PathExpression' && typeof rec.original === 'string') {
      const original = rec.original
      if (!original.startsWith('@') && original !== 'this' && !original.startsWith('this.') && !RESERVED_HELPERS.has(original)) {
        const normalized = original.replace(/^(\.\.\/)+/, '')
        const root = normalized.split('.')[0]
        if (root && root !== 'this') paths.add(root)
      }
    }
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }

  visit(ast)
  return Array.from(paths)
}

export function validarVariaveisTemplate(html: string, schema: TemplateVariaveisSchema, dados: Record<string, unknown>) {
  sanitizarTemplateHtml(html)
  const definicoes = schema.variaveis || {}
  const allowed = new Set(Object.keys(definicoes))
  const usados = coletarPathsHandlebars(html).filter((path) => !['else'].includes(path))
  const desconhecidos = usados.filter((path) => !allowed.has(path))
  if (desconhecidos.length > 0) {
    throw new Error(`Template usa variaveis nao permitidas: ${Array.from(new Set(desconhecidos)).join(', ')}`)
  }

  for (const [nome, def] of Object.entries(definicoes)) {
    const value = dados[nome]
    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Variavel obrigatoria ausente: ${nome}`)
    }
    if (value !== undefined && value !== null && tipoValor(value) !== def.type) {
      throw new Error(`Variavel ${nome} deve ser do tipo ${def.type}`)
    }
  }
}

export function renderizarTemplate(html: string, schema: TemplateVariaveisSchema, dados: Record<string, unknown>) {
  validarVariaveisTemplate(html, schema, dados)
  const runtime = Handlebars.create()
  const template = runtime.compile(sanitizarTemplateHtml(html), {
    noEscape: false,
    strict: false,
    knownHelpersOnly: true,
    knownHelpers: { if: true, each: true, unless: false, with: false, lookup: false, log: false },
  })
  return template(dados)
}

export async function resolverTemplateVigente({
  supabase,
  fundoId,
  tipoDocumento,
  dataReferencia = new Date().toISOString(),
  codigo,
}: {
  supabase: SupabaseClient<Database>
  fundoId: string
  tipoDocumento: TemplateTipoDocumento
  dataReferencia?: string
  codigo?: string
}): Promise<TemplateResolvido | null> {
  let query = supabase
    .from('templates_documentos')
    .select('*, template_versoes(*)')
    .eq('fundo_id', fundoId)
    .eq('tipo_documento', tipoDocumento)
    .eq('status', 'ativo')
  if (codigo) query = query.eq('codigo', codigo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const candidatos = (data || []) as Array<TemplateDocumentoRow & { template_versoes?: TemplateVersaoRow[] }>
  const dataRef = new Date(dataReferencia).getTime()
  const publicados = candidatos.flatMap((template) =>
    (template.template_versoes || [])
      .filter((versao) => versao.status === 'publicada')
      .filter((versao) => new Date(versao.vigente_desde).getTime() <= dataRef)
      .filter((versao) => !versao.vigente_ate || new Date(versao.vigente_ate).getTime() > dataRef)
      .map((versao) => ({ template, versao }))
  )
  publicados.sort((a, b) => b.versao.versao - a.versao.versao)
  return publicados[0] || null
}

export async function registrarDocumentoGerado({
  supabase,
  documentoGeradoId,
  operacaoId,
  cedenteId,
  fundoId,
  template,
  versao,
  tipoDocumento,
  bucket,
  storagePath,
  sha256,
  geradoPor,
}: {
  supabase: SupabaseClient<Database>
  documentoGeradoId?: string
  operacaoId: string | null
  cedenteId: string
  fundoId: string
  template: TemplateDocumentoRow
  versao: TemplateVersaoRow
  tipoDocumento: TemplateTipoDocumento
  bucket: string
  storagePath: string
  sha256: string
  geradoPor: string | null
}) {
  let anterioresQuery = supabase
    .from('documentos_gerados')
    .select('id, status')
    .eq('cedente_id', cedenteId)
    .eq('tipo_documento', tipoDocumento)
    .eq('status', 'gerado')

  anterioresQuery = operacaoId
    ? anterioresQuery.eq('operacao_id', operacaoId)
    : anterioresQuery.is('operacao_id', null)

  const { data: anteriores } = await anterioresQuery

  const ids = (anteriores || []).map((doc) => doc.id)
  if (ids.length > 0) {
    await supabase.from('documentos_gerados').update({ status: 'substituido' } as never).in('id', ids)
  }

  const { data, error } = await supabase
    .from('documentos_gerados')
    .insert({
      id: documentoGeradoId,
      operacao_id: operacaoId,
      cedente_id: cedenteId,
      fundo_id: fundoId,
      template_id: template.id,
      template_versao_id: versao.id,
      template_versao: versao.versao,
      template_hash: versao.sha256,
      tipo_documento: tipoDocumento,
      bucket,
      storage_path: storagePath,
      sha256,
      status: 'gerado',
      gerado_por: geradoPor,
    } as never)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string }
}
