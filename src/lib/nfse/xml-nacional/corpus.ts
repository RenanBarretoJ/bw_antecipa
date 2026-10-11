/** Development-only corpus loader. Never accepts arbitrary real-document paths. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { sha256 } from '../review-facts'

const expectationSchema = z.object({
  resultado: z.literal('RECONHECIDO'), natureza_documento: z.enum(['NFSE', 'DPS', 'EVENTO']),
  campos: z.record(z.string(), z.object({ estado: z.enum(['PRESENTE', 'AUSENTE', 'DERIVADO', 'INVALIDO']), valor: z.union([z.string(), z.boolean(), z.null()]) })),
  alertas: z.array(z.string()),
})
const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), arquivo: z.string().regex(/^[a-z0-9-]+\.xml$/),
  esperado: z.string().regex(/^[a-z0-9-]+\.expected\.json$/),
  origem: z.literal('SINTETICO_ESTRUTURAL'), evidencia_compatibilidade_oficial: z.literal(false),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), versao: z.enum(['1.00', '1.01']),
  xsd_esperado: z.boolean(), raiz_xsd: z.string(), limitacao_xsd: z.string().nullable(),
  baseline_esperado: z.object({ resultado: z.literal('ERRO'), codigo: z.literal('MISSING_IDENTITY') }),
})
export function loadStructuralCorpus() {
  const dir = path.resolve(process.cwd(), 'tests/fixtures/nfse/nacional')
  const manifest = z.object({ casos: z.array(caseSchema).min(1) }).parse(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')))
  return manifest.casos.map(entry => {
    const xml = readFileSync(path.join(dir, entry.arquivo), 'utf8')
    if (sha256(xml) !== entry.sha256) throw new Error('CORPUS_HASH_MISMATCH')
    return { entry, xml, expected: expectationSchema.parse(JSON.parse(readFileSync(path.join(dir, entry.esperado), 'utf8'))) }
  })
}

export function valueAt(value: unknown, key: string): unknown {
  let result = value
  for (const part of key.split('.')) {
    if (typeof result !== 'object' || result === null || !(part in result)) return undefined
    result = Reflect.get(result, part)
  }
  return result
}

export function canonicalFields(value: unknown, prefix = ''): { caminho: string; estado: string; valor: unknown }[] {
  if (typeof value !== 'object' || value === null) return []
  if ('estado' in value && typeof value.estado === 'string' && 'valor' in value) {
    return [{ caminho: prefix, estado: value.estado, valor: value.valor }]
  }
  return Object.entries(value).flatMap(([key, child]) => canonicalFields(child, prefix ? `${prefix}.${key}` : key))
}
