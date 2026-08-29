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
        <CardContent>
          <form method="get" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
              <label className="relative md:col-span-2 xl:col-span-4">
                <span className="sr-only">Buscar</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={filtros.q}
                  placeholder="Buscar por evento ou entidade..."
                  className="h-11 pl-9"
                />
              </label>
              <Input
                aria-label="Tipo de evento"
                name="tipo"
                defaultValue={filtros.tipo}
                placeholder="Tipo de evento"
                className="h-11 xl:col-span-3"
              />
              <Input
                aria-label="Entidade"
                name="entidade"
                defaultValue={filtros.entidadeTipo}
                placeholder="Entidade"
                className="h-11 xl:col-span-3"
              />
              <Input
                aria-label="Ator"
                name="ator"
                defaultValue={filtros.ator}
                placeholder="Ator"
                className="h-11 xl:col-span-2"
              />
            </div>

            <div className="flex flex-col gap-4 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
              <fieldset className="w-full min-w-0 lg:max-w-xl">
                <legend className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Calendar className="size-4" />
                  Período
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0 space-y-1">
                    <span className="text-xs text-muted-foreground">De</span>
                    <Input
                      name="dataInicial"
                      type="date"
                      defaultValue={filtros.dataInicial}
                      className="h-11"
                    />
                  </label>
                  <label className="min-w-0 space-y-1">
                    <span className="text-xs text-muted-foreground">Até</span>
                    <Input
                      name="dataFinal"
                      type="date"
                      defaultValue={filtros.dataFinal}
                      className="h-11"
                    />
                  </label>
                </div>
              </fieldset>

              <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
                <Button
                  render={<Link href="/gestor/auditoria" />}
                  variant="outline"
                  nativeButton={false}
                  className="h-11 sm:min-w-24"
                >
                  Limpar
                </Button>
                <Button type="submit" className="h-11 sm:min-w-32">
                  Aplicar filtros
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <AuditoriaListClient initialPage={initialPage} filtros={filtros as AuditoriaFiltros} />
    </div>
  )
}
