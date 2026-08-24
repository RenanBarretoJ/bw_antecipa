import { notFound } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { ReprocessarWebhookEventoButton } from '@/components/admin/reprocessar-webhook-evento-button'
import { obterAdminWebhookEventoTransportadora } from '@/lib/admin/integracoes-transportadoras.server'
import { statusPodeSerReprocessado } from '@/lib/admin/integracoes-transportadoras'

function Campo({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm break-all">{value ?? '-'}</p>
    </div>
  )
}

export default async function AdminWebhookEventoTransportadoraDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const evento = await obterAdminWebhookEventoTransportadora(id)
  if (!evento) notFound()

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Logistica" title="Evento do webhook" description={`Status atual: ${evento.status}`} />

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-3">
        <Campo label="Recebido em" value={new Date(evento.recebido_em).toLocaleString('pt-BR')} />
        <Campo label="Processado em" value={evento.processado_em ? new Date(evento.processado_em).toLocaleString('pt-BR') : null} />
        <Campo label="Provider" value={evento.provider} />
        <Campo label="External event id" value={evento.external_event_id} />
        <Campo label="Chave NF-e" value={evento.chave_nfe} />
        <Campo label="Chave CT-e" value={evento.chave_cte} />
        <Campo label="Status" value={evento.status} />
        <Campo label="Evidencia retida" value={evento.evidencia_retida ? 'Sim -- arquivo original disponivel para reprocessamento' : 'Nao -- evento legado ou sem arquivo valido'} />
        <Campo label="Tentativas" value={evento.tentativa_count} />
        <Campo label="NF venda resolvida" value={evento.nota_fiscal_venda_id} />
        <Campo label="NF remessa resolvida" value={evento.nota_fiscal_remessa_id} />
        <Campo label="Tipo de vinculo" value={evento.tipo_vinculo} />
        <Campo label="Metodo de match" value={evento.match_metodo} />
        <Campo label="Canhoto criado" value={evento.canhoto_id} />
        <Campo label="CNPJ cliente" value={evento.cnpj_cliente} />
        <Campo label="CNPJ emitente" value={evento.cnpj_emitente} />
        <Campo label="CNPJ transportadora" value={evento.cnpj_transportadora} />
        <Campo label="Data emissao NF-e" value={evento.data_emissao_nfe} />
        <Campo label="Data entrega NF-e" value={evento.data_entrega_nfe} />
        <Campo label="Content-Type" value={evento.content_type} />
        <Campo label="Codigo do erro" value={evento.erro_codigo} />
      </section>

      {evento.erro_detalhe && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase text-muted-foreground">Motivo de revisao/erro</p>
          <p className="text-sm">{evento.erro_detalhe}</p>
        </section>
      )}

      {statusPodeSerReprocessado(evento.status) && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <ReprocessarWebhookEventoButton id={evento.id} />
        </section>
      )}
    </PageContainer>
  )
}
