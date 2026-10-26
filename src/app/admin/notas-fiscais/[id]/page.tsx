import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { SituacaoFiscalNfeCard } from '@/components/notas-fiscais/SituacaoFiscalNfeCard'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireRole } from '@/lib/auth/authorization'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'

interface AdminNfeIdentity {
  id: string
  numeroNf: string
  serie: string | null
  chaveAcesso: string | null
  dataEmissao: string
  cnpjEmitente: string
  cnpjDestinatario: string
  valorBruto: number
  status: string
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

function isAdminNfeIdentity(value: unknown): value is AdminNfeIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.numeroNf === 'string'
    && typeof row.dataEmissao === 'string'
    && typeof row.cnpjEmitente === 'string'
    && typeof row.cnpjDestinatario === 'string'
    && typeof row.valorBruto === 'number'
    && typeof row.status === 'string'
}

export default async function AdminNfeFiscalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireRole('super_admin')
  const db = context.supabase as unknown as RpcClient
  const { data, error } = await db.rpc('obter_nfe_identidade_fiscal_admin', { p_nota_fiscal_id: id })
  if (error || !isAdminNfeIdentity(data)) notFound()

  return (
    <main className="mx-auto max-w-4xl space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Link href="/admin/fundos" aria-label="Voltar para Fundos" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">NF-e {data.numeroNf}</h1>
          <p className="text-sm text-muted-foreground">Visão fiscal privativa do Super Admin</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Identidade fiscal</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Série</span><br /><strong>{data.serie || '—'}</strong></p>
          <p><span className="text-muted-foreground">Emissão</span><br /><strong>{formatDate(data.dataEmissao)}</strong></p>
          <p><span className="text-muted-foreground">Emitente</span><br /><strong>{formatCNPJ(data.cnpjEmitente)}</strong></p>
          <p><span className="text-muted-foreground">Destinatário</span><br /><strong>{formatCNPJ(data.cnpjDestinatario)}</strong></p>
          <p><span className="text-muted-foreground">Valor total</span><br /><strong>{formatCurrency(data.valorBruto)}</strong></p>
          <p className="break-all"><span className="text-muted-foreground">Chave</span><br /><strong>{data.chaveAcesso || '—'}</strong></p>
        </CardContent>
      </Card>
      {data.status !== 'rascunho' && <SituacaoFiscalNfeCard notaFiscalId={id} />}
    </main>
  )
}
