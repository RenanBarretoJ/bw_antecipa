import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { IntegracaoTransportadoraManager } from '@/components/admin/integracao-transportadora-manager'
import { listarAdminIntegracoesTransportadoras } from '@/lib/admin/integracoes-transportadoras.server'
import { listarAdminFundos } from '@/lib/admin/fundos.server'

export default async function AdminIntegracoesTransportadorasPage() {
  const [integracoes, fundosResult] = await Promise.all([
    listarAdminIntegracoesTransportadoras(),
    listarAdminFundos({ busca: '', status: 'ativos', pagina: 1, porPagina: 100 }),
  ])

  const fundos = fundosResult.itens.map((f) => ({ id: f.id, nome: f.nome }))

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        eyebrow="Logistica"
        title="Integracoes de transportadora"
        description="Somente o Super Admin cria, ativa/desativa e gerencia o token de webhooks de comprovante de entrega. Gestor apenas analisa os comprovantes recebidos."
      />
      <IntegracaoTransportadoraManager integracoes={integracoes} fundos={fundos} />
    </PageContainer>
  )
}
