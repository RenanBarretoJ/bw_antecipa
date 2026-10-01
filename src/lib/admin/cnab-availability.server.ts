import 'server-only'

import type { AdminIntegracao } from './configuracoes-tecnicas'
import { resolverMetodoEnvioOperacional } from '@/lib/integracoes/registry.server'

// Cadastro tecnico nao equivale a readiness de envio. Um rascunho permite
// preparar o CNAB, mas nunca se torna fonte operacional por este helper.
export function podeParametrizarCnab(
  integracoes: AdminIntegracao[],
  ambiente: 'homologacao' | 'producao',
  adapterOperacional: string | null,
): boolean {
  if (adapterOperacional) return resolverMetodoEnvioOperacional(adapterOperacional, 'CESSAO_ENVIO') === 'CNAB'
  return integracoes.some((integracao) => integracao.versoes.some((versao) =>
    versao.ambiente === ambiente
    && (versao.status === 'rascunho' || (versao.status === 'publicada' && !versao.vigente_ate))
    && versao.capabilities.includes('CESSAO_ENVIO')
    && Boolean(versao.adapter_key && resolverMetodoEnvioOperacional(versao.adapter_key, 'CESSAO_ENVIO') === 'CNAB'),
  ))
}
