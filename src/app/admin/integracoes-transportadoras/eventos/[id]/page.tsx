import { notFound } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { CopiableJsonBlock } from '@/components/admin/copiable-json-block'
import { ReprocessarWebhookEventoButton } from '@/components/admin/reprocessar-webhook-evento-button'
import { obterAdminWebhookEventoTransportadora } from '@/lib/admin/integracoes-transportadoras.server'
import { statusPodeSerReprocessado } from '@/lib/admin/integracoes-transportadoras'
import { formatDateTimeSaoPaulo } from '@/lib/utils'

function Campo({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm break-all">{value ?? '-'}</p>
    </div>
  )
}

function magicBytesEspacado(hex: unknown): string | null {
  if (typeof hex !== 'string' || !hex) return null
  return hex.toUpperCase().match(/.{1,2}/g)?.join(' ') ?? null
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
        <Campo label="Recebido em" value={formatDateTimeSaoPaulo(evento.recebido_em)} />
        <Campo label="Processado em" value={evento.processado_em ? formatDateTimeSaoPaulo(evento.processado_em) : null} />
        <Campo label="Respondido em" value={evento.respondido_em ? formatDateTimeSaoPaulo(evento.respondido_em) : null} />
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

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Diagnostico tecnico</h2>
          <p className="text-xs text-muted-foreground">Visivel somente para Super Admin. Nunca exibe Base64 integral, Bearer token, cookie ou stack trace.</p>
        </div>

        <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Content-Type declarado" value={(evento.request_payload?.content_type_declarado as string) ?? evento.content_type} />
          <Campo label="MIME detectado (magic bytes)" value={(evento.request_payload?.mime_detectado as string) ?? null} />
          <Campo label="Tamanho decodificado" value={typeof evento.request_payload?.tamanho_decodificado_bytes === 'number' ? `${evento.request_payload.tamanho_decodificado_bytes} bytes` : null} />
          <Campo label="SHA-256 da imagem" value={(evento.request_payload?.imagem_sha256 as string) ?? null} />
          <Campo label="Magic bytes (HEX)" value={magicBytesEspacado(evento.request_payload?.magic_bytes_hex)} />
          <Campo label="Codigo do erro" value={evento.erro_codigo} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <CopiableJsonBlock title="Request recebido" value={evento.request_payload} />
          <CopiableJsonBlock title="Validacao do arquivo" value={evento.request_payload ? {
            content_type_declarado: evento.request_payload.content_type_declarado,
            mime_detectado: evento.request_payload.mime_detectado,
            tamanho_decodificado_bytes: evento.request_payload.tamanho_decodificado_bytes,
            imagem_sha256: evento.request_payload.imagem_sha256,
            magic_bytes_hex: evento.request_payload.magic_bytes_hex,
            codigo_erro: evento.erro_codigo,
          } : null} />
          <CopiableJsonBlock title="Response enviado" value={evento.response_payload ? { ...evento.response_payload, http_status: evento.response_http_status } : null} />
        </div>
      </section>

      {statusPodeSerReprocessado(evento.status) && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <ReprocessarWebhookEventoButton id={evento.id} />
        </section>
      )}
    </PageContainer>
  )
}
