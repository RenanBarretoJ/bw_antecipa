import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FILAS_CONCILIACAO, hrefConciliacao } from '@/lib/navigation/conciliacao'
import { cn } from '@/lib/utils'
import { estadoFilaConciliacao, type PendingWorkqueuesData } from './pending-workqueues'

const TITULOS = { matching: 'Vínculos com NF', conciliacao: 'Movimentações do estoque', logistica: 'Evidências logísticas' }

export function PendingWorkqueues({ dashboard }: { dashboard: PendingWorkqueuesData }) {
  return <section aria-label="Filas de pendências" className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {FILAS_CONCILIACAO.map(fila => {
        const state = estadoFilaConciliacao(dashboard, fila)
        const selected = dashboard.filtros.fila === fila
        return <Card key={fila} className={cn(selected && 'ring-2 ring-primary')}>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">{TITULOS[fila]}</h3>
            <p className="text-sm text-muted-foreground">{state.label}</p>
            <Button variant={selected ? 'default' : 'outline'} render={<Link href={hrefConciliacao('excecoes', dashboard.filtros.dataReferencia, fila)} scroll={false} prefetch={false} aria-current={selected ? 'page' : undefined} />} nativeButton={false}>
              {selected ? 'Fila selecionada' : 'Abrir fila'}
            </Button>
          </CardContent>
        </Card>
      })}
      <Card><CardContent className="space-y-3">
        <h3 className="font-semibold">Avaliação de risco</h3>
        <p className="text-sm text-muted-foreground">{dashboard.erros.risco ? 'Não foi possível conferir a avaliação' : dashboard.riscoExecucao?.decisao || (dashboard.riscoExecucao?.aplicavel === false ? 'Não aplicável' : 'Ainda não avaliada nesta data')}</p>
        <Button variant="outline" render={<Link href={hrefConciliacao('risco', dashboard.filtros.dataReferencia)} scroll={false} prefetch={false} />} nativeButton={false}>Ver avaliação e revisões</Button>
      </CardContent></Card>
    </div>
    <p className="text-sm text-muted-foreground">Selecione uma fila para tratar seus registros. As filas têm paginação própria; um mesmo título pode ter pendências em mais de uma origem. As ocorrências não são somadas como títulos únicos.</p>
  </section>
}
