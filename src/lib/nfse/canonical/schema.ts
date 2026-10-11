import { z } from 'zod'

export const CANONICAL_VERSION = '1.1.0' as const
const evidence = z.strictObject({
  documento_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  caminho: z.string().min(1), namespace: z.string().nullable(),
})
const validation = z.strictObject({
  codigo: z.string().min(1), resultado: z.enum(['PASSOU', 'FALHOU', 'NAO_EXECUTADA']),
})
const common = {
  // A confidence score, when supplied by another strategy, is not measured accuracy.
  confianca: z.number().min(0).max(1).nullable(),
  validacoes: z.array(validation), alertas: z.array(z.string()),
}
const provenance = {
  origem: z.enum(['XML', 'PDF', 'MANUAL']),
  metodo: z.enum(['XML_ESTRUTURAL', 'PDF_TEXTUAL', 'OCR', 'IA_VISUAL', 'ENTRADA_MANUAL']),
  evidencias: z.array(evidence).min(1),
}

type Trace = {
  confianca: number | null; validacoes: z.infer<typeof validation>[]; alertas: string[]
  evidencias: z.infer<typeof evidence>[]
}
type DocumentSource = { origem: 'XML' | 'PDF' | 'MANUAL'; metodo: 'XML_ESTRUTURAL' | 'PDF_TEXTUAL' | 'OCR' | 'IA_VISUAL' | 'ENTRADA_MANUAL' }
export type CanonicalValue<T> = Trace & (
  | (DocumentSource & { estado: 'PRESENTE'; original: string; valor: T; derivacao: null })
  | (DocumentSource & { estado: 'INVALIDO'; original: string; valor: null; derivacao: null })
  | { estado: 'AUSENTE'; original: null; valor: null; origem: null; metodo: null; derivacao: null }
  | (DocumentSource & { estado: 'NAO_APLICAVEL'; original: string; valor: null; derivacao: null; justificativa: string })
  | { estado: 'DERIVADO'; original: null; valor: T; origem: 'CALCULO'; metodo: 'CALCULO_EVIDENCIADO'; derivacao: { formula_versao: string; campos_fontes: string[] } }
)

/** The state encodes presence, never financial eligibility. Invalid input retains its original. */
export function fieldSchema<T extends string | boolean>(value: z.ZodType<T>): z.ZodType<CanonicalValue<T>>
export function fieldSchema(value: z.ZodType<string | boolean>): z.ZodType<CanonicalValue<string | boolean>> {
  return z.discriminatedUnion('estado', [
    z.strictObject({ ...common, ...provenance, estado: z.literal('PRESENTE'),
      original: z.string().min(1), valor: value, derivacao: z.null() }),
    z.strictObject({ ...common, ...provenance, estado: z.literal('INVALIDO'),
      original: z.string(), valor: z.null(), derivacao: z.null(),
      validacoes: z.array(validation.extend({ resultado: z.literal('FALHOU') })).min(1) }),
    z.strictObject({ ...common, estado: z.literal('AUSENTE'), original: z.null(), valor: z.null(),
      origem: z.null(), metodo: z.null(), evidencias: z.array(evidence).max(0), derivacao: z.null() }),
    z.strictObject({ ...common, ...provenance, estado: z.literal('NAO_APLICAVEL'),
      original: z.string().min(1), valor: z.null(), derivacao: z.null(), justificativa: z.string().min(1) }),
    z.strictObject({ ...common, estado: z.literal('DERIVADO'), original: z.null(), valor: value,
      origem: z.literal('CALCULO'), metodo: z.literal('CALCULO_EVIDENCIADO'),
      evidencias: z.array(evidence).min(1), derivacao: z.strictObject({
        formula_versao: z.string().min(1), campos_fontes: z.array(z.string().min(1)).min(1),
      }) }),
  ])
}

export const textField = fieldSchema(z.string().min(1))
export const decimalField = fieldSchema(z.string().regex(/^(0|[1-9]\d{0,14})\.\d{2}$/))
export const rateField = fieldSchema(z.string().regex(/^(0|[1-9]\d{0,2})(\.\d{1,4})?$/))
export const boolField = fieldSchema(z.boolean())
export const dateField = fieldSchema(z.iso.date())
export const temporalField = fieldSchema(z.union([z.iso.date(), z.iso.datetime({ offset: true })]))
const situationField = fieldSchema(z.enum(['ATIVA', 'CANCELADA', 'SUBSTITUIDA', 'DESCONHECIDA']))
const money = {
  valor_bruto_documental: decimalField,
  valor_servicos: decimalField, valor_operacao: decimalField, valor_recebido: decimalField,
  deducoes: decimalField, desconto_condicionado: decimalField, desconto_incondicionado: decimalField,
  base_calculo_iss: decimalField, aliquota_iss: rateField, valor_iss: decimalField, iss_retido: boolField,
  valor_pis: decimalField, valor_cofins: decimalField, base_pis_cofins: decimalField,
  aliquota_pis: rateField, aliquota_cofins: rateField,
  pis_retido: boolField, cofins_retido: boolField, csll_retido: boolField,
  retencao_previdenciaria: decimalField, retencao_irrf: decimalField, retencao_csll: decimalField,
  outras_retencoes: decimalField, total_retencoes: decimalField,
  liquido_documental: decimalField, liquido_derivado: decimalField,
  valor_ibs: decimalField, valor_cbs: decimalField, total_nf_com_ibscbs: decimalField,
  liquido_com_ibscbs: decimalField,
}
const address = z.strictObject({
  logradouro: textField, numero: textField, complemento: textField, bairro: textField,
  codigo_municipio: textField, municipio: textField, uf: textField, cep: textField,
  codigo_pais: textField, cidade_exterior: textField, estado_exterior: textField, codigo_postal_exterior: textField,
})
const person = z.strictObject({
  cnpj: fieldSchema(z.string().regex(/^\d{14}$/)), cpf: fieldSchema(z.string().regex(/^\d{11}$/)),
  nif: textField, motivo_sem_nif: textField, caepf: textField, inscricao_municipal: textField,
  razao_social: textField, nome_fantasia: textField, email: textField, telefone: textField, endereco: address,
})
const dps = z.strictObject({ id: textField, numero: textField, serie: textField, emissao: temporalField })
const service = z.strictObject({
  descricao: textField, codigo_tributacao_nacional: textField, codigo_tributacao_municipal: textField,
  codigo_nbs: textField, municipio_prestacao: textField, pais_prestacao: textField,
  tributacao_iss: textField, tipo_retencao_iss: textField, tipo_retencao_pis_cofins: textField,
  cst_pis_cofins: textField, regime_simples: textField, regime_especial: textField,
})
export const canonicalSchema = z.strictObject({
  schema_version: z.literal(CANONICAL_VERSION), extrator_versao: z.string(),
  natureza_documento: z.enum(['NFSE', 'DPS', 'RPS', 'EVENTO', 'OUTRO', 'DESCONHECIDO']),
  identificacao_layout: z.strictObject({
    familia: z.string(), provedor: z.string().nullable(), versao_documental: z.string(),
    namespace: z.string(), perfil_id: z.string(), status_cobertura: z.literal('ESTRUTURAL'),
  }),
  originais: z.array(z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), formato: z.enum(['XML', 'PDF']) })).min(1),
  verificacao: z.strictObject({
    xsd: z.literal('NAO_EXECUTADA'), assinatura: z.literal('NAO_EXECUTADA'), consulta_fiscal: z.literal('NAO_EXECUTADA'),
    elegibilidade: z.literal('NAO_AVALIADA'),
  }),
  identificacao: z.strictObject({
    numero_nfse: textField, serie_nfse: textField, codigo_verificacao: textField,
    chave_acesso: fieldSchema(z.string().regex(/^\d{50}$/)),
    emissao: temporalField, competencia: dateField, municipio_emissor: textField,
    processamento: temporalField, codigo_status_geracao: textField, ambiente: textField,
    situacao: situationField, situacao_declarada: situationField,
    dps, rps: dps.extend({ tipo: textField }), nota_substituida: textField, nota_substituta: textField,
    cancelamento_data: temporalField, cancelamento_motivo: textField,
  }),
  prestador: person, tomador: person, intermediario: person,
  servicos: z.array(service), totais: z.strictObject(money), vencimento: dateField,
  evento: z.strictObject({ tipo: textField, id: textField, pedido_id: textField, registro: temporalField }),
  campos_nao_mapeados: z.array(evidence),
  alertas_documento: z.array(z.string()),
})

export type CanonicalDocument = z.infer<typeof canonicalSchema>
export type CanonicalField<T> =
  | { estado: 'PRESENTE'; original: string; valor: T; origem: 'XML'; metodo: 'XML_ESTRUTURAL';
      evidencias: z.infer<typeof evidence>[]; confianca: null; validacoes: z.infer<typeof validation>[]; alertas: string[]; derivacao: null }
  | { estado: 'INVALIDO'; original: string; valor: null; origem: 'XML'; metodo: 'XML_ESTRUTURAL';
      evidencias: z.infer<typeof evidence>[]; confianca: null; validacoes: { codigo: string; resultado: 'FALHOU' }[]; alertas: string[]; derivacao: null }
  | { estado: 'AUSENTE'; original: null; valor: null; origem: null; metodo: null;
      evidencias: []; confianca: null; validacoes: []; alertas: []; derivacao: null }

/** Creates absent fields from the schema, preventing divergent handwritten defaults. */
export function absentDocument(): CanonicalDocument {
  function absent(shape: z.ZodType): unknown {
    if (shape instanceof z.ZodDiscriminatedUnion) return {
      estado: 'AUSENTE', original: null, valor: null, origem: null, metodo: null,
      evidencias: [], confianca: null, validacoes: [], alertas: [], derivacao: null,
    }
    if (shape instanceof z.ZodObject) return Object.fromEntries(
      Object.entries(shape.shape).map(([key, child]) => [key, absent(child)]),
    )
    if (shape instanceof z.ZodArray) return []
    return undefined
  }
  return canonicalSchema.parse({
    ...absent(canonicalSchema) as Record<string, unknown>,
    schema_version: CANONICAL_VERSION, extrator_versao: 'national-xml/0.1.0',
    natureza_documento: 'DESCONHECIDO',
    identificacao_layout: { familia: 'NACIONAL', provedor: null, versao_documental: '', namespace: '', perfil_id: '', status_cobertura: 'ESTRUTURAL' },
    originais: [{ sha256: '0'.repeat(64), formato: 'XML' }],
    verificacao: { xsd: 'NAO_EXECUTADA', assinatura: 'NAO_EXECUTADA', consulta_fiscal: 'NAO_EXECUTADA', elegibilidade: 'NAO_AVALIADA' },
  })
}
