import {
  POLICY_DOCUMENT_CODES,
  POLICY_REQUIREMENT_SCOPES,
  POLICY_RESPONSIBLES,
  POLICY_VALIDATION_LEVELS,
  type PoliticaNivelValidacao,
  type PoliticaRequisitoEscopo,
  type PoliticaResponsavel,
  type PoliticaTipoDocumentoCodigo,
} from '@/lib/types/domain'

export type PoliticaMomentoObrigatorio = PoliticaRequisitoEscopo

export interface PoliticaRequisitoInput {
  codigo: string
  momento_obrigatorio: PoliticaMomentoObrigatorio
  tipo_documento_codigo: PoliticaTipoDocumentoCodigo
  obrigatorio: boolean
  quantidade_minima?: number
  formatos_aceitos?: string[]
  nivel_validacao?: PoliticaNivelValidacao
  prazo_dias_corridos?: number | null
  observacoes?: string | null
  responsavel_upload: PoliticaResponsavel
  responsavel_aprovacao: PoliticaResponsavel
  ordem?: number
  ativo?: boolean
}

export interface PoliticaRequisitoNormalizado {
  codigo: string
  momento_obrigatorio: PoliticaMomentoObrigatorio
  escopo: PoliticaMomentoObrigatorio
  categoria: PoliticaMomentoObrigatorio
  tipo_documento_codigo: PoliticaTipoDocumentoCodigo
  obrigatorio: boolean
  bloqueia_fluxo: boolean
  quantidade_minima: number
  formatos_aceitos: string[]
  nivel_validacao: PoliticaNivelValidacao
  prazo_dias_corridos: number | null
  observacoes: string | null
  responsavel_upload: PoliticaResponsavel
  responsavel_aprovacao: PoliticaResponsavel
  ordem: number
  ativo: boolean
}

const CAMPOS_DERIVADOS_OU_LEGADOS = [
  'escopo',
  'categoria',
  'bloqueia_fluxo',
  'bloqueiaFluxo',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} invalido.`)
  }
  return value as T
}

function validarContratoPublico(input: PoliticaRequisitoInput, index: number) {
  if (!isRecord(input)) throw new Error(`Requisito ${index + 1} invalido.`)

  const camposIndevidos = CAMPOS_DERIVADOS_OU_LEGADOS.filter((campo) => Object.hasOwn(input, campo))
  if (camposIndevidos.length > 0) {
    throw new Error(
      `O requisito ${index + 1} informou campos derivados ou legados: ${camposIndevidos.join(', ')}.`,
    )
  }
}

export function derivarCategoriaRequisito(
  momentoObrigatorio: PoliticaMomentoObrigatorio,
): PoliticaMomentoObrigatorio {
  return validEnum(
    momentoObrigatorio,
    POLICY_REQUIREMENT_SCOPES,
    'Momento obrigatorio do requisito',
  )
}

export function derivarBloqueioFluxo(obrigatorio: boolean): boolean {
  if (typeof obrigatorio !== 'boolean') {
    throw new Error('Obrigatoriedade do requisito invalida.')
  }
  return obrigatorio
}

export function resolverMomentoObrigatorioLegado(
  input: {
    momento_obrigatorio?: unknown
    escopo?: unknown
    categoria?: unknown
  },
): PoliticaMomentoObrigatorio {
  const candidatos = [
    input.momento_obrigatorio,
    input.escopo,
    input.categoria,
  ]
  const momento = candidatos.find(
    (value): value is PoliticaMomentoObrigatorio =>
      typeof value === 'string' && POLICY_REQUIREMENT_SCOPES.includes(value as PoliticaMomentoObrigatorio),
  )

  if (!momento) throw new Error('Requisito legado sem momento obrigatorio reconhecido.')
  return momento
}

export function normalizarRequisitoDocumental(
  input: PoliticaRequisitoInput,
  index: number,
): PoliticaRequisitoNormalizado {
  validarContratoPublico(input, index)

  const codigo = typeof input.codigo === 'string' ? input.codigo.trim() : ''
  if (!codigo) throw new Error(`O codigo do requisito ${index + 1} e obrigatorio.`)
  if (codigo.length > 80) throw new Error(`O codigo do requisito ${index + 1} excede 80 caracteres.`)

  const momentoObrigatorio = validEnum(
    input.momento_obrigatorio,
    POLICY_REQUIREMENT_SCOPES,
    `Momento obrigatorio do requisito ${codigo}`,
  )
  const obrigatorio = derivarBloqueioFluxo(input.obrigatorio)
  const quantidade = input.quantidade_minima ?? 1
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error(`Quantidade invalida no requisito ${codigo}.`)
  }

  const prazo = input.prazo_dias_corridos ?? null
  if (prazo !== null && (!Number.isInteger(prazo) || prazo < 0)) {
    throw new Error(`Prazo invalido no requisito ${codigo}.`)
  }

  const ordem = input.ordem ?? index
  if (!Number.isInteger(ordem) || ordem < 0) {
    throw new Error(`Ordem invalida no requisito ${codigo}.`)
  }

  return {
    codigo,
    momento_obrigatorio: momentoObrigatorio,
    escopo: momentoObrigatorio,
    categoria: derivarCategoriaRequisito(momentoObrigatorio),
    tipo_documento_codigo: validEnum(
      input.tipo_documento_codigo,
      POLICY_DOCUMENT_CODES,
      `Tipo documental do requisito ${codigo}`,
    ),
    obrigatorio,
    bloqueia_fluxo: obrigatorio,
    quantidade_minima: quantidade,
    formatos_aceitos: [
      ...new Set(
        (input.formatos_aceitos || [])
          .map((format) => format.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    nivel_validacao: validEnum(
      input.nivel_validacao || 'manual',
      POLICY_VALIDATION_LEVELS,
      `Nivel de validacao do requisito ${codigo}`,
    ),
    prazo_dias_corridos: prazo,
    observacoes: input.observacoes?.trim() || null,
    responsavel_upload: validEnum(
      input.responsavel_upload,
      POLICY_RESPONSIBLES,
      `Responsavel pelo upload do requisito ${codigo}`,
    ),
    responsavel_aprovacao: validEnum(
      input.responsavel_aprovacao,
      POLICY_RESPONSIBLES,
      `Responsavel pela aprovacao do requisito ${codigo}`,
    ),
    ordem,
    ativo: input.ativo ?? true,
  }
}

export function normalizarRequisitoLegadoParaEdicao(
  input: Record<string, unknown>,
  index: number,
): PoliticaRequisitoInput {
  const normalizado = normalizarRequisitoDocumental({
    codigo: String(input.codigo || ''),
    momento_obrigatorio: resolverMomentoObrigatorioLegado(input),
    tipo_documento_codigo: input.tipo_documento_codigo as PoliticaTipoDocumentoCodigo,
    obrigatorio: input.obrigatorio === true,
    quantidade_minima: input.quantidade_minima == null ? 1 : Number(input.quantidade_minima),
    formatos_aceitos: Array.isArray(input.formatos_aceitos)
      ? input.formatos_aceitos.filter((value): value is string => typeof value === 'string')
      : [],
    nivel_validacao: input.nivel_validacao as PoliticaNivelValidacao,
    prazo_dias_corridos: input.prazo_dias_corridos == null ? null : Number(input.prazo_dias_corridos),
    observacoes: input.observacoes == null ? null : String(input.observacoes),
    responsavel_upload: input.responsavel_upload as PoliticaResponsavel,
    responsavel_aprovacao: input.responsavel_aprovacao as PoliticaResponsavel,
    ordem: input.ordem == null ? index : Number(input.ordem),
    ativo: input.ativo == null ? true : input.ativo === true,
  }, index)

  return {
    codigo: normalizado.codigo,
    momento_obrigatorio: normalizado.momento_obrigatorio,
    tipo_documento_codigo: normalizado.tipo_documento_codigo,
    obrigatorio: normalizado.obrigatorio,
    quantidade_minima: normalizado.quantidade_minima,
    formatos_aceitos: normalizado.formatos_aceitos,
    nivel_validacao: normalizado.nivel_validacao,
    prazo_dias_corridos: normalizado.prazo_dias_corridos,
    observacoes: normalizado.observacoes,
    responsavel_upload: normalizado.responsavel_upload,
    responsavel_aprovacao: normalizado.responsavel_aprovacao,
    ordem: normalizado.ordem,
    ativo: normalizado.ativo,
  }
}
