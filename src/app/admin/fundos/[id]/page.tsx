import Link from 'next/link'
import { notFound } from 'next/navigation'
import { History, Users } from 'lucide-react'
import { FundoLifecycleAction } from '@/components/admin/fundo-lifecycle-action'
import { FundoIntegracoesTecnicas } from '@/components/admin/fundo-integracoes-tecnicas'
import { FundoCnabTecnico } from '@/components/admin/fundo-cnab-tecnico'
import { FundoStructuralForm } from '@/components/admin/fundo-structural-form'
import { GestorFundAccessAction } from '@/components/admin/gestor-fund-access-action'
import { DetailField, DetailSection, EmptyState, FieldGrid, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAuditoriaAdminFundo, obterAdminFundo } from '@/lib/admin/fundos.server'
import { listarGestoresAdminFundo } from '@/lib/admin/usuarios.server'
import { obterConfiguracoesTecnicasAdminFundo } from '@/lib/admin/configuracoes-tecnicas.server'
import { formatCNPJ } from '@/lib/utils'

const tabClass = 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium'
const formatDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

export default async function AdminFundoDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; execPage?: string }> }) {
  const { id } = await params
  const query = await searchParams
  const requestedTab = query.tab
  const execPage = Math.max(1, Number.parseInt(query.execPage || '1', 10) || 1)
  const tab = requestedTab === 'auditoria' ? 'auditoria' : requestedTab === 'gestores' ? 'gestores' : requestedTab === 'integracoes' ? 'integracoes' : requestedTab === 'cnab' ? 'cnab' : 'geral'
  const fundo = await obterAdminFundo(id)
  if (!fundo) notFound()
  const auditoria = tab === 'auditoria' ? await listarAuditoriaAdminFundo(id) : []
  const gestores = tab === 'gestores' ? await listarGestoresAdminFundo(id) : []
  const technical = tab === 'integracoes' || tab === 'cnab' ? await obterConfiguracoesTecnicasAdminFundo(id, execPage) : null

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Detalhe do fundo" title={fundo.nome} description={formatCNPJ(fundo.cnpj)} action={<><StatusBadge status={fundo.ativo ? 'ativo' : 'desativada'} label={fundo.ativo ? 'Ativo' : 'Inativo'} /><FundoLifecycleAction fundoId={fundo.id} updatedAt={fundo.updated_at} ativo={fundo.ativo} /></>} />
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <Link className={`${tabClass} ${tab === 'geral' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}`}>Geral</Link>
        <Link className={`${tabClass} ${tab === 'gestores' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}?tab=gestores`}>Gestores</Link>
        <Link className={`${tabClass} ${tab === 'integracoes' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}?tab=integracoes`}>Integracoes</Link>
        <Link className={`${tabClass} ${tab === 'cnab' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/fundos/${id}?tab=cnab`}>CNAB</Link>
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
      </> : tab === 'gestores' ? (
        <DetailSection title="Gestores autorizaveis" icon={Users}>
          {!fundo.ativo && (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              Os vinculos podem ser preparados, mas este fundo esta inativo e nao concede contexto operacional.
            </p>
          )}
          {gestores.length === 0 ? <EmptyState title="Nenhum Gestor cadastrado" description="Crie um Gestor em Usuarios & Acessos antes de vincula-lo ao fundo." icon={Users} /> : (
            <div className="divide-y divide-border">
              {gestores.map((gestor) => (
                <div key={gestor.usuario_id} className="grid items-center gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_140px_160px_auto]">
                  <ListNameCell name={gestor.nome_completo} subline={gestor.email} className="max-w-none" sublineClassName="font-sans" />
                  <StatusBadge status={gestor.usuario_status === 'ativo' ? 'ativo' : 'desativada'} label={`Usuario ${gestor.usuario_status === 'ativo' ? 'ativo' : 'inativo'}`} />
                  <StatusBadge status={gestor.vinculo_status === 'ativo' ? 'ativo' : 'desativada'} label={`Vinculo ${gestor.vinculo_status || 'inexistente'}`} />
                  <GestorFundAccessAction usuarioId={gestor.usuario_id} fundoId={id} status={gestor.vinculo_status} />
                </div>
              ))}
            </div>
          )}
        </DetailSection>
      ) : tab === 'integracoes' && technical ? (
        <FundoIntegracoesTecnicas state={technical} execPage={execPage} />
      ) : tab === 'cnab' && technical ? (
        <FundoCnabTecnico state={technical} />
      ) : (
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
