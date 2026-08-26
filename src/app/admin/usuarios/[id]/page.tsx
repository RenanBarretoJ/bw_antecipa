import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, History, ShieldCheck } from 'lucide-react'
import { AdminUserActions } from '@/components/admin/admin-user-actions'
import { AdminVinculoSearchDialog } from '@/components/admin/admin-vinculo-search-dialog'
import { GestorFundAccessAction } from '@/components/admin/gestor-fund-access-action'
import { DetailField, DetailSection, EmptyState, FieldGrid, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { listarAuditoriaAdminUsuario, listarFundosAdminUsuario, obterAdminUsuario } from '@/lib/admin/usuarios.server'

const tabClass = 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium'
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Nao informado'

export default async function AdminUsuarioDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, context] = await Promise.all([params, searchParams, requireSuperAdmin()])
  const allowedTabs = ['geral', 'fundos', 'seguranca', 'auditoria'] as const
  const requested = query.tab || 'geral'
  const tab = allowedTabs.includes(requested as typeof allowedTabs[number]) ? requested as typeof allowedTabs[number] : 'geral'
  const usuario = await obterAdminUsuario(id)
  if (!usuario) notFound()
  const fundos = tab === 'fundos' ? await listarFundosAdminUsuario(id) : []
  const auditoria = tab === 'auditoria' ? await listarAuditoriaAdminUsuario(id) : []

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Usuario administrativo" title={usuario.nome_completo} description={usuario.email} action={<><StatusBadge status={usuario.status === 'ativo' ? 'ativo' : 'desativada'} label={usuario.status === 'ativo' ? 'Ativo' : 'Inativo'} /><AdminUserActions usuario={usuario} currentUserId={context.user.id} /></>} />
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {allowedTabs.map((item) => <Link key={item} className={`${tabClass} ${tab === item ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} href={`/admin/usuarios/${id}${item === 'geral' ? '' : `?tab=${item}`}`}>{item === 'geral' ? 'Geral' : item === 'fundos' ? 'Fundos' : item === 'seguranca' ? 'Seguranca' : 'Auditoria'}</Link>)}
      </div>

      {tab === 'geral' && <DetailSection title="Identidade e capacidades"><FieldGrid><DetailField label="Nome" value={usuario.nome_completo} /><DetailField label="E-mail" value={usuario.email} /><DetailField label="Papel primario" value={usuario.papel_primario.replaceAll('_', ' ')} /><DetailField label="Capacidades ativas" value={usuario.capacidades.length ? usuario.capacidades.map((item) => item.replaceAll('_', ' ')).join(', ') : 'Nenhuma'} /><DetailField label="Criado em" value={formatDate(usuario.created_at)} /><DetailField label="Atualizado em" value={formatDate(usuario.updated_at)} /></FieldGrid></DetailSection>}

      {tab === 'fundos' && (usuario.papel_primario !== 'gestor' ? <EmptyState title="Sem papel operacional Gestor" description="Super Admin puro nao recebe vinculos operacionais. Nenhum acesso global a fundos e concedido implicitamente." icon={ShieldCheck} /> : (
        <div className="space-y-4">
          <DetailSection title="Fundos vinculados" icon={Building2} action={<AdminVinculoSearchDialog direcao="fundos_para_gestor" contextoId={usuario.id} />}>
            {fundos.length === 0 ? <EmptyState title="Nenhum fundo vinculado a este gestor." description="Use Vincular fundo para localizar um cadastro por nome ou CNPJ." icon={Building2} /> : <div className="divide-y divide-border">{fundos.map((fundo) => <div key={fundo.fundo_id} className="grid items-center gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_130px_150px_auto]"><ListNameCell name={fundo.fundo_nome} subline={fundo.fundo_cnpj} className="max-w-none" /><StatusBadge status={fundo.fundo_ativo ? 'ativo' : 'desativada'} label={`Fundo ${fundo.fundo_ativo ? 'ativo' : 'inativo'}`} /><StatusBadge status="ativo" label="Vinculo ativo" /><GestorFundAccessAction usuarioId={usuario.id} fundoId={fundo.fundo_id} status={fundo.vinculo_status} /></div>)}</div>}
          </DetailSection>
        </div>
      ))}

      {tab === 'seguranca' && <DetailSection title="Seguranca da conta" icon={ShieldCheck}><FieldGrid><DetailField label="MFA" value={usuario.mfa_configurado ? 'Configurado' : 'Pendente'} /><DetailField label="Ultimo reset MFA" value={formatDate(usuario.mfa_reset_em)} /><DetailField label="Sessoes revogadas em" value={formatDate(usuario.sessoes_revogadas_em)} /></FieldGrid><p className="mt-5 text-sm text-muted-foreground">Segredos, QR Codes, tokens e identificadores de fatores nao sao exibidos. O reset administrativo exige TOTP fresco do Super Admin e esta bloqueado para a propria conta.</p></DetailSection>}

      {tab === 'auditoria' && <DetailSection title="Auditoria administrativa" icon={History}>{auditoria.length === 0 ? <EmptyState title="Nenhum evento administrativo" description="Convites, acessos, papeis, lifecycle e reset MFA aparecerao aqui." icon={History} /> : <div className="divide-y divide-border">{auditoria.map((item) => <div key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_220px]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.tipo_evento}</p><p className="truncate text-xs text-muted-foreground">{item.ator_nome || 'Usuario nao identificado'} · {item.origem}</p></div><div className="text-sm text-muted-foreground sm:text-right"><p>{formatDate(item.created_at)}</p><p className="truncate font-mono text-xs" title={item.correlation_id || undefined}>{item.correlation_id}</p></div></div>)}</div>}</DetailSection>}
    </PageContainer>
  )
}
