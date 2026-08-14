import 'server-only'

import { FINANCIAL_CAPABILITIES, capabilityParaTipoFinanceiro } from '@/lib/integracoes/capabilities'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability, type IntegrationResolution } from '@/lib/integracoes/resolver.server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolverExpectativasCicloRlx } from './cron-contract'
import { ingerirArquivoFinanceiroRlx, publicarImportacaoFinanceiraRlx } from './ingestao.server'
import { obterArquivoCapabilityComTimeout, rlxCapabilityHandlerRegistry, RlxProviderTimeoutError, type RlxCapabilityHandler } from './provider'
import { SinqiaProviderError, type SinqiaProviderErrorCode } from './sinqia-portal-fidc.server'

type AdminClient = ReturnType<typeof createAdminClient>

type CronDependencies = {
  supabase?: AdminClient
  resolve?: typeof resolverIntegracaoPorCapability
  handlers?: { get(adapterKey: string, capability: typeof FINANCIAL_CAPABILITIES[number]): RlxCapabilityHandler | null }
  ingest?: typeof ingerirArquivoFinanceiroRlx
  publish?: typeof publicarImportacaoFinanceiraRlx
}

type CapabilityDetail = {
  capability: typeof FINANCIAL_CAPABILITIES[number]
  data_referencia: string
  status: 'PUBLICADA' | 'VALIDA' | 'FALHA' | 'NAO_CONFIGURADA' | 'INDISPONIVEL' | 'ADAPTER_NAO_IMPLEMENTADO' | 'IGNORADA_CONCORRENCIA'
  integration_version_id?: string
  provider_key?: string
  system_name?: string
  motivo?: string
}

export async function executarCicloFinanceiroRlx(dataOperacional: string, dependencies: CronDependencies = {}) {
  const supabase = dependencies.supabase || createAdminClient()
  const resolve = dependencies.resolve || resolverIntegracaoPorCapability
  const handlers = dependencies.handlers || rlxCapabilityHandlerRegistry
  const ingest = dependencies.ingest || ingerirArquivoFinanceiroRlx
  const publish = dependencies.publish || publicarImportacaoFinanceiraRlx
  const ambiente = integrationRuntimeEnvironment()
  const expectativas = resolverExpectativasCicloRlx(dataOperacional)
  const { data: funds, error: fundError } = await supabase.from('fundos').select('id').eq('ativo', true)
  if (fundError) throw new Error(`Nao foi possivel listar fundos ativos para o ciclo financeiro: ${fundError.message}`)

  let arquivos = 0
  let publicados = 0
  let falhas = 0
  let ignoradosConcorrencia = 0
  const adaptersExecutados = new Set<string>()
  const errosProviders: Array<{ provider: string; capability: string; codigo: 'TIMEOUT' | 'FALHA' | 'NAO_CONFIGURADA' | 'INDISPONIVEL' | 'ADAPTER_NAO_IMPLEMENTADO' | SinqiaProviderErrorCode }> = []

  for (const fund of funds || []) {
    const fundoId = fund.id
    const correlationId = crypto.randomUUID()
    const { data: cycleId, error: cycleError } = await supabase.rpc('iniciar_ciclo_importacao_financeira_rlx', {
      p_fundo_id: fundoId,
      p_data_operacional: dataOperacional,
      p_origem: 'CRON',
      p_correlation_id: correlationId,
    })
    if (cycleError) throw new Error(`Nao foi possivel iniciar o ciclo financeiro do fundo: ${cycleError.message}`)
    if (!cycleId) {
      ignoradosConcorrencia += FINANCIAL_CAPABILITIES.length
      continue
    }

    const details: CapabilityDetail[] = []
    for (const capability of FINANCIAL_CAPABILITIES) {
      const tipoBase = capabilityParaTipoFinanceiro(capability)
      const dataReferencia = expectativas[tipoBase]
      let resolution: IntegrationResolution
      try {
        resolution = await resolve({ fundoId, ambiente, capability })
      } catch {
        falhas += 1
        details.push({ capability, data_referencia: dataReferencia, status: 'FALHA', motivo: 'ERRO_RESOLUCAO' })
        errosProviders.push({ provider: 'resolver', capability, codigo: 'FALHA' })
        continue
      }
      if (resolution.status !== 'CONFIGURADA') {
        const status = resolution.status === 'NAO_CONFIGURADA' ? 'NAO_CONFIGURADA' : 'INDISPONIVEL'
        falhas += 1
        details.push({ capability, data_referencia: dataReferencia, status, motivo: resolution.reason })
        errosProviders.push({ provider: 'nao_resolvido', capability, codigo: status })
        continue
      }

      const version = resolution.integrationVersion
      const handler = handlers.get(version.adapterKey, capability)
      if (!handler) {
        falhas += 1
        details.push({ capability, data_referencia: dataReferencia, status: 'ADAPTER_NAO_IMPLEMENTADO', integration_version_id: version.integrationVersionId, provider_key: version.providerKey, system_name: version.systemName })
        errosProviders.push({ provider: version.adapterKey, capability, codigo: 'ADAPTER_NAO_IMPLEMENTADO' })
        continue
      }

      adaptersExecutados.add(version.adapterKey)
      try {
        const arquivo = await obterArquivoCapabilityComTimeout(handler, { dataOperacional, dataReferencia, integrationVersion: version })
        if (arquivo.fundoId !== fundoId || arquivo.tipoBase !== tipoBase || arquivo.dataReferencia !== dataReferencia) {
          throw new Error('Arquivo retornado nao corresponde ao fundo, capability ou data esperados.')
        }
        arquivos += 1
        const result = await ingest({
          ...arquivo,
          origem: 'CRON',
          atorUsuarioId: null,
          arquivo: arquivo.conteudo,
          integracaoFundoVersaoId: version.integrationVersionId,
        })
        if (result.status === 'VALIDA') {
          await publish(result.importacaoId)
          publicados += 1
          details.push({ capability, data_referencia: dataReferencia, status: 'PUBLICADA', integration_version_id: version.integrationVersionId, provider_key: version.providerKey, system_name: version.systemName })
        } else if (result.status === 'PUBLICADA') {
          publicados += 1
          details.push({ capability, data_referencia: dataReferencia, status: 'PUBLICADA', integration_version_id: version.integrationVersionId, provider_key: version.providerKey, system_name: version.systemName })
        } else {
          falhas += 1
          details.push({ capability, data_referencia: dataReferencia, status: 'FALHA', integration_version_id: version.integrationVersionId, provider_key: version.providerKey, system_name: version.systemName, motivo: `IMPORTACAO_${result.status}` })
        }
      } catch (error) {
        falhas += 1
        const code = error instanceof RlxProviderTimeoutError ? 'TIMEOUT' : error instanceof SinqiaProviderError ? error.code : 'FALHA'
        details.push({ capability, data_referencia: dataReferencia, status: 'FALHA', integration_version_id: version.integrationVersionId, provider_key: version.providerKey, system_name: version.systemName, motivo: code })
        errosProviders.push({ provider: version.adapterKey, capability, codigo: code })
      }
    }

    const successCount = details.filter((item) => item.status === 'PUBLICADA' || item.status === 'VALIDA').length
    const status = successCount === FINANCIAL_CAPABILITIES.length ? 'CONCLUIDO' : successCount === 0 ? 'FALHA' : 'PARCIAL'
    const { error: finishError } = await supabase.from('rlx_importacao_ciclos').update({
      status,
      processadas: details.length,
      falhas: details.length - successCount,
      detalhes: { capabilities: details, resumo: `${successCount}/${FINANCIAL_CAPABILITIES.length} fontes disponiveis`, correlation_id: correlationId, expectativas },
      concluida_em: new Date().toISOString(),
    }).eq('id', cycleId)
    if (finishError) throw new Error(`Nao foi possivel finalizar o ciclo financeiro do fundo: ${finishError.message}`)
  }

  return { providers: adaptersExecutados.size, arquivos, publicados, falhas, ignoradosConcorrencia, errosProviders }
}
