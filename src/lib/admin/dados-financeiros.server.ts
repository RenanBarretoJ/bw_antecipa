import 'server-only'

import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { obterConfiguracoesTecnicasAdminFundo } from './configuracoes-tecnicas.server'
import type { AdminDadosFinanceirosFundo, AdminImportacaoFinanceira } from './dados-financeiros'
import type { TipoBaseFinanceiro } from '@/lib/financeiro/ingestao/types'

const linhagemTecnicaSchema = z.object({
  fundo: z.object({ id: z.string() }),
  integracoes: z.array(z.object({
    provider_key: z.string(),
    system_name: z.string(),
    versoes: z.array(z.object({ id: z.string() })),
  })),
})

export async function obterDadosFinanceirosAdminFundo(fundoId: string): Promise<AdminDadosFinanceirosFundo> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase
    .from('importacoes_financeiras')
    .select('id,tipo_base,data_referencia,provedor,origem,integracao_fundo_versao_id,layout_nome,versao_layout,status,completude,nome_arquivo,hash_conteudo,encoding_detectado,linhas_total,linhas_validas,linhas_invalidas,linhas_warning,linhas_publicadas,valor_total,erros,recebida_em,publicada_em,substitui_importacao_id,declaracao_sem_movimento')
    .eq('fundo_id', fundoId)
    .order('recebida_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(`Nao foi possivel carregar as importacoes financeiras: ${error.message}`)
  const ids = (data || []).map((item) => item.id)
  const { data: lineSamples, error: lineError } = ids.length
    ? await context.supabase
        .from('importacao_linhas')
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
  const fontePorVersao = new Map<string, string>()
  if (integrationVersionIds.length) {
    // Technical tables deliberately deny direct session reads. Reuse the
    // canonical Super Admin/MFA RPC instead of granting SELECT or bypassing RLS.
    const parsed = linhagemTecnicaSchema.safeParse(await obterConfiguracoesTecnicasAdminFundo(fundoId))
    if (!parsed.success || parsed.data.fundo.id !== fundoId) {
      throw new Error('Nao foi possivel confirmar a linhagem tecnica deste Fundo.')
    }
    const requestedVersions = new Set(integrationVersionIds)
    for (const integration of parsed.data.integracoes) {
      for (const version of integration.versoes) {
        if (requestedVersions.has(version.id)) {
          if (fontePorVersao.has(version.id)) throw new Error('Linhagem tecnica ambigua para este Fundo.')
          fontePorVersao.set(version.id, `${integration.system_name} / ${integration.provider_key}`)
        }
      }
    }
  }

  const importacoes = (data || []).map((item) => {
    const fonteIntegracao = item.integracao_fundo_versao_id ? fontePorVersao.get(item.integracao_fundo_versao_id) : undefined
    const fonte = item.origem === 'MANUAL'
      ? 'Importacao manual'
      : item.origem === 'GOLDEN_DATASET'
        ? 'RLX Golden QA'
        : fonteIntegracao || 'Fonte automatica indisponivel'
    return {
      ...item,
      fonte,
      amostras_linhas: samplesByImport.get(item.id) || [],
    }
  }) as AdminImportacaoFinanceira[]
  const vigentes: Partial<Record<TipoBaseFinanceiro, AdminImportacaoFinanceira>> = {}
  for (const item of importacoes) {
    if (item.status === 'PUBLICADA' && !vigentes[item.tipo_base]) vigentes[item.tipo_base] = item
  }
  return { fundoId, importacoes, vigentes }
}
