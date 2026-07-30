import { Calendar, Search, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { AuditoriaListClient } from '@/components/auditoria/auditoria-list-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { carregarAuditoria, normalizarFiltrosAuditoria } from '@/lib/auditoria/listagem.server'
import type { AuditoriaFiltros } from '@/lib/auditoria/contracts'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default async function AuditoriaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const filtros = normalizarFiltrosAuditoria({
    q: single(params.q),
    tipo: single(params.tipo),
    entidadeTipo: single(params.entidade),
    ator: single(params.ator),
    dataInicial: single(params.dataInicial),
    dataFinal: single(params.dataFinal),
  })
  const initialPage = await carregarAuditoria({ ...filtros, limit: 20 })

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ShieldCheck className="size-6 text-purple-600" />
          Auditoria
        </h1>
        <p className="text-muted-foreground">Log completo de todas as ações do sistema.</p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <form method="get" className="grid gap-3 lg:grid-cols-12">
            <label className="relative lg:col-span-4">
              <span className="sr-only">Buscar</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={filtros.q} placeholder="Buscar por evento ou entidade..." className="h-11 pl-9" />
            </label>
            <Input name="tipo" defaultValue={filtros.tipo} placeholder="Tipo de evento" className="h-11 lg:col-span-2" />
            <Input name="entidade" defaultValue={filtros.entidadeTipo} placeholder="Entidade" className="h-11 lg:col-span-2" />
            <Input name="ator" defaultValue={filtros.ator} placeholder="Ator" className="h-11 lg:col-span-2" />
            <div className="flex items-center gap-2 lg:col-span-2">
              <Calendar className="size-4 shrink-0 text-muted-foreground" />
              <Input aria-label="Data inicial" name="dataInicial" type="date" defaultValue={filtros.dataInicial} className="h-11 min-w-0" />
            </div>
            <div className="flex items-center gap-2 lg:col-span-4 lg:col-start-7">
              <span className="text-xs text-muted-foreground">até</span>
              <Input aria-label="Data final" name="dataFinal" type="date" defaultValue={filtros.dataFinal} className="h-11 min-w-0" />
              <Button type="submit">Aplicar filtros</Button>
              <Button
                render={<Link href="/gestor/auditoria" />}
                variant="outline"
                nativeButton={false}
              >
                Limpar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AuditoriaListClient initialPage={initialPage} filtros={filtros as AuditoriaFiltros} />
    </div>
  )
}
