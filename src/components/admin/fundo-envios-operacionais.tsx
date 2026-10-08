import Link from 'next/link'
import { Send } from 'lucide-react'
import { FundoCnabTecnico } from '@/components/admin/fundo-cnab-tecnico'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/data-display/primitives'
import { resolverDefinicaoRemessaOperacional, resolverMetodoEnvioOperacional } from '@/lib/integracoes/registry.server'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '@/lib/integracoes/resolver.server'
import type { AdminConfiguracoesTecnicasFundo } from '@/lib/admin/configuracoes-tecnicas'
import { podeParametrizarCnab } from '@/lib/admin/cnab-availability.server'

export async function FundoEnviosOperacionais({ state }: { state: AdminConfiguracoesTecnicasFundo }) {
  const ambiente = integrationRuntimeEnvironment()
  const resolution = await resolverIntegracaoPorCapability({
    fundoId: state.fundo.id,
    ambiente,
    capability: 'CESSAO_ENVIO',
  })
  const integration = resolution.status === 'CONFIGURADA' ? resolution.integrationVersion : null
  const cnab = state.cnab.flatMap((config) => config.versoes.map((version) => ({ config, version })))
    .find(({ version }) => version.status === 'publicada' && !version.vigente_ate)
  const method = integration?.adapterKey
    ? resolverMetodoEnvioOperacional(integration.adapterKey, 'CESSAO_ENVIO')
    : null
  const remittance = integration?.adapterKey ? resolverDefinicaoRemessaOperacional(integration.adapterKey) : null
  const configured = Boolean(integration && remittance && (method !== 'CNAB' || cnab))
  const showCnab = podeParametrizarCnab(state.integracoes, ambiente, integration?.adapterKey || null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="size-5" />Envio de Cessao</CardTitle>
          <CardDescription>A integracao pode ser ativada antes da configuracao do arquivo. O envio exige os parametros do formato utilizado pelo provedor.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">Status</p><StatusBadge status={configured ? 'ativo' : 'pendente'} label={configured ? 'Configurado' : 'Nao configurado'} /></div>
          <div><p className="text-xs uppercase text-muted-foreground">Integracao</p><p className="font-medium">{integration ? `${integration.systemName} · v${integration.version}` : 'Nao configurada'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Metodo</p><p className="font-medium">{method || 'Nao definido'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Agrupamento</p><p className="font-medium">{remittance?.estrategiaAgrupamento === 'POR_CEDENTE' ? 'Por Cedente' : remittance ? 'Por lote' : 'Nao definido'}</p></div>
          {method === 'CNAB' && <div className="md:col-span-4"><p className="text-xs uppercase text-muted-foreground">Configuracao de arquivo</p><p className="font-medium">{cnab ? `${cnab.config.nome} · v${cnab.version.versao}` : 'CNAB nao publicado'}</p></div>}
          {integration && method === 'CNAB' && !cnab && <p className="md:col-span-4 text-sm text-warning">Integracao ativa. Publique o CNAB abaixo para liberar a geracao e o envio de remessas. As consultas financeiras nao dependem do CNAB.</p>}
          {method === 'VRS_CSV' && <p className="md:col-span-4 text-sm text-muted-foreground">O sistema gera a remessa em CSV para Vortx VRS 2.0. Parametrizacao CNAB nao se aplica.</p>}
          {!integration && <p className="md:col-span-4 text-sm text-muted-foreground">Nenhuma integracao esta configurada para envio de cessao. Configure uma integracao com a capability &quot;Cessao e envio&quot; na aba <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/fundos/${state.fundo.id}?tab=integracoes`}>Integracoes</Link>.</p>}
        </CardContent>
      </Card>
      {showCnab && <FundoCnabTecnico state={state} />}
    </div>
  )
}
