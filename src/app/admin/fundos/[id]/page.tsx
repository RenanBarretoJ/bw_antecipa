import Link from 'next/link'
import { notFound } from 'next/navigation'
import { History } from 'lucide-react'
import { FundoLifecycleAction } from '@/components/admin/fundo-lifecycle-action'
import { FundoStructuralForm } from '@/components/admin/fundo-structural-form'
import { DetailField, DetailSection, EmptyState, FieldGrid, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAuditoriaAdminFundo, obterAdminFundo } from '@/lib/admin/fundos.server'
import { formatCNPJ } from '@/lib/utils'

const tabClass = 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium'
const formatDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

export default async function AdminFundoDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const tab = (await searchParams).tab === 'auditoria' ? 'auditoria' : 'geral'
  const fundo = await obterAdminFundo(id)
  if (!fundo) notFound()
  const auditoria = tab === 'auditoria' ? await listarAuditoriaAdminFundo(id) : []

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Detalhe do fundo" title={fundo.nome} description={formatCNPJ(fundo.cnpj)} action={<><StatusBadge status={fundo.ativo ? 'ativo' : 'desativada'} label={fundo.ativo ? 'Ativo' : 'Inativo'} /><FundoLifecycleAction fundoId={fundo.id} updatedAt={fundo.updated_at} ativo={fundo.ativo} /></>} />
      <div className="flex gap-2 border-b border-border pb-2">
        <Link className={`${tabClass} ${tab === 'geral' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}`}>Geral</Link>
        <Link className={`${tabClass} ${tab === 'auditoria' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}?tab=auditoria`}>Auditoria</Link>
      </div>

      {tab === 'geral' ? <>
        <DetailSection title="Identidade estrutural">
          <FieldGrid>
            <DetailField label="Administradora" value={`${fundo.administradora_nome} · ${formatCNPJ(fundo.administradora_cnpj)}`} />
            <DetailField label="Gestora" value={`${fundo.gestora_nome} · ${formatCNPJ(fundo.gestora_cnpj)}`} />
            <DetailField label="Custodiante" value={fundo.custodiante_nome ? `${fundo.custodiante_nome} · ${formatCNPJ(fundo.custodiante_cnpj || '')}` : 'Nao informado'} />
            <DetailField label="Contato" value={fundo.contato_nome || 'Nao informado'} />
            <DetailField label="E-mail" value={fundo.contato_email || 'Nao informado'} />
            <DetailField label="Criado em" value={formatDate(fundo.created_at)} />
          </FieldGrid>
        </DetailSection>
        <details className="rounded-xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer px-5 py-4 font-semibold">Editar dados estruturais</summary>
          <div className="border-t border-border p-5"><FundoStructuralForm fundo={fundo} /></div>
        </details>
      </> : (
        <DetailSection title="Auditoria estrutural" icon={History}>
          {auditoria.length === 0 ? <EmptyState title="Nenhum evento registrado" description="As mutacoes estruturais deste fundo aparecerao aqui." icon={History} /> : (
            <div className="divide-y divide-border">
              {auditoria.map((item) => (
                <div key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.tipo_evento}</p><p className="truncate text-xs text-muted-foreground">{item.ator_nome || 'Usuario nao identificado'} · {item.origem}</p></div>
                  <div className="text-sm text-muted-foreground sm:text-right"><p>{formatDate(item.created_at)}</p>{item.correlation_id && <p className="truncate font-mono text-xs" title={item.correlation_id}>{item.correlation_id}</p>}</div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>
      )}
    </PageContainer>
  )
}
