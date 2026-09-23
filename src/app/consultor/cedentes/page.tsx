import Link from 'next/link'
import { Building2, FileText, Pencil, Plus, Search } from 'lucide-react'
import { listarCedentesGerenciadosConsultor } from '@/lib/consultor/cedentes.server'
import { formatCNPJ } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const statusLabels: Record<string, string> = {
  pendente: 'Cadastro pendente', em_analise: 'Em análise', ativo: 'Aprovado',
  reprovado: 'Requer correção', bloqueado: 'Bloqueado',
}

export default async function CedentesConsultorPage({ searchParams }: {
  searchParams: Promise<{ busca?: string; pagina?: string }>
}) {
  const params = await searchParams
  const busca = params.busca?.trim().slice(0, 120) || ''
  const pagina = Math.max(1, Number.parseInt(params.pagina || '1', 10) || 1)
  const resultado = await listarCedentesGerenciadosConsultor({ termo: busca, pagina, porPagina: 10 })
  const totalPaginas = Math.max(1, Math.ceil(resultado.total / resultado.porPagina))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold">Cedentes</h1><p className="text-muted-foreground">Cadastre empresas, acompanhe documentos e consulte a aprovação.</p></div>
        <Link href="/consultor/cedentes/novo" className={buttonVariants()}><Plus />Cadastrar Cedente</Link>
      </div>
      <Card><CardContent className="pt-4"><form className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="busca" defaultValue={busca} placeholder="Razão Social, Nome Fantasia ou CNPJ" className="pl-9" /></div><Button type="submit">Buscar</Button></form></CardContent></Card>
      {resultado.itens.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><Building2 className="mx-auto mb-3 size-12 text-muted-foreground/30" /><p className="text-muted-foreground">Nenhum Cedente encontrado.</p></CardContent></Card>
      ) : <div className="space-y-3">{resultado.itens.map((cedente) => (
        <Card key={cedente.id}><CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-lg font-semibold">{cedente.razao_social}</p><Badge variant={cedente.status === 'ativo' ? 'default' : cedente.status === 'reprovado' ? 'destructive' : 'outline'}>{statusLabels[cedente.status] || cedente.status}</Badge><Badge variant="secondary">Vínculo {cedente.vinculo_status}</Badge></div><div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3"><span className="font-mono">{formatCNPJ(cedente.cnpj)}</span><span className="truncate">{cedente.fundo_nome}</span><span>{cedente.documentos_pendentes} documento(s) pendente(s)</span></div></div>
          <div className="flex flex-wrap gap-2"><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/consultor/cedentes/${cedente.id}/cadastro`}><Pencil />{cedente.onboarding_concluido_em ? 'Ver cadastro' : 'Continuar cadastro'}</Link><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/consultor/cedentes/${cedente.id}/documentos`}><FileText />Documentos</Link></div>
        </CardContent></Card>
      ))}</div>}
      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{resultado.total} Cedente(s)</span><div className="flex items-center gap-2">{pagina > 1 ? <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/consultor/cedentes?busca=${encodeURIComponent(busca)}&pagina=${pagina - 1}`}>Anterior</Link> : <Button variant="outline" size="sm" disabled>Anterior</Button>}<span>Página {pagina} de {totalPaginas}</span>{pagina < totalPaginas ? <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/consultor/cedentes?busca=${encodeURIComponent(busca)}&pagina=${pagina + 1}`}>Próxima</Link> : <Button variant="outline" size="sm" disabled>Próxima</Button>}</div></div>
    </div>
  )
}
