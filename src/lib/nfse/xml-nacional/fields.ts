import Decimal from 'decimal.js'
import { z } from 'zod'
import { validarCNPJ, validarCPF } from '@/lib/validations/cedente'
import type { CanonicalField } from '../canonical/schema'
import { at, type XmlNode } from './xml-tree'

export class FieldReader {
  readonly issues: string[] = []
  readonly consumedPaths = new Set<string>()
  constructor(readonly sha256: string) {}
  field<T>(node: XmlNode | undefined, convert: (text: string) => T, code: string, attribute?: string): CanonicalField<T> {
    if (!node || (attribute && node.attributes[attribute] === undefined)) return {
      estado: 'AUSENTE', original: null, valor: null, origem: null, metodo: null,
      evidencias: [], confianca: null, validacoes: [], alertas: [], derivacao: null,
    }
    const original = attribute ? node.attributes[attribute] : node.text
    this.consumedPaths.add(node.path + (attribute ? `/@${attribute}` : ''))
    const common = { original, origem: 'XML' as const, metodo: 'XML_ESTRUTURAL' as const,
      evidencias: [{ documento_sha256: this.sha256, caminho: node.path + (attribute ? `/@${attribute}` : ''), namespace: node.namespace }],
      confianca: null, alertas: [], derivacao: null }
    try {
      if (!attribute && node.children.length) throw new Error('NOT_A_LEAF')
      return { ...common, estado: 'PRESENTE', valor: convert(original.trim()), validacoes: [{ codigo: code, resultado: 'PASSOU' }] }
    } catch {
      this.issues.push(`${code}:${node.path}`)
      return { ...common, estado: 'INVALIDO', valor: null, validacoes: [{ codigo: code, resultado: 'FALHOU' }] }
    }
  }
  text(root: XmlNode | undefined, path: string) { return this.field(at(root, path), s => z.string().min(1).parse(s), 'TEXT') }
  pattern(root: XmlNode | undefined, path: string, pattern: RegExp, code: string) {
    return this.field(at(root, path), s => z.string().regex(pattern).parse(s), code)
  }
  money(root: XmlNode | undefined, path: string) {
    return this.field(at(root, path), s => {
      z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{2})?$/).parse(s)
      return new Decimal(s).toFixed(2)
    }, 'DECIMAL_MONETARIO')
  }
  rate(root: XmlNode | undefined, path: string, integerDigits: 1 | 2 = 2) {
    const pattern = integerDigits === 1 ? /^(0|[1-9])(\.\d{2})?$/ : /^(0|[1-9]\d?)(\.\d{2})?$/
    return this.field(at(root, path), s => z.string().regex(pattern).parse(s), 'ALIQUOTA_PERCENTUAL')
  }
  date(root: XmlNode | undefined, path: string) { return this.field(at(root, path), s => z.iso.date().parse(s), 'DATA_CIVIL') }
  timestamp(root: XmlNode | undefined, path: string) {
    return this.field(at(root, path), s => z.iso.datetime({ offset: true }).parse(s), 'DATA_HORA_COM_FUSO')
  }
  taxId(root: XmlNode | undefined, name: 'CNPJ' | 'CPF') {
    return this.field(at(root, name), s => {
      if (!(name === 'CNPJ' ? /^\d{14}$/.test(s) && validarCNPJ(s) : /^\d{11}$/.test(s) && validarCPF(s))) throw new Error('ID')
      return s
    }, `${name}_DIGITOS_VERIFICADORES`)
  }
  flag(root: XmlNode | undefined, path: string, codes: Readonly<Record<string, boolean>>) {
    return this.field(at(root, path), s => {
      if (codes[s] === undefined) throw new Error('UNMAPPED_FLAG')
      return codes[s]
    }, 'ENUM_RETENCAO')
  }
}
