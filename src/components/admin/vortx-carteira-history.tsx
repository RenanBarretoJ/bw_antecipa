'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, formatDateTimeSaoPaulo } from '@/lib/utils'
import { hrefHistoricoCarteira, lerFiltrosCarteira, TAMANHO_PAGINA_CARTEIRA, type HistoricoCarteira } from '@/lib/integracoes/vortx/carteira-historico'
import styles from './central-bases.module.css'

export function VortxCarteiraHistory({ historico, href }: { historico: HistoricoCarteira; href: string }) {
  const router = useRouter(), [pending, startTransition] = useTransition()
  const { registros, total, pagina, filtros } = historico
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA_CARTEIRA))
  const filtrado = Boolean(filtros.estado || filtros.referencia)
  return <Card id="historico-carteira" className={styles.history} aria-busy={pending}>
    <CardHeader><div className={styles.historyHeading}><div><CardTitle>Histórico da carteira <span className={styles.badge}>{total}</span></CardTitle>
      <CardDescription>Posições salvas e versões retificadas. Ordenadas pela data da posição, não pela última consulta.</CardDescription></div>
      <Button type="button" variant="outline" className={styles.button} disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden="true" className="size-4" />Atualizar histórico da carteira</Button>
    </div></CardHeader>
    <CardContent>
      <form key={JSON.stringify(filtros)} className={`${styles.toolbar} ${styles.walletToolbar}`} aria-label="Filtrar histórico da carteira" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const selecionados = lerFiltrosCarteira({ carteiraEstado: String(form.get('carteiraEstado') || ''), carteiraReferencia: String(form.get('carteiraReferencia') || '') })
        startTransition(() => router.push(hrefHistoricoCarteira(href, selecionados)))
      }}>
        <label htmlFor="carteira-historico-estado">Situação da versão<select id="carteira-historico-estado" name="carteiraEstado" defaultValue={filtros.estado || ''} disabled={pending}><option value="">Todas as situações</option><option value="PUBLICADA">Publicada</option><option value="RETIFICADA">Retificada · substituída</option></select></label>
        <label htmlFor="carteira-historico-referencia">Data da posição<Input id="carteira-historico-referencia" type="date" name="carteiraReferencia" defaultValue={filtros.referencia || ''} disabled={pending} /></label>
        <Button type="submit" variant="outline" className={styles.button} disabled={pending}>Filtrar carteira</Button>
        {filtrado && <Link className="inline-flex min-h-11 items-center text-primary underline" href={hrefHistoricoCarteira(href, {})}>Limpar filtros da carteira</Link>}
      </form>
      {registros.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{filtrado ? 'Nenhuma posição salva corresponde aos filtros. O histórico foi preservado.' : 'Nenhuma posição salva nesta página.'}</p> :
        <Table containerProps={{ tabIndex: 0, role: 'region', 'aria-label': 'Histórico da carteira; role horizontalmente em telas menores' }}>
          <TableHeader><TableRow><TableHead>Data da posição</TableHead><TableHead>Processamento</TableHead><TableHead>Situação</TableHead><TableHead>PL total</TableHead><TableHead>Conferência por cota</TableHead></TableRow></TableHeader>
          <TableBody>{registros.map(row => <TableRow key={row.id}>
            <TableCell className="font-semibold tabular-nums">{formatDate(row.dataReferencia)}</TableCell>
            <TableCell><p>API Carteira · JSON</p><p>Recebida: {formatDateTimeSaoPaulo(row.recebidaEm)}</p><p>Publicada: {formatDateTimeSaoPaulo(row.publicadaEm)}</p></TableCell>
            <TableCell><span className={`${styles.badge} ${row.estado === 'PUBLICADA' ? styles.green : styles.amber}`}>{row.estado === 'PUBLICADA' ? 'Publicada' : 'Retificada · substituída'}</span>{row.substituidaEm && <p>Substituída: {formatDateTimeSaoPaulo(row.substituidaEm)}</p>}</TableCell>
            <TableCell className="font-semibold tabular-nums">{formatCurrency(Number(row.patrimonioLiquidoTotal))}</TableCell>
            <TableCell><details><summary className="cursor-pointer">Conferir {row.cotas.length} cotas</summary><dl className="space-y-2 pt-2">{row.cotas.map(cota => <div key={cota.codigoCarteira}><dt>{cota.rotulo} · {cota.codigoCarteira}</dt><dd className="tabular-nums font-semibold">{formatCurrency(Number(cota.patrimonioLiquido))}</dd></div>)}</dl></details></TableCell>
          </TableRow>)}</TableBody>
        </Table>}
      <p className="px-5 py-4 text-xs text-muted-foreground">Abrir ou atualizar esta lista não consulta a Vórtx. Conteúdos idênticos não criam novas versões. Consultas sem persistência não constam nesta lista; uma versão retificada não é reativada.</p>
      <nav aria-label="Páginas do histórico da carteira" className={styles.pagination}><span>{registros.length ? `${(pagina - 1) * TAMANHO_PAGINA_CARTEIRA + 1}–${(pagina - 1) * TAMANHO_PAGINA_CARTEIRA + registros.length} de ${total}` : `0 registros nesta página · ${total} no resultado`} · até 20 por página</span><div className="flex items-center gap-3">
        {pagina > 1 && <Link className="inline-flex min-h-11 items-center underline" href={hrefHistoricoCarteira(href, filtros, pagina - 1)}>Anterior</Link>}
        <span>Página {pagina} de {paginas}</span>{pagina < paginas && <Link className="inline-flex min-h-11 items-center underline" href={hrefHistoricoCarteira(href, filtros, pagina + 1)}>Próxima</Link>}
      </div></nav>
    </CardContent>
  </Card>
}
