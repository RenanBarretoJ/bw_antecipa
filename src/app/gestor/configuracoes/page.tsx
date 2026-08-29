import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ComunicacoesDoFundo } from '@/components/comunicacoes/ComunicacoesDoFundo'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PoliticasDoFundo } from '@/components/politicas/PoliticasDoFundo'
import { TemplatesDoFundo } from '@/components/templates/TemplatesDoFundo'
import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'

const tabClass = 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium'

export default async function ConfiguracoesGestorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab
  const tab = requested === 'templates' ? 'templates' : requested === 'comunicacoes' ? 'comunicacoes' : 'politicas'
  const auth = await requireGestor()
  let fundo: Awaited<ReturnType<typeof resolverContextoFundoGestor>>
  try { fundo = await resolverContextoFundoGestor(auth) } catch { redirect('/gestor/sem-fundo') }

  return <PageContainer className="space-y-5">
    <PageHeader eyebrow="Fundo ativo" title="Configuracoes operacionais" description={`${fundo.fundoNome}. Dados estruturais, CNAB, integracoes e credenciais sao administrados pela plataforma.`} />
    <div className="flex flex-wrap gap-2 border-b border-border pb-2">
      <Link className={`${tabClass} ${tab === 'politicas' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href="/gestor/configuracoes?tab=politicas">Politicas</Link>
      <Link className={`${tabClass} ${tab === 'templates' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href="/gestor/configuracoes?tab=templates">Templates juridicos</Link>
      <Link className={`${tabClass} ${tab === 'comunicacoes' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href="/gestor/configuracoes?tab=comunicacoes">Comunicacoes</Link>
    </div>
    {tab === 'politicas' ? <PoliticasDoFundo fundoId={fundo.fundoId} showFundoInLabel={false} />
      : tab === 'templates' ? <TemplatesDoFundo fundoId={fundo.fundoId} showFundoSelector={false} />
        : <ComunicacoesDoFundo fundoId={fundo.fundoId} />}
  </PageContainer>
}
