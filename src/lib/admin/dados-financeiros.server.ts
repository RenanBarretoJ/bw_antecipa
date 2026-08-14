import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type { AdminDadosFinanceirosFundo, AdminImportacaoFinanceira } from './dados-financeiros'
import type { RlxTipoBase } from '@/lib/rlx/ingestao/types'

export async function obterDadosFinanceirosAdminFundo(fundoId: string): Promise<AdminDadosFinanceirosFundo> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase
    .from('rlx_importacoes_financeiras')
    .select('id,tipo_base,data_referencia,provedor,origem,integracao_fundo_versao_id,layout_nome,versao_layout,status,completude,nome_arquivo,hash_conteudo,encoding_detectado,linhas_total,linhas_validas,linhas_invalidas,linhas_warning,linhas_publicadas,valor_total,erros,recebida_em,publicada_em,substitui_importacao_id,declaracao_sem_movimento')
    .eq('fundo_id', fundoId)
    .order('recebida_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(`Nao foi possivel carregar as importacoes financeiras: ${error.message}`)
  const ids = (data || []).map((item) => item.id)
  const { data: lineSamples, error: lineError } = ids.length
    ? await context.supabase
        .from('rlx_importacao_linhas')
        .select('importacao_id,numero_linha,status,erros,avisos')
        .in('importacao_id', ids)
        .in('status', ['INVALIDA', 'WARNING'])
        .order('numero_linha', { ascending: true })
        .limit(300)
    : { data: [], error: null }
  if (lineError) throw new Error(`Nao foi possivel carregar as amostras de validacao: ${lineError.message}`)
  const samplesByImport = new Map<string, AdminImportacaoFinanceira['amostras_linhas']>()
  for (const sample of lineSamples || []) {
    const current = samplesByImport.get(sample.importacao_id) || []
    if (current.length < 5) current.push({
      numero_linha: sample.numero_linha,
      status: sample.status,
      erros: Array.isArray(sample.erros) ? sample.erros : [],
      avisos: Array.isArray(sample.avisos) ? sample.avisos : [],
    })
    samplesByImport.set(sample.importacao_id, current)
  }
  const integrationVersionIds = [...new Set((data || []).map((item) => item.integracao_fundo_versao_id).filter((id): id is string => Boolean(id)))]
  const { data: integrationVersions, error: versionsError } = integrationVersionIds.length
    ? await context.supabase.from('integracao_fundo_versoes').select('id,integracao_fundo_id').in('id', integrationVersionIds)
    : { data: [], error: null }
  if (versionsError) throw new Error(`Nao foi possivel carregar a linhagem tecnica das importacoes: ${versionsError.message}`)
  const integrationIds = [...new Set((integrationVersions || []).map((item) => item.integracao_fundo_id))]
  const { data: integrations, error: integrationsError } = integrationIds.length
    ? await context.supabase.from('integracoes_fundo').select('id,provider_key,system_name').eq('fundo_id', fundoId).in('id', integrationIds)
    : { data: [], error: null }
  if (integrationsError) throw new Error(`Nao foi possivel carregar as fontes tecnicas: ${integrationsError.message}`)
  const integrationById = new Map((integrations || []).map((item) => [item.id, item]))
  const versionById = new Map((integrationVersions || []).map((item) => [item.id, item]))

  const importacoes = (data || []).map((item) => {
    const version = item.integracao_fundo_versao_id ? versionById.get(item.integracao_fundo_versao_id) : null
    const integration = version ? integrationById.get(version.integracao_fundo_id) : null
    const fonte = item.origem === 'MANUAL'
      ? 'Importacao manual'
      : item.origem === 'GOLDEN_DATASET'
        ? 'RLX Golden QA'
        : integration
          ? `${integration.system_name} / ${integration.provider_key}`
          : 'Fonte automatica indisponivel'
    return {
      ...item,
      fonte,
      amostras_linhas: samplesByImport.get(item.id) || [],
    }
  }) as AdminImportacaoFinanceira[]
  const vigentes: Partial<Record<RlxTipoBase, AdminImportacaoFinanceira>> = {}
  for (const item of importacoes) {
    if (item.status === 'PUBLICADA' && !vigentes[item.tipo_base]) vigentes[item.tipo_base] = item
  }
  return { fundoId, importacoes, vigentes }
}
