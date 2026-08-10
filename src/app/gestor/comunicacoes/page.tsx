import Link from 'next/link'
import { carregarHistoricoComunicacoes } from '@/lib/actions/comunicacoes'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/data-display/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não enviado'
}

export default async function ComunicacoesPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const fundoId = valueOf(raw.fundoId)
  const familia = valueOf(raw.familia)
  const status = valueOf(raw.status)
  const rows = await carregarHistoricoComunicacoes({ fundoId: fundoId || undefined, familia: familia || undefined, status: status || undefined, limite: 100 })

  return <PageContainer className="space-y-6">
    <PageHeader eyebrow="Operação" title="Comunicações" description="Histórico consolidado e somente leitura dos alertas, lembretes e cobranças por e-mail." />
    <form className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto]">
      <Input name="fundoId" defaultValue={fundoId} placeholder="ID do fundo" aria-label="ID do fundo" />
      <select name="familia" defaultValue={familia} className="h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Todas as famílias</option><option value="LOGISTICA">Logística</option><option value="FINANCEIRO">Financeiro</option></select>
      <select name="status" defaultValue={status} className="h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Todos os status</option>{['PENDENTE', 'PROCESSANDO', 'ENVIADA', 'FALHA', 'BLOQUEADA', 'CANCELADA'].map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <Button type="submit">Aplicar filtros</Button>
      <Link href="/gestor/comunicacoes" className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Limpar</Link>
    </form>
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[120px_130px_minmax(180px,1fr)_180px_170px] gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><span>Família</span><span>Status</span><span>Assunto / destinatário</span><span>Fundo</span><span>Data</span></div>
      <div className="divide-y divide-border">{rows.length ? rows.map((row) => <div key={row.id} className="grid grid-cols-[120px_130px_minmax(180px,1fr)_180px_170px] items-center gap-3 px-4 py-3 text-sm"><span>{row.familia === 'LOGISTICA' ? 'Logística' : 'Financeiro'}</span><StatusBadge status={row.status} /><div className="min-w-0"><p className="truncate font-medium" title={row.assunto}>{row.assunto}</p><p className="truncate text-xs text-muted-foreground" title={row.destinatario_email || row.destinatario_nome}>{row.destinatario_nome}{row.destinatario_email ? ` · ${row.destinatario_email}` : ''}</p>{row.bloqueio_motivo && <p className="mt-1 text-xs text-destructive">{row.bloqueio_motivo}</p>}</div><Link href={`/gestor/fundos/${row.fundo_id}?tab=comunicacoes`} className="truncate text-primary hover:underline" title={row.fundo_id}>{row.fundo_id.slice(0, 8)}...</Link><span className="text-xs text-muted-foreground">{formatDate(row.enviada_em || row.criada_em)}</span></div>) : <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma comunicação encontrada para os filtros aplicados.</p>}</div>
    </div>
  </PageContainer>
}
