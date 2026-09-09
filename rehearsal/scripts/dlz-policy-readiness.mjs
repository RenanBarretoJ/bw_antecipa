function canonicalRequirements(requirements = []) {
  return requirements
    .map((requirement) => ({
      codigo: requirement.codigo,
      escopo: requirement.escopo,
      tipo_documento_codigo: requirement.tipo_documento_codigo,
      obrigatorio: requirement.obrigatorio,
      quantidade_minima: requirement.quantidade_minima,
      formatos_aceitos: [...(requirement.formatos_aceitos ?? [])].sort(),
      nivel_validacao: requirement.nivel_validacao,
      prazo_dias_corridos: requirement.prazo_dias_corridos,
      responsavel_upload: requirement.responsavel_upload,
      responsavel_aprovacao: requirement.responsavel_aprovacao,
      momento_obrigatorio: requirement.momento_obrigatorio,
      categoria: requirement.categoria,
      bloqueia_fluxo: requirement.bloqueia_fluxo,
      ativo: requirement.ativo,
    }))
    .sort((left, right) => String(left.codigo).localeCompare(String(right.codigo), 'en'))
}

function policySemantics(version) {
  return {
    acceptance_required: version.aceite_sacado_obrigatorio,
    cession_on_disbursement: version.cessao_no_desembolso,
    delivery_tracking: version.cria_acompanhamento_entrega,
    postponement_allowed: version.permite_postergacao_upload_canhoto,
    financial_calculation_method: version.metodo_calculo_financeiro,
    require_pre_cession_logistics: version.exigir_status_logistico_pre_cessao,
    financial_asset_type: version.tipo_ativo_financeiro,
    logistics_exposure_control: version.controle_exposicao_logistica_ativo,
    risk_gate: version.gate_risco_ativo,
    requirements: canonicalRequirements(version.requirements),
  }
}

function expectedSemantics(policy) {
  return {
    acceptance_required: policy.acceptance_required,
    cession_on_disbursement: policy.cession_on_disbursement,
    delivery_tracking: policy.delivery_tracking,
    postponement_allowed: policy.postponement_allowed,
    financial_calculation_method: policy.financial_calculation_method,
    require_pre_cession_logistics: policy.require_pre_cession_logistics,
    financial_asset_type: policy.financial_asset_type,
    logistics_exposure_control: policy.logistics_exposure_control,
    risk_gate: policy.risk_gate,
    requirements: canonicalRequirements(policy.requirements),
  }
}

export function evaluateDlzPolicyReadiness({ versions, expectedPolicy, fundoId }) {
  const published = versions.filter((version) => version.status === 'publicada')
  if (published.length === 0) {
    return { passed: false, code: 'NO_PUBLISHED_POLICY', published_count: 0, mismatches: [] }
  }
  if (published.length !== 1) {
    return { passed: false, code: 'MULTIPLE_PUBLISHED_POLICIES', published_count: published.length, mismatches: [] }
  }

  const current = published[0]
  if (current.fundo_id !== fundoId) {
    return { passed: false, code: 'WRONG_FUND', published_count: 1, mismatches: ['fundo_id'] }
  }

  const expected = expectedSemantics(expectedPolicy)
  const actual = policySemantics(current)
  const mismatches = Object.keys(expected).filter((field) => JSON.stringify(expected[field]) !== JSON.stringify(actual[field]))

  return {
    passed: mismatches.length === 0,
    code: mismatches.length === 0 ? 'READY' : 'POLICY_SEMANTICS_DIVERGENT',
    published_count: 1,
    current_version: current.versao,
    current_version_id: current.id,
    mismatches,
  }
}
