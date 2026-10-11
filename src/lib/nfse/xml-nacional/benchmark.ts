import { FiscalIntakeError } from '@/lib/fiscal-intake/contracts'
import { extractNationalXml } from './adapter'
import { canonicalFields, loadStructuralCorpus, valueAt } from './corpus'

/** Calls the existing XML dispatch verbatim; never falls through to PDF/AI or persistence. */
export async function benchmarkNationalCorpus(baselineParser: (file: File) => Promise<unknown>) {
  const rows = []
  for (const { entry, xml, expected } of loadStructuralCorpus()) {
    let baseline: { resultado: string; codigo: string | null }
    try {
      await baselineParser(new File([xml], entry.arquivo, { type: 'application/xml' }))
      baseline = { resultado: 'EXTRAIDO', codigo: null }
    } catch (error) {
      if (!(error instanceof FiscalIntakeError)) throw error
      baseline = { resultado: 'ERRO', codigo: error.code }
    }
    const extracted = extractNationalXml(xml)
    if (extracted.resultado !== 'RECONHECIDO') {
      rows.push({ id: entry.id, origem: entry.origem, baseline, adaptador: extracted.resultado, erro: extracted.codigo,
        corretos: [], ausentes: [], divergencias: ['DOCUMENTO_NAO_EXTRAIDO'], problemas: [] })
      continue
    }
    const fields = canonicalFields(extracted.documento)
    const correct: string[] = [], differences: string[] = [], absentExpected: string[] = [], presentExpected: string[] = []
    for (const [key, expectedField] of Object.entries(expected.campos)) {
      const actual = valueAt(extracted.documento, key)
      if (actual && typeof actual === 'object' && 'estado' in actual && 'valor' in actual &&
          actual.estado === expectedField.estado && actual.valor === expectedField.valor) {
        correct.push(key)
        if (expectedField.estado === 'AUSENTE') absentExpected.push(key)
        if (expectedField.estado === 'PRESENTE') presentExpected.push(key)
      }
      else differences.push(key)
    }
    if (extracted.documento.natureza_documento !== expected.natureza_documento) differences.push('natureza_documento')
    for (const alert of expected.alertas) if (!extracted.documento.alertas_documento.includes(alert)) differences.push(`alerta:${alert}`)
    if (baseline.resultado !== entry.baseline_esperado.resultado || baseline.codigo !== entry.baseline_esperado.codigo) differences.push('baseline_regrediu')
    rows.push({ id: entry.id, origem: entry.origem, baseline, adaptador: extracted.resultado, erro: null,
      corretos: correct, presentes_conferidos: presentExpected, ausencias_conferidas: absentExpected,
      ausentes: fields.filter(f => f.estado === 'AUSENTE').map(f => f.caminho),
      divergencias: differences, problemas: extracted.problemas,
      campos_extraidos: fields.filter(f => f.estado === 'PRESENTE' || f.estado === 'DERIVADO'),
      campos_invalidos: fields.filter(f => f.estado === 'INVALIDO').map(f => f.caminho),
      campos_xml_nao_mapeados: extracted.documento.campos_nao_mapeados.map(f => f.caminho),
      alertas: extracted.documento.alertas_documento, limitacao_xsd: entry.limitacao_xsd })
  }
  return {
    modo: 'SOMENTE_LEITURA', corpus: 'SINTETICO_ESTRUTURAL', compatibilidade_oficial_medida: false,
    acuracia_fiscal_real: null, confianca_do_modelo_usada_como_precisao: false,
    resumo: { documentos: rows.length, expectativas_corretas: rows.reduce((n, row) => n + row.corretos.length, 0),
      divergencias: rows.reduce((n, row) => n + row.divergencias.length, 0),
      baseline_erros: rows.filter(row => row.baseline.resultado === 'ERRO').length,
      adaptador_reconhecidos: rows.filter(row => row.adaptador === 'RECONHECIDO').length },
    resultados: rows,
  }
}
