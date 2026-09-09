import crypto from 'node:crypto'

export const DLZ_POLICY_V5_EXPECTED_HASH = '00d6ed07b545cd3193f92e56b81f7a2e68faa37505c9717d99caa7d0e05429c5'

const COMPARABLE_FIELDS = [
  'regras',
  'parametros',
  'configuracao',
  'cedente_fundo_id',
  'aceite_sacado_obrigatorio',
  'cessao_no_desembolso',
  'cria_acompanhamento_entrega',
  'exigir_status_logistico_pre_cessao',
  'permite_postergacao_upload_canhoto',
  'limite_postergacao_upload_canhoto_dias',
  'metodo_calculo_financeiro',
  'tipo_ativo_financeiro',
  'controle_exposicao_logistica_ativo',
  'limite_exposicao_em_transito_pct',
  'gate_risco_ativo',
  'limite_inclusivo',
  'tratamento_pl_indisponivel',
  'tratamento_indeterminada',
  'tratamento_sem_match',
  'tratamento_operacao_nao_incorporada',
  'tratamento_liquidacao_parcial',
]

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

function canonicalRequirements(requirements = []) {
  return requirements
    .map((requirement) => Object.fromEntries(
      Object.entries(requirement)
        .filter(([key]) => !['id', 'politica_operacional_versao_id', 'created_at'].includes(key)),
    ))
    .sort((left, right) => String(left.codigo).localeCompare(String(right.codigo), 'en'))
}

function comparable(version, requirements = []) {
  return {
    ...Object.fromEntries(COMPARABLE_FIELDS.map((field) => [field, version[field] ?? null])),
    requirements: canonicalRequirements(requirements),
  }
}

export function buildDlzPolicyV5Draft(v4, requirements = []) {
  if (v4.versao !== 4 || v4.status !== 'publicada') throw new Error('A base da v5 deve ser a v4 publicada.')
  if (v4.metodo_calculo_financeiro !== 'TRINTA_360') throw new Error('A v4 nao possui o metodo financeiro esperado para a correcao.')
  return {
    ...v4,
    id: null,
    versao: 5,
    status: 'rascunho',
    publicada_em: null,
    publicada_por: null,
    vigente_ate: null,
    substituida_em: null,
    metodo_calculo_financeiro: 'DIAS_CORRIDOS_365',
    requirements: canonicalRequirements(requirements),
  }
}

export function diffPolicyVersionSemantics(left, right, leftRequirements = [], rightRequirements = []) {
  const before = comparable(left, leftRequirements)
  const after = comparable(right, rightRequirements)
  return Object.keys(before).filter((field) => stableJson(before[field]) !== stableJson(after[field]))
}

export function assertDlzPolicyV5SingleChange(v4, v5, requirements = []) {
  const differences = diffPolicyVersionSemantics(v4, v5, requirements, v5.requirements ?? requirements)
  if (stableJson(differences) !== stableJson(['metodo_calculo_financeiro'])) {
    throw new Error(`A v5 possui diferencas nao autorizadas: ${differences.join(', ') || 'nenhuma'}.`)
  }
  if (v5.metodo_calculo_financeiro !== 'DIAS_CORRIDOS_365') throw new Error('Metodo financeiro da v5 invalido.')
  return differences
}

export function policyContentHash(version, requirements = []) {
  const payload = {
    aceite_sacado_obrigatorio: version.aceite_sacado_obrigatorio,
    cessao_no_desembolso: version.cessao_no_desembolso,
    cria_acompanhamento_entrega: version.cria_acompanhamento_entrega,
    exigir_status_logistico_pre_cessao: version.exigir_status_logistico_pre_cessao,
    permite_postergacao_upload_canhoto: version.permite_postergacao_upload_canhoto,
    limite_postergacao_upload_canhoto_dias: version.limite_postergacao_upload_canhoto_dias,
    metodo_calculo_financeiro: version.metodo_calculo_financeiro,
    tipo_ativo_financeiro: version.tipo_ativo_financeiro,
    controle_exposicao_logistica_ativo: version.controle_exposicao_logistica_ativo,
    limite_exposicao_em_transito_pct: version.limite_exposicao_em_transito_pct,
    gate_risco_ativo: version.gate_risco_ativo,
    limite_inclusivo: version.limite_inclusivo,
    tratamento_pl_indisponivel: version.tratamento_pl_indisponivel,
    tratamento_indeterminada: version.tratamento_indeterminada,
    tratamento_sem_match: version.tratamento_sem_match,
    tratamento_operacao_nao_incorporada: version.tratamento_operacao_nao_incorporada,
    tratamento_liquidacao_parcial: version.tratamento_liquidacao_parcial,
    configuracao: version.configuracao ?? {},
    requisitos: canonicalRequirements(requirements),
  }
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex')
}

export function simulateDlzPolicyV5Publication({ v4, requirements = [], historicalOperations = [], publishedAt }) {
  const v5 = buildDlzPolicyV5Draft(v4, requirements)
  assertDlzPolicyV5SingleChange(v4, v5, requirements)
  const historyBefore = stableJson(historicalOperations)
  const result = {
    v4: { ...v4, status: 'substituida', vigente_ate: publishedAt, substituida_em: publishedAt },
    v5: {
      ...v5,
      status: 'publicada',
      publicada_em: publishedAt,
      vigente_desde: publishedAt,
      conteudo_hash: policyContentHash(v5, requirements),
    },
    historicalOperations,
  }
  if (stableJson(result.historicalOperations) !== historyBefore) throw new Error('Historico operacional foi alterado.')
  return result
}
