import Link from 'next/link'
import { Send } from 'lucide-react'
import { FundoCnabTecnico } from '@/components/admin/fundo-cnab-tecnico'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/data-display/primitives'
import { resolverMetodoEnvioOperacional } from '@/lib/integracoes/registry.server'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '@/lib/integracoes/resolver.server'
import type { AdminConfiguracoesTecnicasFundo } from '@/lib/admin/configuracoes-tecnicas'

export async function FundoEnviosOperacionais({ state }: { state: AdminConfiguracoesTecnicasFundo }) {
  const resolution = await resolverIntegracaoPorCapability({
    fundoId: state.fundo.id,
    ambiente: integrationRuntimeEnvironment(),
    capability: 'CESSAO_ENVIO',
  })
  const integration = resolution.status === 'CONFIGURADA' ? resolution.integrationVersion : null
  const cnab = state.cnab.flatMap((config) => config.versoes.map((version) => ({ config, version })))
    .find(({ version }) => version.status === 'publicada' && !version.vigente_ate)
  const method = integration?.adapterKey
    ? resolverMetodoEnvioOperacional(integration.adapterKey, 'CESSAO_ENVIO')
    : null
  const configured = Boolean(integration && cnab && method === 'CNAB')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="size-5" />Envio de Cessao</CardTitle>
          <CardDescription>A operacao de cessao resolve a capability CESSAO_ENVIO e utiliza a configuracao CNAB publicada deste fundo.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">Status</p><StatusBadge status={configured ? 'ativo' : 'pendente'} label={configured ? 'Configurado' : 'Nao configurado'} /></div>
          <div><p className="text-xs uppercase text-muted-foreground">Integracao</p><p className="font-medium">{integration ? `${integration.systemName} · v${integration.version}` : 'Nao configurada'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Metodo</p><p className="font-medium">{method || 'Nao definido'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Configuracao de arquivo</p><p className="font-medium">{cnab ? `${cnab.config.nome} · v${cnab.version.versao}` : 'CNAB nao publicado'}</p></div>
          {!integration && <p className="md:col-span-4 text-sm text-muted-foreground">Nenhuma integracao esta configurada para envio de cessao. Configure uma integracao com a capability &quot;Cessao e envio&quot; na aba <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/fundos/${state.fundo.id}?tab=integracoes`}>Integracoes</Link>.</p>}
        </CardContent>
      </Card>
      {integration && method === 'CNAB' && <FundoCnabTecnico state={state} />}
    </div>
  )
}
